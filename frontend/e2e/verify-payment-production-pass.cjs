const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");
const { cleanupProofOrder } = require("./helpers/order-cleanup.cjs");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");
const paymentActionTimeoutMs = Number(
  process.env.E2E_PAYMENT_ACTION_TIMEOUT_MS || (baseURL.includes("vercel.app") ? 45000 : 15000)
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cookieHeaderFromSetCookie(setCookie) {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie || ""];
  return values
    .flatMap((value) => value.split(/,(?=\s*pb_[^=]+=)/))
    .map((value) => value.split(";")[0].trim())
    .filter((value) => value.startsWith("pb_"))
    .join("; ");
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

async function createPrepaidOrder() {
  const response = await fetch(`${apiURL}/api/v1/restaurant/orders/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Payment Production E2E",
      customer_phone: "9400012355",
      customer_email: "payment-production@example.com",
      opt_in_marketing: true,
      payment_method: "prepaid",
      notes: "Browser verification payment production pass",
      items: [
        {
          name: "Margherita Pizza",
          quantity: 1,
          price: 199,
        },
      ],
    }),
  });
  const data = await response.json();
  assert(response.ok, `Could not create prepaid order: ${JSON.stringify(data)}`);
  assert(data.order_id, "Prepaid order response did not include order_id.");
  assert(data.payment_status === "awaiting_payment", `Expected awaiting_payment, got ${data.payment_status}.`);
  return data.order_id;
}

async function signInAsAdmin(context) {
  const response = await context.request.post(`${baseURL}/api/admin-session`, {
    data: { id: adminId, password: adminPassword, role: "admin" },
  });
  const data = await response.json();
  assert(response.ok(), `Admin session failed: ${JSON.stringify(data)}`);
  const cookie = cookieHeaderFromSetCookie(response.headers()["set-cookie"]);
  assert(cookie.includes("pb_admin_session="), "Admin login did not return an admin session cookie.");
  return cookie;
}

async function getPaymentProduction(context, adminCookie) {
  const response = await context.request.get(
    `${apiURL}/api/v1/restaurant/orders/payments/production-readiness`,
    { headers: { Cookie: adminCookie } }
  );
  const data = await response.json();
  assert(response.ok(), `Payment production readiness failed: ${JSON.stringify(data)}`);
  return data;
}

async function waitForPaymentProductionState(context, adminCookie, orderId, predicate, label) {
  const startedAt = Date.now();
  let latest = null;

  while (Date.now() - startedAt < paymentActionTimeoutMs) {
    latest = await getPaymentProduction(context, adminCookie);
    if (predicate(latest)) return latest;
    await sleep(1500);
  }

  const snapshot = latest
    ? {
        awaiting: latest.queues.awaiting_settlement.map((order) => order.id),
        recent_paid: latest.queues.recent_paid.map((order) => order.id),
      }
    : null;
  throw new Error(`${label} for order #${orderId}. Latest payment queue snapshot: ${JSON.stringify(snapshot)}`);
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
    issues.push(`console error: ${text}`);
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    const localRequest = url.startsWith(baseURL) || url.startsWith(apiURL);
    if (!localRequest) return;
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
  const bodyText = await page.locator("body").innerText({ timeout: 7000 });
  assert(bodyText.trim().length > 40, `${label} rendered too little content.`);
  assert(
    !/Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(bodyText),
    `${label} rendered a framework error overlay.`
  );
  const overlayCount = await page
    .locator("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")
    .count();
  assert(overlayCount === 0, `${label} has a Next.js error overlay.`);
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);
  let orderId = 0;
  let paymentReference = "";
  let adminCookie = "";
  let cleanedUp = false;

  try {
    adminCookie = await signInAsAdmin(context);
    orderId = await createPrepaidOrder();

    const productionBefore = await getPaymentProduction(context, adminCookie);
    assert(
      productionBefore.queues.awaiting_settlement.some((order) => order.id === orderId),
      `Order #${orderId} was not visible in the settlement queue.`
    );
    assert(
      productionBefore.summary.awaiting_settlement_count >= 1,
      "Settlement queue count did not include the prepaid order."
    );

    const missingProvider = productionBefore.providers.find(
      (provider) => provider.provider !== "manual" && !provider.checkout_configured
    );
    if (missingProvider) {
      const sessionResponse = await context.request.post(
        `${apiURL}/api/v1/restaurant/orders/${orderId}/payment-session`,
        {
          data: { provider: missingProvider.provider },
          headers: { Cookie: adminCookie },
        }
      );
      assert(
        sessionResponse.status() === 409,
        `Unconfigured ${missingProvider.provider} session should return 409, got ${sessionResponse.status()}.`
      );
    }

    paymentReference = `MANUAL-PROD-${Date.now()}`;
    const response = await page.goto(`${baseURL}/settings`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Settings returned HTTP ${response?.status() || "no response"}.`);
    await assertHealthyPage(page, "settings page");

    await page.getByText("Payment Gateway Readiness", { exact: false }).waitFor({ timeout: paymentActionTimeoutMs });
    await page.getByText("Payment Production Control", { exact: false }).waitFor({ timeout: paymentActionTimeoutMs });
    await page.getByText("Awaiting Settlement Queue", { exact: false }).waitFor({ timeout: paymentActionTimeoutMs });
    await page.getByRole("button", { name: new RegExp(`Load #${orderId}`) }).click();
    await page.getByPlaceholder("Payment reference").fill(paymentReference);
    await page.getByRole("button", { name: /Record Manual Paid Proof|Send Manual Paid Webhook/i }).click();
    await page.getByText(`Order #${orderId} is paid`, { exact: false }).waitFor({ timeout: paymentActionTimeoutMs });
    await page.getByText("Recent Paid Settlements", { exact: false }).waitFor({ timeout: paymentActionTimeoutMs });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-payment-production-pass.png"),
      fullPage: true,
    });
    watch.assertClean("payment production settings workflow");

    const productionAfter = await waitForPaymentProductionState(
      context,
      adminCookie,
      orderId,
      (data) =>
        !data.queues.awaiting_settlement.some((order) => order.id === orderId) &&
        data.queues.recent_paid.some((order) => order.id === orderId),
      "Paid order did not settle into the production queues"
    );
    assert(
      !productionAfter.queues.awaiting_settlement.some((order) => order.id === orderId),
      `Order #${orderId} remained in the settlement queue after paid webhook.`
    );
    assert(
      productionAfter.queues.recent_paid.some((order) => order.id === orderId),
      `Order #${orderId} was not visible in recent paid settlements.`
    );

    const orderResponse = await fetch(`${apiURL}/api/v1/restaurant/orders/${orderId}`, {
      cache: "no-store",
    });
    const order = await orderResponse.json();
    assert(orderResponse.ok, `Could not fetch paid order: ${JSON.stringify(order)}`);
    assert(order.payment_status === "paid", `Expected paid order, got ${order.payment_status}.`);
    assert(order.payment_provider === "manual", `Expected manual provider, got ${order.payment_provider}.`);
    assert(order.payment_reference === paymentReference, `Payment reference mismatch: ${order.payment_reference}.`);

    await cleanupProofOrder({
      apiURL,
      orderId,
      cookie: adminCookie,
      reason: "E2E cleanup after payment production proof",
    });
    cleanedUp = true;
  } finally {
    await browser.close();
    if (!cleanedUp && adminCookie && orderId) {
      await cleanupProofOrder({
        apiURL,
        orderId,
        cookie: adminCookie,
        reason: "Best effort cleanup after interrupted payment production proof",
        strict: false,
      });
    }
  }

  assert(orderId > 0, "No prepaid order was created for the payment production proof.");

  console.log(`Payment production pass proof completed for order #${orderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
