const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
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

async function apiJson(endpoint, init = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init,
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function seedOrder(phone, items, note) {
  const { response, data } = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Customer Intelligence Proof",
      customer_phone: phone,
      customer_email: "customer-proof@example.com",
      opt_in_marketing: true,
      payment_method: "cash",
      notes: note,
      items,
    }),
  });
  assert(response.ok, `Could not seed customer order: ${JSON.stringify(data)}`);
  assert(data.order_id, "Seed order response did not include order_id.");
  return data.order_id;
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
    const localRequest = url.startsWith(baseURL) || url.startsWith(apiURL);
    if (!localRequest) return;
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

async function signInAsCustomer(context, phone, orderId) {
  const response = await context.request.post(`${baseURL}/api/customer-session`, {
    data: { phone, order_id: orderId },
  });
  assert(response.ok(), `Customer session failed: ${await response.text()}`);
  const cookie = cookieHeaderFromSetCookie(response.headers()["set-cookie"]);
  assert(cookie.includes("pb_customer_session="), "Customer login did not return a customer session cookie.");
  const [name, ...valueParts] = cookie.split("=");
  await context.addCookies([
    {
      name,
      value: valueParts.join("="),
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  const sessionResponse = await context.request.get(`${baseURL}/api/customer-session`, {
    headers: { Cookie: cookie },
  });
  const sessionData = await sessionResponse.json().catch(() => ({}));
  assert(sessionResponse.ok(), `Customer session was not persisted: ${JSON.stringify(sessionData)}`);
  assert(sessionData.session?.phone === phone, "Customer session returned the wrong phone.");
}

async function assertCustomerHistory(phone, orderId) {
  const { response, data } = await apiJson(
    `/api/v1/restaurant/orders/customer-history/${encodeURIComponent(phone)}?order_id=${orderId}`
  );
  assert(response.ok, `Customer history failed: ${JSON.stringify(data)}`);
  assert(data.customer?.phone === phone, "Customer history returned the wrong phone.");
  assert(data.customer?.total_orders >= 2, "Customer history did not include seeded orders.");
  assert(data.loyalty_summary, "Customer history did not include loyalty_summary.");
  assert(data.loyalty_summary.average_order_value > 0, "Loyalty summary did not include AOV.");
  assert(Array.isArray(data.loyalty_summary.favorite_items), "Loyalty summary favorite_items is not an array.");
  assert(Array.isArray(data.loyalty_summary.recommended_reorder), "Loyalty summary recommended_reorder is not an array.");
  assert(
    data.loyalty_summary.favorite_items.some((item) => item.name === "Margherita Pizza (R)"),
    "Favorite items did not include the repeated pizza."
  );
  assert(
    data.loyalty_summary.recommended_reorder.some((item) => item.name === "Margherita Pizza (R)"),
    "Recommended reorder did not include the repeated pizza."
  );
}

async function assertAccountPage(page, watch) {
  const response = await page.goto(`${baseURL}/account`, { waitUntil: "commit", timeout: 20000 });
  assert(response && response.ok(), `Customer account returned HTTP ${response?.status() || "no response"}.`);
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);

  await page.getByText("Loyalty Snapshot", { exact: false }).waitFor({ timeout: 15000 });
  await page.getByText("Recommended Basket", { exact: false }).waitFor({ timeout: 10000 });
  await page.getByText("Favorite Items", { exact: false }).waitFor({ timeout: 10000 });
  await page.getByText("Margherita Pizza (R)", { exact: false }).first().waitFor({ timeout: 10000 });

  const corruptionMarkers = [
    "\uFFFD",
    "\u00C3\u00A2\u00E2\u201A\u00AC",
    "\u00C3\u00A2\u00E2\u201A\u00AC\u00E2\u201E\u00A2",
    "\u00C3\u00A2\u00E2\u201A\u00AC\u00C5\u201C",
    "\u00C3\u00A2\u00E2\u201A\u00AC\uFFFD",
    "\u00C3\u00A2\u00E2\u201A\u00AC\u0161\u00C2\u00B9",
    "\u00C3\u201A",
  ];
  const health = await page.evaluate((markers) => {
    const text = document.body.innerText || "";
    return {
      textLength: text.trim().length,
      hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
      hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
      hasTextCorruption: markers.some((marker) => text.includes(marker)),
      bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  }, corruptionMarkers);
  assert(health.textLength > 200, "Customer account rendered too little content.");
  assert(!health.hasOverlay, "Customer account rendered a Next.js error overlay.");
  assert(!health.hasFrameworkError, "Customer account rendered framework error text.");
  assert(!health.hasTextCorruption, "Customer account rendered corrupted text characters.");
  assert(health.bodyOverflow <= 8, `Customer account has body-level horizontal overflow of ${health.bodyOverflow}px.`);

  await page.screenshot({
    path: path.join(artifactsDir, "visible-customer-account-intelligence-account.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: /Recommended Reorder/i }).click();
  await page.waitForURL(/\/order/, { timeout: 15000 });
  await page.getByText(/Loaded .* from order #history/i).waitFor({ timeout: 15000 });
  await page.getByText("Margherita Pizza (R)", { exact: false }).first().waitFor({ timeout: 10000 });

  await page.screenshot({
    path: path.join(artifactsDir, "visible-customer-account-intelligence.png"),
    fullPage: true,
  });
  watch.assertClean("customer account intelligence");
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const phone = `98${Date.now().toString().slice(-8)}`;
  await seedOrder(
    phone,
    [
      { name: "Margherita Pizza (R)", quantity: 2, price: 199 },
      { name: "Garlic Bread", quantity: 1, price: 119 },
    ],
    "Customer intelligence proof one"
  );
  const proofOrderId = await seedOrder(
    phone,
    [
      { name: "Margherita Pizza (R)", quantity: 1, price: 199 },
    ],
    "Customer intelligence proof two"
  );
  await assertCustomerHistory(phone, proofOrderId);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    await signInAsCustomer(context, phone, proofOrderId);
    await assertAccountPage(page, watch);
  } finally {
    await browser.close();
  }

  console.log(`Customer account intelligence proof passed for ${phone}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
