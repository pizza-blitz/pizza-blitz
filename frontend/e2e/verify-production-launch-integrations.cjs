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
  const anonymous = await apiJson("/api/v1/restaurant/ops/production-launch");
  assert(anonymous.response.status === 401, `Anonymous production launch report should be blocked, got ${anonymous.response.status}.`);

  const report = await adminJson("/api/v1/restaurant/ops/production-launch", cookie);
  assert(report.response.ok, `Production launch API failed: ${JSON.stringify(report.data)}`);
  assert(typeof report.data.score === "number", "Production launch score was missing.");
  assert(["ready", "conditional", "hold"].includes(report.data.decision), "Production launch decision was missing.");
  assert(report.data.summary?.lanes_total === 5, "Production launch lane summary was incomplete.");
  assert(report.data.summary?.integration_steps >= 15, "Production launch integration steps were incomplete.");

  const laneKeys = report.data.lanes.map((lane) => lane.key);
  for (const key of ["live_credentials", "managed_database", "backup_restore", "deployment_secrets", "production_smoke"]) {
    assert(laneKeys.includes(key), `Production launch lane ${key} was missing.`);
  }
  assert(
    report.data.execution_plan.some((step) => step.key === "deploy_smoke"),
    "Production launch execution plan did not include deploy smoke."
  );
  assert(
    report.data.lanes.some((lane) => lane.steps.some((step) => step.proof === "verify-payment-production-pass.cjs")),
    "Payment production proof was missing from launch integrations."
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

    const board = page.getByTestId("production-launch-integrations-command");
    await board.waitFor({ timeout: 20000 });
    await board.getByText("Production Launch Integrations Command", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("live-credentials-lane").waitFor({ timeout: 15000 });
    await page.getByTestId("managed-database-lane").waitFor({ timeout: 15000 });
    await page.getByTestId("backup-restore-lane").waitFor({ timeout: 15000 });
    await page.getByTestId("deployment-secrets-lane").waitFor({ timeout: 15000 });
    await page.getByTestId("production-smoke-lane").waitFor({ timeout: 15000 });
    await page.getByTestId("production-launch-execution-plan").waitFor({ timeout: 15000 });
    await page.getByTestId("production-launch-blockers").waitFor({ timeout: 15000 });
    await board.getByText("Live Credentials", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Managed Database", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Backup/Restore Rehearsal", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Deployment Secrets", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Production Smoke", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Payment gateway credentials", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("verify-payment-production-pass.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("production-launch-execution-plan").getByText("Set deployment secrets", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("production-launch-execution-plan").getByText("Deploy and smoke test", { exact: true }).waitFor({ timeout: 15000 });

    const boardText = await board.innerText();
    const normalizedBoardText = boardText.replace(/\s+/g, " ").trim();
    assert(/\d+% ready/i.test(normalizedBoardText), "Production launch board did not show a readiness score.");
    assert(boardText.toLowerCase().includes(report.decision), "Production launch board did not show API decision.");
    assert(/Lanes \d+\/5/i.test(normalizedBoardText), "Production launch board did not show lane count.");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-production-launch-integrations-command.png"),
    });
    watch.assertClean("production launch integrations command");
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
  console.log("Production launch integrations proof passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
