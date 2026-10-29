const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
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

async function portalLogin() {
  const response = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  const data = await response.json().catch(() => ({}));
  assert(response.ok, `Admin portal login failed: ${JSON.stringify(data)}`);
  const cookie = cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
  assert(cookie.includes("pb_admin_session="), "Admin login did not return an admin session cookie.");
  return cookie;
}

async function apiJson(endpoint, cookie, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function createBrowserWatch(page) {
  const issues = [];

  page.on("pageerror", (error) => {
    issues.push(`page error: ${error.message}`);
  });

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico|images\.unsplash\.com/i.test(text)) return;
    if (/Failed to fetch RSC payload/i.test(text) && /Falling back to browser navigation/i.test(text)) return;
    issues.push(`console error: ${text}`);
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!url.startsWith(baseURL) && !url.startsWith(apiURL)) return;
    const failure = request.failure();
    if (failure?.errorText === "net::ERR_ABORTED") return;
    issues.push(`request failed: ${request.method()} ${url} ${failure?.errorText || ""}`.trim());
  });

  return {
    assertClean(label) {
      assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
    },
  };
}

async function assertHealthyPage(page, label) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => undefined);
  const health = await page.evaluate(() => {
    const text = document.body.innerText || "";
    return {
      textLength: text.trim().length,
      hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
      hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
      bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  assert(health.textLength > 500, `${label} rendered too little content.`);
  assert(!health.hasOverlay, `${label} has a Next.js error overlay.`);
  assert(!health.hasFrameworkError, `${label} rendered framework error text.`);
  assert(health.bodyOverflow <= 8, `${label} has body-level horizontal overflow of ${health.bodyOverflow}px.`);
}

async function chooseMenuItem() {
  const response = await fetch(`${apiURL}/api/v1/restaurant/menu/menu-with-customizations`, {
    cache: "no-store",
  });
  const menu = await response.json();
  assert(response.ok, `Could not fetch menu: ${JSON.stringify(menu)}`);
  const item = menu
    .filter((menuItem) => menuItem.is_available)
    .sort((left, right) => Number(right.selling_price || 0) - Number(left.selling_price || 0))[0];
  assert(item, "No available menu item was found for operational dashboard proof.");
  return item;
}

async function createPickupOrder(item, phone) {
  const result = await apiJson("/api/v1/restaurant/orders/", null, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Ops Board Pickup Proof",
      customer_phone: phone,
      payment_method: "cash",
      notes: "Operational dashboard command proof",
      items: [
        {
          menu_item_id: item.id,
          name: item.name,
          quantity: 1,
          price: Number(item.selling_price || 0),
        },
      ],
    }),
  });
  assert(result.response.ok, `Could not create pickup order: ${JSON.stringify(result.data)}`);
  assert(result.data.order_id, "Pickup order response did not include order_id.");
  return result.data.order_id;
}

async function createDeliveryOrder(item, zoneId, address, phone) {
  const result = await apiJson("/api/v1/restaurant/orders/", null, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "delivery",
      customer_name: "Ops Board Delivery Proof",
      customer_phone: phone,
      customer_email: `ops-board-${Date.now()}@example.com`,
      payment_method: "cash",
      delivery_address: address,
      delivery_zone_id: zoneId,
      notes: "Operational dashboard delivery proof",
      items: [
        {
          menu_item_id: item.id,
          name: item.name,
          quantity: 1,
          price: Number(item.selling_price || 0),
        },
      ],
    }),
  });
  assert(result.response.ok, `Could not create delivery order: ${JSON.stringify(result.data)}`);
  assert(result.data.order_id, "Delivery order response did not include order_id.");
  return result.data.order_id;
}

