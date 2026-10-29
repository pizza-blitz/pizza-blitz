/* Scheduled order proof: slots -> create -> tracking, customer UI, counter badge. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function localDate(offsetDays = 0) {
  const target = new Date();
  target.setDate(target.getDate() + offsetDays);
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  return `${target.getFullYear()}-${month}-${day}`;
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

function cookieHeaderFromSetCookie(setCookie) {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie || ""];
  return values
    .flatMap((value) => value.split(/,(?=\s*pb_[^=]+=)/))
    .map((value) => value.split(";")[0].trim())
    .filter((value) => value.startsWith("pb_"))
    .join("; ");
}

async function apiJson(token, endpoint, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

const hours = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [
    day,
    { open: "11:00", close: "23:30" },
  ])
);

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const apiLogin = await fetch(`${apiURL}/api/v1/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  });
  if (!apiLogin.ok) throw new Error(`Admin API login failed: ${await apiLogin.text()}`);
  const token = (await apiLogin.json()).access_token;

  const original = await apiJson(token, "/api/v1/restaurant/ops/store-profile");
  assert(original.response.ok, `Could not read store profile: ${JSON.stringify(original.data)}`);
  const restore = {
    name: original.data.name,
    tagline: original.data.tagline,
    phone: original.data.phone,
    email: original.data.email,
    address_line: original.data.address_line,
    map_url: original.data.map_url,
    instagram_url: original.data.instagram_url,
    opening_hours: original.data.opening_hours,
    online_ordering_paused: original.data.online_ordering_paused,
    pause_message: original.data.pause_message,
    prep_time_minutes: original.data.prep_time_minutes,
  };

  const profileUpdate = await apiJson(token, "/api/v1/restaurant/ops/store-profile", {
    method: "PUT",
    body: JSON.stringify({ ...restore, online_ordering_paused: false, opening_hours: hours }),
  });
  assert(profileUpdate.response.ok, `Could not set store hours: ${JSON.stringify(profileUpdate.data)}`);

  const date = localDate(1);
  const slotsResponse = await apiJson(
    null,
    `/api/v1/restaurant/orders/scheduled-slots?date=${date}`
  );
  assert(slotsResponse.response.ok, `Slots failed: ${JSON.stringify(slotsResponse.data)}`);
  const available = (slotsResponse.data.slots || []).filter((slot) => slot.available);
  assert(available.length > 0, "No scheduled slots were available for tomorrow.");
  const slot = available[0];

  const phone = `97${String(Date.now()).slice(-8)}`;
  const orderResponse = await apiJson(null, "/api/v1/restaurant/orders/", {
    method: "POST",
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Scheduled Proof",
      customer_phone: phone,
      payment_method: "cash",
      scheduled_for: slot.value,
      items: [{ name: "Garlic Bread", quantity: 1, price: 119 }],
    }),
  });
  assert(orderResponse.response.ok, `Scheduled order failed: ${JSON.stringify(orderResponse.data)}`);
  const orderId = orderResponse.data.order_id;
  assert(
    orderResponse.data.scheduled_label === `Tomorrow, ${slot.label}`,
    `Unexpected scheduled label: ${orderResponse.data.scheduled_label}`
  );

  const browser = await chromium.launch({ headless: true });
  try {
    const customer = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const trackPage = await customer.newPage();
    await trackPage.goto(
      `${baseURL}/track?order=${orderId}&phone=${encodeURIComponent(phone)}`,
      { waitUntil: "networkidle" }
    );
    await trackPage.getByTestId("track-scheduled-time").waitFor({ timeout: 20000 });
    const trackText = (await trackPage.getByTestId("track-scheduled-time").innerText()).trim();
    assert(/Scheduled for Tomorrow/.test(trackText), `Tracking text was "${trackText}".`);
    await trackPage.screenshot({
      path: path.join(artifactsDir, "visible-scheduled-order-tracking.png"),
      fullPage: false,
    });

    const orderPage = await customer.newPage();
    await orderPage.goto(`${baseURL}/order`, { waitUntil: "networkidle" });
    await orderPage.getByText("Garlic Bread", { exact: false }).first().waitFor({ timeout: 20000 });
    const scheduleToggle = orderPage.getByLabel("Schedule for later");
    await scheduleToggle.waitFor({ timeout: 20000 });
    await scheduleToggle.check();
    const timeSelect = orderPage.getByLabel("Scheduled time");
    await timeSelect.waitFor({ timeout: 15000 });
    await orderPage.waitForFunction(
      () => {
        const select = document.querySelector('select[aria-label="Scheduled time"]');
        return select && select.options.length > 1;
      },
      { timeout: 20000 }
    );
    const options = await timeSelect.locator("option").evaluateAll((nodes) =>
      nodes
        .map((node) => ({ value: node.value, disabled: node.disabled }))
        .filter((node) => node.value && !node.disabled)
    );
    assert(options.length > 0, "The customer schedule picker had no bookable times.");
    await timeSelect.selectOption(options[0].value);
    const buttonText = (await orderPage.getByTestId("customer-place-order").innerText()).trim();
    assert(/Schedule Order/.test(buttonText), `Order button read "${buttonText}".`);
    await orderPage.screenshot({
      path: path.join(artifactsDir, "visible-scheduled-order-picker.png"),
      fullPage: false,
    });
    await customer.close();

    const adminLogin = await fetch(`${baseURL}/api/admin-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
    });
    assert(adminLogin.ok, `Admin portal login failed: ${await adminLogin.text()}`);
    const cookie = cookieHeaderFromSetCookie(adminLogin.headers.get("set-cookie"));
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await adminContext.addCookies(
      cookie
        .split(/;\s*/)
        .filter(Boolean)
        .map((pair) => {
          const [name, ...rest] = pair.split("=");
          return { name, value: rest.join("="), url: baseURL, httpOnly: true, sameSite: "Lax" };
        })
    );
    const ordersPage = await adminContext.newPage();
    await ordersPage.goto(`${baseURL}/orders`, { waitUntil: "domcontentloaded" });
    const scheduledBadge = ordersPage.getByTestId(`counter-order-scheduled-${orderId}`);
    await scheduledBadge.waitFor({ timeout: 25000 });
    await scheduledBadge.scrollIntoViewIfNeeded();
    const badge = (await scheduledBadge.innerText()).trim();
    assert(/Tomorrow/.test(badge), `Counter badge read "${badge}".`);
    await ordersPage.screenshot({
      path: path.join(artifactsDir, "visible-scheduled-order-counter.png"),
      fullPage: false,
    });
    await adminContext.close();

    console.log("Scheduled order proof passed.");
  } finally {
    await browser.close();
    const restored = await apiJson(token, "/api/v1/restaurant/ops/store-profile", {
      method: "PUT",
      body: JSON.stringify(restore),
    });
    if (!restored.response.ok) {
      console.warn(`Could not restore store profile: ${JSON.stringify(restored.data)}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
