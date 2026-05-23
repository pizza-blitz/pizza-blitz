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

function isoDate(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
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

async function proveBudgetPanel(campaignName, campaignId) {
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

    const response = await page.goto(`${baseURL}/ads?campaign=${campaignId}`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Ads page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByText(campaignName, { exact: false }).first().click();
    const panel = page.getByTestId("ad-budget-command");
    await panel.waitFor({ timeout: 15000 });
    await panel.getByText("Ad Spend Command", { exact: false }).waitFor({ timeout: 15000 });
    await panel.getByText("Over Pace", { exact: false }).waitFor({ timeout: 15000 });
    await panel.getByText("Strong ROAS", { exact: false }).waitFor({ timeout: 15000 });
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactsDir, "visible-ad-budget-pacing.png"),
      fullPage: false,
    });
    watch.assertClean("ad budget pacing console");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const anonymous = await apiJson("/api/v1/restaurant/ads/campaigns/1/budget-health");
  assert(anonymous.response.status === 401, `Anonymous budget health should be blocked, got ${anonymous.response.status}.`);

  const cookie = await portalLogin();
  const campaignName = `Ad Budget Pace Proof ${Date.now()}`;
  const campaign = await adminJson("/api/v1/restaurant/ads/campaigns", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: campaignName,
      objective: "sales",
      platforms: ["facebook", "instagram"],
      audience: "Local repeat buyers",
      location: "Delivery radius",
      creative_message: "Pizza Blitz budget pacing proof campaign.",
      link_url: `${baseURL}/order`,
      lifetime_budget: 1000,
      start_date: isoDate(-4),
      end_date: isoDate(5),
      status: "ready",
    }),
  });
  assert(campaign.response.ok, `Could not create ad pacing campaign: ${JSON.stringify(campaign.data)}`);
  const campaignId = campaign.data.campaign.id;

  const metrics = await adminJson(`/api/v1/restaurant/ads/campaigns/${campaignId}/metrics`, cookie, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      impressions: 8000,
      clicks: 240,
      conversions: 28,
      spend: 700,
      revenue: 2450,
    }),
  });
  assert(metrics.response.ok, `Could not update ad pacing metrics: ${JSON.stringify(metrics.data)}`);

  const health = await adminJson(`/api/v1/restaurant/ads/campaigns/${campaignId}/budget-health`, cookie);
  assert(health.response.ok, `Budget health endpoint failed: ${JSON.stringify(health.data)}`);
  assert(health.data.budget_health.pacing_status === "over_pacing", `Expected over_pacing, got ${health.data.budget_health.pacing_status}.`);
  assert(health.data.budget_health.performance_status === "strong", `Expected strong performance, got ${health.data.budget_health.performance_status}.`);
  assert(health.data.budget_health.remaining_budget === 300, `Expected Rs 300 remaining, got ${health.data.budget_health.remaining_budget}.`);
  assert(health.data.budget_health.recommendations.length >= 2, "Budget health did not return action recommendations.");

  await proveBudgetPanel(campaignName, campaignId);
  console.log(`Ad budget pacing proof passed for campaign #${campaignId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
