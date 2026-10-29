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

  while (Date.now() - startedAt < 45000) {
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

async function adminJson(endpoint, cookie, options = {}) {
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

function todayIso() {
  return new Date().toISOString().split("T")[0];
}

async function seedExpenseAudit(cookie) {
  const categories = await adminJson("/api/v1/restaurant/expenses/categories", cookie);
  assert(categories.response.ok, `Categories failed: ${JSON.stringify(categories.data)}`);
  assert(categories.data.length > 0, "No active expense category exists.");

  const category = categories.data.find((item) => /inventory|packaging|maintenance/i.test(item.name)) || categories.data[0];
  const amount = 88;
  const description = `Expense Audit Proof ${Date.now().toString().slice(-7)}`;
  const created = await adminJson("/api/v1/restaurant/expenses/expenses", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: `${todayIso()}T12:00:00`,
      category_id: category.id,
      amount,
      description,
    }),
  });
  assert(created.response.ok, `Expense seed failed: ${JSON.stringify(created.data)}`);

  const audit = await adminJson("/api/v1/restaurant/expenses/audit-command", cookie);
  assert(audit.response.ok, `Expense audit command failed: ${JSON.stringify(audit.data)}`);
  assert(audit.data.summary.expense_count >= 1, "Audit command did not see manual expense records.");
  assert(audit.data.summary.category_count >= 1, "Audit command did not see cost categories.");
  assert(Array.isArray(audit.data.checks) && audit.data.checks.length >= 4, "Audit command checks were missing.");
  return { category, description };
}

function createBrowserWatch(page) {
  const issues = [];
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico|images\.unsplash\.com/i.test(text)) return;
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

async function verifyBrowser(seed) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1050 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/expenses`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Expenses page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByTestId("expense-audit-command").waitFor({ timeout: 30000 });
    await page.getByTestId("expense-audit-readiness-score").waitFor({ timeout: 30000 });
    await page.getByTestId("expense-audit-checks").waitFor({ timeout: 30000 });
    await page.getByTestId("expense-category-breakdown").waitFor({ timeout: 30000 });

    const scoreText = await page.getByTestId("expense-audit-readiness-score").innerText();
    const score = Number(scoreText.replace(/[^0-9]/g, ""));
    assert(score >= 50, `Expense audit score was unexpectedly low: ${scoreText}.`);

    const browserDescription = `Browser Expense Audit ${Date.now().toString().slice(-6)}`;
    await page.getByTestId("expense-log-toggle").click();
    await page.getByTestId("expense-category-select").selectOption(String(seed.category.id));
    await page.getByTestId("expense-amount-input").fill("77");
    await page.getByTestId("expense-description-input").fill(browserDescription);
    await page.getByTestId("expense-save").click();
    await page.getByText("Logged expense of Rs. 77.", { exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole("cell", { name: browserDescription }).waitFor({ timeout: 30000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-expense-audit-command.png"),
      fullPage: true,
    });
    watch.assertClean("expense audit command");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(`${baseURL}/login`, "restaurant portal");
  const cookie = await portalLogin();
  const seed = await seedExpenseAudit(cookie);
  await verifyBrowser(seed);
  console.log(`Expense audit command proof passed with ${seed.description}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
