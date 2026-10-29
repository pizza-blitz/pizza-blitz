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

  return {
    assertClean(label) {
      assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
    },
  };
}

async function assertHealthyPage(page, label, requireOverflow = true) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => undefined);
  const health = await page.evaluate(() => {
    const text = document.body.innerText || "";
    return {
      textLength: text.trim().length,
      hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
      bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  assert(health.textLength > 300, `${label} rendered too little content.`);
  assert(!health.hasFrameworkError, `${label} rendered framework error text.`);
  if (requireOverflow) {
    assert(health.bodyOverflow <= 8, `${label} has body-level horizontal overflow of ${health.bodyOverflow}px.`);
  }
}

async function createOrder(phone) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(`${apiURL}/api/v1/restaurant/orders/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_type: "takeaway",
          customer_name: "Confirmation Proof",
          customer_phone: phone,
          payment_method: "cash",
          items: [{ name: "Garlic Bread", quantity: 1, price: 119 }],
        }),
      });
      const data = await response.json().catch(() => ({}));
      assert(response.ok, `Could not create proof order: ${JSON.stringify(data)}`);
      assert(Number(data.order_id) > 0, "Proof order did not return an id.");
      return data.order_id;
    } catch (err) {
      lastError = err;
      await sleep(1000);
    }
  }
  throw lastError;
}

async function receipt(orderId, phone) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(
        `${apiURL}/api/v1/restaurant/orders/customer-receipt/${orderId}?phone=${encodeURIComponent(phone)}`,
        { cache: "no-store" }
      );
      const data = await response.json().catch(() => ({}));
      assert(response.ok, `Could not load proof receipt: ${JSON.stringify(data)}`);
      return data;
    } catch (err) {
      lastError = err;
      await sleep(1000);
    }
  }
  throw lastError;
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const phone = `93${Date.now().toString().slice(-8)}`;
  const orderId = await createOrder(phone);
  const order = await receipt(orderId, phone);
  const total = `Rs ${Number(order.total_amount || 0).toFixed(2)}`;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 1200 },
    });
    const page = await context.newPage();
    const watch = createBrowserWatch(page);

    const confirmationUrl = `${baseURL}/order/confirmation?order=${orderId}&phone=${encodeURIComponent(phone)}`;
    const response = await page.goto(confirmationUrl, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Confirmation page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByTestId("order-confirmation-page").waitFor({ timeout: 15000 });
    await page.getByText(`Order #${orderId}`, { exact: false }).waitFor({ timeout: 10000 });
    await page.getByText("Garlic Bread", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByText(total, { exact: false }).first().waitFor({ timeout: 10000 });
    await assertHealthyPage(page, "order confirmation page");

    const trackHref = await page.getByRole("link", { name: /Track this order/i }).getAttribute("href");
    assert(
      trackHref && trackHref.includes(`/track?order=${orderId}`) && trackHref.includes("phone="),
      `Track link did not prefill the order: ${trackHref}`
    );
    const receiptHref = await page.getByRole("link", { name: /View receipt/i }).getAttribute("href");
    assert(
      receiptHref && receiptHref.includes(`/receipt/${orderId}`) && receiptHref.includes("phone="),
      `Receipt link did not prefill the order: ${receiptHref}`
    );
    assert(
      (await page.locator('a[href="/login"], a[href^="/dashboard"], a[href^="/orders"]').count()) === 0,
      "Confirmation page exposed staff or admin links."
    );

    await page.getByRole("link", { name: /Track this order/i }).click();
    await page.getByText(`Order #${orderId}`, { exact: false }).waitFor({ timeout: 20000 });
    await page.getByTestId("track-last-updated").waitFor({ timeout: 10000 });
    const updatedText = await page.getByTestId("track-last-updated").innerText();
    assert(/refreshes every 30s/i.test(updatedText), `Tracking refresh label missing: ${updatedText}`);
    await page.screenshot({
      path: path.join(artifactsDir, "visible-order-confirmation.png"),
      fullPage: true,
    });
    watch.assertClean("confirmation and tracking");

    const mobile = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(confirmationUrl, { waitUntil: "domcontentloaded" });
    await mobilePage.getByTestId("order-confirmation-page").waitFor({ timeout: 15000 });
    await assertHealthyPage(mobilePage, "mobile order confirmation page");
    await mobilePage.screenshot({
      path: path.join(artifactsDir, "mobile-order-confirmation.png"),
      fullPage: true,
    });
    await mobile.close();
    await context.close();

    const cartContext = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 1200 },
    });
    const cartPage = await cartContext.newPage();
    const cartWatch = createBrowserWatch(cartPage);
    await cartPage.goto(`${baseURL}/order`, { waitUntil: "domcontentloaded" });
    await cartPage.getByTestId("customer-funnel-command").waitFor({ timeout: 15000 });
    await cartPage.getByRole("button", { name: /^Add$/i }).first().click();
    await cartPage.getByText("1 item selected", { exact: false }).waitFor({ timeout: 10000 });
    await cartPage.waitForTimeout(800);
    await cartPage.reload({ waitUntil: "domcontentloaded" });
    await cartPage.getByText("1 item selected", { exact: false }).waitFor({ timeout: 20000 });
    await cartPage.getByText(/Restored your saved cart/i).waitFor({ timeout: 10000 });
    assert(
      (await cartPage.getByTestId("customer-cart-summary").count()) > 0,
      "Restored cart did not render its summary."
    );
    assert(
      (await cartPage.getByRole("link", { name: /Admin Portal/i }).count()) === 0,
      "Order page still exposes the admin portal from the customer header."
    );
    assert(
      (await cartPage.getByRole("link", { name: /Track order/i }).count()) > 0,
      "Customer header is missing the track order link."
    );
    cartWatch.assertClean("restored cart");
    await cartContext.close();

    console.log(`Order confirmation, tracking prefill, and cart restore proof passed for order #${orderId}.`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
