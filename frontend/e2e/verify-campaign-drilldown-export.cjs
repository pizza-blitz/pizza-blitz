const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
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

function cookieHeaderFromSetCookie(setCookie) {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie || ""];
  return values
    .flatMap((value) => value.split(/,(?=\s*pb_[^=]+=)/))
    .map((value) => value.split(";")[0].trim())
    .filter((value) => value.startsWith("pb_"))
    .join("; ");
}

async function apiJson(endpoint, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: { ...(options.headers || {}) },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function adminJson(endpoint, cookie, options = {}) {
  return apiJson(endpoint, {
    ...options,
    headers: {
      Cookie: cookie,
      ...(options.headers || {}),
    },
  });
}

async function portalLogin() {
  const response = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  const data = await response.json();
  assert(response.ok, `Admin portal login failed: ${JSON.stringify(data)}`);
  const cookie = cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
  assert(cookie.includes("pb_admin_session="), "Admin login did not return an admin session cookie.");
  return cookie;
}

async function createCampaign(cookie) {
  const suffix = Date.now().toString(36).toUpperCase();
  const today = new Date();
  const endDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const promotion = await adminJson("/api/v1/restaurant/promotions/", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Drilldown Export Proof ${suffix}`,
      code: `DRILL${suffix.slice(-6)}`,
      start_date: today.toISOString().slice(0, 10),
      end_date: endDate.toISOString().slice(0, 10),
      description: "E2E campaign drill-down export proof",
      discount_type: "percentage",
      discount_value: 12,
      audience: "all_customers",
      channel: "email",
      status: "active",
      message_template: "Hi {name}, Pizza Blitz has {offer}. Use {code}.",
    }),
  });
  assert(promotion.response.ok, `Could not create drilldown campaign: ${JSON.stringify(promotion.data)}`);
  return promotion.data.promotion;
}

async function createCouponOrder(campaign, marker, price) {
  const order = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: `Drilldown Buyer ${marker}`,
      customer_phone: `81${Date.now().toString().slice(-8)}${marker}`,
      customer_email: `drilldown-buyer-${marker}-${Date.now()}@example.com`,
      opt_in_marketing: true,
      payment_method: "cash",
      coupon_code: campaign.code,
      notes: "Campaign drilldown export proof",
      items: [{ name: "Drilldown Export Feast", quantity: 1, price }],
    }),
  });
  assert(order.response.ok, `Could not create drilldown coupon order: ${JSON.stringify(order.data)}`);
  assert(order.data.coupon_code === campaign.code, `Order did not apply coupon ${campaign.code}.`);
}

async function seedProofData(cookie) {
  const campaign = await createCampaign(cookie);
  await createCouponOrder(campaign, "A", 1299);
  await createCouponOrder(campaign, "B", 999);
  const dryRun = await adminJson(`/api/v1/restaurant/promotions/${campaign.id}/send`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true, limit: 30 }),
  });
  assert(dryRun.response.ok, `Drilldown dry run failed: ${JSON.stringify(dryRun.data)}`);
  return campaign;
}

async function assertCsvExport(cookie, campaign) {
  const endpoint = `/api/v1/restaurant/promotions/performance/${campaign.id}/export.csv`;
  const anonymous = await fetch(`${apiURL}${endpoint}`, { cache: "no-store" });
  assert(anonymous.status === 401, `Anonymous campaign export should be blocked, got ${anonymous.status}.`);

  const response = await fetch(`${apiURL}${endpoint}`, {
    headers: { Cookie: cookie },
    cache: "no-store",
  });
  const text = await response.text();
  assert(response.ok, `Campaign export failed: ${response.status} ${text}`);
  assert((response.headers.get("content-type") || "").includes("text/csv"), "Campaign export did not return text/csv.");
  assert((response.headers.get("content-disposition") || "").includes("campaign_"), "Campaign export did not include an attachment filename.");
  assert(text.includes("Campaign,Name") && text.includes(campaign.name), "Campaign export CSV is missing campaign identity.");
  assert(text.includes("Coupon,Net Value"), "Campaign export CSV is missing net value.");
  assert(text.includes("Outreach,Ready Reach"), "Campaign export CSV is missing ready reach.");
}

function createBrowserWatch(page) {
  const issues = [];
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico|images\.unsplash\.com/i.test(text)) return;
    if (/Failed to fetch RSC payload/i.test(text) && /Falling back to browser navigation/i.test(text)) return;
    issues.push(`console error: ${text}`);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!url.startsWith(baseURL) && !url.startsWith(apiURL)) return;
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

async function proveDrilldownPanel(campaign) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/reports`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Reports page returned HTTP ${response?.status() || "no response"}.`);
    const drilldownPanel = page.getByTestId("campaign-drilldown-export");
    await drilldownPanel.waitFor({ timeout: 20000 });
    await drilldownPanel.getByText("Campaign Drill-Down Export", { exact: true }).waitFor({ timeout: 15000 });
    await drilldownPanel.getByRole("heading", { name: campaign.name }).waitFor({ timeout: 15000 });
    await drilldownPanel.getByText("Outreach Readiness", { exact: true }).waitFor({ timeout: 15000 });
    await drilldownPanel.getByText("Ad Economics", { exact: true }).waitFor({ timeout: 15000 });

    const exportHref = await drilldownPanel.getByRole("link", { name: /Export CSV/i }).first().getAttribute("href");
    assert(
      exportHref && exportHref.includes(`/api/v1/restaurant/promotions/performance/${campaign.id}/export.csv`),
      `Export link did not target the campaign CSV endpoint: ${exportHref}`
    );

    const health = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        textLength: text.trim().length,
        hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
        hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert(health.textLength > 400, "Campaign drill-down report rendered too little content.");
    assert(!health.hasOverlay, "Campaign drill-down report rendered a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Campaign drill-down report rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Campaign drill-down report has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    await drilldownPanel.screenshot({
      path: path.join(artifactsDir, "visible-campaign-drilldown-export.png"),
    });
    watch.assertClean("campaign drill-down export");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const cookie = await portalLogin();
  const campaign = await seedProofData(cookie);
  await assertCsvExport(cookie, campaign);
  await proveDrilldownPanel(campaign);

  console.log(`Campaign drill-down export proof passed for campaign #${campaign.id}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
