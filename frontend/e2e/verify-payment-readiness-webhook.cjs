const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");
const { cleanupProofOrder } = require("./helpers/order-cleanup.cjs");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
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
      if (response.ok) return;
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
      customer_name: "Payment Readiness Proof",
      customer_phone: "9400012345",
      customer_email: "payment-proof@example.com",
      opt_in_marketing: true,
      payment_method: "prepaid",
      notes: "Browser verification payment webhook",
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

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);
  let orderId = 0;
  let paymentReference = "";
  let reconciliationEvent = null;
  let adminCookie = "";
  let cleanedUp = false;

  try {
    adminCookie = await signInAsAdmin(context);
    orderId = await createPrepaidOrder();
    paymentReference = `MANUAL-E2E-${Date.now()}`;
    const response = await page.goto(`${baseURL}/settings`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Settings returned HTTP ${response?.status() || "no response"}.`);
    await assertHealthyPage(page, "settings page");

    await page.getByText("Payment Gateway Readiness", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByText("Payment Reconciliation Ledger", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByText("Staff Settlement Tester", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByTestId("staff-settlement-provider-manual").click();
    await page.getByTestId("staff-settlement-order-id").fill(String(orderId));
    await page.getByTestId("staff-settlement-reference").fill(paymentReference);
    await page.getByTestId("staff-settlement-send").click();
    await page.getByText(`Order #${orderId} is paid`, { exact: false }).waitFor({ timeout: paymentActionTimeoutMs });
    const auditLedger = page.getByTestId("payment-event-audit");
    await auditLedger.getByText(paymentReference, { exact: false }).first().waitFor({ timeout: paymentActionTimeoutMs });
    await auditLedger.getByText("processed", { exact: false }).first().waitFor({ timeout: paymentActionTimeoutMs });

    await page.getByTestId("staff-settlement-send").click();
    await page
      .getByText(/Settlement proof received with status: duplicate|was already paid/i, { exact: false })
      .waitFor({ timeout: paymentActionTimeoutMs });
    await auditLedger.getByText("Duplicate 1", { exact: false }).first().waitFor({ timeout: paymentActionTimeoutMs });

    const reconciliationResponse = await context.request.get(
      `${apiURL}/api/v1/restaurant/orders/payments/reconciliation`,
      { headers: { Cookie: adminCookie } }
    );
    const reconciliationData = await reconciliationResponse.json();
    assert(
      reconciliationResponse.ok(),
      `Could not fetch payment reconciliation: ${JSON.stringify(reconciliationData)}`
    );
    reconciliationEvent = reconciliationData.recent_events.find(
      (event) => event.provider_payment_id === paymentReference
    );
    assert(reconciliationEvent, `Payment audit did not include reference ${paymentReference}.`);
    assert(
      reconciliationEvent.action === "processed",
      `Expected processed audit action, got ${reconciliationEvent.action}.`
    );
    assert(
      reconciliationEvent.duplicate_count >= 1,
      `Expected duplicate delivery count >= 1, got ${reconciliationEvent.duplicate_count}.`
    );

    await page.screenshot({
      path: path.join(artifactsDir, "visible-payment-readiness-webhook.png"),
      fullPage: true,
    });
    watch.assertClean("payment readiness settings workflow");

    const orderResponse = await fetch(`${apiURL}/api/v1/restaurant/orders/${orderId}`, {
      cache: "no-store",
      headers: { Cookie: adminCookie },
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
      reason: "E2E cleanup after payment readiness webhook proof",
    });
    cleanedUp = true;
  } finally {
    await browser.close();
    if (!cleanedUp && adminCookie && orderId) {
      await cleanupProofOrder({
        apiURL,
        orderId,
        cookie: adminCookie,
        reason: "Best effort cleanup after interrupted payment readiness proof",
        strict: false,
      });
    }
  }

  assert(orderId > 0, "No prepaid order was created for the payment proof.");
  assert(reconciliationEvent, "No payment reconciliation event was captured.");

  console.log(`Payment readiness webhook proof passed for order #${orderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
