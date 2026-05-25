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

  page.on("pageerror", (error) => {
    issues.push(`page error: ${error.message}`);
  });

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
  const health = await page.evaluate(() => {
    const text = document.body.innerText || "";
    return {
      textLength: text.trim().length,
      hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
      hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
      bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  assert(health.textLength > 300, `${label} rendered too little content.`);
  assert(!health.hasOverlay, `${label} has a Next.js error overlay.`);
  assert(!health.hasFrameworkError, `${label} rendered framework error text.`);
  assert(health.bodyOverflow <= 8, `${label} has body-level horizontal overflow of ${health.bodyOverflow}px.`);
}

async function chooseCounterMenuItem() {
  const response = await fetch(`${apiURL}/api/v1/restaurant/menu/menu-with-customizations`, {
    cache: "no-store",
  });
  const menu = await response.json();
  assert(response.ok, `Could not fetch menu: ${JSON.stringify(menu)}`);
  const item = menu
    .filter((menuItem) =>
      (menuItem.customization_groups || []).some((group) =>
        (group.options || []).some((option) => Number(option.price_delta || 0) > 0)
      )
    )
    .sort((left, right) => Number(right.selling_price || 0) - Number(left.selling_price || 0))[0];
  assert(item, "No customizable POS menu item was available.");
  const selected = item.customization_groups
    .flatMap((group) =>
      group.options
        .filter((option) => Number(option.price_delta || 0) > 0)
        .map((option) => ({ group, option }))
    )[0];
  assert(selected, `No priced option was available for ${item.name}.`);
  return {
    itemId: item.id,
    itemName: item.name,
    optionId: selected.option.id,
    optionName: selected.option.name,
  };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const adminCookie = await portalLogin();
  const counterItem = await chooseCounterMenuItem();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);
  const phone = `96${Date.now().toString().slice(-8)}`;
  let orderId = 0;

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    let response = await page.goto(`${baseURL}/orders`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Counter POS returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: "Counter POS" }).waitFor({ timeout: 15000 });
    await page.getByTestId("counter-order-e2e-command").waitFor({ timeout: 15000 });
    await assertHealthyPage(page, "counter POS page");

    await page.getByTestId("counter-new-takeaway").click();
    await page.getByRole("heading", { name: "Takeaway Order" }).waitFor({ timeout: 15000 });
    await page.getByPlaceholder("Customer name").fill("Counter E2E Proof");
    await page.getByPlaceholder("Customer phone").fill(phone);
    await page.getByTestId(`counter-item-quantity-${counterItem.itemId}`).fill("1");
    await page.getByTestId(`counter-option-${counterItem.itemId}-${counterItem.optionId}`).click();
    await page.getByText(counterItem.optionName, { exact: false }).first().waitFor({ timeout: 10000 });
    await page.getByTestId("counter-send-order").click();
    await page.getByText(/Order #\d+ sent to kitchen/i).waitFor({ timeout: 15000 });

    const bodyText = await page.locator("body").innerText();
    const orderMatch = bodyText.match(/Order #(\d+) sent to kitchen/i);
    assert(orderMatch, `Could not find counter order id in POS text: ${bodyText.slice(0, 500)}`);
    orderId = Number(orderMatch[1]);
    assert(orderId > 0, "Counter order id was not positive.");
    await page.getByTestId(`counter-order-card-${orderId}`).waitFor({ timeout: 15000 });
    await page.getByTestId(`counter-bill-${orderId}`).waitFor({ timeout: 10000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-counter-order-e2e-pos.png"),
      fullPage: true,
    });

    response = await page.goto(`${baseURL}/receipt/${orderId}`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Counter receipt returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: "Customer Receipt" }).waitFor({ timeout: 15000 });
    await page.getByText(`PB-ORDER-${orderId}`, { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText(counterItem.optionName, { exact: false }).waitFor({ timeout: 15000 });

    let orderResult = await apiJson(`/api/v1/restaurant/orders/${orderId}`, adminCookie);
    assert(orderResult.response.ok, `Could not fetch counter order: ${JSON.stringify(orderResult.data)}`);
    assert(orderResult.data.source === "counter", `Expected counter source, got ${orderResult.data.source}.`);
    assert(orderResult.data.order_type === "takeaway", `Expected takeaway, got ${orderResult.data.order_type}.`);
    assert(orderResult.data.payment_method === "cash", `Expected cash, got ${orderResult.data.payment_method}.`);
    assert(orderResult.data.payment_status === "pending", `Expected pending payment, got ${orderResult.data.payment_status}.`);
    assert(
      orderResult.data.items.some((item) =>
        (item.selected_options || []).some((option) => option.option_name === counterItem.optionName)
      ),
      `Counter order did not preserve selected option ${counterItem.optionName}.`
    );

    const preparingResult = await apiJson(`/api/v1/restaurant/orders/${orderId}/status`, adminCookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "preparing" }),
    });
    assert(preparingResult.response.ok, `Could not mark counter order preparing: ${JSON.stringify(preparingResult.data)}`);

    const readyResult = await apiJson(`/api/v1/restaurant/orders/${orderId}/status`, adminCookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ready" }),
    });
    assert(readyResult.response.ok, `Could not mark counter order ready: ${JSON.stringify(readyResult.data)}`);

    response = await page.goto(`${baseURL}/operations`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Operations returned HTTP ${response?.status() || "no response"}.`);
    await page.getByTestId("operations-order-flow-watch").waitFor({ timeout: 15000 });
    await page.getByTestId(`operations-order-row-${orderId}`).waitFor({ timeout: 15000 });
    await page.getByTestId(`operations-order-row-${orderId}`).getByText("Ready", { exact: true }).waitFor({ timeout: 10000 });
    await page.getByText("Ready To Close", { exact: false }).first().waitFor({ timeout: 10000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-counter-order-e2e.png"),
      fullPage: true,
    });

    await page.getByLabel(`Close order ${orderId}`).click();
    await page.getByText(new RegExp(`Order #${orderId} closed`, "i")).waitFor({ timeout: 15000 });

    orderResult = await apiJson(`/api/v1/restaurant/orders/${orderId}`, adminCookie);
    assert(orderResult.response.ok, `Could not refetch closed counter order: ${JSON.stringify(orderResult.data)}`);
    assert(orderResult.data.status === "closed", `Expected closed status, got ${orderResult.data.status}.`);
    assert(orderResult.data.payment_status === "paid", `Expected paid status, got ${orderResult.data.payment_status}.`);
    assert(orderResult.data.payment_method === "cash", `Expected cash after close, got ${orderResult.data.payment_method}.`);

    watch.assertClean("counter order E2E");
  } finally {
    await browser.close();
  }

  console.log(`Counter order E2E passed for order #${orderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
