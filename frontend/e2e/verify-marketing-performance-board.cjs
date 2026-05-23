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

async function createCampaignWithRevenue(cookie) {
  const suffix = Date.now().toString().slice(-8);
  const code = `BOARD${suffix.slice(-6)}`;
  const campaignName = `Marketing Board Proof ${suffix}`;
  const today = new Date();
  const endDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

  const promotion = await adminJson("/api/v1/restaurant/promotions/", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: campaignName,
      code,
      start_date: today.toISOString().slice(0, 10),
      end_date: endDate.toISOString().slice(0, 10),
      description: "E2E marketing performance board proof",
      discount_type: "fixed",
      discount_value: 100,
      audience: "marketing_opt_in",
      channel: "email",
      status: "active",
      message_template: "Hi {name}, use {code} for {offer}.",
    }),
  });
  assert(promotion.response.ok, `Could not create board campaign: ${JSON.stringify(promotion.data)}`);
  const promotionId = promotion.data.promotion.id;

  const order = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Marketing Board Proof",
      customer_phone: `92${suffix}`,
      customer_email: `marketing-board-${suffix}@example.com`,
      opt_in_marketing: true,
      payment_method: "cash",
      coupon_code: code,
      notes: "Marketing performance board proof",
      items: [{ name: "Marketing Board Party Pack", quantity: 1, price: 99999 }],
    }),
  });
  assert(order.response.ok, `Could not seed coupon order: ${JSON.stringify(order.data)}`);
  assert(order.data.coupon_code === code, `Seeded order did not apply coupon ${code}: ${JSON.stringify(order.data)}`);

  const socialPost = await adminJson(`/api/v1/restaurant/promotions/${promotionId}/social-post`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platforms: ["facebook", "instagram"],
      status: "ready",
      link_url: `${baseURL}/order?coupon=${code}`,
    }),
  });
  assert(socialPost.response.ok, `Could not create social handoff: ${JSON.stringify(socialPost.data)}`);

  const adCampaign = await adminJson(`/api/v1/restaurant/promotions/${promotionId}/ad-campaign`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platforms: ["facebook", "instagram"],
      objective: "sales",
      daily_budget: 750,
      status: "ready",
      link_url: `${baseURL}/order?coupon=${code}`,
    }),
  });
  assert(adCampaign.response.ok, `Could not create ad handoff: ${JSON.stringify(adCampaign.data)}`);

  return { promotionId, campaignName, code };
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

async function screenshotPerformanceBoard(campaignName) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/promotions`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Promotions page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByText("Marketing Performance Board", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Campaign comparison and coupon ROI", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Campaign Comparison", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText(campaignName, { exact: true }).first().waitFor({ timeout: 15000 });
    await page.getByText("Coupon Revenue", { exact: true }).waitFor({ timeout: 15000 });

    const health = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        textLength: text.trim().length,
        hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
        hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert(health.textLength > 300, "Marketing performance board rendered too little content.");
    assert(!health.hasOverlay, "Marketing performance board rendered a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Marketing performance board rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Marketing performance board has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    await page.screenshot({
      path: path.join(artifactsDir, "visible-marketing-performance-board.png"),
      fullPage: true,
    });
    watch.assertClean("marketing performance board");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const anonymous = await apiJson("/api/v1/restaurant/promotions/performance?limit=12");
  assert(anonymous.response.status === 401, `Anonymous performance rollup should be blocked, got ${anonymous.response.status}.`);

  const cookie = await portalLogin();
  const proof = await createCampaignWithRevenue(cookie);

  const rollup = await adminJson("/api/v1/restaurant/promotions/performance?limit=12", cookie);
  assert(rollup.response.ok, `Performance rollup failed: ${JSON.stringify(rollup.data)}`);
  const proofRow = rollup.data.campaigns.find((row) => row.promotion_detail.id === proof.promotionId);
  assert(proofRow, "Performance rollup did not include the seeded campaign.");
  assert(proofRow.redemptions.count >= 1, "Seeded campaign did not show coupon orders.");
  assert(proofRow.redemptions.revenue > 90000, "Seeded campaign revenue was not counted.");
  assert(proofRow.social.post_count >= 1, "Seeded campaign social handoff was not counted.");
  assert(proofRow.ads.campaign_count >= 1, "Seeded campaign ad handoff was not counted.");
  assert(rollup.data.summary.redemption_revenue >= proofRow.redemptions.revenue, "Rollup summary did not include seeded revenue.");

  await screenshotPerformanceBoard(proof.campaignName);
  console.log(`Marketing performance board proof passed for promotion #${proof.promotionId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
