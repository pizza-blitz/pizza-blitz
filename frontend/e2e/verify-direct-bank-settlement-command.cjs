const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL =
  process.env.E2E_API_URL ||
  (/localhost|127\.0\.0\.1/.test(baseURL) ? "http://127.0.0.1:8010" : `${baseURL}/server`);
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function createPrepaidOrder() {
  const response = await fetch(`${apiURL}/api/v1/restaurant/orders/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Direct Bank Settlement Proof",
      customer_phone: "9400098765",
      customer_email: "direct-bank-proof@example.com",
      opt_in_marketing: true,
      payment_method: "prepaid",
      notes: "Direct bank settlement command verification",
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
  assert(
    data.payment_status === "awaiting_payment",
    `Expected awaiting_payment, got ${data.payment_status}.`
  );
  return data.order_id;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const reference = `BANK-E2E-${Date.now()}`;
  let orderId = 0;

  try {
    orderId = await createPrepaidOrder();
    const sessionResponse = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    const sessionData = await sessionResponse.json().catch(() => ({}));
    assert(sessionResponse.ok(), `Admin session failed: ${JSON.stringify(sessionData)}`);

    await page.goto(`${baseURL}/settings`, { waitUntil: "domcontentloaded" });
    const tester = page.getByTestId("staff-settlement-tester");
    await page.getByText("Staff Settlement Tester", { exact: false }).waitFor({ timeout: 60000 });
    await tester.waitFor({ timeout: 60000 });
    await page.getByTestId("staff-settlement-provider-direct_bank").click();
    await page.getByTestId("staff-settlement-order-id").fill(String(orderId));
    await page.getByTestId("staff-settlement-reference").fill(reference);
    await page.getByTestId("staff-settlement-send").click();
    await page.getByText(`Order #${orderId} marked paid through Direct Bank / UPI proof.`, {
      exact: false,
    }).waitFor({ timeout: 20000 });
    await page.getByTestId("payment-event-audit").getByText(reference, { exact: false }).waitFor({
      timeout: 20000,
    });
    await page.getByTestId("payment-event-audit").getByText("direct_bank", { exact: false }).first().waitFor({
      timeout: 20000,
    });

    const orderResponse = await fetch(`${apiURL}/api/v1/restaurant/orders/${orderId}`, {
      cache: "no-store",
    });
    const order = await orderResponse.json();
    assert(orderResponse.ok, `Could not fetch settled order: ${JSON.stringify(order)}`);
    assert(order.payment_status === "paid", `Expected paid order, got ${order.payment_status}.`);
    assert(order.payment_provider === "direct_bank", `Expected direct_bank, got ${order.payment_provider}.`);
    assert(order.payment_reference === reference, `Payment reference mismatch: ${order.payment_reference}.`);

    console.log(`direct-bank-settlement-command verification passed for order #${orderId}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
