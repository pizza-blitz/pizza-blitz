const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = (process.env.E2E_BASE_URL || "http://127.0.0.1:3011").replace(/\/$/, "");
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

function monthStartIso(value) {
  return `${value.slice(0, 8)}01`;
}

function slug(value) {
  return value.trim().toLowerCase().split(/\s+/).join("-");
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

async function seedPayroll(cookie, targetDate) {
  const suffix = Date.now().toString().slice(-6);
  const counterStaff = `Payroll Counter Proof ${suffix}`;
  const lopStaff = `Payroll LOP Proof ${suffix}`;
  const plStaff = `Payroll PL Proof ${suffix}`;

  const shifts = [
    {
      staff_name: counterStaff,
      role: "Counter / POS",
      shift_start: "11:30",
      shift_end: "16:30",
      notes: "E2E payroll short late shift",
    },
    {
      staff_name: lopStaff,
      role: "Kitchen / Oven",
      shift_start: "10:30",
      shift_end: "18:30",
      notes: "E2E payroll normal shift",
    },
  ];

  for (const shift of shifts) {
    const result = await adminJson("/api/v1/restaurant/shifts/", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: targetDate, ...shift }),
    });
    assert(result.response.ok, `Payroll shift seed failed: ${JSON.stringify(result.data)}`);
  }

  for (const leave of [
    {
      staff_name: plStaff,
      leave_type: "PL",
      reason: "E2E paid leave proof",
    },
    {
      staff_name: lopStaff,
      leave_type: "LOP",
      reason: "E2E unpaid leave proof",
    },
  ]) {
    const result = await adminJson("/api/v1/restaurant/shifts/leave", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...leave,
        start_date: targetDate,
        end_date: targetDate,
        status: "approved",
      }),
    });
    assert(result.response.ok, `Payroll leave seed failed: ${JSON.stringify(result.data)}`);
  }

  return { suffix, counterStaff, lopStaff, plStaff };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(`${baseURL}/login`, "restaurant portal");

  const targetDate = todayIso();
  const cookie = await portalLogin();
  const proof = await seedPayroll(cookie, targetDate);
  const previewResult = await adminJson(
    `/api/v1/restaurant/shifts/payroll-preview?start_date=${monthStartIso(targetDate)}&end_date=${targetDate}`,
    cookie
  );
  assert(previewResult.response.ok, `Payroll preview failed: ${JSON.stringify(previewResult.data)}`);
  const staffRows = previewResult.data.staff || [];
  const counterRow = staffRows.find((row) => row.staff_name === proof.counterStaff);
  const lopRow = staffRows.find((row) => row.staff_name === proof.lopStaff);
  const plRow = staffRows.find((row) => row.staff_name === proof.plStaff);
  assert(counterRow, `Payroll preview missed ${proof.counterStaff}.`);
  assert(lopRow, `Payroll preview missed ${proof.lopStaff}.`);
  assert(plRow, `Payroll preview missed ${proof.plStaff}.`);
  assert(counterRow.short_shift_count >= 1, `Expected short shift for ${proof.counterStaff}.`);
  assert(counterRow.late_start_count >= 1, `Expected late start for ${proof.counterStaff}.`);
  assert(lopRow.lop_days >= 1, `Expected LOP day for ${proof.lopStaff}.`);
  assert(lopRow.present_leave_conflict_count >= 1, `Expected present/on-leave conflict for ${proof.lopStaff}.`);
  assert(plRow.paid_leave_days >= 1 && plRow.pl_days >= 1, `Expected paid PL for ${proof.plStaff}.`);
  assert(previewResult.data.summary.exception_count >= 3, "Payroll summary did not count settlement exceptions.");

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

    const response = await page.goto(`${baseURL}/shifts`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Shifts page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByTestId("employee-payroll-preview").waitFor({ timeout: 30000 });
    await assertHealthyPage(page, "employee payroll preview page");
    for (const staffName of [proof.counterStaff, proof.lopStaff, proof.plStaff]) {
      await page.getByTestId(`payroll-row-${slug(staffName)}`).waitFor({ timeout: 30000 });
    }
    await page
      .getByTestId("payroll-next-actions")
      .getByText(/payroll|LOP|short shifts|leave/i)
      .first()
      .waitFor({ timeout: 15000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-employee-payroll-preview.png"),
      fullPage: true,
    });
    watch.assertClean("employee payroll preview");
  } finally {
    await browser.close();
  }

  console.log(`Employee payroll preview proof passed for ${targetDate} with seed ${proof.suffix}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
