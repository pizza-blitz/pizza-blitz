/* Customer OTP proof: request -> code -> session -> account page. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
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

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const phone = `93${String(Date.now()).slice(-8)}`;
  const created = await fetch(`${apiURL}/api/v1/restaurant/orders/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "OTP Proof Guest",
      customer_phone: phone,
      payment_method: "cash",
      items: [{ name: "Garlic Bread", quantity: 1, price: 119 }],
    }),
  });
  const order = await created.json();
  assert(created.ok, `Could not create order: ${JSON.stringify(order)}`);
  const orderId = order.order_id;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${baseURL}/account/login`, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="customer-login"][data-hydrated="true"]')
      .waitFor({ timeout: 20000 });

    await page.getByLabel("Phone number").fill(phone);
    await page.getByRole("button", { name: "Send verification code" }).click();
    const debug = page.getByTestId("customer-otp-debug");
    await debug.waitFor({ timeout: 20000 });
    const debugText = (await debug.innerText()).trim();
    const codeMatch = debugText.match(/\d{6}/);
    assert(codeMatch, `No 6-digit development code in "${debugText}".`);

    await page.getByLabel("Verification code").fill(codeMatch[0]);
    await page.screenshot({
      path: path.join(artifactsDir, "visible-customer-otp-login.png"),
      fullPage: false,
    });
    await page.getByRole("button", { name: "Verify and sign in" }).click();
    await page.waitForURL("**/account", { timeout: 25000 });
    await page.getByRole("heading", { name: "My Orders" }).waitFor({ timeout: 20000 });
    await page.getByText(`Order #${orderId}`, { exact: false }).first().waitFor({ timeout: 20000 });

    const cookies = await context.cookies();
    assert(
      cookies.some((cookie) => cookie.name === "pb_customer_session"),
      "Customer session cookie was not set."
    );

    await page.screenshot({
      path: path.join(artifactsDir, "visible-customer-otp-account.png"),
      fullPage: false,
    });

    // A phone-only backend login must not mint a token.
    const insecure = await fetch(`${apiURL}/api/v1/auth/customer/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    assert(!insecure.ok, "Phone-only customer login unexpectedly succeeded.");

    console.log("Customer OTP proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
