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

async function portalLoginCookie() {
  const response = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  const data = await response.json().catch(() => ({}));
  assert(response.ok, `Admin portal login failed: ${JSON.stringify(data)}`);
  const cookie = cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
  assert(cookie.includes("pb_admin_session="), "Admin login did not return an admin session cookie.");
  return cookie;
}

async function apiJson(endpoint, cookie, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function createUpiOrder() {
  const response = await fetch(`${apiURL}/api/v1/restaurant/orders/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Payment Proof Counter",
      customer_phone: "9400098765",
      payment_method: "upi",
      notes: "E2E payment proof before close",
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
  assert(response.ok, `Could not create UPI order: ${JSON.stringify(data)}`);
  assert(data.order_id, "UPI order response did not include order_id.");
  return data.order_id;
}

function createBrowserWatch(page) {
  const issues = [];
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
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

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const adminCookie = await portalLoginCookie();
  const orderId = await createUpiOrder();
  const paymentReference = `UPI-E2E-${Date.now()}`;

  const readyResult = await apiJson(`/api/v1/restaurant/orders/${orderId}/status`, adminCookie, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "ready" }),
  });
  assert(readyResult.response.ok, `Could not mark UPI order ready: ${JSON.stringify(readyResult.data)}`);
  assert(
    readyResult.data.payment_proof_required === true,
    `Ready UPI order should require payment proof: ${JSON.stringify(readyResult.data)}`
  );
  assert(
    readyResult.data.close_blockers?.includes("payment proof required"),
    `Ready UPI order did not expose payment proof close blocker: ${JSON.stringify(readyResult.data)}`
  );

  const blockedClose = await apiJson(`/api/v1/restaurant/orders/${orderId}/close?payment_method=upi`, adminCookie, {
    method: "PATCH",
  });
  assert(blockedClose.response.status === 409, `UPI close before proof returned ${blockedClose.response.status}.`);
  assert(/payment proof required/i.test(blockedClose.data.detail || ""), `Unexpected close blocker: ${JSON.stringify(blockedClose.data)}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1150 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/orders`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Counter POS returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: "Counter POS" }).waitFor({ timeout: 15000 });
    await page.getByTestId(`counter-ready-order-${orderId}`).waitFor({ timeout: 15000 });
    await page.getByTestId(`counter-ready-payment-proof-${orderId}`).waitFor({ timeout: 15000 });
    assert(
      await page.getByTestId(`counter-ready-close-${orderId}`).isDisabled(),
      "UPI ready order close button should be disabled before payment proof."
    );

    await page.getByTestId(`counter-ready-payment-reference-${orderId}`).fill(paymentReference);
    await page.getByTestId(`counter-ready-confirm-payment-${orderId}`).click();
    await page.getByTestId("counter-pos-message").getByText(/Payment confirmed/i).waitFor({ timeout: 15000 });
    await page.waitForFunction(
      (id) => {
        const button = document.querySelector(`[data-testid="counter-ready-close-${id}"]`);
        return button && !button.disabled;
      },
      orderId,
      { timeout: 15000 }
    );

    await page.screenshot({
      path: path.join(artifactsDir, "visible-counter-payment-proof-confirmed.png"),
      fullPage: true,
    });

    const paidOrder = await apiJson(`/api/v1/restaurant/orders/${orderId}`, adminCookie);
    assert(paidOrder.response.ok, `Could not fetch paid UPI order: ${JSON.stringify(paidOrder.data)}`);
    assert(paidOrder.data.payment_status === "paid", `Expected paid status, got ${paidOrder.data.payment_status}.`);
    assert(paidOrder.data.payment_method === "upi", `Expected UPI method to be preserved, got ${paidOrder.data.payment_method}.`);
    assert(
      paidOrder.data.payment_reference === paymentReference,
      `Payment reference mismatch: ${paidOrder.data.payment_reference}.`
    );

    await page.getByTestId(`counter-ready-close-${orderId}`).click();
    await page.getByTestId("counter-pos-message").getByText(/closed/i).waitFor({ timeout: 15000 });

    const closedOrder = await apiJson(`/api/v1/restaurant/orders/${orderId}`, adminCookie);
    assert(closedOrder.response.ok, `Could not fetch closed UPI order: ${JSON.stringify(closedOrder.data)}`);
    assert(closedOrder.data.status === "closed", `Expected closed status, got ${closedOrder.data.status}.`);
    assert(closedOrder.data.payment_status === "paid", `Expected paid status after close, got ${closedOrder.data.payment_status}.`);
    assert(closedOrder.data.payment_reference === paymentReference, "Closed order lost the payment reference.");

    watch.assertClean("counter payment proof close workflow");
  } finally {
    await browser.close();
  }

  console.log(`Counter payment proof close workflow passed for order #${orderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
