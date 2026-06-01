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

async function apiJson(endpoint, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: { ...(options.headers || {}) },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function createDeliveryOrder(zoneId, address) {
  const result = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "delivery",
      customer_name: "Delivery Charges Proof",
      customer_phone: `93${Date.now().toString().slice(-8)}`,
      customer_email: "delivery-charges-proof@example.com",
      payment_method: "cash",
      delivery_address: address,
      delivery_zone_id: zoneId,
      notes: "E2E delivery charges and zones proof",
      items: [
        {
          name: "Delivery Charges Pizza",
          quantity: 1,
          price: 249,
        },
      ],
    }),
  });
  assert(result.response.ok, `Could not create delivery order: ${JSON.stringify(result.data)}`);
  assert(result.data.order_id, "Delivery order response did not include order_id.");
  return result.data.order_id;
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

  const zonesResult = await apiJson("/api/v1/restaurant/delivery/zones");
  assert(zonesResult.response.ok, `Could not load delivery zones: ${JSON.stringify(zonesResult.data)}`);
  const outerZone = zonesResult.data.find((zone) => zone.name === "Outer Ring") || zonesResult.data[zonesResult.data.length - 1];
  assert(outerZone?.id, "Outer delivery zone was not available.");
  assert(outerZone.minimum_order_amount >= 199, "Outer zone should protect delivery margin with a minimum order.");
  assert(outerZone.pricing_rule, "Delivery zone did not expose a pricing rule.");

  const address = "Gate 4 Airport bypass warehouse, Outer Ring service road";
  const blockedQuote = await apiJson("/api/v1/restaurant/delivery/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, subtotal: 99, zone_id: outerZone.id }),
  });
  assert(blockedQuote.response.ok, `Blocked quote request failed: ${JSON.stringify(blockedQuote.data)}`);
  assert(!blockedQuote.data.is_deliverable, "Low subtotal quote should be blocked by the zone minimum.");
  assert(blockedQuote.data.charge_breakdown?.minimum_gap > 0, "Blocked quote did not include minimum gap.");

  const deliverableQuote = await apiJson("/api/v1/restaurant/delivery/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, subtotal: 249, zone_id: outerZone.id }),
  });
  assert(deliverableQuote.response.ok, `Deliverable quote failed: ${JSON.stringify(deliverableQuote.data)}`);
  assert(deliverableQuote.data.is_deliverable, "Delivery quote should pass after meeting the minimum.");
  assert(deliverableQuote.data.charge_breakdown.total_with_delivery === 318, "Delivery total should include the Rs 69 outer-zone fee.");

  const orderId = await createDeliveryOrder(outerZone.id, address);
  const economicsResult = await apiJson("/api/v1/restaurant/delivery/economics", {
    headers: {
      Cookie: `pb_admin_session=placeholder`,
    },
  });
  assert(
    economicsResult.response.status === 401 || economicsResult.response.status === 403,
    "Delivery economics should require an authenticated portal session."
  );

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
    const adminCookie = cookieHeaderFromSetCookie(login.headers()["set-cookie"]);
    assert(adminCookie.includes("pb_admin_session="), "Admin login did not return an admin session cookie.");

    const authedEconomics = await context.request.get(`${apiURL}/api/v1/restaurant/delivery/economics`, {
      headers: { Cookie: adminCookie },
    });
    const economics = await authedEconomics.json();
    assert(authedEconomics.ok(), `Authed delivery economics failed: ${JSON.stringify(economics)}`);
    assert(economics.summary.minimum_order_zone_count >= 1, "Economics summary did not count minimum-order zones.");
    assert(economics.summary.highest_fee >= outerZone.delivery_fee, "Economics summary did not include outer-zone fee.");
    assert(economics.summary.open_delivery_count >= 1, "Economics summary did not include open delivery orders.");

    const response = await page.goto(`${baseURL}/settings`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Settings page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByText("Delivery Zones & Charges", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Delivery Economics Command", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Minimum Rules", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Zone Rule Summary", { exact: false }).waitFor({ timeout: 15000 });

    await page.getByPlaceholder("House/building and area").fill(address);
    await page.getByPlaceholder("Subtotal").fill("99");
    await page.locator("select").first().selectOption(String(outerZone.id));
    await page.getByRole("button", { name: /^Test$/i }).click();
    await page.getByText(/Add Rs \d+ more to unlock this zone/i).waitFor({ timeout: 15000 });

    const health = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        textLength: text.trim().length,
        hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
        hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert(health.textLength > 300, "Delivery settings rendered too little content.");
    assert(!health.hasOverlay, "Delivery settings has a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Delivery settings rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Delivery settings has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    await page.screenshot({
      path: path.join(artifactsDir, "visible-delivery-charges-zones.png"),
      fullPage: true,
    });
    watch.assertClean("delivery charges and zones settings");
  } finally {
    await browser.close();
  }

  console.log(`Delivery charges and zones proof passed with order #${orderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
