const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

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

function isoDate(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
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

async function verifyApiContract(cookie) {
  const anonymous = await apiJson("/api/v1/restaurant/ads/management-control");
  assert(anonymous.response.status === 401, `Anonymous ad management control should be blocked, got ${anonymous.response.status}.`);

  const firstControl = await adminJson("/api/v1/restaurant/ads/management-control?limit=100", cookie);
  assert(firstControl.response.ok, `Ad management control failed: ${JSON.stringify(firstControl.data)}`);
  assert(firstControl.data.summary?.overall_status, "Management control summary did not include overall status.");
  assert(Array.isArray(firstControl.data.controls), "Management control missing operator controls.");
  assert(firstControl.data.controls.some((item) => item.label === "Provider launch gate"), "Provider launch gate control was missing.");
  assert(firstControl.data.controls.some((item) => item.label === "Budget pacing gate"), "Budget pacing gate control was missing.");
  assert(firstControl.data.controls.some((item) => item.label === "External ID audit"), "External ID audit control was missing.");

  const campaignName = `Ad Management Proof ${Date.now()}`;
  const campaign = await adminJson("/api/v1/restaurant/ads/campaigns", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: campaignName,
      objective: "sales",
      platforms: ["facebook", "instagram"],
      audience: "High intent pizza buyers",
      location: "Local delivery radius",
      creative_message: "Pizza Blitz ad management control proof campaign.",
      link_url: `${baseURL}/order`,
      lifetime_budget: 1000,
      start_date: isoDate(-4),
      end_date: isoDate(5),
      status: "ready",
    }),
  });
  assert(campaign.response.ok, `Could not create ad management campaign: ${JSON.stringify(campaign.data)}`);
  const campaignId = campaign.data.campaign.id;

  const metrics = await adminJson(`/api/v1/restaurant/ads/campaigns/${campaignId}/metrics`, cookie, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      impressions: 9000,
      clicks: 270,
      conversions: 30,
      spend: 700,
      revenue: 2400,
    }),
  });
  assert(metrics.response.ok, `Could not update ad management metrics: ${JSON.stringify(metrics.data)}`);

  const dryRun = await adminJson(`/api/v1/restaurant/ads/campaigns/${campaignId}/launch`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true }),
  });
  assert(dryRun.response.ok, `Ad launch dry-run failed: ${JSON.stringify(dryRun.data)}`);
  assert(dryRun.data.launches[0].status === "dry_run", "Launch proof did not record a dry_run attempt.");

  const control = await adminJson("/api/v1/restaurant/ads/management-control?limit=100", cookie);
  assert(control.response.ok, `Updated ad management control failed: ${JSON.stringify(control.data)}`);
  assert(typeof control.data.summary.launch_ready_count === "number", "Management summary missing launch-ready count.");
  assert(typeof control.data.summary.budget_attention_count === "number", "Management summary missing budget attention count.");
  assert(typeof control.data.summary.external_sync_count === "number", "Management summary missing external sync count.");
  const row = control.data.campaigns.find((item) => item.id === campaignId);
  assert(row, "Created campaign did not appear in management control rows.");
  assert(row.budget_health.attention_required === true, "Management row should flag the over-pacing budget risk.");
  assert(row.budget_health.pacing_status === "over_pacing", `Expected over_pacing, got ${row.budget_health.pacing_status}.`);
  assert(row.latest_launch?.status === "dry_run", "Management row did not expose the latest dry-run launch proof.");
  assert(row.next_action, "Management row did not include a next action.");

  return { campaignId, campaignName };
}

async function verifyBrowser(campaignId, campaignName) {
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

    const managementResponsePromise = page.waitForResponse((res) =>
      res.url().includes("/ads/management-control") && res.status() === 200
    );
    const response = await page.goto(`${baseURL}/ads?campaign=${campaignId}`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Ads page returned HTTP ${response?.status() || "no response"}.`);
    await managementResponsePromise;

    const management = page.getByTestId("ad-management-control");
    await management.waitFor({ timeout: 25000 });
    await management.getByText("Ad Campaign Mission Control", { exact: false }).waitFor({ timeout: 25000 });
    await management.getByText("Launch readiness, budget risk, sync audit and next actions", { exact: false }).waitFor({ timeout: 25000 });
    await management.getByText("Provider launch gate", { exact: true }).waitFor({ timeout: 25000 });
    await management.getByText("Paused launch guardrail", { exact: true }).waitFor({ timeout: 25000 });
    await management.getByText("Budget pacing gate", { exact: true }).waitFor({ timeout: 25000 });
    await management.getByText("External ID audit", { exact: true }).waitFor({ timeout: 25000 });
    await management.getByText("Action ledger", { exact: true }).waitFor({ timeout: 25000 });
    await management.getByText("Priority Campaigns", { exact: false }).waitFor({ timeout: 25000 });
    await management.getByText("Operator Summary", { exact: false }).waitFor({ timeout: 25000 });
    await management.getByText("review", { exact: false }).first().waitFor({ timeout: 25000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-ad-management-control.png"),
      fullPage: true,
    });
    watch.assertClean("ad management mission control");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const cookie = await portalLogin();
  const proof = await verifyApiContract(cookie);
  await verifyBrowser(proof.campaignId, proof.campaignName);
  console.log(`Ad management control proof passed for campaign #${proof.campaignId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
