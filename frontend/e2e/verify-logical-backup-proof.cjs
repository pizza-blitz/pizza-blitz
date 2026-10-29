const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");
const opsCommandTimeoutMs = Number(
  process.env.E2E_OPS_COMMAND_TIMEOUT_MS || (baseURL.includes("vercel.app") ? 60000 : 15000)
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
    const localRequest = url.startsWith(baseURL) || url.startsWith(apiURL);
    if (!localRequest) return;
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

async function proveBrowserButton() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/ops`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Ops page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByTestId("run-logical-backup-proof").waitFor({ timeout: opsCommandTimeoutMs });
    await page.getByTestId("run-logical-backup-proof").click();
    await page.getByTestId("ops-message").getByText("Logical export proof recorded", { exact: false }).waitFor({
      timeout: opsCommandTimeoutMs,
    });
    await page.getByText("Logical export: pass", { exact: false }).waitFor({ timeout: opsCommandTimeoutMs });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-logical-backup-proof.png"),
      fullPage: true,
    });
    watch.assertClean("logical backup proof button");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const anonymousRun = await apiJson("/api/v1/restaurant/ops/backups/logical-proof/run", { method: "POST" });
  assert(
    anonymousRun.response.status === 401,
    `Anonymous logical proof should be blocked, got ${anonymousRun.response.status}.`
  );

  const cookie = await portalLogin();
  const proofRun = await adminJson("/api/v1/restaurant/ops/backups/logical-proof/run", cookie, { method: "POST" });
  assert(proofRun.response.ok, `Logical proof failed: ${JSON.stringify(proofRun.data)}`);
  assert(proofRun.data.backup?.backup_type === "logical_manifest", "Logical proof did not create a logical_manifest backup run.");
  assert(proofRun.data.backup?.status === "success", "Logical proof backup run was not successful.");
  assert(/^logical-manifest:[a-f0-9]{64}$/.test(proofRun.data.backup?.file_path || ""), "Logical proof did not record a checksum reference.");
  assert(/^[a-f0-9]{64}$/.test(proofRun.data.manifest?.checksum || ""), "Logical proof manifest checksum is invalid.");
  assert(proofRun.data.manifest?.table_count >= 10, "Logical proof manifest did not cover the expected core tables.");
  assert(Array.isArray(proofRun.data.manifest?.tables), "Logical proof manifest did not include table details.");
  assert(
    proofRun.data.manifest.tables.some((table) => table.table === "orders"),
    "Logical proof manifest did not include orders."
  );
  assert(
    proofRun.data.manifest.tables.some((table) => table.table === "customers"),
    "Logical proof manifest did not include customers."
  );

  const readiness = await adminJson("/api/v1/restaurant/ops/readiness", cookie);
  assert(readiness.response.ok, `Readiness failed after logical proof: ${JSON.stringify(readiness.data)}`);
  assert(readiness.data.logical_backup_proof?.status === "pass", "Readiness did not mark logical proof as fresh.");
  assert(
    readiness.data.logical_backup_proof?.checksum === proofRun.data.manifest.checksum,
    "Readiness logical proof checksum does not match the latest run."
  );

  await proveBrowserButton();
  console.log(
    `Logical backup proof passed with ${proofRun.data.manifest.table_count} tables and checksum ${proofRun.data.manifest.checksum.slice(0, 12)}.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
