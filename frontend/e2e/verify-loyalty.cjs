/* Loyalty proof: points on close, referral bonuses, and account UI. */
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

function payload(phone, overrides = {}) {
  return {
    order_type: "takeaway",
    customer_name: "Loyalty Proof Guest",
    customer_phone: phone,
    payment_method: "cash",
    items: [{ name: "Garlic Bread", quantity: 2, price: 119 }],
    ...overrides,
  };
}

async function createAndClose(adminToken, phone, overrides = {}) {
  const created = await api(adminToken, "/api/v1/restaurant/orders/", {
    method: "POST",
    body: JSON.stringify(payload(phone, overrides)),
  });
  assert(created.response.ok, `Create failed: ${JSON.stringify(created.data)}`);
  const orderId = created.data.order_id;
  for (const status of ["preparing", "ready"]) {
    const moved = await api(
      adminToken,
      `/api/v1/restaurant/orders/${orderId}/status`,
      { method: "PATCH", body: JSON.stringify({ status }) }
    );
    assert(moved.response.ok, `Status ${status} failed: ${JSON.stringify(moved.data)}`);
  }
  const closed = await api(
    adminToken,
    `/api/v1/restaurant/orders/${orderId}/close?payment_method=cash`,
    { method: "PATCH" }
  );
  assert(closed.response.ok, `Close failed: ${JSON.stringify(closed.data)}`);
  return created.data;
}

async function customerToken(phone) {
  const requested = await api(null, "/api/v1/auth/customer/otp/request", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
  assert(requested.response.ok, `OTP request failed: ${JSON.stringify(requested.data)}`);
  const verified = await api(null, "/api/v1/auth/customer/otp/verify", {
    method: "POST",
    body: JSON.stringify({ phone, code: requested.data.debug_code }),
  });
  assert(verified.response.ok, `OTP verify failed: ${JSON.stringify(verified.data)}`);
  return verified.data.access_token;
}

async function loyaltyFor(token) {
  const response = await api(token, "/api/v1/restaurant/customers/me/loyalty");
  assert(response.response.ok, `Loyalty failed: ${JSON.stringify(response.data)}`);
  return response.data;
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
  const adminToken = login.data.access_token;

  const phoneA = `91${String(Date.now()).slice(-8)}`;
  const orderA = await createAndClose(adminToken, phoneA);
  const tokenA = await customerToken(phoneA);
  const loyaltyA = await loyaltyFor(tokenA);
  assert(loyaltyA.points_balance === Math.floor(orderA.total), "Points did not match the order total.");
  assert(/^PB[A-Z0-9]{6}$/.test(loyaltyA.referral_code), "Referral code shape was wrong.");

  const phoneB = `90${String(Date.now() + 1).slice(-8)}`;
  const createdB = await api(adminToken, "/api/v1/restaurant/orders/", {
    method: "POST",
    body: JSON.stringify(payload(phoneB, { referral_code: loyaltyA.referral_code })),
  });
  assert(createdB.response.ok, `Referral order failed: ${JSON.stringify(createdB.data)}`);
  assert(createdB.data.referral_applied === true, "Referral was not applied.");

  for (const status of ["preparing", "ready"]) {
    const moved = await api(
      adminToken,
      `/api/v1/restaurant/orders/${createdB.data.order_id}/status`,
      { method: "PATCH", body: JSON.stringify({ status }) }
    );
    assert(moved.response.ok, `Friend status ${status} failed: ${JSON.stringify(moved.data)}`);
  }
  const closedB = await api(
    adminToken,
    `/api/v1/restaurant/orders/${createdB.data.order_id}/close?payment_method=cash`,
    { method: "PATCH" }
  );
  assert(closedB.response.ok, `Friend close failed: ${JSON.stringify(closedB.data)}`);

  const invalid = await api(adminToken, "/api/v1/restaurant/orders/", {
    method: "POST",
    body: JSON.stringify(payload(`89${String(Date.now()).slice(-8)}`, { referral_code: "BADCODE" })),
  });
  assert(invalid.response.status === 422, "Invalid referral code was accepted.");

  const tokenB = await customerToken(phoneB);
  const loyaltyB = await loyaltyFor(tokenB);
  assert(
    loyaltyB.points_balance === Math.floor(createdB.data.total) + 100,
    `Friend points were ${loyaltyB.points_balance}.`
  );
  assert(loyaltyB.referrals_made === 0, "Friend should not have referrals made.");

  const updatedA = await loyaltyFor(tokenA);
  assert(updatedA.referrals_made === 1, "Referrer referral count did not update.");
  assert(updatedA.points_balance === loyaltyA.points_balance + 100, "Referrer bonus missing.");

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    await page.goto(`${baseURL}/account/login`, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="customer-login"][data-hydrated="true"]')
      .waitFor({ timeout: 20000 });
    await page.getByLabel("Phone number").fill(phoneA);
    await page.getByRole("button", { name: "Send verification code" }).click();
    const debug = page.getByTestId("customer-otp-debug");
    await debug.waitFor({ timeout: 20000 });
    const code = (await debug.innerText()).match(/\d{6}/)?.[0];
    assert(code, "No development code shown.");
    await page.getByLabel("Verification code").fill(code);
    await page.getByRole("button", { name: "Verify and sign in" }).click();
    await page.waitForURL("**/account", { timeout: 25000 });

    const card = page.getByTestId("loyalty-card");
    await card.waitFor({ timeout: 20000 });
    const pointsText = (await page.getByTestId("loyalty-points").innerText()).trim();
    assert(
      Number(pointsText) === updatedA.points_balance,
      `UI showed ${pointsText} points.`
    );
    const codeText = (await page.getByTestId("loyalty-referral-code").innerText()).trim();
    assert(codeText === loyaltyA.referral_code, "UI referral code did not match.");
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactsDir, "visible-loyalty-account.png"),
      fullPage: false,
    });

    await page.goto(`${baseURL}/order`, { waitUntil: "networkidle" });
    await page.getByLabel("Referral code").waitFor({ timeout: 15000 });
    console.log("Loyalty proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
