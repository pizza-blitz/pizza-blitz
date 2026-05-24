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

async function adminText(endpoint, cookie) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    headers: { Cookie: cookie },
    cache: "no-store",
  });
  const text = await response.text();
  return { response, text };
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

function assertTextContains(text, expected, label) {
  assert(text.includes(expected), `${label} did not include "${expected}". Actual text:\n${text}`);
}

function assertNormalizedTextContains(text, expected, label) {
  const normalized = text.replace(/\s+/g, " ").trim().toUpperCase();
  assert(
    normalized.includes(expected.toUpperCase()),
    `${label} did not include "${expected}". Actual text:\n${text}`
  );
}

async function verifyApi(cookie) {
  const anonymous = await apiJson("/api/v1/restaurant/ops/data-quality");
  assert(anonymous.response.status === 401, `Anonymous data quality should be blocked, got ${anonymous.response.status}.`);

  const quality = await adminJson("/api/v1/restaurant/ops/data-quality", cookie);
  assert(quality.response.ok, `Data quality API failed: ${JSON.stringify(quality.data)}`);
  assert(typeof quality.data.score === "number", "Data quality score was missing.");
  assert(quality.data.summary && typeof quality.data.summary.total_customers === "number", "Customer summary was missing.");
  assert(quality.data.exports.some((item) => item.key === "customers"), "Customer export check was missing.");
  assert(quality.data.exports.some((item) => item.key === "sales"), "Sales export check was missing.");
  assert(quality.data.imports.some((item) => item.key === "customer_csv_import"), "Customer import dry-run gap was missing.");
  assert(quality.data.backup_restore.restore_rehearsal.status === "warn", "Restore rehearsal should remain visible as a warning.");

  const anonymousCustomerExport = await fetch(`${apiURL}/api/v1/restaurant/customers/export.csv`, { cache: "no-store" });
  assert(
    anonymousCustomerExport.status === 401,
    `Anonymous customer export should be blocked, got ${anonymousCustomerExport.status}.`
  );

  const customerExport = await adminText("/api/v1/restaurant/customers/export.csv", cookie);
  assert(customerExport.response.ok, `Customer export failed: ${customerExport.response.status} ${customerExport.text}`);
  assert((customerExport.response.headers.get("content-type") || "").includes("text/csv"), "Customer export was not CSV.");
  assert(customerExport.text.includes("phone") && customerExport.text.includes("marketing_opt_in"), "Customer export header was incomplete.");

  const salesExport = await adminText("/api/v1/restaurant/sales/export/csv", cookie);
  assert(salesExport.response.ok, `Sales export failed: ${salesExport.response.status} ${salesExport.text}`);
  assert((salesExport.response.headers.get("content-type") || "").includes("text/csv"), "Sales export was not CSV.");
  assert(salesExport.text.includes("Date") && salesExport.text.includes("Net Profit"), "Sales export header was incomplete.");

  return quality.data;
}

async function verifyBrowser(quality) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1200 },
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

    const board = page.getByTestId("data-quality-export-command");
    await board.waitFor({ timeout: 20000 });
    await board.getByText("Data Quality and Export Command", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("customer-import-export-checks").waitFor({ timeout: 15000 });
    await page.getByTestId("report-export-checks").waitFor({ timeout: 15000 });
    await page.getByTestId("backup-restore-proof-checks").waitFor({ timeout: 15000 });
    await page.getByText("Import Readiness", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Customer CSV import dry-run", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole("link", { name: /Download customers/i }).waitFor({ timeout: 15000 });
    await page.getByRole("link", { name: /Download sales/i }).waitFor({ timeout: 15000 });
    await page.getByRole("link", { name: /Open backups/i }).waitFor({ timeout: 15000 });

    const boardText = await board.innerText();
    assertNormalizedTextContains(boardText, `${quality.score}% ready`, "data quality board score");
    assertNormalizedTextContains(boardText, `Customers ${quality.summary.total_customers}`, "customer metric");
    assertNormalizedTextContains(boardText, `Reachable ${quality.summary.reachable_customers}`, "reachable metric");
    assertNormalizedTextContains(boardText, `Sales Rows ${quality.summary.daily_sales_rows}`, "sales rows metric");

    await board.screenshot({
      path: path.join(artifactsDir, "visible-data-quality-export-command.png"),
    });
    watch.assertClean("data quality export command");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const cookie = await portalLogin();
  const quality = await verifyApi(cookie);
  await verifyBrowser(quality);
  console.log("Data quality export command proof passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
