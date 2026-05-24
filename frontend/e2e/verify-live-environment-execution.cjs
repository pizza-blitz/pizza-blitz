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
    if (/Access to fetch at 'http:\/\/localhost:3011\/login'.*\/logout\?_rsc=/i.test(text)) return;
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
  const anonymous = await apiJson("/api/v1/restaurant/ops/live-environment");
  assert(anonymous.response.status === 401, `Anonymous live environment report should be blocked, got ${anonymous.response.status}.`);

  const report = await adminJson("/api/v1/restaurant/ops/live-environment", cookie);
  assert(report.response.ok, `Live environment API failed: ${JSON.stringify(report.data)}`);
  assert(typeof report.data.score === "number", "Live environment score was missing.");
  assert(["ready", "conditional", "hold"].includes(report.data.decision), "Live environment decision was missing.");
  assert(report.data.summary?.phases_total === 5, "Live environment phase summary was incomplete.");
  assert(report.data.summary?.actions_total >= 15, "Live environment action summary was incomplete.");
  assert(report.data.summary?.evidence_total >= 4, "Live environment evidence summary was incomplete.");

  const phaseKeys = report.data.phases.map((phase) => phase.key);
  for (const key of ["credential_cutover", "database_migration", "secret_sync", "restore_rehearsal", "public_host_smoke"]) {
    assert(phaseKeys.includes(key), `Live environment phase ${key} was missing.`);
  }
  assert(
    report.data.cutover_windows.some((window) => window.key === "rollback"),
    "Live environment report did not include the rollback window."
  );
  assert(
    report.data.evidence.some((item) => item.proof === "verify-live-environment-execution.cjs"),
    "Live environment evidence did not include its browser proof."
  );
  assert(
    report.data.go_no_go.required_signoffs.length >= 3,
    "Live environment go/no-go signoffs were incomplete."
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

    const board = page.getByTestId("live-environment-execution-command");
    await board.waitFor({ timeout: 20000 });
    await board.getByText("Live Environment Execution Command", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("credential-cutover-phase").waitFor({ timeout: 15000 });
    await page.getByTestId("database-migration-phase").waitFor({ timeout: 15000 });
    await page.getByTestId("secret-sync-phase").waitFor({ timeout: 15000 });
    await page.getByTestId("restore-rehearsal-phase").waitFor({ timeout: 15000 });
    await page.getByTestId("public-host-smoke-phase").waitFor({ timeout: 15000 });
    await page.getByTestId("cutover-window-plan").waitFor({ timeout: 15000 });
    await page.getByTestId("go-no-go-checkpoint").waitFor({ timeout: 15000 });
    await page.getByTestId("live-environment-evidence").waitFor({ timeout: 15000 });
    await page.getByTestId("live-environment-blockers").waitFor({ timeout: 15000 });
    await board.getByText("Credential Cutover", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Database Migration", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Secret Sync", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Restore Rehearsal", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Public Host Smoke", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Go/No-Go Checkpoint", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("live-environment-evidence").getByText("verify-live-environment-execution.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("live-environment-evidence").getByText("visible-live-environment-execution-command.png", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("public-host-smoke-phase").getByText("Run customer and staff smoke", { exact: true }).waitFor({ timeout: 15000 });

    const normalizedBoardText = (await board.innerText()).replace(/\s+/g, " ").trim();
    assert(/\d+% ready/i.test(normalizedBoardText), "Live environment board did not show a readiness score.");
    assert(normalizedBoardText.toLowerCase().includes(report.decision), "Live environment board did not show API decision.");
    assert(/Phases \d+\/5/i.test(normalizedBoardText), "Live environment board did not show phase count.");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-live-environment-execution-command.png"),
    });
    watch.assertClean("live environment execution command");
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
  console.log("Live environment execution proof passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
