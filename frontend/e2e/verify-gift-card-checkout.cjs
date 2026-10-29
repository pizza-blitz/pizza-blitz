/* Gift card checkout proof: issue a card, pay a real order with it, verify the balance. */
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
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`${label} did not become ready at ${url}: ${lastError}`);
}

async function api(pathname, token, options = {}) {
  const response = await fetch(`${apiURL}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function adminToken() {
  const response = await fetch(`${apiURL}/api/v1/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  });
  const data = await response.json();
  assert(response.ok, `Admin login failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function cheapestSimpleItem() {
  const response = await fetch(
    `${apiURL}/api/v1/restaurant/menu/menu-with-customizations`,
    { cache: "no-store" }
  );
  const menu = await response.json();
  assert(response.ok, `Menu fetch failed: ${JSON.stringify(menu)}`);
  const candidates = menu
    .filter((item) => item.is_available !== false)
    .filter((item) => !(item.customization_groups || []).length)
    .sort(
      (left, right) =>
        Number(left.selling_price || 0) - Number(right.selling_price || 0)
    );
  assert(candidates.length, "No simple menu item was available for the proof.");
  return candidates[0];
}


function cookieHeaderFromSetCookie(setCookie) {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie || ""];
  return values
    .flatMap((value) => value.split(/,(?=\s*pb_[^=]+=)/))
    .map((value) => value.split(";")[0].trim())
    .filter((value) => value.startsWith("pb_"))
    .join("; ");
}

async function adminPortalContext(browser) {
  const response = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  const cookie = cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
  assert(cookie.includes("pb_admin_session="), "Portal login returned no admin session.");
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1200 },
  });
  await context.addCookies(
    cookie
      .split(/;\s*/)
      .filter(Boolean)
      .map((pair) => {
        const [name, ...rest] = pair.split("=");
        return {
          name,
          value: rest.join("="),
          url: baseURL,
          httpOnly: true,
          sameSite: "Lax",
        };
      })
  );
  return context;
}

async function run() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const token = await adminToken();
  const issued = await api("/api/v1/restaurant/gift-cards", token, {
    method: "POST",
    body: JSON.stringify({
      initial_balance: 5000,
      customer_phone: "9812300000",
      note: `Gift card checkout proof ${Date.now()}`,
    }),
  });
  assert(
    issued.response.status === 201,
    `Gift card issue failed: ${JSON.stringify(issued.data)}`
  );
  const card = issued.data;
  assert(card.code && card.code.startsWith("PB-"), "Issued card has no code.");

  const item = await cheapestSimpleItem();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();
  const issues = [];
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico|images\.unsplash\.com/i.test(text)) return;
    issues.push(`console error: ${text}`);
  });

  let orderId = 0;
  let total = 0;
  try {
    const response = await page.goto(`${baseURL}/order`, {
      waitUntil: "domcontentloaded",
    });
    assert(response && response.ok(), `Order page returned ${response?.status()}.`);

    await page.getByPlaceholder("Search menu").fill(item.name);
    const addButton = page.getByTestId(`customer-add-item-${item.id}`);
    await addButton.waitFor({ timeout: 20000 });
    await addButton.click();

    await page.getByPlaceholder("Name").fill("Gift Card Proof");
    await page.getByPlaceholder("Phone").fill(
      `98${Date.now().toString().slice(-8)}`
    );

    const giftCardInput = page.getByLabel("Gift card code");
    await giftCardInput.fill(card.code);
    await giftCardInput
      .locator("xpath=..")
      .getByRole("button", { name: "Apply", exact: true })
      .click();
    await page
      .getByText(/This card covers the order/i)
      .waitFor({ timeout: 15000 });
    await page
      .getByText(/will be deducted/i)
      .waitFor({ timeout: 15000 });

    const placeOrder = page.getByTestId("customer-place-order");
    await placeOrder.waitFor({ timeout: 15000 });
    await placeOrder.click();

    const success = page.getByText(
      /Paid with gift card\. Remaining balance Rs/i
    );
    await success.waitFor({ timeout: 30000 });
    const message = await success.innerText();
    const match = message.match(/Order #(\d+)/);
    assert(match, `Could not read the order number from: ${message}`);
    orderId = Number(match[1]);
    const remaining = Number(
      message.match(/Remaining balance Rs\s*(\d+(?:\.\d+)?)/)[1]
    );

    await page.screenshot({
      path: path.join(artifactsDir, "gift-card-checkout.png"),
      fullPage: false,
    });

    const order = await api(`/api/v1/restaurant/orders/${orderId}`, token);
    assert(order.response.ok, `Order lookup failed: ${JSON.stringify(order.data)}`);
    total = Number(order.data.total || order.data.total_amount || 0);
    assert(
      order.data.payment_method === "gift_card",
      `Order payment method was ${order.data.payment_method}.`
    );
    assert(
      order.data.payment_status === "paid",
      `Order payment status was ${order.data.payment_status}.`
    );
    assert(total > 0, "Order total was not positive.");

    const cards = await api(
      `/api/v1/restaurant/gift-cards?query=${encodeURIComponent(card.code)}`,
      token
    );
    assert(cards.response.ok, `Gift card lookup failed: ${JSON.stringify(cards.data)}`);
    const stored = cards.data.items.find((row) => row.code === card.code);
    assert(stored, "Issued gift card was not listed.");
    assert(
      Math.abs(Number(stored.balance) - (5000 - total)) < 0.01,
      `Card balance ${stored.balance} does not match 5000 - ${total}.`
    );
    assert(
      Math.abs(remaining - Number(stored.balance)) < 0.01,
      `Success message balance ${remaining} does not match stored ${stored.balance}.`
    );

    const adminBrowser = await chromium.launch({ headless: true });
    const adminContext = await adminPortalContext(adminBrowser);
    try {
      const adminPage = await adminContext.newPage();
      await adminPage.goto(`${baseURL}/orders`, { waitUntil: "domcontentloaded" });
      const refundButton = adminPage.getByTestId(`counter-refund-${orderId}`);
      await refundButton.waitFor({ timeout: 30000 });
      await refundButton.click();
      const method = adminPage.getByTestId("refund-method");
      await method.waitFor({ timeout: 15000 });
      assert(
        (await method.inputValue()) === "gift_card",
        "Gift card orders should default the refund method to gift_card."
      );
      await adminPage.getByTestId("refund-amount").fill("10");
      await adminPage
        .getByTestId("refund-reason")
        .fill("Gift card refund browser proof");
      await adminPage.getByTestId("refund-submit").click();
      await adminPage
        .getByText(`Refund of Rs 10.00 recorded for order #${orderId}.`)
        .waitFor({ timeout: 30000 });

      const refundedOrder = await api(`/api/v1/restaurant/orders/${orderId}`, token);
      assert(refundedOrder.response.ok, "Refunded order lookup failed.");
      assert(
        Math.abs(Number(refundedOrder.data.refunded_amount || 0) - 10) < 0.01,
        `Refunded amount was ${refundedOrder.data.refunded_amount}.`
      );
      const refreshed = await api(
        `/api/v1/restaurant/gift-cards?query=${encodeURIComponent(card.code)}`,
        token
      );
      const refreshedCard = refreshed.data.items.find((row) => row.code === card.code);
      assert(
        Math.abs(Number(refreshedCard.balance) - (Number(stored.balance) + 10)) < 0.01,
        `Card balance after refund was ${refreshedCard.balance}.`
      );
      await adminPage.screenshot({
        path: path.join(artifactsDir, "gift-card-refund.png"),
        fullPage: false,
      });
    } finally {
      await adminBrowser.close();
    }
    assert(!issues.length, `Browser issues: ${issues.join("\n")}`);
  } finally {
    await browser.close();
  }
  console.log(
    `Gift card checkout proof passed: order #${orderId} paid Rs ${total.toFixed(
      2
    )} from ${card.code}.`
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
