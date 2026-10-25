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

async function createCampaign(cookie, name, code, channel = "email", discountValue = 15) {
  const today = new Date();
  const endDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const promotion = await adminJson("/api/v1/restaurant/promotions/", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      code,
      start_date: today.toISOString().slice(0, 10),
      end_date: endDate.toISOString().slice(0, 10),
      description: "E2E marketing ROI command proof",
      discount_type: "percentage",
      discount_value: discountValue,
      audience: "all_customers",
      channel,
      status: "active",
      message_template: "Hi {name}, Pizza Blitz has {offer}. Use {code}.",
    }),
  });
  assert(promotion.response.ok, `Could not create ROI campaign ${name}: ${JSON.stringify(promotion.data)}`);
  return promotion.data.promotion;
}

async function createCouponOrder(campaign, suffix, price) {
  const order = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: `ROI Buyer ${suffix}`,
      customer_phone: `82${Date.now().toString().slice(-8)}${suffix}`,
      customer_email: `roi-buyer-${suffix}-${Date.now()}@example.com`,
      opt_in_marketing: true,
      payment_method: "cash",
      coupon_code: campaign.code,
      notes: "Marketing ROI command proof",
      items: [{ name: "ROI Proof Pizza Pack", quantity: 1, price }],
    }),
  });
  assert(order.response.ok, `Could not create coupon order for ${campaign.code}: ${JSON.stringify(order.data)}`);
  assert(order.data.coupon_code === campaign.code, `Order did not apply coupon ${campaign.code}.`);
  return order.data.order_id || order.data.id;
}

async function seedHandoffs(cookie, campaign) {
  const socialPost = await adminJson(`/api/v1/restaurant/promotions/${campaign.id}/social-post`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platforms: ["facebook", "instagram"],
      status: "ready",
      link_url: `${baseURL}/order?coupon=${campaign.code}`,
    }),
  });
  assert(socialPost.response.ok, `Could not create ROI social handoff: ${JSON.stringify(socialPost.data)}`);

  const adCampaign = await adminJson(`/api/v1/restaurant/promotions/${campaign.id}/ad-campaign`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platforms: ["facebook", "instagram"],
      status: "ready",
      daily_budget: 650,
      link_url: `${baseURL}/order?coupon=${campaign.code}`,
    }),
  });
  assert(adCampaign.response.ok, `Could not create ROI ad handoff: ${JSON.stringify(adCampaign.data)}`);
}

async function seedProofData(cookie) {
  const suffix = Date.now().toString(36).toUpperCase();
  const codeSuffix = suffix.slice(-8);
  const leader = await createCampaign(cookie, `Marketing ROI Winner ${suffix}`, `ROI${codeSuffix}`, "email", 10);
  const challenger = await createCampaign(cookie, `Marketing ROI Challenger ${suffix}`, `ROC${codeSuffix}`, "sms", 20);

  await createCouponOrder(leader, `A${suffix}`, 899);
  await createCouponOrder(leader, `B${suffix}`, 749);
  await createCouponOrder(challenger, `C${suffix}`, 349);
  await seedHandoffs(cookie, leader);

  const dryRun = await adminJson(`/api/v1/restaurant/promotions/${leader.id}/send`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true, limit: 25 }),
  });
  assert(dryRun.response.ok, `ROI dry run failed: ${JSON.stringify(dryRun.data)}`);

  return { leader, challenger };
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

async function assertMarketingEndpoint(cookie, leader) {
  const anonymous = await apiJson("/api/v1/restaurant/promotions/performance?limit=25");
  assert(anonymous.response.status === 401, `Anonymous marketing performance should be blocked, got ${anonymous.response.status}.`);

  const response = await adminJson("/api/v1/restaurant/promotions/performance?limit=25", cookie);
  assert(response.response.ok, `Marketing performance endpoint failed: ${JSON.stringify(response.data)}`);
  assert(response.data.summary.redemption_orders >= 3, "Marketing endpoint did not count seeded coupon orders.");
  assert(response.data.summary.redemption_revenue > 0, "Marketing endpoint did not count coupon revenue.");
  assert(
    response.data.campaigns.some((row) => row.promotion_detail.id === leader.id && row.redemptions.count >= 2),
    "Marketing endpoint did not include the seeded winning campaign."
  );
}

async function proveReportsPanel(leader) {
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
    await page.getByTestId("marketing-roi-command").waitFor({ timeout: 20000 });
    await page.getByText("Marketing ROI Command", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Which push deserves attention next", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText(leader.name, { exact: false }).first().waitFor({ timeout: 15000 });
    await page.getByText("Next Push Ranking", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Scale next offer", { exact: true }).first().waitFor({ timeout: 15000 });

    const health = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        textLength: text.trim().length,
        hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
        hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert(health.textLength > 400, "Marketing ROI reports panel rendered too little content.");
    assert(!health.hasOverlay, "Marketing ROI reports panel rendered a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Marketing ROI reports panel rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Marketing ROI reports page has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    await page.getByTestId("marketing-roi-command").screenshot({
      path: path.join(artifactsDir, "visible-marketing-roi-command.png"),
    });
    watch.assertClean("marketing ROI command");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const cookie = await portalLogin();
  const { leader } = await seedProofData(cookie);
  await assertMarketingEndpoint(cookie, leader);
  await proveReportsPanel(leader);

  console.log(`Marketing ROI command proof passed for campaign #${leader.id}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
