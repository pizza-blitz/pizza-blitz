const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
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

async function apiJson(endpoint, init = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init,
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
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
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

async function chooseDeliveryItem() {
  const { response, data } = await apiJson("/api/v1/restaurant/menu/menu-with-customizations");
  assert(response.ok, `Could not load menu: ${JSON.stringify(data)}`);
  const item = data
    .filter((row) => row.is_available && Number(row.selling_price || 0) > 0)
    .sort((left, right) => Number(right.selling_price || 0) - Number(left.selling_price || 0))[0];
  assert(item, "No available menu item found for delivery profile proof.");
  return item;
}

async function seedDeliveryOrder() {
  const zonesResult = await apiJson("/api/v1/restaurant/delivery/zones");
  assert(zonesResult.response.ok, `Could not load delivery zones: ${JSON.stringify(zonesResult.data)}`);
  const zone = zonesResult.data.find((row) => row.is_active && row.name === "Near Store") ||
    zonesResult.data.find((row) => row.is_active) ||
    zonesResult.data[0];
  assert(zone?.id, "No delivery zone was available.");

  const item = await chooseDeliveryItem();
  const minimum = Number(zone.minimum_order_amount || 0);
  const unitPrice = Number(item.selling_price || 0);
  const quantity = Math.max(1, Math.ceil((minimum + 25) / Math.max(unitPrice, 1)));
  const phone = `96${Date.now().toString().slice(-8)}`;
  const address = `House 42 ${zone.keywords?.[0] || "Civil Lines"} main road delivery profile proof`;

  const orderResult = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    body: JSON.stringify({
      order_type: "delivery",
      customer_name: "Delivery Profile Proof",
      customer_phone: phone,
      customer_email: `delivery-profile-${Date.now()}@example.com`,
      opt_in_marketing: true,
      payment_method: "cash",
      delivery_address: address,
      delivery_zone_id: zone.id,
      notes: "Customer delivery profile proof",
      items: [
        {
          menu_item_id: item.id,
          name: item.name,
          quantity,
          price: unitPrice,
        },
      ],
    }),
  });
  assert(orderResult.response.ok, `Could not seed delivery order: ${JSON.stringify(orderResult.data)}`);
  assert(orderResult.data.order_id, "Seeded delivery order did not return order_id.");
  return { address, item, orderId: Number(orderResult.data.order_id), phone, quantity, zone };
}

async function signInAsCustomer(context, phone, orderId) {
  const response = await context.request.post(`${baseURL}/api/customer-session`, {
    data: { phone, order_id: orderId },
  });
  assert(response.ok(), `Customer session failed: ${await response.text()}`);
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const seeded = await seedDeliveryOrder();
  const historyResult = await apiJson(
    `/api/v1/restaurant/orders/customer-history/${encodeURIComponent(seeded.phone)}?order_id=${seeded.orderId}`
  );
  assert(historyResult.response.ok, `Customer history failed: ${JSON.stringify(historyResult.data)}`);
  assert(historyResult.data.delivery_profile?.address === seeded.address, "Customer history did not expose latest delivery address.");
  assert(historyResult.data.delivery_profile?.zone === seeded.zone.name, "Customer history did not expose latest delivery zone.");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    await signInAsCustomer(context, seeded.phone, seeded.orderId);

    let response = await page.goto(`${baseURL}/account`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Account page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByTestId("customer-delivery-profile").waitFor({ timeout: 15000 });
    await page.getByTestId("customer-delivery-profile").getByText(seeded.address, { exact: false }).waitFor({ timeout: 10000 });
    await page.getByTestId("customer-delivery-profile").getByText(seeded.zone.name, { exact: false }).waitFor({ timeout: 10000 });
    await assertHealthyPage(page, "customer account delivery profile");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-customer-delivery-profile-account.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: /Order To This Address/i }).click();
    await page.waitForURL(/\/order$/, { timeout: 15000 });
    await page.getByPlaceholder("Delivery address").waitFor({ timeout: 30000 });
    await page.waitForFunction(
      (expectedAddress) => {
        const input = Array.from(document.querySelectorAll("input")).find(
          (element) => element.getAttribute("placeholder") === "Delivery address"
        );
        return input && input.value === expectedAddress;
      },
      seeded.address,
      { timeout: 30000 }
    );

    const loadedAddress = await page.getByPlaceholder("Delivery address").inputValue();
    const loadedName = await page.getByPlaceholder("Name").inputValue();
    const loadedPhone = await page.getByPlaceholder("Phone").inputValue();
    assert(loadedAddress === seeded.address, `Expected saved address, got ${loadedAddress}.`);
    assert(loadedName === "Delivery Profile Proof", `Expected customer name, got ${loadedName}.`);
    assert(loadedPhone === seeded.phone, `Expected phone ${seeded.phone}, got ${loadedPhone}.`);

    await page.getByText(new RegExp(`Delivery ${seeded.zone.name}`, "i")).waitFor({ timeout: 15000 });
    const quantityLabel = `${seeded.quantity} item${seeded.quantity === 1 ? "" : "s"} selected`;
    await page.getByTestId("customer-funnel-cart-total").getByText(quantityLabel, { exact: false }).waitFor({ timeout: 15000 });
    await assertHealthyPage(page, "customer delivery profile reorder checkout");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-customer-delivery-profile-checkout.png"),
      fullPage: true,
    });
    watch.assertClean("customer delivery profile loop");
  } finally {
    await browser.close();
  }

  console.log(`Customer delivery profile proof passed for order #${seeded.orderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
