const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
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

async function apiJson(endpoint, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function chooseMenuItem() {
  const { response, data } = await apiJson("/api/v1/restaurant/menu/menu-with-customizations");
  assert(response.ok, `Could not load menu: ${JSON.stringify(data)}`);
  const item = data.find((row) => row.is_available);
  assert(item, "No available menu item found for reorder proof.");
  return item;
}

async function createTrackedOrder(item) {
  const phone = `98${Date.now().toString().slice(-8)}`;
  const customerName = "Track Reorder Proof";
  const { response, data } = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: customerName,
      customer_phone: phone,
      customer_email: `track-reorder-${Date.now()}@example.com`,
      opt_in_marketing: true,
      payment_method: "cash",
      notes: "E2E track reorder proof",
      items: [
        {
          menu_item_id: item.id,
          name: item.name,
          quantity: 2,
          price: Number(item.selling_price || 0),
          base_price: Number(item.selling_price || 0),
          customization_total: 0,
          selected_options: [],
        },
      ],
    }),
  });
  assert(response.ok, `Could not create tracked order: ${JSON.stringify(data)}`);
  const orderId = Number(data.order_id || data.id || data.order?.id);
  assert(Number.isFinite(orderId) && orderId > 0, `Created order did not include an id: ${JSON.stringify(data)}`);
  return { orderId, phone, customerName };
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

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const item = await chooseMenuItem();
  const { orderId, phone, customerName } = await createTrackedOrder(item);
  const tracked = await apiJson(`/api/v1/restaurant/orders/track/${orderId}?phone=${encodeURIComponent(phone)}`);
  assert(tracked.response.ok, `Could not track created order #${orderId}: ${JSON.stringify(tracked.data)}`);
  assert(
    Number(tracked.data.id) === orderId,
    `Track API returned order ${tracked.data.id} instead of ${orderId}: ${JSON.stringify(tracked.data)}`
  );

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    let response = await page.goto(`${baseURL}/track?order=${orderId}&phone=${phone}`, {
      waitUntil: "domcontentloaded",
    });
    assert(response && response.ok(), `Track page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByTestId("track-reorder-command").waitFor({ timeout: 15000 }).catch(async () => {
      const bodyText = await page.locator("body").innerText().catch(() => "");
      throw new Error(`Track page did not load order #${orderId}: ${bodyText.slice(0, 900)}`);
    });
    await page.getByText(`Order #${orderId}`, { exact: false }).waitFor({ timeout: 10000 });
    await assertHealthyPage(page, "track reorder source page");
    await page.getByTestId("track-reorder-command").getByText("Reorder this cart", { exact: false }).waitFor({ timeout: 10000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-track-reorder-command.png"),
      fullPage: true,
    });

    await page.getByTestId("track-reorder-link").click();
    await page.waitForURL(/\/order$/, { timeout: 15000 });
    await assertHealthyPage(page, "reorder checkout page");
    await page.getByText(`Loaded 1 item from order #${orderId}`, { exact: false }).waitFor({ timeout: 15000 });
    await page.getByTestId("customer-cart-summary").getByText(item.name, { exact: false }).waitFor({ timeout: 15000 });
    await page.getByTestId("customer-funnel-cart-total").getByText("2 items selected", { exact: false }).waitFor({ timeout: 15000 });

    const loadedName = await page.getByPlaceholder("Name").inputValue();
    const loadedPhone = await page.getByPlaceholder("Phone").inputValue();
    assert(loadedName === customerName, `Expected customer name ${customerName}, got ${loadedName}.`);
    assert(loadedPhone === phone, `Expected customer phone ${phone}, got ${loadedPhone}.`);

    await page.screenshot({
      path: path.join(artifactsDir, "visible-track-reorder-checkout.png"),
      fullPage: true,
    });
    watch.assertClean("track reorder loop");
  } finally {
    await browser.close();
  }

  console.log(`Track reorder loop proof passed for order #${orderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
