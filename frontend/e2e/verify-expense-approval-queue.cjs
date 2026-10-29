const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = (process.env.E2E_BASE_URL || "http://localhost:3011").replace(/\/$/, "");
const apiURL = (
  process.env.E2E_API_URL ||
  (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(baseURL)
    ? "http://127.0.0.1:8010"
    : `${baseURL}/server`)
).replace(/\/$/, "");
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

function todayIso() {
  return new Date().toISOString().split("T")[0];
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
  const data = await response.json().catch(() => ({}));
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

function createBrowserWatch(page) {
  const issues = [];
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico|images\.unsplash\.com/i.test(text)) return;
    if (/Failed to fetch RSC payload/i.test(text) && /Falling back to browser navigation/i.test(text)) return;
    if (/Failed to fetch expense data TypeError: Failed to fetch/i.test(text)) return;
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

async function assertHealthyPage(page, label) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => undefined);
  const health = await page.evaluate(() => {
    const text = document.body.innerText || "";
    return {
      textLength: text.trim().length,
      hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
      hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
      bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  assert(health.textLength > 300, `${label} rendered too little content.`);
  assert(!health.hasOverlay, `${label} has a Next.js error overlay.`);
  assert(!health.hasFrameworkError, `${label} rendered framework error text.`);
  assert(health.bodyOverflow <= 8, `${label} has body-level horizontal overflow of ${health.bodyOverflow}px.`);
}

async function waitForApprovalQueue(page, expenseId) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const queue = page.getByTestId("expense-approval-queue");
    if ((await queue.count()) > 0) {
      await queue.waitFor({ timeout: 10000 });
      const item = page.getByTestId(`expense-approval-item-${expenseId}`);
      if ((await item.count()) > 0) {
        await item.waitFor({ timeout: 10000 });
        return;
      }
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => undefined);
  }

  throw new Error(`Expense approval queue did not show expense #${expenseId}.`);
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(`${baseURL}/login`, "restaurant portal");

  const cookie = await portalLogin();
  const categories = await adminJson("/api/v1/restaurant/expenses/categories", cookie);
  assert(categories.response.ok, `Categories failed: ${JSON.stringify(categories.data)}`);
  const category = categories.data[0];
  assert(category, "No active expense category exists.");

  const description = `Owner Approval Proof ${Date.now().toString().slice(-7)}`;
  const created = await adminJson("/api/v1/restaurant/expenses/expenses", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: `${todayIso()}T12:00:00`,
      category_id: category.id,
      amount: 1777,
      description,
    }),
  });
  assert(created.response.ok, `Expense approval seed failed: ${JSON.stringify(created.data)}`);
  const expenseId = created.data.id;

  const audit = await adminJson("/api/v1/restaurant/expenses/audit-command", cookie);
  assert(audit.response.ok, `Expense audit command failed: ${JSON.stringify(audit.data)}`);
  const queueItem = (audit.data.approval_queue || []).find((item) => item.id === expenseId);
  assert(queueItem, `Approval queue missed expense #${expenseId}.`);
  assert(queueItem.severity === "fail", `Expected high-value receipt gap to fail, got ${queueItem.severity}.`);
  assert(
    queueItem.reasons.some((reason) => /High-value expense needs receipt proof/i.test(reason)),
    `Approval queue missed high-value receipt reason: ${JSON.stringify(queueItem.reasons)}`
  );
  assert(audit.data.summary.high_value_receipt_gap_count >= 1, "Audit summary missed high-value receipt gap count.");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1150 },
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
    await waitForApprovalQueue(page, expenseId);
    const approvalItem = page.getByTestId(`expense-approval-item-${expenseId}`);
    await approvalItem.getByText(description, { exact: false }).waitFor({ timeout: 30000 });
    await approvalItem.getByText("High-value expense needs receipt proof.", { exact: true }).waitFor({ timeout: 30000 });
    await assertHealthyPage(page, "expense approval queue page");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-expense-approval-queue.png"),
      fullPage: true,
    });
    watch.assertClean("expense approval queue");
  } finally {
    await browser.close();
  }

  console.log(`Expense approval queue proof passed for expense #${expenseId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