async function assertCount(page, testId, expected) {
  const locator = page.getByTestId(testId);
  await locator.waitFor({ timeout: 15000 });
  const deadline = Date.now() + 15000;
  let actual = "";
  while (Date.now() < deadline) {
    actual = (await locator.innerText()).trim();
    if (actual === String(expected)) return;
    await sleep(250);
  }
  assert(false, `${testId} expected ${expected}, got ${actual}.`);
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const adminCookie = await portalLogin();
  const item = await chooseMenuItem();
  const zonesResult = await apiJson("/api/v1/restaurant/delivery/zones");
  assert(zonesResult.response.ok, `Could not load delivery zones: ${JSON.stringify(zonesResult.data)}`);
  const nearZone = zonesResult.data.find((zone) => zone.name === "Near Store") || zonesResult.data[0];
  assert(nearZone?.id, "No delivery zone was available.");

  const pickupPhone = `95${Date.now().toString().slice(-8)}`;
  const deliveryPhone = `94${Date.now().toString().slice(-8)}`;
  const pickupOrderId = await createPickupOrder(item, pickupPhone);
  const deliveryOrderId = await createDeliveryOrder(
    item,
    nearZone.id,
    "House 88 Civil Lines market near main road",
    deliveryPhone
  );

  const [todayResult, flowResult, queueResult] = await Promise.all([
    apiJson("/api/v1/restaurant/orders/today", adminCookie),
    apiJson("/api/v1/restaurant/orders/flow-readiness", adminCookie),
    apiJson("/api/v1/restaurant/delivery/queue", adminCookie),
  ]);
  assert(todayResult.response.ok, `Could not fetch today orders: ${JSON.stringify(todayResult.data)}`);
  assert(flowResult.response.ok, `Could not fetch order flow: ${JSON.stringify(flowResult.data)}`);
  assert(queueResult.response.ok, `Could not fetch delivery queue: ${JSON.stringify(queueResult.data)}`);
  assert(
    todayResult.data.orders.some((order) => order.id === pickupOrderId) &&
      todayResult.data.orders.some((order) => order.id === deliveryOrderId),
    "Seeded pickup and delivery orders were not present in today's command data."
  );
  assert(flowResult.data.summary.open_count >= 2, "Order flow did not report the seeded open orders.");
  assert(queueResult.data.summary.unassigned_count >= 1, "Delivery queue did not report the seeded unassigned delivery.");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1250 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    let response = await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Dashboard returned HTTP ${response?.status() || "no response"}.`);
    await page.getByTestId("today-command-board").waitFor({ timeout: 15000 });
    await page.getByRole("heading", { name: "Today Command Board" }).waitFor({ timeout: 15000 });
    await page.getByTestId("today-command-board").getByRole("link", { name: /Kitchen Ops/i }).waitFor({ timeout: 15000 });

    await assertCount(page, "today-orders-count", flowResult.data.summary.today_order_count);
    await assertCount(page, "kitchen-active-count", flowResult.data.summary.active_order_count);
    await assertCount(page, "delivery-handoff-count", queueResult.data.summary.open_delivery_count);
    await assertCount(page, "kitchen-state-new", flowResult.data.summary.open_count);
    await assertCount(page, "delivery-state-unassigned", queueResult.data.summary.unassigned_count);

    await page.getByTestId("owner-alert-list").getByText("Start prep", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("owner-alert-list").getByText("Assign riders", { exact: true }).waitFor({ timeout: 15000 });
    await assertHealthyPage(page, "desktop operational dashboard command board");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-operational-dashboard-command-board.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    response = await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Mobile dashboard returned HTTP ${response?.status() || "no response"}.`);
    await page.getByTestId("today-command-board").waitFor({ timeout: 15000 });
    await assertCount(page, "delivery-state-unassigned", queueResult.data.summary.unassigned_count);
    await assertHealthyPage(page, "mobile operational dashboard command board");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-operational-dashboard-command-board-mobile.png"),
      fullPage: true,
    });

    watch.assertClean("operational dashboard command board");
  } finally {
    await browser.close();
  }

  console.log(`Operational dashboard command board proof passed for orders #${pickupOrderId} and #${deliveryOrderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
