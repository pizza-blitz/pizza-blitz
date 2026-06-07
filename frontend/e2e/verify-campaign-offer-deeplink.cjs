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

async function adminJson(endpoint, cookie, options = {}) {
  return apiJson(endpoint, {
    ...options,
    headers: {
      Cookie: cookie,
      ...(options.headers || {}),
    },
  });
}

async function portalLogin() {
  const response = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  const data = await response.json();
  assert(response.ok, `Admin portal login failed: ${JSON.stringify(data)}`);
  const cookie = cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
  assert(cookie.includes("pb_admin_session="), "Admin login did not return an admin session cookie.");
  return cookie;
}

async function seedOptInCustomer() {
  const menuResult = await apiJson("/api/v1/restaurant/menu/menu-with-customizations");
  assert(menuResult.response.ok, `Could not load menu: ${JSON.stringify(menuResult.data)}`);
  const item = menuResult.data.find((row) => row.is_available) || menuResult.data[0];
  assert(item, "No menu item was available to seed a marketing customer.");

  const suffix = Date.now().toString().slice(-8);
  const email = `offer-link-${suffix}@example.com`;
  const phone = `96${suffix}`;
  const orderResult = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Offer Link Proof Customer",
      customer_phone: phone,
      customer_email: email,
      opt_in_marketing: true,
      payment_method: "cash",
      notes: "Offer deep-link campaign seed",
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
  assert(orderResult.response.ok, `Could not seed marketing customer: ${JSON.stringify(orderResult.data)}`);
  return { email, phone };
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

async function placeOrderFromOfferLink(orderLink, code) {
  const browserOrderLink = new URL(orderLink);
  const baseOrigin = new URL(baseURL).origin;
  const localFrontendOrigin = /^https?:\/\/(127\.0\.0\.1|localhost):3011$/i;
  if (localFrontendOrigin.test(browserOrderLink.origin) && localFrontendOrigin.test(baseOrigin)) {
    browserOrderLink.protocol = new URL(baseURL).protocol;
    browserOrderLink.host = new URL(baseURL).host;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const response = await page.goto(browserOrderLink.toString(), { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Offer order page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByText(`${code} selected from this offer link`, { exact: false }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /^Add$/i }).first().click();
    await page.getByText(new RegExp(`Applied\\s+${code}`, "i")).first().waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /^Cash$/i }).click();
    await page.getByPlaceholder("Name").fill("Offer Link Checkout Proof");
    await page.getByPlaceholder("Phone").fill(`95${Date.now().toString().slice(-8)}`);
    await page.getByPlaceholder("Email for receipts and offers").fill(`checkout-link-${Date.now()}@example.com`);
    await page.getByRole("button", { name: /Place Order/i }).click();
    await page.getByText(/Order #\d+ placed/i).waitFor({ timeout: 15000 });

    const health = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        textLength: text.trim().length,
        hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
        hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert(health.textLength > 300, "Offer order page rendered too little content.");
    assert(!health.hasOverlay, "Offer order page rendered a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Offer order page rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Offer order page has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    await page.screenshot({
      path: path.join(artifactsDir, "visible-campaign-offer-deeplink.png"),
      fullPage: true,
    });
    watch.assertClean("campaign offer order link");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const contact = await seedOptInCustomer();
  const cookie = await portalLogin();
  const suffix = Date.now().toString().slice(-6);
  const code = `DEEP${suffix}`;
  const today = new Date();
  const endDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

  const promotionResult = await adminJson("/api/v1/restaurant/promotions/", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Offer Deep Link Proof ${suffix}`,
      code,
      start_date: today.toISOString().slice(0, 10),
      end_date: endDate.toISOString().slice(0, 10),
      description: "E2E campaign-to-checkout handoff proof",
      discount_type: "percentage",
      discount_value: 15,
      audience: "marketing_opt_in",
      channel: "email",
      status: "active",
      message_template: "Hi {name}, use {code} for {offer} before {end_date}.",
    }),
  });
  assert(promotionResult.response.ok, `Could not create deep-link promotion: ${JSON.stringify(promotionResult.data)}`);
  const promotionId = promotionResult.data.promotion.id;

  const dispatchResult = await adminJson(`/api/v1/restaurant/promotions/${promotionId}/dispatch`, cookie);
  assert(dispatchResult.response.ok, `Dispatch preview failed: ${JSON.stringify(dispatchResult.data)}`);
  const orderLink = dispatchResult.data.order_link;
  assert(orderLink && orderLink.includes(`/order?coupon=${code}`), `Dispatch did not include order link: ${orderLink}`);
  assert(dispatchResult.data.message_preview.includes(orderLink), "Message preview did not include the order link.");
  const seededContact = dispatchResult.data.contacts.find((row) => row.destination === contact.email);
  assert(seededContact, "Dispatch preview did not include the seeded opt-in customer.");
  assert(seededContact.order_link === orderLink, "Contact row did not include the campaign order link.");
  assert(seededContact.message.includes(orderLink), "Contact message did not include the campaign order link.");
  assert(
    seededContact.action_url && decodeURIComponent(seededContact.action_url).includes(orderLink),
    "Send action URL did not carry the order link inside the message body."
  );

  await placeOrderFromOfferLink(orderLink, code);

  const performanceResult = await adminJson(`/api/v1/restaurant/promotions/performance/${promotionId}`, cookie);
  assert(performanceResult.response.ok, `Performance lookup failed: ${JSON.stringify(performanceResult.data)}`);
  assert(performanceResult.data.redemptions.count >= 1, "Campaign performance did not count the checkout redemption.");
  assert(performanceResult.data.redemptions.discount > 0, "Campaign performance did not count a discount amount.");

  console.log(`Campaign offer deep-link proof passed for promotion #${promotionId} and code ${code}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
