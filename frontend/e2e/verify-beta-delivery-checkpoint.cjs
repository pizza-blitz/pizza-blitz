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
  const anonymous = await apiJson("/api/v1/restaurant/ops/beta-delivery");
  assert(anonymous.response.status === 401, `Anonymous beta delivery report should be blocked, got ${anonymous.response.status}.`);

  const report = await adminJson("/api/v1/restaurant/ops/beta-delivery", cookie);
  assert(report.response.ok, `Beta delivery API failed: ${JSON.stringify(report.data)}`);
  assert(typeof report.data.score === "number", "Beta delivery score was missing.");
  assert(["ready", "conditional", "hold"].includes(report.data.decision), "Beta delivery decision was missing.");
  assert(report.data.summary?.proofs_total >= 8, "Beta delivery proof queue was incomplete.");
  assert(report.data.summary?.known_gaps >= 5, "Known gap documentation was incomplete.");
  assert(report.data.proof_queue.some((proof) => proof.proof === "npm run build"), "Final build proof gate was missing.");
  assert(
    report.data.proof_queue.some((proof) => proof.proof === "verify-final-acceptance-walkthrough.cjs"),
    "Final acceptance proof gate was missing."
  );
  assert(report.data.known_gaps.some((gap) => gap.key === "real_payments"), "Real payment known gap was missing.");
  assert(report.data.production_plan.some((step) => step.key === "deployment_smoke"), "Deployment smoke next step was missing.");
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

    const board = page.getByTestId("beta-delivery-checkpoint-command");
    await board.waitFor({ timeout: 20000 });
    await board.getByText("Beta Delivery Checkpoint Command", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("beta-proof-queue").waitFor({ timeout: 15000 });
    await page.getByTestId("known-gap-documentation").waitFor({ timeout: 15000 });
    await page.getByTestId("next-production-plan").waitFor({ timeout: 15000 });
    await page.getByTestId("beta-handoff-decision").waitFor({ timeout: 15000 });
    await board.getByText("Final Build and Smoke Proof Queue", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Known Gap Documentation", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Next Production Plan", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Checkpoint Handoff", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("npm run build", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("verify-final-acceptance-walkthrough.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Real payment credentials", { exact: true }).waitFor({ timeout: 15000 });
    await board.getByText("Deploy and smoke test", { exact: true }).waitFor({ timeout: 15000 });

    const boardText = await board.innerText();
    assertNormalizedTextContains(boardText, `${report.score}% ready`, "beta delivery board readiness score");
    assertNormalizedTextContains(boardText, report.decision, "beta delivery board decision");
    assertNormalizedTextContains(boardText, `Proofs ${report.summary.proofs_total}`, "beta delivery proof count");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-beta-delivery-checkpoint-command.png"),
    });
    watch.assertClean("beta delivery checkpoint command");
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
  console.log("Beta delivery checkpoint proof passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
