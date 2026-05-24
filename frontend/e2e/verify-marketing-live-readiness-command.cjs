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

function marketingScore(providerReadiness, sendQueue, socialReadiness, adLaunchReadiness, adSyncReadiness) {
  const socialProviderCount = Object.keys(socialReadiness.providers || {}).length;
  const socialProviderReadyCount = Object.values(socialReadiness.providers || {}).filter((status) => status.configured).length;
  const socialIssueCount =
    (socialReadiness.audit.provider_issue_count || 0) +
    (socialReadiness.audit.asset_issue_count || 0) +
    (socialReadiness.audit.needs_review_count || 0);
  const adIssueCount =
    (adSyncReadiness.audit.provider_setup_issue_count || 0) +
    (adSyncReadiness.audit.provider_issue_count || 0) +
    (adSyncReadiness.audit.external_id_issue_count || 0) +
    (adSyncReadiness.audit.needs_review_count || 0);
  const checks = [
    (providerReadiness.configured_count || 0) === 3,
    (sendQueue.summary.dry_run_needed_count || 0) === 0 && (sendQueue.summary.campaign_count || 0) > 0,
    (sendQueue.summary.audience_blocked_count || 0) === 0 && (sendQueue.summary.missing_contacts || 0) === 0,
    (sendQueue.summary.live_ready_count || 0) > 0 &&
      (sendQueue.summary.provider_blocked_count || 0) === 0 &&
      providerReadiness.live_send_blocked === false,
    socialProviderCount > 0 && socialProviderReadyCount === socialProviderCount,
    (socialReadiness.schedule.blocked_count || 0) === 0 &&
      (socialReadiness.schedule.eligible_count || 0) >= (socialReadiness.schedule.due_count || 0),
    socialIssueCount === 0,
    (socialReadiness.audit.dry_run_count || 0) > 0 || (socialReadiness.audit.published_count || 0) > 0,
    Boolean(adLaunchReadiness.provider_status.configured),
    (adLaunchReadiness.blocked_count || 0) === 0 && (adLaunchReadiness.ready_count || 0) > 0,
    (adSyncReadiness.audit.unsynced_live_count || 0) === 0,
    adIssueCount === 0,
  ];
  return {
    passed: checks.filter(Boolean).length,
    total: checks.length,
    score: Math.round((checks.filter(Boolean).length / checks.length) * 100),
  };
}

function assertTextContains(text, expected, label) {
  assert(text.includes(expected), `${label} did not include "${expected}". Actual text:\n${text}`);
}

function assertMetricText(text, label, value, scope) {
  const normalized = text.replace(/\s+/g, " ").trim();
  assertTextContains(normalized, `${label.toUpperCase()} ${value}`, `${scope} metric ${label}`);
}

async function fetchReadinessContracts(cookie) {
  const anonymous = await apiJson("/api/v1/restaurant/promotions/providers/status");
  assert(anonymous.response.status === 401, `Anonymous provider readiness should be blocked, got ${anonymous.response.status}.`);

  const [provider, sendQueue, social, adLaunch, adSync] = await Promise.all([
    adminJson("/api/v1/restaurant/promotions/providers/status", cookie),
    adminJson("/api/v1/restaurant/promotions/send/queue?limit=20&view=all", cookie),
    adminJson("/api/v1/restaurant/social/readiness?limit=20", cookie),
    adminJson("/api/v1/restaurant/ads/launch-readiness?limit=20", cookie),
    adminJson("/api/v1/restaurant/ads/sync-readiness?limit=20", cookie),
  ]);

  assert(provider.response.ok, `Provider readiness failed: ${JSON.stringify(provider.data)}`);
  assert(sendQueue.response.ok, `Campaign send queue failed: ${JSON.stringify(sendQueue.data)}`);
  assert(social.response.ok, `Social readiness failed: ${JSON.stringify(social.data)}`);
  assert(adLaunch.response.ok, `Ad launch readiness failed: ${JSON.stringify(adLaunch.data)}`);
  assert(adSync.response.ok, `Ad sync readiness failed: ${JSON.stringify(adSync.data)}`);
  assert(Array.isArray(provider.data.channels), "Provider readiness should include channel status rows.");
  assert(typeof sendQueue.data.summary.live_ready_count === "number", "Send queue should include live-ready campaign count.");
  assert(social.data.providers.facebook && social.data.providers.instagram, "Social readiness should include both providers.");
  assert(typeof adLaunch.data.ready_count === "number", "Ad launch readiness should include ready count.");
  assert(typeof adSync.data.audit.unsynced_live_count === "number", "Ad sync readiness should include external sync audit.");

  return {
    provider: provider.data,
    sendQueue: sendQueue.data,
    social: social.data,
    adLaunch: adLaunch.data,
    adSync: adSync.data,
  };
}

