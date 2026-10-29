const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
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

function breakevenBody(setup) {
  const total = setup.rent + setup.salaries + setup.utilities + setup.other_fixed;
  return {
    month: setup.month,
    fixed_costs: {
      rent: setup.rent,
      salaries: setup.salaries,
      utilities: setup.utilities,
      other: setup.other_fixed,
      total,
    },
    avg_order_value: setup.avg_order_value,
    daily_breakeven_revenue: 8200,
    daily_breakeven_orders: 32.8,
    today_revenue: 9100,
    today_above_breakeven: true,
    status_message: "Above break-even today by Rs 900",
  };
}

async function installApiFixtures(page) {
  let setup = {
    month: "2026-06",
    rent: 55000,
    salaries: 120000,
    utilities: 15000,
    other_fixed: 5000,
    avg_order_value: 250,
  };
  const setupPosts = [];

  await page.route(/\/api\/v1\/restaurant\/stats\/breakeven$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(breakevenBody(setup)),
    });
  });

  await page.route(/\/api\/v1\/restaurant\/stats\/breakeven\/setup.*/, async (route) => {
    const url = new URL(route.request().url());
    setup = {
      month: url.searchParams.get("month") || setup.month,
      rent: Number(url.searchParams.get("rent") || 0),
      salaries: Number(url.searchParams.get("salaries") || 0),
      utilities: Number(url.searchParams.get("utilities") || 0),
      other_fixed: Number(url.searchParams.get("other_fixed") || 0),
      avg_order_value: Number(url.searchParams.get("avg_order_value") || 0),
    };
    setupPosts.push(setup);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "saved", month: setup.month }),
    });
  });

  return { setupPosts };
}

async function fillNumber(page, label, value) {
  const input = page.getByLabel(label);
  await input.fill("");
  await input.fill(String(value));
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
    const fixtures = await installApiFixtures(page);

    watch.clear();
    const response = await page.goto(`${baseURL}/breakeven`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `/breakeven returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: /Profitability & Break-even/i }).waitFor({ timeout: 15000 });
    await page.getByText("Fixed Monthly", { exact: true }).waitFor({ timeout: 15000 });

    const configureButton = page.getByRole("button", { name: /Configure Fixed Costs/i });
    await configureButton.waitFor({ timeout: 15000 });
    await configureButton.scrollIntoViewIfNeeded();
    await configureButton.click({ force: true });
    await page.getByRole("heading", { name: "Configure Monthly Base" }).waitFor({ timeout: 15000 });
    const modal = page.getByTestId("breakeven-setup-modal");
    await modal.waitFor({ timeout: 15000 });
    await page.getByLabel("Month Select").fill("2026-07");
    await fillNumber(page, "Rent", 66000);
    await fillNumber(page, "Salaries", 142000);
    await fillNumber(page, "Utilities", 22000);
    await fillNumber(page, "Other Fixed", 9000);
    await fillNumber(page, "Average Order Value", 320);

    const applyButton = page.getByRole("button", { name: /Apply & Update/i });
    await applyButton.click();
    await page.getByText("Saving...", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Break-even setup saved for 2026-07.", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText(/Rs\s+2,39,000/).waitFor({ timeout: 15000 });

    assert(fixtures.setupPosts.length === 1, `Expected one setup POST, got ${fixtures.setupPosts.length}.`);
    const posted = fixtures.setupPosts[0];
    assert(posted.month === "2026-07", `Expected posted month 2026-07, got ${posted.month}.`);
    assert(posted.utilities === 22000, `Expected posted utilities 22000, got ${posted.utilities}.`);
    assert(posted.other_fixed === 9000, `Expected posted other_fixed 9000, got ${posted.other_fixed}.`);
    assert(posted.avg_order_value === 320, `Expected posted avg_order_value 320, got ${posted.avg_order_value}.`);

    watch.assertClean("break-even setup feedback");

    const artifact = {
      checkedAt: new Date().toISOString(),
      baseURL,
      postedSetup: posted,
      proofs: [
        "Break-even setup exposes rent, salaries, utilities, other fixed cost and average order value.",
        "Apply & Update shows a saving state and posts exactly once.",
        "Saved setup refreshes the fixed monthly total and shows inline success feedback.",
      ],
    };
    fs.writeFileSync(
      path.join(artifactsDir, "breakeven-setup-feedback.json"),
      `${JSON.stringify(artifact, null, 2)}\n`
    );

    console.log("Break-even setup feedback proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
