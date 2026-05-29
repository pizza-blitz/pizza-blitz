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

async function seedAttendance(cookie, targetDate) {
  const suffix = Date.now().toString().slice(-7);
  const roster = [
    ["Attendance Counter Proof", "Counter / POS", "11:00", "19:00"],
    ["Attendance Oven Proof", "Kitchen / Oven", "10:30", "18:30"],
    ["Attendance Prep Proof", "Prep / Packing", "11:00", "19:00"],
    ["Attendance Rider Proof", "Delivery Rider", "12:00", "20:00"],
  ];

  for (const [name, role, start, end] of roster) {
    const result = await adminJson("/api/v1/restaurant/shifts/", cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: targetDate,
        staff_name: `${name} ${suffix}`,
        role,
        shift_start: start,
        shift_end: end,
        notes: "E2E employee attendance proof",
      }),
    });
    assert(result.response.ok, `Shift seed failed: ${JSON.stringify(result.data)}`);
  }

  const leave = await adminJson("/api/v1/restaurant/shifts/leave", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      staff_name: `Attendance Leave Proof ${suffix}`,
      leave_type: "CL",
      start_date: targetDate,
      end_date: targetDate,
      status: "approved",
      reason: "E2E CL proof",
    }),
  });
  assert(leave.response.ok, `Leave seed failed: ${JSON.stringify(leave.data)}`);

  const plannedLeave = await adminJson("/api/v1/restaurant/shifts/leave", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      staff_name: `Attendance Planned Leave ${suffix}`,
      leave_type: "PL",
      start_date: targetDate,
      end_date: targetDate,
      status: "planned",
      reason: "E2E leave approval proof",
    }),
  });
  assert(plannedLeave.response.ok, `Planned leave seed failed: ${JSON.stringify(plannedLeave.data)}`);

  const approvedLeave = await adminJson(
    `/api/v1/restaurant/shifts/leave/${plannedLeave.data.leave.id}/status`,
    cookie,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "approved",
        reason: "E2E owner approval proof",
      }),
    }
  );
  assert(approvedLeave.response.ok, `Leave approval failed: ${JSON.stringify(approvedLeave.data)}`);

  const command = await adminJson(`/api/v1/restaurant/shifts/attendance-command?target_date=${targetDate}`, cookie);
  assert(command.response.ok, `Attendance command failed: ${JSON.stringify(command.data)}`);
  assert(command.data.readiness_score >= 90, `Expected attendance readiness >= 90, got ${command.data.readiness_score}.`);
  assert(command.data.summary.roles_covered >= 4, "Attendance command did not cover all required roles.");
  assert(command.data.summary.leave_count >= 1, "Attendance command did not include active leave.");
  const audit = await adminJson("/api/v1/restaurant/ops/audit-events?limit=20", cookie);
  assert(audit.response.ok, `Audit events failed: ${JSON.stringify(audit.data)}`);
  assert(
    audit.data.events?.some((event) => event.event_type === "employee" && event.action === "leave_status_update"),
    "Employee leave approval did not reach the operational audit trail."
  );
  return {
    suffix,
    plannedLeaveId: plannedLeave.data.leave.id,
    plannedLeaveName: plannedLeave.data.leave.staff_name,
  };
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

async function waitForCoverageBoard(page) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 120000) {
    await page.getByTestId("employee-attendance-command").waitFor({ timeout: 20000 });
    try {
      await page.waitForFunction(
        () => {
          const coverageCount = document.querySelectorAll('[data-testid^="attendance-coverage-"]').length;
          const scoreText = document.querySelector('[data-testid="attendance-readiness-score"]')?.textContent || "0";
          const score = Number(scoreText.replace(/[^0-9]/g, ""));
          return coverageCount >= 4 && score >= 90;
        },
        null,
        { timeout: 20000 }
      );
      const scoreText = await page.getByTestId("attendance-readiness-score").innerText();
      return Number(scoreText.replace(/[^0-9]/g, ""));
    } catch {
      await page.reload({ waitUntil: "domcontentloaded" });
    }
  }

  throw new Error("Attendance coverage board did not settle with four roles and score >= 90.");
}

async function verifyBrowser(targetDate, proof) {
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

    const response = await page.goto(`${baseURL}/shifts`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Shifts page returned HTTP ${response?.status() || "no response"}.`);
    const score = await waitForCoverageBoard(page);

    for (const role of ["counter", "kitchen", "prep", "delivery"]) {
      await page.getByTestId(`attendance-coverage-${role}`).waitFor({ timeout: 20000 });
    }

    assert(score >= 90, `Browser attendance score was too low: ${score}.`);

    const browserLeaveName = `Browser Planned Leave ${Date.now().toString().slice(-5)}`;
    await page.getByTestId("leave-staff-name").fill(browserLeaveName);
    await page.getByTestId("leave-type").selectOption("PL");
    await page.locator('[data-testid="employee-leave-form"] select').nth(1).selectOption("planned");
    await page.getByTestId("leave-start-date").fill(targetDate);
    await page.getByTestId("leave-submit").click();
    await page.getByText("Leave logged.", { exact: true }).waitFor({ timeout: 20000 });
    const leaveApprovalQueue = page.getByTestId("employee-leave-approval-queue");
    await leaveApprovalQueue.waitFor({ timeout: 20000 });
    await leaveApprovalQueue.getByText(browserLeaveName, { exact: false }).waitFor({ timeout: 20000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-employee-attendance-command.png"),
      fullPage: true,
    });
    watch.assertClean("employee attendance command");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(`${baseURL}/login`, "restaurant portal");
  const anonymousShift = await fetch(`${apiURL}/api/v1/restaurant/shifts/`, { cache: "no-store" });
  assert(anonymousShift.status === 401, `Anonymous shift API should be blocked, got ${anonymousShift.status}.`);
  const anonymousPayroll = await fetch(`${apiURL}/api/v1/restaurant/shifts/payroll-preview`, { cache: "no-store" });
  assert(anonymousPayroll.status === 401, `Anonymous payroll API should be blocked, got ${anonymousPayroll.status}.`);
  const targetDate = todayIso();
  const cookie = await portalLogin();
  const proof = await seedAttendance(cookie, targetDate);
  await verifyBrowser(targetDate, proof);
  console.log(`Employee attendance command proof passed for ${targetDate} with seed ${proof.suffix}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
