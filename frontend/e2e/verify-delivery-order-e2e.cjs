const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
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
  assert(health.textLength > 300, `${label} rendered too little content.`);
  assert(!health.hasOverlay, `${label} has a Next.js error overlay.`);
  assert(!health.hasFrameworkError, `${label} rendered framework error text.`);
  assert(health.bodyOverflow <= 8, `${label} has body-level horizontal overflow of ${health.bodyOverflow}px.`);
}

async function chooseDeliveryMenuItem() {
  const response = await fetch(`${apiURL}/api/v1/restaurant/menu/menu-with-customizations`, {
    cache: "no-store",
  });
  const menu = await response.json();
  assert(response.ok, `Could not fetch menu: ${JSON.stringify(menu)}`);
  const item = menu
    .filter((menuItem) => menuItem.is_available)
    .sort((left, right) => Number(right.selling_price || 0) - Number(left.selling_price || 0))[0];
  assert(item, "No available menu item was found for delivery proof.");
  return item;
}

async function createDeliveryOrder(zoneId, address, phone) {
  const item = await chooseDeliveryMenuItem();
  const result = await apiJson("/api/v1/restaurant/orders/", null, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "delivery",
      customer_name: "Delivery E2E Proof",
      customer_phone: phone,
      customer_email: `delivery-e2e-${Date.now()}@example.com`,
      payment_method: "cash",
      delivery_address: address,
      delivery_zone_id: zoneId,
      notes: "Delivery order E2E proof",
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
  return { orderId: result.data.order_id, itemName: item.name };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const adminCookie = await portalLogin();
  const zonesResult = await apiJson("/api/v1/restaurant/delivery/zones");
  assert(zonesResult.response.ok, `Could not load delivery zones: ${JSON.stringify(zonesResult.data)}`);
  const nearZone = zonesResult.data.find((zone) => zone.name === "Near Store") || zonesResult.data[0];
  assert(nearZone?.id, "No active delivery zone was available.");

  const address = "House 42 Civil Lines market near main road";
  const quoteResult = await apiJson("/api/v1/restaurant/delivery/quote", null, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, subtotal: 549, zone_id: nearZone.id }),
  });
  assert(quoteResult.response.ok, `Delivery quote failed: ${JSON.stringify(quoteResult.data)}`);
  assert(quoteResult.data.is_deliverable, "Delivery quote was not deliverable.");
  assert(Number(quoteResult.data.delivery_fee || 0) > 0, "Delivery quote did not include a positive fee.");
  assert(quoteResult.data.eta_window, "Delivery quote did not include ETA.");

  const phone = `97${Date.now().toString().slice(-8)}`;
  const { orderId, itemName } = await createDeliveryOrder(nearZone.id, address, phone);
  let orderResult = await apiJson(`/api/v1/restaurant/orders/${orderId}`, adminCookie);
  assert(orderResult.response.ok, `Could not fetch delivery order: ${JSON.stringify(orderResult.data)}`);
  assert(orderResult.data.order_type === "delivery", `Expected delivery order, got ${orderResult.data.order_type}.`);
  assert(orderResult.data.delivery_fee > 0, `Expected positive delivery fee, got ${orderResult.data.delivery_fee}.`);
  assert(orderResult.data.delivery_assignment?.status === "unassigned", "Delivery order did not start unassigned.");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    let response = await page.goto(`${baseURL}/operations`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Operations returned HTTP ${response?.status() || "no response"}.`);
    await page.getByText("Delivery Dispatch Board", { exact: false }).waitFor({ timeout: 15000 });
    await assertHealthyPage(page, "delivery operations page");

    const deliveryCard = page.locator("article").filter({ hasText: `Order #${orderId}` }).first();
    await deliveryCard.waitFor({ timeout: 15000 });
    await deliveryCard.getByText(address, { exact: false }).waitFor({ timeout: 10000 });
    await deliveryCard.getByPlaceholder("Delivery partner").fill("Ravi Rider");
    await deliveryCard.getByPlaceholder("Handoff note or failure reason").fill("Thermal bag; call at Civil Lines gate.");
    await deliveryCard.getByRole("button", { name: "Assign" }).click();
    await page.getByText(`Delivery for order #${orderId} moved to assigned.`, { exact: false }).waitFor({ timeout: 15000 });
    await deliveryCard.getByText("assigned", { exact: false }).waitFor({ timeout: 10000 });

    await deliveryCard.getByRole("button", { name: "Dispatch" }).click();
    await page.getByText(`Delivery for order #${orderId} moved to out for delivery.`, { exact: false }).waitFor({ timeout: 15000 });
    await deliveryCard.getByText("out for delivery", { exact: false }).waitFor({ timeout: 10000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-delivery-order-e2e-operations.png"),
      fullPage: true,
    });

    response = await page.goto(`${baseURL}/track?order=${orderId}&phone=${encodeURIComponent(phone)}`, {
      waitUntil: "domcontentloaded",
    });
    assert(response && response.ok(), `Tracking returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: new RegExp(`Order #${orderId}`, "i") }).waitFor({ timeout: 15000 });
    await page.getByText("Rider is on the way with your order.", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByTestId("track-delivery-status").getByText("out for delivery", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByTestId("track-delivery-status").getByText("Ravi Rider", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByText("Out for delivery", { exact: true }).waitFor({ timeout: 10000 });
    await assertHealthyPage(page, "delivery tracking out-for-delivery page");

    response = await page.goto(`${baseURL}/operations`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Operations returned HTTP ${response?.status() || "no response"} before delivery close.`);
    await deliveryCard.waitFor({ timeout: 15000 });
    await deliveryCard.getByRole("button", { name: "Delivered & Close" }).click();
    await page.getByText(new RegExp(`Delivery for order #${orderId} delivered and order closed`, "i")).waitFor({ timeout: 15000 });

    response = await page.goto(`${baseURL}/track?order=${orderId}&phone=${encodeURIComponent(phone)}`, {
      waitUntil: "domcontentloaded",
    });
    assert(response && response.ok(), `Tracking returned HTTP ${response?.status() || "no response"} after delivery close.`);
    await page.getByRole("heading", { name: new RegExp(`Order #${orderId}`, "i") }).waitFor({ timeout: 15000 });
    await page.getByText("Delivery completed. Thank you for ordering.", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByTestId("track-delivery-status").getByText("delivered", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByText(itemName, { exact: false }).waitFor({ timeout: 10000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-delivery-order-e2e.png"),
      fullPage: true,
    });

    watch.assertClean("delivery order E2E");
  } finally {
    await browser.close();
  }

  orderResult = await apiJson(`/api/v1/restaurant/orders/${orderId}`, adminCookie);
  assert(orderResult.response.ok, `Could not fetch final delivery order: ${JSON.stringify(orderResult.data)}`);
  assert(orderResult.data.status === "closed", `Expected closed order, got ${orderResult.data.status}.`);
  assert(orderResult.data.payment_status === "paid", `Expected paid payment, got ${orderResult.data.payment_status}.`);
  assert(orderResult.data.delivery_assignment?.status === "delivered", "Delivery assignment did not end delivered.");
  assert(orderResult.data.delivery_assignment?.assigned_to === "Ravi Rider", "Delivery rider was not preserved.");

  console.log(`Delivery order E2E passed for order #${orderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
