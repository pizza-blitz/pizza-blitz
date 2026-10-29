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

async function createOrder({ name, phone, paymentMethod, price }) {
  const response = await fetch(`${apiURL}/api/v1/restaurant/orders/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: name,
      customer_phone: phone,
      payment_method: paymentMethod,
      notes: "E2E cash drawer command",
      items: [
        {
          name: "Margherita Pizza",
          quantity: 1,
          price,
        },
      ],
    }),
  });
  const data = await response.json();
  assert(response.ok, `Could not create ${paymentMethod} order: ${JSON.stringify(data)}`);
  assert(data.order_id, `${paymentMethod} order response did not include order_id.`);
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

async function closeOrderFlow(orderId, cookie, paymentMethod) {
  const ready = await apiJson(`/api/v1/restaurant/orders/${orderId}/status`, cookie, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "ready" }),
  });
  assert(ready.response.ok, `Could not ready order #${orderId}: ${JSON.stringify(ready.data)}`);

  if (paymentMethod === "upi") {
    const paymentReference = `UPI-DRAWER-${Date.now()}`;
    const paid = await apiJson(`/api/v1/restaurant/orders/${orderId}/payment-confirmation`, cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payment_provider: "direct_bank",
        payment_reference: paymentReference,
      }),
    });
    assert(paid.response.ok, `Could not confirm UPI payment #${orderId}: ${JSON.stringify(paid.data)}`);
  }

  const closed = await apiJson(
    `/api/v1/restaurant/orders/${orderId}/close?payment_method=${paymentMethod}`,
    cookie,
    { method: "PATCH" }
  );
  assert(closed.response.ok, `Could not close order #${orderId}: ${JSON.stringify(closed.data)}`);
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const adminCookie = await portalLoginCookie();
  const cashOrderId = await createOrder({
    name: "Drawer Cash Guest",
    phone: "9400012301",
    paymentMethod: "cash",
    price: 149,
  });
  const upiOrderId = await createOrder({
    name: "Drawer UPI Guest",
    phone: "9400012302",
    paymentMethod: "upi",
    price: 199,
  });

  await closeOrderFlow(cashOrderId, adminCookie, "cash");
  await closeOrderFlow(upiOrderId, adminCookie, "upi");

  const commandBefore = await apiJson("/api/v1/restaurant/orders/cash-drawer/command", adminCookie);
  assert(commandBefore.response.ok, `Cash drawer command failed: ${JSON.stringify(commandBefore.data)}`);
  assert(
    commandBefore.data.summary.closed_paid_order_count >= 2,
    `Expected at least two closed paid orders: ${JSON.stringify(commandBefore.data.summary)}`
  );
  assert(
    commandBefore.data.recent_closed_orders.some((order) => order.id === cashOrderId),
    `Cash order #${cashOrderId} was not in recent drawer orders.`
  );
  assert(
    commandBefore.data.recent_closed_orders.some((order) => order.id === upiOrderId),
    `UPI order #${upiOrderId} was not in recent drawer orders.`
  );

  const expected = Object.fromEntries(
    commandBefore.data.method_totals.map((row) => [row.method, String(row.expected_amount)])
  );

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

    const response = await page.goto(`${baseURL}/settings`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Settings returned HTTP ${response?.status() || "no response"}.`);
    await assertHealthyPage(page, "cash drawer command page");
    await page.getByText("Cash Drawer / Shift Close", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByTestId("cash-drawer-command").waitFor({ timeout: 15000 });

    await page.getByTestId("cash-drawer-counted-cash").fill(expected.cash || "0");
    await page.getByTestId("cash-drawer-counted-upi").fill(expected.upi || "0");
    await page.getByTestId("cash-drawer-counted-card").fill(expected.card || "0");
    await page.getByTestId("cash-drawer-counted-mixed").fill(expected.mixed || "0");
    await page.getByTestId("cash-drawer-counted-prepaid").fill(expected.prepaid || "0");
    await page.getByTestId("cash-drawer-counted-other").fill(expected.other || "0");
    await page.getByTestId("cash-drawer-closed-by").fill("E2E Manager");
    await page.getByTestId("cash-drawer-notes").fill("E2E drawer close proof");
    await page.getByTestId("cash-drawer-close").click();
    await page.getByTestId("cash-drawer-close-result").waitFor({ timeout: 15000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-cash-drawer-command.png"),
      fullPage: true,
    });
    watch.assertClean("cash drawer command workflow");
  } finally {
    await browser.close();
  }

  const commandAfter = await apiJson("/api/v1/restaurant/orders/cash-drawer/command", adminCookie);
  assert(commandAfter.response.ok, `Cash drawer command after close failed: ${JSON.stringify(commandAfter.data)}`);
  assert(commandAfter.data.latest_close, "Cash drawer close did not create a latest audit event.");
  assert(
    commandAfter.data.latest_close.action === "cash_drawer_close",
    `Latest drawer action mismatch: ${JSON.stringify(commandAfter.data.latest_close)}`
  );
  assert(
    Math.abs(Number(commandAfter.data.latest_close.metadata?.variance_totals?.total || 0)) < 0.01,
    `Expected balanced variance after counted totals: ${JSON.stringify(commandAfter.data.latest_close.metadata)}`
  );

  console.log(`Cash drawer command passed for orders #${cashOrderId} and #${upiOrderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
