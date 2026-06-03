const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
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
  return (setCookie || "")
    .split(/,(?=\s*pb_[^=]+=)/)
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

async function proveManagedBackupButtons() {
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

    await page.getByTestId("create-backup-action").waitFor({ timeout: opsCommandTimeoutMs });
    const backupActionText = (await page.getByTestId("create-backup-action").innerText()).trim();
    if (/Backup Proof Form/i.test(backupActionText)) {
      await page.getByTestId("create-backup-action").click();
      await page.getByTestId("ops-message").getByText("Backup proof form is ready", { exact: false }).waitFor({
        timeout: opsCommandTimeoutMs,
      });
      await page.getByTestId("backup-proof-type").selectOption("managed_snapshot");
      assert(
        (await page.getByTestId("backup-proof-type").inputValue()) === "managed_snapshot",
        "Managed backup action did not prepare the managed snapshot proof form."
      );
    }

    await page.getByTestId("run-restore-rehearsal").waitFor({ timeout: opsCommandTimeoutMs });
    const restoreActionText = (await page.getByTestId("run-restore-rehearsal").innerText()).trim();
    if (/Prepare Restore Proof/i.test(restoreActionText)) {
      await page.getByTestId("run-restore-rehearsal").click();
      await page.getByTestId("ops-message").getByText("Restore proof form is ready", { exact: false }).waitFor({
        timeout: opsCommandTimeoutMs,
      });
      assert(
        (await page.getByTestId("backup-proof-type").inputValue()) === "restore_rehearsal",
        "Restore action did not prepare the restore rehearsal proof form."
      );
    }

    await page.screenshot({
      path: path.join(artifactsDir, "visible-managed-backup-proof-actions.png"),
      fullPage: true,
    });
    watch.assertClean("managed backup proof actions");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");
  const cookie = await portalLogin();

  const readinessResponse = await fetch(`${apiURL}/api/v1/restaurant/ops/readiness`, {
    headers: { Cookie: cookie },
    cache: "no-store",
  });
  const readiness = await readinessResponse.json().catch(() => ({}));
  assert(readinessResponse.ok, `Readiness failed: ${JSON.stringify(readiness)}`);
  assert(readiness.restore_rehearsal, "Readiness did not include restore rehearsal status.");
  assert(readiness.production_database_plan?.backup_restore_drill?.some((step) => step.key === "restore_rehearsal"), "Production database plan did not include restore rehearsal step.");

  const invalidProof = await fetch(`${apiURL}/api/v1/restaurant/ops/backups/proof`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      proof_type: "managed_snapshot",
      reference: "bad",
      notes: "This invalid proof must not be recorded.",
    }),
  });
  assert(
    invalidProof.status === 422,
    `Invalid managed backup proof should be rejected, got ${invalidProof.status}.`
  );

  await proveManagedBackupButtons();
  console.log(`Managed backup proof command passed with restore status ${readiness.restore_rehearsal.status}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
