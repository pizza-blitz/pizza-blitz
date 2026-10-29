const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");
const { cleanupProofOrder } = require("./helpers/order-cleanup.cjs");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");

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

async function apiJson(endpoint, init = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function cookieHeaderFromSetCookie(setCookie) {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie || ""];
  return values
    .flatMap((value) => value.split(/,(?=\s*pb_[^=]+=)/))
    .map((value) => value.split(";")[0].trim())
    .filter((value) => value.startsWith("pb_"))
    .join("; ");
}

async function portalLoginCookie() {
  const response = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  const data = await response.json().catch(() => ({}));
  assert(response.ok, `Admin portal login failed: ${JSON.stringify(data)}`);
  const cookie = cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
  assert(cookie.includes("pb_admin_session="), "Admin login did not return an admin session cookie.");
  return cookie;
}

function dateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function sameDateLastYear(date) {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() - 1);
  return next;
}

async function seedDailyEntry({ date, totalSale, expense, notes }, adminCookie) {
  const { response, data } = await apiJson("/api/v1/restaurant/sales/daily-entry", {
    method: "POST",
    headers: { Cookie: adminCookie },
    body: JSON.stringify({
      date,
      total_sale: totalSale,
      cash_collected: totalSale,
      total_expense: expense,
      payment_method: "mixed",
      notes,
    }),
  });
  assert(response.ok, `Could not seed daily reporting entry: ${JSON.stringify(data)}`);
}

async function seedOwnerComparisonLedger(adminCookie) {
  const today = new Date();
  await seedDailyEntry({
    date: dateOnly(today),
    totalSale: 4321,
    expense: 1180,
    notes: "E2E owner comparison current day",
  }, adminCookie);
  await seedDailyEntry({
    date: dateOnly(addDays(today, -7)),
    totalSale: 3210,
    expense: 950,
    notes: "E2E owner comparison same weekday last week",
  }, adminCookie);
  await seedDailyEntry({
    date: dateOnly(sameDateLastYear(today)),
    totalSale: 2875,
    expense: 870,
    notes: "E2E owner comparison same day last year",
  }, adminCookie);
}

async function seedReportingOrder() {
  const { response, data } = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Reporting Dashboard Proof",
      customer_phone: `96${Date.now().toString().slice(-8)}`,
      customer_email: "reporting-proof@example.com",
      opt_in_marketing: true,
      payment_method: "cash",
      notes: "E2E reporting comparison proof",
      items: [
        {
          name: "Margherita Pizza",
          quantity: 2,
          price: 249,
        },
        {
          name: "Owner Comparison Garlic Bread",
          quantity: 1,
          price: 149,
        },
      ],
    }),
  });
  assert(response.ok, `Could not seed reporting order: ${JSON.stringify(data)}`);
  assert(data.id || data.order_id, "Seed order response did not include an order id.");
  return data.id || data.order_id;
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
    assertClean(label) {
      assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
    },
  };
}

async function signInAsAdmin(context) {
  const response = await context.request.post(`${baseURL}/api/admin-session`, {
    data: { id: adminId, password: adminPassword, role: "admin" },
  });
  assert(response.ok(), `Admin session failed: ${await response.text()}`);
}

async function assertProtectedEndpoint() {
  const { response, data } = await apiJson("/api/v1/restaurant/stats/compare/order-channel-dashboard?period=30days");
  assert(response.status === 401, `Anonymous reporting endpoint should return 401, got ${response.status}: ${JSON.stringify(data)}`);

  const owner = await apiJson("/api/v1/restaurant/stats/compare/owner-command-dashboard?period=30days");
  assert(owner.response.status === 401, `Anonymous owner comparison endpoint should return 401, got ${owner.response.status}: ${JSON.stringify(owner.data)}`);
}

async function assertAdminEndpoint(context, adminCookie) {
  const response = await context.request.get(`${apiURL}/api/v1/restaurant/stats/compare/order-channel-dashboard?period=30days`, {
    headers: { Cookie: adminCookie },
  });
  const data = await response.json();
  assert(response.ok(), `Admin reporting endpoint failed: ${JSON.stringify(data)}`);
  assert(data.period && Number(data.period.days) === 30, "Reporting endpoint did not return the requested 30-day period.");
  assert(data.summary && typeof data.summary === "object", "Reporting endpoint did not return summary metrics.");
  assert(Array.isArray(data.channel_mix), "Reporting endpoint channel_mix is not an array.");
  assert(Array.isArray(data.payment_mix), "Reporting endpoint payment_mix is not an array.");
  assert(Array.isArray(data.payment_status_mix), "Reporting endpoint payment_status_mix is not an array.");
  assert(Array.isArray(data.fulfillment_status_mix), "Reporting endpoint fulfillment_status_mix is not an array.");
  assert(data.current.orders >= 1, "Reporting endpoint did not include the seeded order.");
  assert(data.channel_mix.some((row) => row.key === "takeaway"), "Reporting endpoint did not include takeaway channel data.");
  assert(data.payment_mix.some((row) => row.key === "cash"), "Reporting endpoint did not include cash payment data.");

  const ownerResponse = await context.request.get(`${apiURL}/api/v1/restaurant/stats/compare/owner-command-dashboard?period=30days`, {
    headers: { Cookie: adminCookie },
  });
  const ownerData = await ownerResponse.json();
  assert(ownerResponse.ok(), `Admin owner comparison endpoint failed: ${JSON.stringify(ownerData)}`);
  assert(ownerData.same_day?.same_weekday_last_week, "Owner comparison did not return same weekday last week.");
  assert(ownerData.same_month?.same_month_last_year, "Owner comparison did not return same month last year.");
  assert(Array.isArray(ownerData.product_movers), "Owner comparison product_movers is not an array.");
  assert(
    ownerData.product_movers.some((row) => String(row.name).includes("Margherita Pizza")),
    "Owner comparison did not include the seeded Margherita Pizza product mover."
  );
  assert(Array.isArray(ownerData.category_movers), "Owner comparison category_movers is not an array.");
  assert(Array.isArray(ownerData.owner_actions), "Owner comparison owner_actions is not an array.");
  return data;
}

