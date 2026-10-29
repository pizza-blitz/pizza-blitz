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

async function chooseMenuItem() {
  const response = await fetch(`${apiURL}/api/v1/restaurant/menu/menu-with-customizations`, {
    cache: "no-store",
  });
  const menu = await response.json();
  assert(response.ok, `Could not fetch menu: ${JSON.stringify(menu)}`);
  const item = menu.filter((menuItem) => menuItem.is_available)[0];
  assert(item, "No available menu item was found for void proof.");
  return item;
}

async function createVoidableOrder() {
  const item = await chooseMenuItem();
  const result = await apiJson("/api/v1/restaurant/orders/", null, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Void E2E Proof",
      customer_phone: `95${Date.now().toString().slice(-8)}`,
      payment_method: "cash",
      notes: "Void order E2E proof",
      items: [
        {
          menu_item_id: item.id,
          name: item.name,
          quantity: 1,
          price: Number(item.selling_price || 0),
        },
      ],
    }),
  });
  assert(result.response.ok, `Could not create void proof order: ${JSON.stringify(result.data)}`);
  assert(result.data.order_id, "Void proof order response did not include order_id.");
  return result.data.order_id;
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const adminCookie = await portalLogin();
  const orderId = await createVoidableOrder();

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

    let response = await page.goto(`${baseURL}/operations`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Operations returned HTTP ${response?.status() || "no response"}.`);
    const voidButton = page.getByTestId(`operations-void-card-${orderId}`);
    await voidButton.waitFor({ state: "attached", timeout: 60000 });
    await voidButton.scrollIntoViewIfNeeded();

    page.once("dialog", async (dialog) => {
      assert(dialog.type() === "prompt", `Expected prompt, got ${dialog.type()}.`);
      await dialog.accept("E2E void safety proof");
    });
    await voidButton.click();
    await page.getByText(`Order #${orderId} voided. No sales or inventory posted.`, { exact: false }).waitFor({ timeout: 15000 });

    response = await page.goto(`${baseURL}/orders`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Counter POS returned HTTP ${response?.status() || "no response"}.`);
    await page.getByTestId(`counter-order-card-${orderId}`).waitFor({ timeout: 15000 });
    await page.getByTestId(`counter-order-status-${orderId}`).getByText("cancelled", { exact: true }).waitFor({ timeout: 10000 });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-order-void-flow.png"),
      fullPage: true,
    });
    watch.assertClean("order void browser proof");
  } finally {
    await browser.close();
  }

  const orderResult = await apiJson(`/api/v1/restaurant/orders/${orderId}`, adminCookie);
  assert(orderResult.response.ok, `Could not fetch voided order: ${JSON.stringify(orderResult.data)}`);
  assert(orderResult.data.status === "cancelled", `Expected cancelled, got ${orderResult.data.status}.`);
  assert(orderResult.data.payment_status === "voided", `Expected voided payment, got ${orderResult.data.payment_status}.`);
  assert(/E2E void safety proof/i.test(orderResult.data.notes || ""), "Cancellation reason was not preserved.");

  const closeResult = await apiJson(`/api/v1/restaurant/orders/${orderId}/close?payment_method=cash`, adminCookie, {
    method: "PATCH",
  });
  assert(closeResult.response.status === 409, `Voided order close returned ${closeResult.response.status}.`);
  assert(/cannot be closed/i.test(closeResult.data.detail || ""), `Unexpected close rejection: ${JSON.stringify(closeResult.data)}`);

  const flowResult = await apiJson("/api/v1/restaurant/orders/flow-readiness", adminCookie);
  assert(flowResult.response.ok, `Could not load flow readiness: ${JSON.stringify(flowResult.data)}`);
  const flowOrder = flowResult.data.orders.find((order) => order.id === orderId);
  assert(flowOrder?.stage === "cancelled", `Expected cancelled flow stage, got ${flowOrder?.stage}.`);
  assert(
    !flowResult.data.ready_to_close.some((order) => order.id === orderId),
    "Voided order appeared as ready to close."
  );

  console.log(`Order void flow proof passed for order #${orderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
