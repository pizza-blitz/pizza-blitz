/* Tips proof: API capture -> tracking/receipt -> customer checkout presets -> counter total. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
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

function cookieHeaderFromSetCookie(setCookie) {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie || ""];
  return values
    .flatMap((value) => value.split(/,(?=\s*pb_[^=]+=)/))
    .map((value) => value.split(";")[0].trim())
    .filter((value) => value.startsWith("pb_"))
    .join("; ");
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const phone = `96${String(Date.now()).slice(-8)}`;
  const orderResponse = await fetch(`${apiURL}/api/v1/restaurant/orders/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Tip Proof Guest",
      customer_phone: phone,
      payment_method: "cash",
      tip_amount: 50,
      items: [{ name: "Garlic Bread", quantity: 2, price: 119 }],
    }),
  });
  const order = await orderResponse.json();
  assert(orderResponse.ok, `Tip order failed: ${JSON.stringify(order)}`);
  assert(order.tip_amount === 50, `API tip was ${order.tip_amount}.`);

  const browser = await chromium.launch({ headless: true });
  try {
    const customer = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const trackPage = await customer.newPage();
    await trackPage.goto(
      `${baseURL}/track?order=${order.order_id}&phone=${encodeURIComponent(phone)}`,
      { waitUntil: "networkidle" }
    );
    await trackPage.getByText("Tip", { exact: true }).waitFor({ timeout: 20000 });
    const trackText = await trackPage.getByText("Rs 50", { exact: true }).first().innerText();
    assert(trackText.includes("50"), "Tracking did not show the tip amount.");
    await trackPage.screenshot({
      path: path.join(artifactsDir, "visible-tips-tracking.png"),
      fullPage: false,
    });

    const receiptPage = await customer.newPage();
    await receiptPage.goto(
      `${baseURL}/receipt/${order.order_id}?phone=${encodeURIComponent(phone)}`,
      { waitUntil: "networkidle" }
    );
    await receiptPage.getByText("Tip", { exact: true }).waitFor({ timeout: 20000 });
    await receiptPage.screenshot({
      path: path.join(artifactsDir, "visible-tips-receipt.png"),
      fullPage: false,
    });

    const orderPage = await customer.newPage();
    await orderPage.goto(`${baseURL}/order`, { waitUntil: "networkidle" });
    await orderPage.getByRole("button", { name: /Add/i }).first().waitFor({ timeout: 20000 });
    await orderPage.getByRole("button", { name: /Add/i }).first().click();
    await orderPage.getByTestId("customer-tip").waitFor({ timeout: 15000 });
    await orderPage.getByRole("button", { name: "10%", exact: true }).click();
    const tipText = (await orderPage.getByTestId("customer-tip-amount").innerText()).trim();
    const tipValue = Number(tipText.replace(/[^\d.]/g, ""));
    assert(tipValue > 0, `Customer tip amount was "${tipText}".`);
    const totalsText = (await orderPage.locator("#checkout").innerText()).toLowerCase();
    assert(totalsText.includes("tip"), "Checkout totals did not include a tip row.");
    await orderPage.screenshot({
      path: path.join(artifactsDir, "visible-tips-checkout.png"),
      fullPage: false,
    });
    await customer.close();

    const adminLogin = await fetch(`${baseURL}/api/admin-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
    });
    assert(adminLogin.ok, `Admin login failed: ${await adminLogin.text()}`);
    const cookie = cookieHeaderFromSetCookie(adminLogin.headers.get("set-cookie"));
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await adminContext.addCookies(
      cookie
        .split(/;\s*/)
        .filter(Boolean)
        .map((pair) => {
          const [name, ...rest] = pair.split("=");
          return { name, value: rest.join("="), url: baseURL, httpOnly: true, sameSite: "Lax" };
        })
    );
    const ordersPage = await adminContext.newPage();
    await ordersPage.goto(`${baseURL}/orders`, { waitUntil: "domcontentloaded" });
    const tipsTile = ordersPage.getByTestId("counter-tips-today");
    await tipsTile.waitFor({ timeout: 25000 });
    const tipsTileText = (await tipsTile.innerText()).trim();
    assert(/Rs\s*[\d,]+/.test(tipsTileText), `Tips tile read "${tipsTileText}".`);

    const tipBadge = ordersPage.getByTestId(`counter-order-tip-${order.order_id}`);
    await tipBadge.waitFor({ timeout: 20000 });
    await tipBadge.scrollIntoViewIfNeeded();
    await ordersPage.screenshot({
      path: path.join(artifactsDir, "visible-tips-counter.png"),
      fullPage: false,
    });
    await adminContext.close();

    console.log("Order tips proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
