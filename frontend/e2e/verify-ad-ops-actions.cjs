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

async function clickAndWait(page, testId, urlPart) {
  const [response] = await Promise.all([
    page.waitForResponse((res) => res.url().includes(urlPart) && res.request().method() === "POST"),
    page.getByTestId(testId).click(),
  ]);
  const payload = await response.json().catch(() => ({}));
  assert(response.ok(), `${testId} failed: ${JSON.stringify(payload)}`);
  return payload;
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const cookie = await portalLogin();
  const campaignName = `Ad Ops Actions Proof ${Date.now()}`;
  const campaign = await adminJson("/api/v1/restaurant/ads/campaigns", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: campaignName,
      objective: "sales",
      platforms: ["facebook", "instagram"],
      audience: "Weekend pizza buyers",
      location: "Delivery radius",
      creative_message: "Pizza Blitz ad operations proof campaign.",
      link_url: `${baseURL}/order`,
      lifetime_budget: 1200,
      start_date: isoDate(-1),
      end_date: isoDate(8),
      status: "ready",
    }),
  });
  assert(campaign.response.ok, `Could not create ad ops campaign: ${JSON.stringify(campaign.data)}`);
  const campaignId = campaign.data.campaign.id;

  const anonymousPause = await apiJson(`/api/v1/restaurant/ads/campaigns/${campaignId}/pause`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note: "anonymous should fail" }),
  });
  assert(anonymousPause.response.status === 401, `Anonymous pause should be blocked, got ${anonymousPause.response.status}.`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  let duplicateId = null;
  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/ads?campaign=${campaignId}`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Ads page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByText(campaignName, { exact: false }).first().click();
    await page.getByTestId("ad-ops-actions").waitFor({ timeout: 15000 });

    const pause = await clickAndWait(page, "pause-ad-campaign", `/campaigns/${campaignId}/pause`);
    assert(pause.campaign.status === "paused", `Pause did not set paused status: ${JSON.stringify(pause)}`);
    await page.getByText("paused", { exact: false }).first().waitFor({ timeout: 15000 });

    const resume = await clickAndWait(page, "resume-ad-campaign", `/campaigns/${campaignId}/resume`);
    assert(resume.campaign.status === "ready", `Resume did not restore ready status: ${JSON.stringify(resume)}`);
    await page.getByText("ready", { exact: false }).first().waitFor({ timeout: 15000 });

    const complete = await clickAndWait(page, "complete-ad-campaign", `/campaigns/${campaignId}/complete`);
    assert(complete.campaign.status === "completed", `Complete did not set completed status: ${JSON.stringify(complete)}`);
    await page.getByText("completed", { exact: false }).first().waitFor({ timeout: 15000 });

    const duplicate = await clickAndWait(page, "duplicate-ad-campaign", `/campaigns/${campaignId}/duplicate`);
    duplicateId = duplicate.duplicate.id;
    assert(duplicate.duplicate.status === "ready", `Duplicate should be ready: ${JSON.stringify(duplicate)}`);
    assert(duplicate.duplicate.spend === 0, "Duplicate should reset spend.");

    await page.getByText(`${campaignName} Copy`, { exact: false }).first().waitFor({ timeout: 15000 });
    const actionHistory = page.getByTestId("ad-action-history");
    await actionHistory.getByText("created from duplicate", { exact: false }).waitFor({ timeout: 15000 });
    await actionHistory.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactsDir, "visible-ad-ops-actions.png"),
      fullPage: false,
    });
    watch.assertClean("ad ops actions console");
  } finally {
    await browser.close();
  }

  const originalActions = await adminJson(`/api/v1/restaurant/ads/campaigns/${campaignId}/actions`, cookie);
  assert(originalActions.response.ok, `Original action history failed: ${JSON.stringify(originalActions.data)}`);
  const actionNames = originalActions.data.actions.map((action) => action.action);
  ["pause", "resume", "complete", "duplicate"].forEach((action) => {
    assert(actionNames.includes(action), `Original action history is missing ${action}: ${JSON.stringify(actionNames)}`);
  });

  const duplicateActions = await adminJson(`/api/v1/restaurant/ads/campaigns/${duplicateId}/actions`, cookie);
  assert(duplicateActions.response.ok, `Duplicate action history failed: ${JSON.stringify(duplicateActions.data)}`);
  assert(
    duplicateActions.data.actions.some((action) => action.action === "created_from_duplicate"),
    "Duplicate campaign did not record created_from_duplicate action."
  );

  console.log(`Ad ops actions proof passed for campaign #${campaignId} and duplicate #${duplicateId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
