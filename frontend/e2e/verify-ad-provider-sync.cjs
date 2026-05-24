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

async function clickAndWait(page, testId, urlPart) {
  const [response] = await Promise.all([
    page.waitForResponse((res) => res.url().includes(urlPart) && res.request().method() === "POST"),
    page.getByTestId(testId).click(),
  ]);
  const payload = await response.json().catch(() => ({}));
  assert(response.ok(), `${testId} failed: ${JSON.stringify(payload)}`);
  return payload;
}

async function proveSyncPanel(campaignName, campaignId, externalId) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1300 },
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
    await page.getByTestId("ad-provider-sync-command").waitFor({ timeout: 15000 });
    await page.getByText("Ad Provider Sync", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("External ID Audit", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText(campaignName, { exact: false }).first().click();

    const panel = page.getByTestId("ad-external-sync-panel");
    await panel.waitFor({ timeout: 15000 });
    await panel.getByText("Meta Campaign ID", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByTestId("external-campaign-id").fill(externalId);
    const dryRun = await clickAndWait(page, "dry-run-ad-sync", `/campaigns/${campaignId}/external-sync`);
    assert(dryRun.dry_run === true, `Browser dry-run sync did not stay dry: ${JSON.stringify(dryRun)}`);
    await panel.getByText("Dry run ready", { exact: false }).waitFor({ timeout: 15000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-ad-provider-sync.png"),
      fullPage: true,
    });
    watch.assertClean("ad provider sync console");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const anonymous = await apiJson("/api/v1/restaurant/ads/sync-readiness");
  assert(anonymous.response.status === 401, `Anonymous ad sync readiness should be blocked, got ${anonymous.response.status}.`);

  const cookie = await portalLogin();
  const provider = await adminJson("/api/v1/restaurant/ads/provider-status", cookie);
  assert(provider.response.ok, `Provider readiness failed: ${JSON.stringify(provider.data)}`);
  assert(Array.isArray(provider.data.credential_checks), "Provider readiness should expose credential checks.");
  assert(provider.data.external_sync?.dry_run_available === true, "Provider readiness should expose dry-run sync support.");
  assert(provider.data.graph_version, "Provider readiness should expose the Meta graph version.");

  const campaignName = `Ad Provider Sync Proof ${Date.now()}`;
  const campaign = await adminJson("/api/v1/restaurant/ads/campaigns", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: campaignName,
      objective: "sales",
      platforms: ["facebook", "instagram"],
      audience: "Weekend pizza buyers",
      location: "Delivery radius",
      creative_message: "Pizza Blitz provider sync proof campaign.",
      link_url: `${baseURL}/order`,
      daily_budget: 500,
      status: "ready",
    }),
  });
  assert(campaign.response.ok, `Could not create ad sync campaign: ${JSON.stringify(campaign.data)}`);
  const campaignId = campaign.data.campaign.id;

  const launchDryRun = await adminJson(`/api/v1/restaurant/ads/campaigns/${campaignId}/launch`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true }),
  });
  assert(launchDryRun.response.ok, `Launch dry-run failed: ${JSON.stringify(launchDryRun.data)}`);
  assert(launchDryRun.data.launches[0].recovery_action, "Launch dry-run should expose recovery guidance.");

  const externalId = `meta_sync_${Date.now()}`;
  const syncDryRun = await adminJson(`/api/v1/restaurant/ads/campaigns/${campaignId}/external-sync`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      external_campaign_id: externalId,
      status: "paused",
      dry_run: true,
      note: "E2E dry-run sync.",
    }),
  });
  assert(syncDryRun.response.ok, `External sync dry-run failed: ${JSON.stringify(syncDryRun.data)}`);
  assert(syncDryRun.data.dry_run === true, "External sync dry-run should not apply changes.");
  assert(syncDryRun.data.campaign.external_campaign_id !== externalId, "Dry-run sync should not mutate the campaign.");

  const applySync = await adminJson(`/api/v1/restaurant/ads/campaigns/${campaignId}/external-sync`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      external_campaign_id: externalId,
      status: "paused",
      dry_run: false,
      note: "E2E applied external sync.",
    }),
  });
  assert(applySync.response.ok, `External sync apply failed: ${JSON.stringify(applySync.data)}`);
  assert(applySync.data.campaign.external_campaign_id === externalId, "External sync did not attach the Meta campaign ID.");
  assert(applySync.data.campaign.status === "paused", `External sync should set paused, got ${applySync.data.campaign.status}.`);
  assert(applySync.data.action.action === "external_sync", "External sync should write an external_sync action.");

  const resume = await adminJson(`/api/v1/restaurant/ads/campaigns/${campaignId}/resume`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note: "E2E provider resume guardrail." }),
  });
  assert(resume.response.ok, `External ID resume failed: ${JSON.stringify(resume.data)}`);
  assert(resume.data.campaign.status === "launched", "Resume with external ID should return campaign to launched.");

  const syncReadiness = await adminJson("/api/v1/restaurant/ads/sync-readiness", cookie);
  assert(syncReadiness.response.ok, `Sync readiness failed: ${JSON.stringify(syncReadiness.data)}`);
  assert(syncReadiness.data.audit.external_id_count >= 1, "Sync readiness should count external campaign IDs.");
  assert(syncReadiness.data.audit.external_sync_count >= 1, "Sync readiness should count external sync actions.");
  assert(Array.isArray(syncReadiness.data.checklist), "Sync readiness should expose the launch checklist.");

  const actions = await adminJson(`/api/v1/restaurant/ads/campaigns/${campaignId}/actions`, cookie);
  assert(actions.response.ok, `Ad action history failed: ${JSON.stringify(actions.data)}`);
  assert(
    actions.data.actions.some((action) => action.action === "external_sync"),
    "Ad action history is missing the external_sync action."
  );

  await proveSyncPanel(campaignName, campaignId, externalId);
  console.log(`Ad provider sync proof passed for campaign #${campaignId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
