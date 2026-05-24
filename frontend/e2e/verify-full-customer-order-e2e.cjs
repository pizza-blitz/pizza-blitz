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
  const data = await response.json();
  assert(response.ok, `Admin portal login failed: ${JSON.stringify(data)}`);
  const cookie = cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
  assert(cookie.includes("pb_admin_session="), "Admin login did not return an admin session cookie.");
  return cookie;
}

async function adminJson(endpoint, cookie, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      Cookie: cookie,
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function createCustomerOrderPromotion(cookie) {
  const suffix = Date.now().toString().slice(-6);
  const code = `E2E${suffix}`;
  const today = new Date();
  const endDate = new Date(today.getTime() + 6 * 24 * 60 * 60 * 1000);
  const result = await adminJson("/api/v1/restaurant/promotions/", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Full Customer Order Proof ${suffix}`,
      code,
      start_date: today.toISOString().slice(0, 10),
      end_date: endDate.toISOString().slice(0, 10),
      description: "Full customer order E2E coupon proof",
      discount_type: "percentage",
      discount_value: 10,
      audience: "all_customers",
      channel: "email",
      status: "active",
      message_template: "Use {code} for {offer}.",
    }),
  });
  assert(result.response.ok, `Could not create customer E2E promotion: ${JSON.stringify(result.data)}`);
  return code;
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

async function chooseCustomizableMenuItem() {
  const response = await fetch(`${apiURL}/api/v1/restaurant/menu/menu-with-customizations`, {
    cache: "no-store",
  });
  const menu = await response.json();
  assert(response.ok, `Could not fetch menu with customizations: ${JSON.stringify(menu)}`);

  const item = menu
    .filter((menuItem) =>
      (menuItem.customization_groups || []).some((group) =>
        (group.options || []).some((option) => Number(option.price_delta || 0) > 0)
      )
    )
    .sort((left, right) => Number(right.selling_price || 0) - Number(left.selling_price || 0))[0];
  assert(item, "No menu item with priced customization options was available.");

  const selectedOption = item.customization_groups
    .flatMap((group) =>
      group.options
        .filter((option) => Number(option.price_delta || 0) > 0)
        .map((option) => ({ group, option }))
    )[0];
  assert(selectedOption, `No priced option was available for ${item.name}.`);

  return {
    itemName: item.name,
    optionName: selectedOption.option.name,
  };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const cookie = await portalLogin();
  const code = await createCustomerOrderPromotion(cookie);
  const customizableItem = await chooseCustomizableMenuItem();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);
  let orderId = 0;
  const phone = `95${Date.now().toString().slice(-8)}`;
  const email = `full-customer-e2e-${Date.now()}@example.com`;

  try {
    const response = await page.goto(`${baseURL}/order?coupon=${code}`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Order page returned HTTP ${response?.status() || "no response"}.`);
    await assertHealthyPage(page, "full customer order page");

    await page.getByTestId("customer-order-e2e-command").waitFor({ timeout: 15000 });
    await page.getByText("Order Journey", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText(`${code} selected from this offer link`, { exact: false }).waitFor({ timeout: 15000 });

    await page.getByPlaceholder("Search menu").fill(customizableItem.itemName);
    await page.getByRole("heading", { name: customizableItem.itemName }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: new RegExp(customizableItem.optionName, "i") }).first().click();
    await page.getByText(customizableItem.optionName, { exact: false }).first().waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: /^Add$/i }).first().click();
    await page.getByText(new RegExp(`Applied\\s+${code}`, "i")).first().waitFor({ timeout: 15000 });

    await page.getByRole("button", { name: /^Delivery$/i }).click();
    await page.getByPlaceholder("Name").fill("Full Customer Order Proof");
    await page.getByPlaceholder("Phone").fill(phone);
    await page.getByPlaceholder("Email for receipts and offers").fill(email);
    await page.getByPlaceholder("Delivery address").fill("Civil Lines market near main road");
    await page.getByText(/Delivery .*: Rs .*ETA/i).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /^Cash$/i }).click();
    await page.getByRole("button", { name: /Place Order/i }).click();
    await page.getByText(/Order #\d+ confirmed/i).waitFor({ timeout: 15000 });

    const bodyText = await page.locator("body").innerText();
    const orderMatch = bodyText.match(/Order #(\d+) confirmed/i);
    assert(orderMatch, `Could not find confirmed order id in page text: ${bodyText.slice(0, 500)}`);
    orderId = Number(orderMatch[1]);
    assert(orderId > 0, "Confirmed order id was not positive.");

    await page.getByTestId("customer-order-e2e-command").getByText("5/5", { exact: true }).waitFor({ timeout: 10000 });
    const trackingHref = await page.getByRole("link", { name: /Track this order/i }).getAttribute("href");
    const receiptHref = await page.getByRole("link", { name: /View receipt/i }).getAttribute("href");
    assert(trackingHref === `/track?order=${orderId}&phone=${encodeURIComponent(phone)}`, `Unexpected tracking href: ${trackingHref}`);
    assert(receiptHref === `/receipt/${orderId}?phone=${encodeURIComponent(phone)}`, `Unexpected receipt href: ${receiptHref}`);

    await page.screenshot({
      path: path.join(artifactsDir, "visible-full-customer-order-e2e.png"),
      fullPage: true,
    });

    await page.goto(`${baseURL}${receiptHref}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Customer Receipt" }).waitFor({ timeout: 15000 });
    await assertHealthyPage(page, "customer receipt page");
    await page.getByText(`PB-ORDER-${orderId}`, { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText(customizableItem.optionName, { exact: false }).waitFor({ timeout: 15000 });

    await page.goto(`${baseURL}${trackingHref}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: new RegExp(`Order #${orderId}`, "i") }).waitFor({ timeout: 15000 });
    await page.getByText("Order Details", { exact: true }).waitFor({ timeout: 15000 });
    await assertHealthyPage(page, "customer tracking page");
    await page.getByText(customizableItem.optionName, { exact: false }).waitFor({ timeout: 15000 });

    watch.assertClean("full customer order E2E");
  } finally {
    await browser.close();
  }

  const orderResponse = await fetch(`${apiURL}/api/v1/restaurant/orders/${orderId}`, {
    cache: "no-store",
  });
  const order = await orderResponse.json();
  assert(orderResponse.ok, `Could not fetch full customer order: ${JSON.stringify(order)}`);
  assert(order.order_type === "delivery", `Expected delivery order, got ${order.order_type}.`);
  assert(order.payment_method === "cash", `Expected cash payment method, got ${order.payment_method}.`);
  assert(order.payment_status === "pending", `Expected pending payment status, got ${order.payment_status}.`);
  assert(order.source === "customer_website", `Expected customer_website source, got ${order.source}.`);
  assert(order.delivery_fee > 0, `Expected delivery fee greater than 0, got ${order.delivery_fee}.`);
  assert(order.notes.includes(`Coupon: ${code}`), "Order notes did not include the applied coupon.");
  assert(
    order.items.some((item) =>
      (item.selected_options || []).some((option) => option.option_name === customizableItem.optionName)
    ),
    `Order did not preserve selected option ${customizableItem.optionName}.`
  );

  console.log(`Full customer order E2E passed for order #${orderId} using ${code}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
