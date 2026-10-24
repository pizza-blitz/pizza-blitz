/* Departments proof: seeded Operations + HR, HR as a department, create a new one. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
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

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const apiLogin = await fetch(`${apiURL}/api/v1/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  });
  assert(apiLogin.ok, "Admin API login failed.");
  const token = (await apiLogin.json()).access_token;

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(portalLogin.ok, `Portal login failed: ${await portalLogin.text()}`);
  const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));

  const key = `finance-proof-${Date.now()}`;
  let createdId = null;
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
    await page.goto(`${baseURL}/departments`, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="departments-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });

    const operations = page.getByTestId("department-card-operations");
    const hr = page.getByTestId("department-card-hr");
    await operations.waitFor({ timeout: 20000 });
    await hr.waitFor({ timeout: 20000 });
    assert(/Restaurant Operations/i.test(await operations.innerText()), "Operations card missing.");
    assert(/People & HR/i.test(await hr.innerText()), "HR card missing.");
    assert(/Euron Open HRMS/i.test(await hr.innerText()), "HR integration label missing.");

    await page.getByTestId("department-create-open").click();
    await page.getByTestId("department-create-modal").waitFor({ timeout: 15000 });
    await page.getByTestId("department-name").fill("Finance & Compliance");
    await page.locator('input[placeholder="finance"]').fill(key);
    await page.getByRole("checkbox", { name: /Accounting & GST/i }).check();
    await page.getByTestId("department-create-submit").click();
    const createdCard = page.getByTestId(`department-card-${key}`);
    await createdCard.waitFor({ timeout: 20000 });
    assert(/Finance & Compliance/i.test(await createdCard.innerText()), "Created department not visible.");

    const list = await fetch(`${apiURL}/api/v1/restaurant/departments/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await list.json();
    createdId = (data.departments || []).find((row) => row.key === key)?.id || null;
    assert(createdId, "Created department was not returned by the API.");

    await hr.click();
    await page
      .locator('[data-testid="department-detail"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    const heading = await page.getByTestId("department-name-heading").innerText();
    assert(/People & HR/i.test(heading), `HR heading read: ${heading}`);
    const external = page.getByTestId("department-external-system");
    await external.waitFor({ timeout: 15000 });
    const externalText = await external.innerText();
    assert(/Euron Open HRMS/i.test(externalText), "HR external system panel missing.");
    assert(/Pilot/i.test(externalText), "HR pilot status missing.");
    const payroll = page.getByTestId("department-module-payroll");
    assert(/active/i.test(await payroll.innerText()), "Payroll should be active.");
    const onboarding = page.getByTestId("department-module-onboarding");
    assert(
      /planned/i.test(await onboarding.innerText()),
      "Onboarding should be honestly marked planned."
    );
    const people = page.getByTestId("department-module-people");
    assert(/active/i.test(await people.innerText()), "People directory should be active.");
    const activeLink = page.getByTestId("department-module-overview");
    assert((await activeLink.getAttribute("href")) === "/departments/hr", "Overview link mismatch.");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-departments-hr.png"),
      fullPage: false,
    });

    await people.click();
    await page
      .locator('[data-testid="hr-people-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    await page.getByTestId("hr-employee-create-open").click();
    await page.getByTestId("hr-employee-form").waitFor({ timeout: 15000 });
    await page.getByTestId("hr-employee-name").fill("Aarav HR Proof");
    await page.getByTestId("hr-employee-code").fill(`EMP-PROOF-${Date.now()}`);
    await page.getByLabel("Designation").fill("Kitchen Lead");
    await page.getByTestId("hr-employee-save").click();
    const employeeRow = page.getByText("Aarav HR Proof").first();
    await employeeRow.waitFor({ timeout: 20000 });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-hr-people.png"),
      fullPage: false,
    });

    const employees = await fetch(
      `${apiURL}/api/v1/restaurant/hr/employees?q=Aarav%20HR%20Proof`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const employeeData = await employees.json();
    const proofEmployee = (employeeData.employees || [])[0];
    if (proofEmployee) {
      await fetch(
        `${apiURL}/api/v1/restaurant/hr/employees/${proofEmployee.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: "exited", notes: "Proof cleanup" }),
        }
      ).catch(() => {});
    }

    console.log("Departments proof passed.");
  } finally {
    if (createdId) {
      await fetch(`${apiURL}/api/v1/restaurant/departments/${createdId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
