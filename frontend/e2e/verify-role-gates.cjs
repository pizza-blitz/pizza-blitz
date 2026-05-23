const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const staffId = process.env.E2E_STAFF_ID || "staff";
const staffPassword = process.env.E2E_STAFF_PASSWORD || "staff123";
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

  while (Date.now() - startedAt < 30000) {
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

async function portalLogin(role) {
  const response = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: role === "staff" ? staffId : adminId,
      password: role === "staff" ? staffPassword : adminPassword,
      role,
    }),
  });
  const data = await response.json();
  assert(response.ok, `${role} portal login failed: ${JSON.stringify(data)}`);
  const cookie = cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
  assert(cookie.includes(`pb_${role}_session=`), `${role} login did not return a portal session cookie.`);
  return cookie;
}

async function customerLogin() {
  const phone = `94${Date.now().toString().slice(-8)}`;
  const orderResponse = await fetch(`${apiURL}/api/v1/restaurant/orders/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Role Gate Customer",
      customer_phone: phone,
      customer_email: "role-gate@example.com",
      payment_method: "cash",
      items: [{ name: "Brownie", quantity: 1, price: 79 }],
    }),
  });
  const order = await orderResponse.json();
  assert(orderResponse.ok, `Could not create customer proof order: ${JSON.stringify(order)}`);

  const response = await fetch(`${baseURL}/api/customer-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  const data = await response.json();
  assert(response.ok, `Customer login failed: ${JSON.stringify(data)}`);
  const cookie = cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
  assert(cookie.includes("pb_customer_session="), "Customer login did not return a customer session cookie.");
  return cookie;
}

async function requestBackend(endpoint, cookie, options = {}) {
  const headers = cookie ? { Cookie: cookie } : {};
  return fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
}

async function assertStatus(endpoint, expectedStatus, cookie, label, options = {}) {
  const response = await requestBackend(endpoint, cookie, options);
  if (response.status !== expectedStatus) {
    throw new Error(
      `${label} expected ${expectedStatus}, received ${response.status}. Body: ${await response.text()}`
    );
  }
  return response;
}

function createBrowserWatch(page) {
  const issues = [];
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico/i.test(text)) return;
    issues.push(`console error: ${text}`);
  });
  return {
    assertClean(label) {
      assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
    },
  };
}

async function screenshotSettingsWithAdmin() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/settings`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Settings returned HTTP ${response?.status() || "no response"}.`);
    await page.getByText("Backend API Role Gates", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByText("Manual Payment Webhook", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByText("Payment Gateway Readiness", { exact: false }).waitFor({ timeout: 10000 });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-role-gates-settings.png"),
      fullPage: true,
    });
    watch.assertClean("role gate settings screenshot");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/api/v1/restaurant/ops/readiness`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  await assertStatus("/api/v1/restaurant/ops/readiness", 401, "", "anonymous ops readiness");
  await assertStatus("/api/v1/restaurant/orders/today", 401, "", "anonymous today's orders");
  await assertStatus(
    "/api/v1/restaurant/orders/payments/webhook/manual",
    401,
    "",
    "anonymous manual payment webhook",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "manual.payment.updated",
        status: "paid",
        order_id: 1,
        payment_reference: "NOAUTH",
      }),
    }
  );

  const adminCookie = await portalLogin("admin");
  const staffCookie = await portalLogin("staff");
  const customerCookie = await customerLogin();

  const adminReadiness = await assertStatus(
    "/api/v1/restaurant/ops/readiness",
    200,
    adminCookie,
    "admin ops readiness"
  );
  const readiness = await adminReadiness.json();
  assert(
    Array.isArray(readiness.payment_providers) && readiness.payment_providers.length === 3,
    "Admin readiness did not include all payment providers."
  );

  await assertStatus("/api/v1/restaurant/ops/readiness", 403, staffCookie, "staff ops readiness");
  await assertStatus("/api/v1/restaurant/orders/today", 200, staffCookie, "staff today's orders");
  await assertStatus("/api/v1/restaurant/orders/today", 403, customerCookie, "customer today's orders");

  const staffJwtResponse = await fetch(`${apiURL}/api/v1/auth/staff/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: staffId, password: staffPassword }),
  });
  const staffJwt = await staffJwtResponse.json();
  assert(staffJwtResponse.ok, `Staff JWT login failed: ${JSON.stringify(staffJwt)}`);
  assert(staffJwt.role === "staff" && staffJwt.access_token, "Staff JWT login did not return a staff token.");

  await screenshotSettingsWithAdmin();
  console.log("Role gate proof passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
