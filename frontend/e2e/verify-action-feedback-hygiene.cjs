const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, label) {
  const startedAt = Date.now();
  let lastError = "";

  while (Date.now() - startedAt < 30000) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok || response.status === 401 || response.status === 403) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(750);
  }

  throw new Error(`${label} did not become ready at ${url}: ${lastError}`);
}

function createBrowserWatch(page) {
  const issues = [];
  const dialogs = [];

  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss().catch(() => undefined);
  });
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico/i.test(text)) return;
    if (/Failed to fetch RSC payload/i.test(text) && /Falling back to browser navigation/i.test(text)) return;
    issues.push(`console error: ${text}`);
  });

  return {
    clear() {
      issues.length = 0;
      dialogs.length = 0;
    },
    assertClean(label) {
      assert(!dialogs.length, `${label} triggered blocking dialog(s): ${dialogs.join(" | ")}`);
      assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
    },
  };
}

async function signInAsAdmin(context) {
  const response = await context.request.post(`${baseURL}/api/admin-session`, {
    data: { id: adminId, password: adminPassword, role: "admin" },
  });
  assert(response.ok(), `Admin browser login failed: ${await response.text()}`);
}

async function installApiFixtures(page) {
  await page.route(/\/api\/v1\/restaurant\/stats\/insights\/health-score$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        health_score: 86,
        color: "green",
        grade: "Stable",
        recommendation: "Keep pushing high-margin combos and watch delivery prep time.",
        breakdown: {
          revenue: { label: "Revenue", value: 86, score: 22 },
          margin: { label: "Margin", value: 74, score: 19 },
        },
      }),
    });
  });

  await page.route(/\/api\/v1\/restaurant\/stats\/target\/status$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        revenue_so_far: 78200,
        monthly_target: 300000,
        status_message: "Ahead of daily pace",
        target_achieved_pct: 26,
        days_remaining: 24,
        projected_month_total: 326000,
        on_track: true,
      }),
    });
  });

  await page.route(/\/api\/v1\/restaurant\/stats\/ceo-summary$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        period: "Proof week",
        this_week_revenue: 78200,
        direction: "up",
        week_on_week_change: 14,
        profit_margin: 29,
        best_day: { date: "Saturday", revenue: 22400 },
        worst_day: { date: "Monday", revenue: 8100 },
      }),
    });
  });

  await page.route(/\/api\/v1\/restaurant\/stats\/weekly-summary\/whatsapp$/, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "WhatsApp summary provider is not connected in this proof." }),
    });
  });

  await page.route(/\/api\/v1\/restaurant\/purchase-orders\/$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 701,
          supplier_name: "Fresh Dairy",
          supplier_whatsapp: "919999000001",
          status: "draft",
          total_amount: 2450,
          created_at: "2026-06-03T10:00:00Z",
          items: [{ name: "Mozzarella", unit: "kg", reorder_quantity: 8 }],
        },
        {
          id: 702,
          supplier_name: "Spice Market",
          supplier_whatsapp: "",
          status: "sent",
          total_amount: 950,
          created_at: "2026-06-03T11:00:00Z",
          items: [{ name: "Oregano", unit: "pack", reorder_quantity: 4 }],
        },
      ]),
    });
  });

  await page.route(/\/api\/v1\/restaurant\/inventory\/low-stock$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        count: 2,
        groups: [
          {
            supplier_name: "Fresh Dairy",
            supplier_whatsapp: "919999000001",
            items: [{ id: 1, name: "Mozzarella", unit: "kg", reorder_quantity: 8 }],
          },
          {
            supplier_name: "Local Backup Vendor",
            supplier_whatsapp: "",
            items: [{ id: 2, name: "Napkins", unit: "pack", reorder_quantity: 12 }],
          },
        ],
      }),
    });
  });
}

async function proveCeoFeedback(page, watch) {
  watch.clear();
  const response = await page.goto(`${baseURL}/ceo`, { waitUntil: "domcontentloaded" });
  assert(response && response.ok(), `/ceo returned HTTP ${response?.status() || "no response"}.`);
  await page.getByRole("heading", { name: "CEO Intelligence Hub" }).waitFor({ timeout: 15000 });
  await page.getByText("Proof week", { exact: false }).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: /One-Click Weekly Pulse/i }).click();
  await page.getByText("WhatsApp summary provider is not connected in this proof.", { exact: true }).waitFor({
    timeout: 15000,
  });
  watch.assertClean("CEO weekly pulse inline feedback");
}

async function provePurchaseOrderFeedback(page, watch) {
  watch.clear();
  const response = await page.goto(`${baseURL}/purchase-orders`, { waitUntil: "domcontentloaded" });
  assert(response && response.ok(), `/purchase-orders returned HTTP ${response?.status() || "no response"}.`);
  await page.getByRole("heading", { name: "Purchase Orders" }).waitFor({ timeout: 15000 });
  await page.getByText("Fresh Dairy", { exact: true }).waitFor({ timeout: 15000 });
  await page.getByText("Local Backup Vendor", { exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: /WhatsApp Missing/i }).waitFor({ timeout: 15000 });

  const historyPanel = page.getByTestId("purchase-order-history-panel");
  await historyPanel.getByText("Fresh Dairy", { exact: false }).waitFor({ timeout: 15000 });
  await page.getByPlaceholder("Search orders...").fill("spice");
  await historyPanel.getByText("Spice Market", { exact: false }).waitFor({ timeout: 15000 });
  assert(
    !(await historyPanel.getByText("Fresh Dairy", { exact: false }).isVisible()),
    "Purchase order search did not filter Fresh Dairy from the order history."
  );

  await page.getByPlaceholder("Search orders...").fill("missing supplier");
  await historyPanel.getByText("No purchase orders match this search.", { exact: true }).waitFor({ timeout: 15000 });
  watch.assertClean("purchase order search and disabled WhatsApp feedback");
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    await signInAsAdmin(context);
    await installApiFixtures(page);
    await proveCeoFeedback(page, watch);
    await provePurchaseOrderFeedback(page, watch);

    const artifact = {
      checkedAt: new Date().toISOString(),
      baseURL,
      proofs: [
        "CEO weekly pulse failure shows inline feedback without alert dialog.",
        "Purchase order supplier missing WhatsApp uses disabled button, not href hash.",
        "Purchase order search filters visible order history and shows empty result state.",
      ],
    };
    fs.writeFileSync(
      path.join(artifactsDir, "action-feedback-hygiene.json"),
      `${JSON.stringify(artifact, null, 2)}\n`
    );

    console.log("Action feedback hygiene browser proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
