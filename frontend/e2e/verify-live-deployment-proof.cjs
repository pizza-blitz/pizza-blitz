const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");
const liveProofTimeoutMs = Number(
  process.env.E2E_LIVE_DEPLOYMENT_TIMEOUT_MS || (baseURL.includes("vercel.app") ? 90000 : 30000)
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
  const data = await response.json().catch(() => ({}));
  assert(response.ok, `Admin portal login failed: ${JSON.stringify(data)}`);
  const cookie = cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
  assert(cookie.includes("pb_admin_session="), "Admin login did not return an admin session cookie.");
  return cookie;
}

async function apiJson(endpoint, cookie, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      Cookie: cookie,
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
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

async function verifyApi(cookie) {
  const anonymous = await apiJson("/api/v1/restaurant/ops/live-deployment-proof/run", "", {
    method: "POST",
  });
  assert(
    anonymous.response.status === 401,
    `Anonymous live deployment proof should be blocked, got ${anonymous.response.status}.`
  );

  const result = await apiJson("/api/v1/restaurant/ops/live-deployment-proof/run", cookie, {
    method: "POST",
  });
  assert(result.response.ok, `Admin live deployment proof failed: ${JSON.stringify(result.data)}`);
  const proof = result.data.proof;
  assert(proof.status === "pass", `Live deployment proof did not pass: ${JSON.stringify(proof)}`);
  assert(proof.score === 100, `Live deployment proof score was ${proof.score}, expected 100.`);
  assert(proof.checks_passed === 4, "Live deployment proof did not pass all four checks.");
  const keys = new Set(proof.checks.map((check) => check.key));
  for (const key of ["public_api_health", "checkout_database_readiness", "cors_origin_lock", "public_order_page"]) {
    assert(keys.has(key), `Live deployment proof missing check ${key}.`);
  }
  assert(result.data.event?.event_type === "deployment", "Live deployment proof did not record a deployment audit event.");
  return proof;
}

async function verifyBrowser(proof) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1250 } });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/ops`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Production Ops returned HTTP ${response?.status() || "no response"}.`);

    const command = page.getByTestId("live-deployment-proof-command");
    await command.waitFor({ timeout: 20000 });
    await command.getByRole("heading", { name: "Live Deployment Proof" }).waitFor({ timeout: 15000 });
    await command.getByText("Public API health", { exact: true }).waitFor({ timeout: 15000 });
    await command.getByText("Checkout database readiness", { exact: true }).waitFor({ timeout: 15000 });
    await command.getByText("CORS origin lock", { exact: true }).waitFor({ timeout: 15000 });
    await command.getByText("Public order page", { exact: true }).waitFor({ timeout: 15000 });
    await command.getByText(`${proof.score}%`, { exact: true }).waitFor({ timeout: 15000 });

    await page.getByTestId("live-deployment-proof-panel-run").click();
    await page
      .getByTestId("ops-message")
      .getByText("Live deployment proof passed", { exact: false })
      .waitFor({ timeout: liveProofTimeoutMs });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-live-deployment-proof.png"),
      fullPage: true,
    });
    watch.assertClean("live deployment proof command");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");
  const cookie = await portalLogin();
  const proof = await verifyApi(cookie);
  await verifyBrowser(proof);
  console.log("Live deployment proof command passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
