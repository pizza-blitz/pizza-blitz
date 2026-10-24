/* HR-scoped staff proof: member sees HR only; no admin controls. */
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
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const adminLogin = await api(null, "/api/v1/auth/admin/login", {
    method: "POST",
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  });
  assert(adminLogin.response.ok, "Admin login failed.");
  const token = adminLogin.data.access_token;
  const staffId = `hr-proof-${Date.now()}`;
  const staffPassword = "HrProof123!";

  const credential = await api(token, "/api/v1/auth/staff/credential", {
    method: "POST",
    body: JSON.stringify({
      id: staffId,
      password: staffPassword,
      display_name: "HR Proof Lead",
      is_active: true,
    }),
  });
  assert(credential.response.ok, `Staff credential failed: ${JSON.stringify(credential.data)}`);

  const departments = await api(token, "/api/v1/restaurant/departments/");
  const hr = (departments.data.departments || []).find((row) => row.key === "hr");
  assert(hr, "HR department not found.");
  const membership = await api(token, `/api/v1/restaurant/departments/${hr.id}/members`, {
    method: "POST",
    body: JSON.stringify({ staff_id: staffId, role: "head" }),
  });
  assert(membership.response.ok, `Membership failed: ${JSON.stringify(membership.data)}`);

  const permissions = await api(token, "/api/v1/auth/permissions/staff", {
    method: "PUT",
    body: JSON.stringify({
      permissions: [
        "hr.view",
        "hr.people",
        "hr.leave",
        "hr.attendance",
        "hr.payroll",
        "hr.onboarding",
        "hr.documents",
        "hr.exits",
      ],
    }),
  });
  assert(permissions.response.ok, "HR permissions failed.");

  const staffLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: staffId, password: staffPassword, role: "staff" }),
  });
  assert(staffLogin.ok, `Staff portal login failed: ${await staffLogin.text()}`);
  const cookie = cookieHeaderFromSetCookie(staffLogin.headers.get("set-cookie"));

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
    const hrCard = page.getByTestId("department-card-hr");
    await hrCard.waitFor({ timeout: 20000 });
    assert(
      (await page.getByTestId("department-card-operations").count()) === 0,
      "HR staff should not see other departments."
    );
    assert(
      (await page.getByTestId("department-create-open").count()) === 0,
      "HR staff should not see the create-department button."
    );

    await hrCard.click();
    await page
      .locator('[data-testid="department-detail"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    const peopleModule = page.getByTestId("department-module-people");
    assert(/active/i.test(await peopleModule.innerText()), "People module not active.");
    assert(
      (await page.getByLabel("Staff member").count()) === 0,
      "HR staff should not see the admin member picker."
    );
    assert(
      (await page.getByLabel("Add module").count()) === 0,
      "HR staff should not see the add-module control."
    );

    await peopleModule.click();
    await page
      .locator('[data-testid="hr-people-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    const peopleText = await page.getByTestId("hr-people-page").innerText();
    assert(/People directory/i.test(peopleText), "HR people page did not load for member.");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-hr-permissions.png"),
      fullPage: false,
    });

    console.log("HR permissions proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
