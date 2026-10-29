/* Refund proof: paid order -> POS refund dialog -> ledger + badge. */
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

async function api(token, endpoint, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const login = await fetch(`${apiURL}/api/v1/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  });
  if (!login.ok) throw new Error(`Admin API login failed: ${await login.text()}`);
  const token = (await login.json()).access_token;

  const phone = `95${String(Date.now()).slice(-8)}`;
  const created = await api(token, "/api/v1/restaurant/orders/", {
    method: "POST",
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Refund Proof Guest",
      customer_phone: phone,
      payment_method: "cash",
      items: [{ name: "Garlic Bread", quantity: 2, price: 119 }],
    }),
  });
  assert(created.response.ok, `Could not create order: ${JSON.stringify(created.data)}`);
  const orderId = created.data.order_id;

  for (const status of ["preparing", "ready"]) {
    const moved = await api(token, `/api/v1/restaurant/orders/${orderId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    assert(moved.response.ok, `Could not move order to ${status}: ${JSON.stringify(moved.data)}`);
  }
  const closed = await api(
    token,
    `/api/v1/restaurant/orders/${orderId}/close?payment_method=cash`,
    { method: "PATCH" }
  );
  assert(closed.response.ok, `Could not close order: ${JSON.stringify(closed.data)}`);

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(portalLogin.ok, `Portal login failed: ${await portalLogin.text()}`);
  const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies(
      cookie
        .split(/;\s*/)
        .filter(Boolean)
        .map((pair) => {
          const [name, ...rest] = pair.split("=");
          return { name, value: rest.join("="), url: baseURL, httpOnly: true, sameSite: "Lax" };
        })
    );
    const page = await context.newPage();
    await page.goto(`${baseURL}/orders`, { waitUntil: "domcontentloaded" });

    const refundButton = page.getByTestId(`counter-refund-${orderId}`);
    await refundButton.waitFor({ timeout: 25000 });
    await refundButton.scrollIntoViewIfNeeded();
    await refundButton.click();

    await page.getByTestId("refund-amount").fill("25");
    await page.getByTestId("refund-reason").fill("Proof: cold pizza on arrival");
    await page.getByTestId("refund-method").selectOption("upi");
    await page.getByLabel("Refund reference").fill("UPI-PROOF-25");
    await page.screenshot({
      path: path.join(artifactsDir, "visible-refund-dialog.png"),
      fullPage: false,
    });
    await page.getByTestId("refund-submit").click();

    const badge = page.getByTestId(`counter-order-refunded-${orderId}`);
    await badge.waitFor({ timeout: 20000 });
    const badgeText = (await badge.innerText()).trim();
    assert(/Refunded Rs 25/.test(badgeText), `Refund badge read "${badgeText}".`);
    await badge.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactsDir, "visible-refund-counter.png"),
      fullPage: false,
    });

    const ledger = await api(token, `/api/v1/restaurant/orders/${orderId}/refunds`);
    assert(ledger.response.ok, `Ledger read failed: ${JSON.stringify(ledger.data)}`);
    assert(ledger.data.refunds.length === 1, `Ledger had ${ledger.data.refunds.length} refunds.`);
    assert(ledger.data.refunds[0].amount === 25, "Ledger amount was wrong.");
    assert(ledger.data.refunds[0].method === "upi", "Ledger method was wrong.");
    assert(ledger.data.refunds[0].reference === "UPI-PROOF-25", "Ledger reference was wrong.");
    assert(ledger.data.refunded_amount === 25, "Order refunded amount was wrong.");
    assert(ledger.data.payment_status === "partially_refunded", "Payment status did not update.");

    const summary = await api(token, "/api/v1/restaurant/orders/refunds/summary?days=1");
    assert(summary.response.ok, "Refund summary failed.");
    assert(summary.data.refunds_total >= 25, "Refund summary did not include the refund.");

    console.log("Order refund proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