async function verifyBrowser(contracts) {
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

    const response = await page.goto(`${baseURL}/promotions`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Promotions page returned HTTP ${response?.status() || "no response"}.`);

    const board = page.getByTestId("marketing-live-readiness-board");
    await board.waitFor({ timeout: 20000 });
    await board.getByText("Marketing Live Readiness", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("marketing-sender-checklist").waitFor({ timeout: 15000 });
    await page.getByTestId("marketing-social-checklist").waitFor({ timeout: 15000 });
    await page.getByTestId("marketing-ad-checklist").waitFor({ timeout: 15000 });
    await board.getByText("Campaign Sender Checklist", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Social Posting Checklist", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Ad Launch Checklist", { exact: true }).waitFor({ timeout: 15000 });

    const socialProviderCount = Object.keys(contracts.social.providers || {}).length || 2;
    const socialProviderReadyCount = Object.values(contracts.social.providers || {}).filter((status) => status.configured).length;
    const score = marketingScore(
      contracts.provider,
      contracts.sendQueue,
      contracts.social,
      contracts.adLaunch,
      contracts.adSync
    );

    await page.getByTestId("marketing-live-readiness-score").getByText(`${score.score}% ready`, { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText(`${score.passed}/${score.total} checks passed`, { exact: true }).waitFor({ timeout: 15000 });
    const senderText = await page.getByTestId("marketing-sender-checklist").innerText();
    const socialText = await page.getByTestId("marketing-social-checklist").innerText();
    const adText = await page.getByTestId("marketing-ad-checklist").innerText();
    assertMetricText(senderText, "Providers", `${contracts.provider.configured_count}/3`, "sender");
    assertMetricText(senderText, "Ready Campaigns", `${contracts.sendQueue.summary.ready_campaign_count}`, "sender");
    assertMetricText(senderText, "Ready Contacts", `${contracts.sendQueue.summary.send_ready_contacts}`, "sender");
    assertMetricText(socialText, "Providers", `${socialProviderReadyCount}/${socialProviderCount}`, "social");
    assertMetricText(socialText, "Due Posts", `${contracts.social.schedule.due_count}`, "social");
    assertMetricText(socialText, "Blocked", `${contracts.social.schedule.blocked_count}`, "social");
    assertMetricText(adText, "Ready", `${contracts.adLaunch.ready_count}`, "ads");
    assertMetricText(adText, "Blocked", `${contracts.adLaunch.blocked_count}`, "ads");
    assertMetricText(adText, "Budget", `Rs ${Math.round(contracts.adLaunch.planned_budget || 0).toLocaleString()}`, "ads");
    await page.getByRole("link", { name: /Open send queue/i }).waitFor({ timeout: 15000 });
    await page.getByRole("link", { name: /Open social/i }).waitFor({ timeout: 15000 });
    await page.getByRole("link", { name: /Open ads/i }).waitFor({ timeout: 15000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-marketing-live-readiness-command.png"),
      fullPage: true,
    });
    watch.assertClean("marketing live-readiness command");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const cookie = await portalLogin();
  const contracts = await fetchReadinessContracts(cookie);
  await verifyBrowser(contracts);
  console.log("Marketing live-readiness command proof passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
