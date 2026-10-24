/* HR exits proof: create exit, clear checklist, settle and verify employee exited. */
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
      employee_code: `EMP-EXIT-${Date.now()}`,
      full_name: "Exit Proof Employee",
      designation: "Kitchen Lead",
      employment_type: "full_time",
      status: "active",
      joining_date: "2019-04-01",
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
    await page.goto(`${baseURL}/departments/hr/exits`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('[data-testid="hr-exits-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });

    await page.getByTestId("exit-create-open").click();
    await page.getByTestId("exit-create-form").waitFor({ timeout: 15000 });
    await page.getByTestId("exit-employee").selectOption(String(employee.data.id));
    await page.getByTestId("exit-resignation").fill("2026-10-01");
    await page.getByTestId("exit-last-working").fill("2026-11-15");
    await page.getByTestId("exit-create-submit").click();
    await page.getByTestId("exit-detail").waitFor({ timeout: 20000 });

    const exits = await api(token, "/api/v1/restaurant/hr/exits");
    const exitRow = (exits.data.exits || []).find(
      (row) => row.employee_id === employee.data.id
    );
    assert(exitRow, "Exit record was not created.");
    for (const task of exitRow.clearance) {
      await page.getByTestId(`exit-clearance-${task.id}`).click();
    }

    const settle = page.getByTestId("exit-settle");
    await settle.waitFor({ timeout: 15000 });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (await settle.isEnabled()) break;
      await page.waitForTimeout(500);
    }
    assert(await settle.isEnabled(), "Settle button did not enable after clearance.");
    await settle.click();
    await page
      .getByText("Exit settled. Employee and POS access are deactivated.")
      .waitFor({ timeout: 20000 });

    const detailText = await page.getByTestId("exit-detail").innerText();
    assert(/Settled & access revoked/i.test(detailText), "Settled state missing.");
    assert(/Net settlement/i.test(detailText), "Settlement total missing.");

    const employeeAfter = await api(
      token,
      `/api/v1/restaurant/hr/employees/${employee.data.id}`
    );
    assert(employeeAfter.data.status === "exited", "Employee was not exited.");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-hr-exits.png"),
      fullPage: false,
    });

    console.log("HR exits proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
