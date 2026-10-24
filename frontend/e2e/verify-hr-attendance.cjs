/* HR attendance proof: clock in, clock out, regularise. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://localhost:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cookieHeaderFromSetCookie(setCookie) {
  if (!setCookie) return "";
  return setCookie
    .split(/,(?=[^;]+=)/)
    .map((part) => part.split(";")[0].trim())
    .join("; ");
}

async function waitForHttp(url, label) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < 30000) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok || response.status === 401) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`${label} did not become ready at ${url}: ${lastError}`);
}

async function api(token, endpoint, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const login = await api(null, "/api/v1/auth/admin/login", {
    method: "POST",
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  });
  assert(login.response.ok, "Admin login failed.");
  const token = login.data.access_token;

  const employee = await api(token, "/api/v1/restaurant/hr/employees", {
    method: "POST",
    body: JSON.stringify({
      employee_code: `EMP-AT-${Date.now()}`,
      full_name: "Attendance Proof Employee",
      employment_type: "full_time",
      status: "active",
    }),
  });
  assert(employee.response.ok, `Employee create failed: ${JSON.stringify(employee.data)}`);

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(portalLogin.ok, `Portal login failed: ${await portalLogin.text()}`);
  const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.addCookies(
      cookie
        .split(/;\s*/)
        .filter(Boolean)
        .map((pair) => {
          const [name, ...rest] = pair.split("=");
          return {
            name,
            value: rest.join("="),
            url: baseURL,
            httpOnly: true,
            sameSite: "Lax",
          };
        })
    );
    const page = await context.newPage();
    await page.goto(`${baseURL}/departments/hr/attendance`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('[data-testid="hr-attendance-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    const row = page.getByTestId(`attendance-row-${employee.data.id}`);
    await row.waitFor({ timeout: 20000 });

    const clockIn = page.getByTestId(`attendance-clock-in-${employee.data.id}`);
    await clockIn.click();
    await page.getByText("Attendance Proof Employee clocked in.").waitFor({ timeout: 15000 });
    await page.getByTestId(`attendance-clock-out-${employee.data.id}`).click();
    await page
      .getByText("Attendance Proof Employee clocked out.")
      .waitFor({ timeout: 15000 });

    const rowText = await page.getByTestId(`attendance-row-${employee.data.id}`).innerText();
    assert(/present/i.test(rowText), "Employee was not marked present.");
    assert(/h \d{2}m/.test(rowText), `Worked time missing: ${rowText}`);

    await page.getByTestId(`attendance-edit-${employee.data.id}`).click();
    await page.getByTestId("attendance-form").waitFor({ timeout: 15000 });
    await page.getByTestId("attendance-status").selectOption("absent");
    await page.getByTestId("attendance-save").click();
    await page.getByText("Attendance regularised.").waitFor({ timeout: 15000 });
    const updated = await page.getByTestId(`attendance-row-${employee.data.id}`).innerText();
    assert(/absent/i.test(updated), `Regularised status missing: ${updated}`);

    await page.screenshot({
      path: path.join(artifactsDir, "visible-hr-attendance.png"),
      fullPage: false,
    });

    console.log("HR attendance proof passed.");
  } finally {
    await api(token, `/api/v1/restaurant/hr/employees/${employee.data.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "exited", notes: "Proof cleanup" }),
    }).catch(() => {});
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
