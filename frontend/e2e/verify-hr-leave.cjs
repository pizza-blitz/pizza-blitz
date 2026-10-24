/* HR leave proof: request, approve, balance, holiday calendar. */
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

function isoDate(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
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
  const code = `EMP-LV-${Date.now()}`;

  const employee = await api(token, "/api/v1/restaurant/hr/employees", {
    method: "POST",
    body: JSON.stringify({
      employee_code: code,
      full_name: "Leave Proof Employee",
      employment_type: "full_time",
      status: "active",
      joining_date: isoDate(-30),
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
  let requestId = null;
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
    await page.goto(`${baseURL}/departments/hr/leave`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('[data-testid="hr-leave-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    await page.getByTestId("leave-request-open").click();
    await page.getByTestId("leave-request-form").waitFor({ timeout: 15000 });
    await page.getByTestId("leave-employee").selectOption(String(employee.data.id));
    await page.getByTestId("leave-start").fill(isoDate(20));
    await page.getByTestId("leave-end").fill(isoDate(21));
    await page.getByTestId("leave-request-submit").click();
    await page.getByText("Leave request submitted for approval.").waitFor({ timeout: 15000 });

    const requests = await api(
      token,
      `/api/v1/restaurant/hr/leave/requests?employee_id=${employee.data.id}`
    );
    requestId = (requests.data.requests || [])[0]?.id;
    assert(requestId, "Leave request was not created.");

    await page.getByTestId(`leave-approve-${requestId}`).click();
    await page
      .getByText("Leave approved for Leave Proof Employee.")
      .waitFor({ timeout: 15000 });

    await page.getByTestId("leave-tab-balances").click();
    await page.getByText("Leave Proof Employee").first().waitFor({ timeout: 15000 });
    const bodyText = await page.getByTestId("hr-leave-page").innerText();
    assert(/10 \/ 12/.test(bodyText), `Casual balance did not show 10/12: ${bodyText.slice(0, 500)}`);

    await page.getByTestId("leave-tab-requests").click();
    await page.getByTestId(`leave-request-${requestId}`).waitFor({ timeout: 15000 });
    assert(
      /approved/i.test(await page.getByTestId(`leave-request-${requestId}`).innerText()),
      "Approved request did not render."
    );

    await page.screenshot({
      path: path.join(artifactsDir, "visible-hr-leave.png"),
      fullPage: false,
    });

    console.log("HR leave proof passed.");
  } finally {
    if (requestId) {
      await api(token, `/api/v1/restaurant/hr/leave/requests/${requestId}/cancel`, {
        method: "PATCH",
        body: JSON.stringify({ note: "Proof cleanup" }),
      }).catch(() => {});
    }
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
