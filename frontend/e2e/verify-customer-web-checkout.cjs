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

async function createCheckoutPromotion(cookie) {
  const suffix = Date.now().toString().slice(-6);
  const code = `CHK${suffix}`;
  const today = new Date();
  const endDate = new Date(today.getTime() + 6 * 24 * 60 * 60 * 1000);
  const result = await adminJson("/api/v1/restaurant/promotions/", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Customer Checkout Proof ${suffix}`,
      code,
      start_date: today.toISOString().slice(0, 10),
      end_date: endDate.toISOString().slice(0, 10),
      description: "E2E customer checkout coupon proof",
      discount_type: "percentage",
      discount_value: 10,
      audience: "all_customers",
      channel: "email",
      status: "active",
      message_template: "Use {code} for {offer}.",
    }),
  });
  assert(result.response.ok, `Could not create checkout promotion: ${JSON.stringify(result.data)}`);
  return { code, promotionId: result.data.promotion.id };
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

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const cookie = await portalLogin();
  const { code } = await createCheckoutPromotion(cookie);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);
  let orderId = 0;
  const phone = `94${Date.now().toString().slice(-8)}`;
  const email = `customer-checkout-${Date.now()}@example.com`;

  try {
    const response = await page.goto(`${baseURL}/order?coupon=${code}`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Order page returned HTTP ${response?.status() || "no response"}.`);
    await assertHealthyPage(page, "customer order page");
    await page.getByTestId("customer-funnel-command").waitFor({ timeout: 15000 });
    await page.getByTestId("customer-command-pickup").waitFor({ timeout: 10000 });
    await page.getByTestId("customer-command-delivery").click();
    await page.getByTestId("customer-funnel-ready-state").getByText("Complete checkout details", { exact: false }).waitFor({ timeout: 10000 });

    await page.getByTestId("customer-selected-coupon").getByText(code, { exact: false }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /^Add$/i }).first().click();
    await page.getByTestId("customer-funnel-cart-total").getByText("1 item selected", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByTestId("customer-cart-summary").waitFor({ timeout: 10000 });
    await page.getByText(new RegExp(`Applied\\s+${code}`, "i")).first().waitFor({ timeout: 15000 });
    await page.getByTestId("customer-checkout-progress").getByText("Checkout Progress", { exact: false }).waitFor({ timeout: 10000 });

    await page.getByRole("button", { name: /^Delivery$/i }).click();
    await page.getByPlaceholder("Name").fill("Customer Checkout Proof");
    await page.getByPlaceholder("Phone").fill(phone);
    await page.getByPlaceholder("Email for receipts and offers").fill(email);
    await page.getByPlaceholder("Delivery address").fill("Civil Lines market near main road");
    await page.getByText(/Delivery .*: Rs .*ETA/i).waitFor({ timeout: 15000 });
    const prepaidButton = page.getByRole("button", { name: /^Prepaid$/i });
    const cashButton = page.getByRole("button", { name: /^Cash$/i });
    assert(await prepaidButton.isDisabled(), "Manual fallback should not advertise a usable public prepaid checkout.");
    assert((await cashButton.getAttribute("aria-pressed")) === "true", "Cash should be the default while prepaid is inactive.");
    await page.getByRole("button", { name: /^Cash$/i }).click();
    await page.getByTestId("customer-place-order").click();
    await page.getByText(/Order #\d+ confirmed/i).waitFor({ timeout: 15000 });

    const bodyText = await page.locator("body").innerText();
    const orderMatch = bodyText.match(/Order #(\d+) confirmed/i);
    assert(orderMatch, `Could not find confirmed order id in page text: ${bodyText.slice(0, 500)}`);
    orderId = Number(orderMatch[1]);
    assert(orderId > 0, "Confirmed order id was not positive.");
    await page.getByRole("link", { name: /Track this order/i }).waitFor({ timeout: 10000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-customer-web-checkout.png"),
      fullPage: true,
    });
    watch.assertClean("customer web checkout");
  } finally {
    await browser.close();
  }

  const orderResponse = await fetch(
    `${apiURL}/api/v1/restaurant/orders/customer-receipt/${orderId}?phone=${encodeURIComponent(phone)}`,
    { cache: "no-store" }
  );
  const order = await orderResponse.json();
  assert(orderResponse.ok, `Could not fetch customer checkout order: ${JSON.stringify(order)}`);
  assert(order.order_type === "delivery", `Expected delivery order, got ${order.order_type}.`);
  assert(order.payment_method === "cash", `Expected cash payment method, got ${order.payment_method}.`);
  assert(order.payment_status === "pending", `Expected pending payment status, got ${order.payment_status}.`);
  assert(order.source === "customer_website", `Expected customer_website source, got ${order.source}.`);
  assert(order.delivery_fee > 0, `Expected delivery fee greater than 0, got ${order.delivery_fee}.`);
  assert(order.notes.includes(`Coupon: ${code}`), "Order notes did not include the applied coupon.");

  console.log(`Customer web checkout proof passed for order #${orderId} using ${code}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
