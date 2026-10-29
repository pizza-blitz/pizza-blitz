/* Order notification proof: status changes record once and appear on tracking. */
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

  const login = await fetch(`${apiURL}/api/v1/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  });
  if (!login.ok) throw new Error(`Admin API login failed: ${await login.text()}`);
  const token = (await login.json()).access_token;

  const phone = `94${String(Date.now()).slice(-8)}`;
  const created = await api(token, "/api/v1/restaurant/orders/", {
    method: "POST",
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Notify Proof Guest",
      customer_phone: phone,
      payment_method: "cash",
      items: [{ name: "Garlic Bread", quantity: 1, price: 119 }],
    }),
  });
  assert(created.response.ok, `Could not create order: ${JSON.stringify(created.data)}`);
  const orderId = created.data.order_id;

  for (const status of ["preparing", "ready"]) {
    const moved = await api(token, `/api/v1/restaurant/orders/${orderId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    assert(moved.response.ok, `Could not move to ${status}: ${JSON.stringify(moved.data)}`);
  }

  const log = await api(token, `/api/v1/restaurant/orders/${orderId}/notifications`);
  assert(log.response.ok, `Notification log failed: ${JSON.stringify(log.data)}`);
  const rows = log.data.notifications || [];
  const events = rows.map((row) => row.event);
  assert(events.includes("preparing"), `Missing preparing notification: ${events}`);
  assert(events.includes("ready"), `Missing ready notification: ${events}`);
  assert(rows.length === 2, `Expected 2 notifications, found ${rows.length}.`);

  // Repeating a status must not duplicate the event.
  await api(token, `/api/v1/restaurant/orders/${orderId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "preparing" }),
  });
  const again = await api(token, `/api/v1/restaurant/orders/${orderId}/notifications`);
  assert(again.data.notifications.length === 2, "Duplicate notification was created.");

  const sent = rows.filter((row) => row.status === "sent");
  if (sent.length === rows.length) {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      await page.goto(
        `${baseURL}/track?order=${orderId}&phone=${encodeURIComponent(phone)}`,
        { waitUntil: "networkidle" }
      );
      await page.getByTestId("track-notifications").waitFor({ timeout: 20000 });
      const text = (await page.getByTestId("track-notifications").innerText()).toLowerCase();
      assert(text.includes("preparing") && text.includes("ready"), `Tracked updates read "${text}".`);
      await page.getByTestId("track-notifications").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(artifactsDir, "visible-order-notifications-tracking.png"),
        fullPage: false,
      });
    } finally {
      await browser.close();
    }
    console.log("Order notification proof passed (sent + tracking).");
  } else {
    assert(
      rows.every((row) => row.status === "skipped" && row.error),
      `Unexpected notification statuses: ${JSON.stringify(rows)}`
    );
    console.log(
      "Order notification proof passed (recorded as skipped; enable ORDER_NOTIFICATIONS_ENABLED=true and ORDER_NOTIFICATION_CHANNEL=console to exercise sent messages)."
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
