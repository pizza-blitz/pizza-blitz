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

function assertNormalizedTextContains(text, expected, label) {
  const normalized = text.replace(/\s+/g, " ").trim().toUpperCase();
  assert(
    normalized.includes(expected.toUpperCase()),
    `${label} did not include "${expected}". Actual text:\n${text}`
  );
}

async function verifyApi(cookie) {
  const anonymous = await apiJson("/api/v1/restaurant/ops/launch-candidate");
  assert(anonymous.response.status === 401, `Anonymous launch candidate report should be blocked, got ${anonymous.response.status}.`);

  const report = await adminJson("/api/v1/restaurant/ops/launch-candidate", cookie);
  assert(report.response.ok, `Launch candidate API failed: ${JSON.stringify(report.data)}`);
  assert(typeof report.data.score === "number", "Launch candidate score was missing.");
  assert(["ready", "conditional", "hold"].includes(report.data.release_decision), "Release decision was missing.");
  assert(report.data.summary?.critical_routes >= 8, "Critical route summary was incomplete.");
  assert(report.data.critical_routes.some((route) => route.route === "/ops"), "Ops route proof was missing.");
  assert(report.data.critical_routes.some((route) => route.route === "/order"), "Customer checkout route proof was missing.");
  assert(
    report.data.critical_routes.some((route) => route.proof === "verify-customer-web-checkout.cjs"),
    "Customer checkout proof ownership was missing."
  );
  assert(
    report.data.proof_gates.some((gate) => gate.proof === "verify-launch-candidate-hardening.cjs"),
    "Launch hardening proof gate was missing."
  );
  assert(Array.isArray(report.data.blocker_review.hard_blockers), "Hard blocker review was missing.");
  assert(Array.isArray(report.data.hardening_checks), "Hardening checks were missing.");

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

    const board = page.getByTestId("launch-candidate-hardening-command");
    await board.waitFor({ timeout: 20000 });
    await board.getByText("Launch Candidate Hardening Command", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("critical-route-stability").waitFor({ timeout: 15000 });
    await page.getByTestId("e2e-failure-review").waitFor({ timeout: 15000 });
    await page.getByTestId("production-blocker-review").waitFor({ timeout: 15000 });
    await page.getByTestId("launch-release-decision").waitFor({ timeout: 15000 });
    await page.getByText("Critical Route Stability", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("E2E Failure Review", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Production Blocker Review", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Release Decision", { exact: true }).waitFor({ timeout: 15000 });
    const criticalRoutes = page.getByTestId("critical-route-stability");
    await criticalRoutes.locator('a[href="/ops"]').waitFor({ timeout: 15000 });
    await criticalRoutes.locator('a[href="/order"]').waitFor({ timeout: 15000 });
    await page
      .getByTestId("e2e-failure-review")
      .getByText("verify-launch-candidate-hardening.cjs", { exact: true })
      .waitFor({ timeout: 15000 });
    await page
      .getByTestId("critical-route-stability")
      .getByText("verify-customer-web-checkout.cjs", { exact: true })
      .waitFor({ timeout: 15000 });

    const boardText = await board.innerText();
    assertNormalizedTextContains(boardText, `${report.score}% ready`, "launch board readiness score");
    assertNormalizedTextContains(boardText, report.release_decision, "launch board release decision");
    assertNormalizedTextContains(boardText, `Critical Routes ${report.summary.critical_routes}`, "launch board route count");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-launch-candidate-hardening-command.png"),
    });
    watch.assertClean("launch candidate hardening command");
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
  console.log("Launch candidate hardening proof passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
