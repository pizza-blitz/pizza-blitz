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

function createBrowserWatch(page) {
  const issues = [];
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico|images\.unsplash\.com/i.test(text)) return;
    if (/Failed to fetch RSC payload/i.test(text) && /Falling back to browser navigation/i.test(text)) return;
    if (/Access to fetch at 'http:\/\/(?:localhost|127\.0\.0\.1):3011\/login'.*\/logout\?_rsc=/i.test(text)) return;
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

async function verifyApi(cookie) {
  const anonymous = await apiJson("/api/v1/restaurant/ops/credential-activation");
  assert(anonymous.response.status === 401, `Anonymous credential activation report should be blocked, got ${anonymous.response.status}.`);

  const report = await adminJson("/api/v1/restaurant/ops/credential-activation", cookie);
  assert(report.response.ok, `Credential activation API failed: ${JSON.stringify(report.data)}`);
  assert(typeof report.data.score === "number", "Credential activation score was missing.");
  assert(["ready", "conditional", "hold"].includes(report.data.decision), "Credential activation decision was missing.");
  assert(report.data.summary?.providers_total >= 7, "Credential activation provider total was incomplete.");
  assert(report.data.summary?.smoke_steps === 5, "Credential activation smoke plan was incomplete.");

  const laneKeys = report.data.activation_lanes.map((lane) => lane.key);
  for (const key of ["payment_gateway", "messaging_channels", "social_publishing", "ad_campaign_sync"]) {
    assert(laneKeys.includes(key), `Credential activation lane ${key} was missing.`);
  }
  assert(
    report.data.provider_matrix.some((provider) => provider.key === "payment_checkout"),
    "Credential activation provider matrix did not include payment checkout."
  );
  assert(
    report.data.smoke_plan.some((step) => step.key === "payment_webhook"),
    "Credential activation smoke plan did not include payment webhook."
  );
  assert(
    report.data.evidence.some((item) => item.proof === "verify-credential-activation-command.cjs"),
    "Credential activation evidence did not include its browser proof."
  );
  return report.data;
}

async function verifyBrowser(report) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1250 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/ops`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Production Ops page returned HTTP ${response?.status() || "no response"}.`);

    const board = page.getByTestId("credential-activation-command");
    await board.waitFor({ timeout: 20000 });
    await board.getByText("Credential Activation Command", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("payment-gateway-activation").waitFor({ timeout: 15000 });
    await page.getByTestId("messaging-activation").waitFor({ timeout: 15000 });
    await page.getByTestId("social-publishing-activation").waitFor({ timeout: 15000 });
    await page.getByTestId("ad-sync-activation").waitFor({ timeout: 15000 });
    await page.getByTestId("credential-smoke-plan").waitFor({ timeout: 15000 });
    await page.getByTestId("provider-readiness-matrix").waitFor({ timeout: 15000 });
    await page.getByTestId("credential-activation-blockers").waitFor({ timeout: 15000 });
    await page.getByTestId("credential-go-no-go").waitFor({ timeout: 15000 });
    await board.getByText("Payment Gateway Activation", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Messaging Channel Activation", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Social Publishing Activation", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Ad Campaign Sync Activation", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Run low-value payment checkout", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Run payment webhook proof", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Run campaign test sends", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Run social publish smoke", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Run ad sync smoke", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("verify-credential-activation-command.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("visible-credential-activation-command.png", { exact: true }).waitFor({ timeout: 15000 });

    const normalizedBoardText = (await board.innerText()).replace(/\s+/g, " ").trim();
    assert(/\d+% ready/i.test(normalizedBoardText), "Credential activation board did not show a readiness score.");
    assert(normalizedBoardText.toLowerCase().includes(report.decision), "Credential activation board did not show API decision.");
    assert(/Providers \d+\/\d+/i.test(normalizedBoardText), "Credential activation board did not show provider count.");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-credential-activation-command.png"),
    });
    watch.assertClean("credential activation command");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const cookie = await portalLogin();
  const report = await verifyApi(cookie);
  await verifyBrowser(report);
  console.log("Credential activation command proof passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
