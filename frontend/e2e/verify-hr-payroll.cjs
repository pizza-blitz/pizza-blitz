/* HR payroll proof: salary, draft run, payslip, finalize. */
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
      employee_code: `EMP-PAY-${Date.now()}`,
      full_name: "Payroll Proof Employee",
      designation: "Shift Lead",
      employment_type: "full_time",
      status: "active",
    }),
  });
  assert(employee.response.ok, `Employee create failed: ${JSON.stringify(employee.data)}`);
  const salary = await api(
    token,
    `/api/v1/restaurant/hr/payroll/salary-structures/${employee.data.id}`,
    {
      method: "PUT",
      body: JSON.stringify({
        basic: 30000,
        hra: 12000,
        allowances: 8000,
        tds: 2000,
        professional_tax: 200,
      }),
    }
  );
  assert(salary.response.ok, `Salary failed: ${JSON.stringify(salary.data)}`);

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(portalLogin.ok, `Portal login failed: ${await portalLogin.text()}`);
  const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));

  const runYear = 2040 + (Date.now() % 20);
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
    await page.goto(`${baseURL}/departments/hr/payroll`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('[data-testid="hr-payroll-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });

    await page.getByTestId("payroll-month").selectOption("1");
    await page.locator('input[type="number"]').first().fill(String(runYear));
    await page.getByTestId("payroll-generate").click();
    await page.getByTestId("payroll-run-detail").waitFor({ timeout: 20000 });
    const detail = await page.getByTestId("payroll-run-detail").innerText();
    assert(/Payroll Proof Employee/i.test(detail), "Payslip row missing.");
    assert(/Rs 50,000/.test(detail), `Gross missing: ${detail.slice(0, 500)}`);
    assert(/Rs 46,000/.test(detail), `Net missing: ${detail.slice(0, 500)}`);

    const payslipButton = page.getByRole("button", { name: "Payslip" }).first();
    await payslipButton.click();
    await page.getByTestId("payslip-modal").waitFor({ timeout: 15000 });
    const payslipText = await page.getByTestId("payslip-modal").innerText();
    assert(/Net pay/i.test(payslipText), "Payslip net pay missing.");
    assert(/Provident Fund/i.test(payslipText), "PF line missing.");
    await page.screenshot({
      path: path.join(artifactsDir, "visible-hr-payroll.png"),
      fullPage: false,
    });
    await page.getByLabel("Close payslip").click();

    await page.getByTestId("payroll-finalize").click();
    await page
      .getByText("Pay run finalized. Payslips are locked.")
      .waitFor({ timeout: 15000 });
    const finalized = await page.getByTestId("payroll-run-detail").innerText();
    assert(/finalized/i.test(finalized), "Pay run did not finalize.");

    console.log("HR payroll proof passed.");
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
