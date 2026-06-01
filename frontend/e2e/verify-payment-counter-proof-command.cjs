const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
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

async function createCounterUpiOrder() {
  const response = await fetch(`${apiURL}/api/v1/restaurant/orders/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Counter Proof Command",
      customer_phone: "9400077123",
      payment_method: "upi",
      notes: "E2E counter proof command",
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

async function getPaymentProduction(context, adminCookie) {
  const response = await context.request.get(
    `${apiURL}/api/v1/restaurant/orders/payments/production-readiness`,
    { headers: { Cookie: adminCookie } }
  );
  const data = await response.json();
  assert(response.ok(), `Payment production readiness failed: ${JSON.stringify(data)}`);
  return data;
}

function createBrowserWatch(page) {
  const issues = [];
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico|images\.unsplash\.com/i.test(text)) return;
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
    viewport: { width: 1440, height: 1120 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);
  const paymentReference = `UPI-COMMAND-${Date.now()}`;
  let orderId = 0;

  try {
    const adminCookie = await signInAsAdmin(context);
    orderId = await createCounterUpiOrder();

    const readyResponse = await context.request.patch(
      `${apiURL}/api/v1/restaurant/orders/${orderId}/status`,
      {
        data: { status: "ready" },
        headers: { Cookie: adminCookie },
      }
    );
    const readyData = await readyResponse.json();
    assert(readyResponse.ok(), `Could not mark order ready: ${JSON.stringify(readyData)}`);
    assert(readyData.payment_proof_required === true, "UPI order should require payment proof.");

    const productionBefore = await getPaymentProduction(context, adminCookie);
    assert(
      productionBefore.summary.payment_proof_required_count >= 1,
      "Counter proof count did not include the UPI order."
    );
    assert(
      productionBefore.queues.payment_proof_required.some((order) => order.id === orderId),
      `Order #${orderId} was not visible in the counter proof queue.`
    );

    const response = await page.goto(`${baseURL}/settings`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Settings returned HTTP ${response?.status() || "no response"}.`);
    await assertHealthyPage(page, "settings payment proof command page");
    await page.getByText("Payment Production Control", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByText("Counter Proof Queue", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByTestId(`payment-counter-proof-order-${orderId}`).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: new RegExp(`Load Proof #${orderId}`) }).click();
    await page.getByTestId("staff-settlement-reference").fill(paymentReference);
    await page.getByRole("button", { name: /Record Direct Bank Paid Proof/i }).click();
    await page.getByText(`Order #${orderId} marked paid`, { exact: false }).waitFor({ timeout: 10000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-payment-counter-proof-command.png"),
      fullPage: true,
    });
    watch.assertClean("payment counter proof command workflow");

    const productionAfter = await getPaymentProduction(context, adminCookie);
    assert(
      !productionAfter.queues.payment_proof_required.some((order) => order.id === orderId),
      `Order #${orderId} remained in the counter proof queue after proof.`
    );

    const orderResponse = await fetch(`${apiURL}/api/v1/restaurant/orders/${orderId}`, {
      cache: "no-store",
    });
    const order = await orderResponse.json();
    assert(orderResponse.ok, `Could not fetch proofed order: ${JSON.stringify(order)}`);
    assert(order.payment_status === "paid", `Expected paid status, got ${order.payment_status}.`);
    assert(order.payment_method === "upi", `Expected UPI method to be preserved, got ${order.payment_method}.`);
    assert(order.payment_reference === paymentReference, `Payment reference mismatch: ${order.payment_reference}.`);
  } finally {
    await browser.close();
  }

  assert(orderId > 0, "No UPI order was created for the counter proof command.");
  console.log(`Payment counter proof command passed for order #${orderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
