const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
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

function cookieHeaderFromSetCookie(setCookie) {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie || ""];
  return values
    .flatMap((value) => value.split(/,(?=\s*pb_[^=]+=)/))
    .map((value) => value.split(";")[0].trim())
    .filter((value) => value.startsWith("pb_"))
    .join("; ");
}

async function portalLogin() {
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

async function placeCustomerOrder() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);
  const phone = `93${Date.now().toString().slice(-8)}`;
  let orderId = 0;

  try {
    const response = await page.goto(`${baseURL}/order`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Order page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: "Checkout" }).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: /^Add$/i }).first().click();
    await page.getByRole("button", { name: /^Cash$/i }).click();
    await page.getByPlaceholder("Name").fill("Order Flow Proof");
    await page.getByPlaceholder("Phone").fill(phone);
    await page.getByPlaceholder("Email for receipts and offers").fill(`order-flow-${Date.now()}@example.com`);
    await page.getByRole("button", { name: /Place Order/i }).click();
    await page.getByText(/Order #\d+ confirmed/i).waitFor({ timeout: 15000 });
    await page.getByRole("link", { name: /View receipt/i }).waitFor({ timeout: 10000 });

    const bodyText = await page.locator("body").innerText();
    const match = bodyText.match(/Order #(\d+) confirmed/i);
    assert(match, `Could not find order id in customer handoff: ${bodyText.slice(0, 500)}`);
    orderId = Number(match[1]);

    const receiptHref = await page.getByRole("link", { name: /View receipt/i }).getAttribute("href");
    assert(
      receiptHref === `/receipt/${orderId}?phone=${encodeURIComponent(phone)}`,
      `Receipt handoff link was ${receiptHref}.`
    );
    await page.screenshot({
      path: path.join(artifactsDir, "visible-order-flow-receipt-handoff.png"),
      fullPage: true,
    });

    await page.getByRole("link", { name: /View receipt/i }).click();
    await page.getByRole("heading", { name: "Customer Receipt" }).waitFor({ timeout: 10000 });
    await page.getByText(`PB-ORDER-${orderId}`, { exact: false }).waitFor({ timeout: 10000 });
    watch.assertClean("customer order receipt handoff");
  } finally {
    await browser.close();
  }

  assert(orderId > 0, "Customer order id was not captured.");
  return { orderId, phone };
}

async function proveOperationsFlow(orderId) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/operations`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Operations returned HTTP ${response?.status() || "no response"}.`);
    await page.getByText("Order Flow Watch", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByText("Ready To Close", { exact: false }).first().waitFor({ timeout: 10000 });
    await page.getByText("Flow Next Actions", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByText(`Print receipt and close`, { exact: false }).first().waitFor({ timeout: 10000 });
    await page.getByTestId(`operations-order-row-${orderId}`).waitFor({ timeout: 10000 });
    await page.getByText("Received", { exact: false }).first().waitFor({ timeout: 10000 });
    await page.getByText("Ready", { exact: false }).first().waitFor({ timeout: 10000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-order-flow-polish.png"),
      fullPage: true,
    });
    watch.assertClean("operations order flow watch");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const adminCookie = await portalLogin();
  const { orderId, phone } = await placeCustomerOrder();

  const statusResult = await apiJson(`/api/v1/restaurant/orders/${orderId}/status`, adminCookie, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "ready" }),
  });
  assert(statusResult.response.ok, `Could not mark order ready: ${JSON.stringify(statusResult.data)}`);

  const flowResult = await apiJson("/api/v1/restaurant/orders/flow-readiness", adminCookie);
  assert(flowResult.response.ok, `Could not load order-flow readiness: ${JSON.stringify(flowResult.data)}`);
  const flowOrder = flowResult.data.orders.find((order) => order.id === orderId);
  assert(flowOrder, "Flow readiness did not include the customer order.");
  assert(flowOrder.stage === "ready_to_close", `Expected ready_to_close, got ${flowOrder.stage}.`);
  assert(flowOrder.ready_to_close, "Flow order was not marked ready_to_close.");
  assert(flowOrder.receipt_url === `/receipt/${orderId}`, `Flow receipt URL was ${flowOrder.receipt_url}.`);
  assert(/Print receipt and close/i.test(flowOrder.next_action), `Unexpected flow next action: ${flowOrder.next_action}`);
  assert(flowResult.data.summary.ready_to_close_count >= 1, "Ready-to-close summary did not count the order.");
  assert(flowResult.data.summary.receipt_ready_count >= 1, "Receipt-ready summary did not count the order.");

  const trackingResult = await apiJson(`/api/v1/restaurant/orders/track/${orderId}?phone=${phone}`, null);
  assert(trackingResult.response.ok, `Could not load tracking proof: ${JSON.stringify(trackingResult.data)}`);
  assert(
    trackingResult.data.tracking_steps.some((step) => step.key === "ready" && step.complete),
    "Tracking steps did not show the order as ready."
  );

  await proveOperationsFlow(orderId);
  console.log(`Order flow polish proof passed for order #${orderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
