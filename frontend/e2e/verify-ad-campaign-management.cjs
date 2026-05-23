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

async function apiJson(endpoint, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
    },
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

function createBrowserWatch(page) {
  const issues = [];
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico|images\.unsplash\.com/i.test(text)) return;
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

async function screenshotAdConsole(campaignName, campaignId) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
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
    await page.getByText("Meta Ads Launch Console", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText(campaignName, { exact: false }).first().click();
    await page.getByText("Recent Launch Attempts", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("dry_run", { exact: false }).first().waitFor({ timeout: 15000 });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-ad-campaign-management.png"),
      fullPage: true,
    });
    watch.assertClean("ad campaign management console");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const anonymousStatus = await apiJson("/api/v1/restaurant/ads/provider-status");
  assert(anonymousStatus.response.status === 401, `Anonymous ad provider status should be blocked, got ${anonymousStatus.response.status}.`);

  const anonymousCreate = await apiJson("/api/v1/restaurant/ads/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Blocked anonymous ad campaign",
      objective: "sales",
      platforms: ["facebook"],
      creative_message: "Anonymous users must not create ad campaigns.",
      daily_budget: 500,
      status: "ready",
    }),
  });
  assert(anonymousCreate.response.status === 401, `Anonymous ad campaign create should be blocked, got ${anonymousCreate.response.status}.`);

  const cookie = await portalLogin();
  const providerResult = await adminJson("/api/v1/restaurant/ads/provider-status", cookie);
  assert(providerResult.response.ok, `Admin ad provider status failed: ${JSON.stringify(providerResult.data)}`);
  assert(providerResult.data.provider === "meta-ads", "Ad provider status did not identify Meta Ads.");
  assert(providerResult.data.launch_mode === "paused_campaign", "Ad provider launch mode should remain paused_campaign.");

  const summaryResult = await adminJson("/api/v1/restaurant/ads/summary", cookie);
  assert(summaryResult.response.ok, `Admin ad summary failed: ${JSON.stringify(summaryResult.data)}`);

  const campaignName = `Ad Launch Proof ${Date.now()}`;
  const campaignResult = await adminJson("/api/v1/restaurant/ads/campaigns", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: campaignName,
      objective: "sales",
      platforms: ["facebook", "instagram"],
      audience: "Weekend pizza buyers",
      location: "Local delivery radius",
      creative_message: "Order Pizza Blitz tonight and pick up a hot, fresh family deal.",
      link_url: `${baseURL}/order`,
      daily_budget: 500,
      status: "ready",
    }),
  });
  assert(campaignResult.response.ok, `Could not create ad campaign: ${JSON.stringify(campaignResult.data)}`);
  const campaignId = campaignResult.data.campaign.id;

  const anonymousLaunch = await apiJson(`/api/v1/restaurant/ads/campaigns/${campaignId}/launch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true }),
  });
  assert(anonymousLaunch.response.status === 401, `Anonymous ad launch should be blocked, got ${anonymousLaunch.response.status}.`);

  const dryRun = await adminJson(`/api/v1/restaurant/ads/campaigns/${campaignId}/launch`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true }),
  });
  assert(dryRun.response.ok, `Ad dry run failed: ${JSON.stringify(dryRun.data)}`);
  assert(dryRun.data.dry_run_count === 1, `Expected one dry-run launch, got ${dryRun.data.dry_run_count}.`);
  assert(dryRun.data.launches[0].provider === "meta-ads", "Ad dry run did not retain the Meta Ads provider.");
  assert(dryRun.data.launches[0].status === "dry_run", "Ad dry run launch was not recorded as dry_run.");

  const draftResult = await adminJson("/api/v1/restaurant/ads/campaigns", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Blocked Live Launch ${Date.now()}`,
      objective: "traffic",
      platforms: ["facebook"],
      creative_message: "This campaign is intentionally incomplete for launch blocking proof.",
      daily_budget: 0,
      status: "draft",
    }),
  });
  assert(draftResult.response.ok, `Could not create blocked launch campaign: ${JSON.stringify(draftResult.data)}`);
  const blockedCampaignId = draftResult.data.campaign.id;

  const blockedLiveLaunch = await adminJson(`/api/v1/restaurant/ads/campaigns/${blockedCampaignId}/launch`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: false }),
  });
  assert(blockedLiveLaunch.response.status === 409, `Incomplete live launch should be blocked, got ${blockedLiveLaunch.response.status}.`);
  assert(
    String(blockedLiveLaunch.data.detail || "").includes("Campaign is not launch-ready"),
    `Incomplete live launch did not return launch-readiness detail: ${JSON.stringify(blockedLiveLaunch.data)}`
  );

  const launches = await adminJson(`/api/v1/restaurant/ads/campaigns/${campaignId}/launches`, cookie);
  assert(launches.response.ok, `Ad launch history failed: ${JSON.stringify(launches.data)}`);
  assert(launches.data.dry_run_count >= 1, "Ad launch history did not retain the dry run.");

  const readiness = await adminJson("/api/v1/restaurant/ads/launch-readiness", cookie);
  assert(readiness.response.ok, `Ad launch readiness failed: ${JSON.stringify(readiness.data)}`);
  assert(Array.isArray(readiness.data.campaigns), "Ad launch readiness did not return campaign rows.");

  await screenshotAdConsole(campaignName, campaignId);
  console.log(`Ad campaign management proof passed for campaign #${campaignId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
