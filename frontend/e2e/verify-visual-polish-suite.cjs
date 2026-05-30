const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");

const adminRoutes = [
  { route: "/dashboard", label: "Business Intelligence" },
  { route: "/roadmap", label: "Roadmap Command Board" },
  { route: "/ceo", label: "CEO" },
  { route: "/orders", label: "Order" },
  { route: "/operations", label: "Kitchen" },
  { route: "/shifts", label: "Shift" },
  { route: "/daily", label: "Daily" },
  { route: "/sales", label: "Sales" },
  { route: "/reports", label: "Financial" },
  { route: "/invoices", label: "Invoice" },
  { route: "/breakeven", label: "Break-even" },
  { route: "/menu", label: "Menu" },
  { route: "/inventory", label: "Inventory" },
  { route: "/recipes", label: "Recipe" },
  { route: "/customers", label: "Customer" },
  { route: "/promotions", label: "Promotion" },
  { route: "/social", label: "Social" },
  { route: "/ads", label: "Ad Campaigns" },
  { route: "/ops", label: "Production Ops" },
  { route: "/vendors", label: "Vendor" },
  { route: "/waste", label: "Waste" },
  { route: "/expenses", label: "Expense" },
  { route: "/ai-insights", label: "Neural Insights" },
  { route: "/purchase-orders", label: "Purchase" },
  { route: "/settings", label: "Settings" },
];

const publicRoutes = [
  { route: "/", label: "Pizza Blitz" },
  { route: "/order", label: "Checkout" },
  { route: "/track", label: "Track" },
  { route: "/account/login", label: "Sign" },
];

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

  page.on("pageerror", (error) => {
    issues.push(`page error: ${error.message}`);
  });

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico|images\.unsplash\.com/i.test(text)) return;
    if (/Failed to fetch RSC payload/i.test(text) && /Falling back to browser navigation/i.test(text)) return;
    issues.push(`console error: ${text}`);
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    const localRequest = url.startsWith(baseURL) || url.startsWith(apiURL);
    if (!localRequest) return;
    const failure = request.failure();
    if (failure?.errorText === "net::ERR_ABORTED") return;
    issues.push(`request failed: ${request.method()} ${url} ${failure?.errorText || ""}`.trim());
  });

  return {
    clear() {
      issues.length = 0;
    },
    assertClean(label) {
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

async function assertVisualHealth(page, watch, route, expectedLabel, viewportName) {
  console.log(`[visual-audit] ${viewportName} ${route}`);
  watch.clear();
  const response = await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded" });
  assert(response && response.ok(), `${viewportName} ${route} returned HTTP ${response?.status() || "no response"}.`);
  await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => undefined);

  const health = await page.evaluate(() => {
    const text = document.body.innerText || "";
    const overlay = Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal"));
    return {
      textLength: text.trim().length,
      hasOverlay: overlay,
      hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
      hasTextCorruption: /�|â€|â€™|â€œ|â€�|â‚¹|Â/.test(text),
      bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      title: document.title,
    };
  });

  assert(health.textLength > 40, `${viewportName} ${route} rendered too little content.`);
  assert(!health.hasOverlay, `${viewportName} ${route} rendered a framework error overlay.`);
  assert(!health.hasFrameworkError, `${viewportName} ${route} rendered framework error text.`);
  assert(!health.hasTextCorruption, `${viewportName} ${route} rendered corrupted text characters.`);
  assert(health.bodyOverflow <= 8, `${viewportName} ${route} has body-level horizontal overflow of ${health.bodyOverflow}px.`);

  if (expectedLabel) {
    const main = page.locator("main");
    const contentScope = (await main.count()) ? main : page.locator("body");
    await contentScope.getByText(expectedLabel, { exact: false }).first().waitFor({ timeout: 9000 });
  }

  watch.assertClean(`${viewportName} ${route}`);
}

async function runViewportAudit(viewport) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    for (const item of publicRoutes) {
      await assertVisualHealth(page, watch, item.route, item.label, viewport.name);
    }

    await signInAsAdmin(context);
    for (const item of adminRoutes) {
      await assertVisualHealth(page, watch, item.route, item.label, viewport.name);
    }

    await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => undefined);
    await page.screenshot({
      path: path.join(artifactsDir, `visible-visual-audit-${viewport.name}.png`),
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  for (const viewport of viewports) {
    await runViewportAudit(viewport);
  }

  console.log(`Visual polish suite passed across ${adminRoutes.length + publicRoutes.length} routes on ${viewports.length} viewports.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
