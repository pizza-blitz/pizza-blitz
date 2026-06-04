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

async function installInvoiceFixtures(context) {
  const requests = [];
  let mode = "success";

  await context.route("**/api/v1/restaurant/orders/invoices**", async (route) => {
    requests.push({ mode, url: route.request().url() });
    await sleep(300);

    if (mode === "error") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Invoice archive is unavailable for this proof." }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 101,
          invoice_number: "PB-202606-0101",
          customer_name: "Proof Customer",
          date: "2026-06-04",
          payment_method: "card",
          cgst: 18,
          sgst: 18,
          total: 756,
        },
        {
          id: 102,
          invoice_number: "PB-202606-0102",
          customer_name: "Walk-in",
          date: "2026-06-04",
          payment_method: "cash",
          cgst: 12,
          sgst: 12,
          total: 504,
        },
      ]),
    });
  });

  return {
    requests,
    setMode(nextMode) {
      mode = nextMode;
    },
  };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
  });
  await context.addInitScript(() => {
    window.__pizzaBlitzPrintCalls = 0;
    window.print = () => {
      window.__pizzaBlitzPrintCalls += 1;
    };
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    await signInAsAdmin(context);
    const fixtures = await installInvoiceFixtures(context);

    const response = await page.goto(`${baseURL}/invoices`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `/invoices returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: "GST Invoice Archive" }).waitFor({ timeout: 15000 });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
    await page.getByText("Invoice archive loaded with 2 invoices.", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Invoice PB-202606-0101", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Proof Customer", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Rs 756", { exact: true }).waitFor({ timeout: 15000 });

    await page.getByLabel("Search invoices", { exact: true }).fill("Proof Customer");
    await page.getByText("Invoice PB-202606-0101", { exact: true }).waitFor({ timeout: 15000 });
    assert(
      (await page.getByText("Invoice PB-202606-0102", { exact: true }).count()) === 0,
      "Invoice search did not filter out non-matching invoice."
    );

    await page.getByRole("button", { name: "Print invoice PB-202606-0101", exact: true }).click();
    await page.getByText("Print view prepared for invoice PB-202606-0101.", { exact: true }).waitFor({
      timeout: 15000,
    });
    const printCalls = await page.evaluate(() => window.__pizzaBlitzPrintCalls);
    assert(printCalls === 1, `Expected one print call, received ${printCalls}.`);

    await page.getByLabel("Search invoices", { exact: true }).fill("Missing Invoice");
    await page.getByText("No matching invoices found in history node.", { exact: true }).waitFor({ timeout: 15000 });

    fixtures.setMode("error");
    await page.goto(`${baseURL}/invoices`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Invoice archive needs attention" }).waitFor({ timeout: 15000 });
    await page.getByText("Invoice archive is unavailable for this proof.", { exact: true }).waitFor({
      timeout: 15000,
    });

    assert(fixtures.requests.length >= 2, `Expected at least 2 invoice archive requests, got ${fixtures.requests.length}.`);
    watch.assertClean("invoice archive actions");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-invoice-archive-actions.png"),
      fullPage: true,
    });

    const artifact = {
      checkedAt: new Date().toISOString(),
      baseURL,
      requestCount: fixtures.requests.length,
      proofs: [
        "Invoice archive loads and reports the invoice count.",
        "Search filters invoice rows by customer or invoice id.",
        "Print button prepares inline feedback and calls window.print once.",
        "Backend archive failure preserves detail in the visible error panel.",
      ],
    };
    fs.writeFileSync(
      path.join(artifactsDir, "invoice-archive-actions.json"),
      `${JSON.stringify(artifact, null, 2)}\n`
    );

    console.log("Invoice archive actions proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