async function assertReportsPage(page, watch) {
  const response = await page.goto(`${baseURL}/reports`, { waitUntil: "domcontentloaded" });
  assert(response && response.ok(), `Reports page returned HTTP ${response?.status() || "no response"}.`);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);

  await page.getByTestId("executive-comparison-scorecard").waitFor({ timeout: 60000 });
  await page.getByText("Executive Comparison Scorecard", { exact: false }).waitFor({ timeout: 10000 });
  await page.getByTestId("comparison-health-score").getByText(/On Track|Watch Closely|Needs Action/i).waitFor({ timeout: 10000 });
  await page.getByTestId("executive-next-moves").getByText("Next 3 Moves", { exact: false }).waitFor({ timeout: 10000 });
  await page.getByTestId("executive-gap-summary").getByText("Recovery Gap", { exact: false }).waitFor({ timeout: 10000 });
  await page.getByText("Order Channel Comparison", { exact: false }).waitFor({ timeout: 30000 });
  await page.getByTestId("owner-comparison-dashboard").waitFor({ timeout: 15000 });
  await page.getByTestId("reporting-action-board").waitFor({ timeout: 15000 });
  await page.getByText("Owner Comparison Command", { exact: false }).waitFor({ timeout: 15000 });
  await page.getByText("What Needs Attention Next", { exact: true }).waitFor({ timeout: 10000 });
  await page.getByText("Daily Recovery Queue", { exact: true }).waitFor({ timeout: 10000 });
  await page.getByText("Owner Moves", { exact: true }).waitFor({ timeout: 10000 });
  await page.getByText("Same Weekday Last Week", { exact: true }).waitFor({ timeout: 10000 });
  await page.getByText("Same Month Last Year", { exact: false }).waitFor({ timeout: 10000 });
  await page.getByText("Product Movers", { exact: true }).waitFor({ timeout: 10000 });
  await page.getByText("Category Movers", { exact: true }).waitFor({ timeout: 10000 });
  await page.getByText("Channel and Product Decisions", { exact: true }).waitFor({ timeout: 10000 });
  await page.getByText("Channel Revenue Mix", { exact: false }).waitFor({ timeout: 10000 });
  await page.getByText("Payment Method Mix", { exact: false }).waitFor({ timeout: 10000 });
  await page.getByText("Fulfillment Status", { exact: false }).waitFor({ timeout: 10000 });

  const corruptionMarkers = [
    "\uFFFD",
    "\u00C3\u00A2\u00E2\u201A\u00AC",
    "\u00C3\u00A2\u00E2\u201A\u00AC\u00E2\u201E\u00A2",
    "\u00C3\u00A2\u00E2\u201A\u00AC\u00C5\u201C",
    "\u00C3\u00A2\u00E2\u201A\u00AC\uFFFD",
    "\u00C3\u00A2\u00E2\u201A\u00AC\u0161\u00C2\u00B9",
    "\u00C3\u201A",
  ];
  const health = await page.evaluate((markers) => {
    const text = document.body.innerText || "";
    return {
      textLength: text.trim().length,
      hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
      hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
      hasTextCorruption: markers.some((marker) => text.includes(marker)),
      bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  }, corruptionMarkers);
  assert(health.textLength > 200, "Reports page rendered too little content.");
  assert(!health.hasOverlay, "Reports page rendered a Next.js error overlay.");
  assert(!health.hasFrameworkError, "Reports page rendered framework error text.");
  assert(!health.hasTextCorruption, "Reports page rendered corrupted text characters.");
  assert(health.bodyOverflow <= 8, `Reports page has body-level horizontal overflow of ${health.bodyOverflow}px.`);

  await page.screenshot({
    path: path.join(artifactsDir, "visible-reporting-comparison-dashboard.png"),
    fullPage: true,
  });
  watch.assertClean("reporting comparison dashboard");
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  await assertProtectedEndpoint();
  const adminCookie = await portalLoginCookie();
  await seedOwnerComparisonLedger(adminCookie);
  const orderId = await seedReportingOrder();
  let cleanedUp = false;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    await signInAsAdmin(context);
    await assertAdminEndpoint(context, adminCookie);
    await assertReportsPage(page, watch);
    await cleanupProofOrder({
      apiURL,
      orderId,
      cookie: adminCookie,
      reason: "E2E cleanup after reporting comparison proof",
    });
    cleanedUp = true;
  } finally {
    await browser.close();
    if (!cleanedUp && orderId) {
      await cleanupProofOrder({
        apiURL,
        orderId,
        cookie: adminCookie,
        reason: "Best effort cleanup after interrupted reporting comparison proof",
        strict: false,
      });
    }
  }

  console.log(`Reporting comparison dashboard proof passed with seeded order #${orderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
