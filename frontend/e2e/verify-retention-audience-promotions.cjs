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
    headers: { ...(options.headers || {}) },
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

async function seedOrder({ phone, name, email, itemName, price, note }) {
  const { response, data } = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: name,
      customer_phone: phone,
      customer_email: email,
      opt_in_marketing: true,
      payment_method: "cash",
      notes: note,
      items: [{ name: itemName, quantity: 1, price }],
    }),
  });
  assert(response.ok, `Could not seed order: ${JSON.stringify(data)}`);
}

async function seedAudienceCustomers() {
  const suffix = Date.now().toString().slice(-8);
  const vip = {
    phone: `93${suffix}`,
    name: "Promotion VIP Audience Proof",
    email: `promo-vip-${suffix}@example.com`,
  };
  const regular = {
    phone: `92${suffix}`,
    name: "Promotion Regular Audience Proof",
    email: `promo-regular-${suffix}@example.com`,
  };

  await seedOrder({
    ...vip,
    itemName: "VIP Audience Party Pack Proof",
    price: 5400,
    note: "Retention audience promotion VIP seed",
  });
  for (let index = 0; index < 3; index += 1) {
    await seedOrder({
      ...regular,
      itemName: "Margherita Pizza (R)",
      price: 199,
      note: `Retention audience promotion regular seed ${index + 1}`,
    });
  }

  return { vip, regular };
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

async function screenshotPromotionAudience(campaignName, vipEmail) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/promotions`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Promotions page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByText("Retention Audience Bridge", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("VIP Guests", { exact: false }).first().waitFor({ timeout: 10000 });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-retention-audience-bridge.png"),
      fullPage: true,
    });
    await page.getByText(campaignName, { exact: false }).first().click();
    await page.getByText("VIP Guests", { exact: false }).first().waitFor({ timeout: 10000 });
    await page.getByText(vipEmail, { exact: false }).first().waitFor({ timeout: 15000 });

    const health = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        textLength: text.trim().length,
        hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
        hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert(health.textLength > 300, "Promotions page rendered too little content.");
    assert(!health.hasOverlay, "Promotions page rendered a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Promotions page rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Promotions page has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    await page.screenshot({
      path: path.join(artifactsDir, "visible-retention-audience-promotions.png"),
      fullPage: true,
    });
    watch.assertClean("retention audience promotions");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const anonymousAudience = await apiJson("/api/v1/restaurant/promotions/audience?audience=vip_guests");
  assert(anonymousAudience.response.status === 401, `Anonymous audience should be blocked, got ${anonymousAudience.response.status}.`);

  const { vip, regular } = await seedAudienceCustomers();
  const cookie = await portalLogin();

  const audience = await adminJson("/api/v1/restaurant/promotions/audience?audience=vip_guests", cookie);
  assert(audience.response.ok, `VIP audience summary failed: ${JSON.stringify(audience.data)}`);
  assert(
    audience.data.customers.some((customer) => customer.email === vip.email),
    "VIP audience did not include the seeded VIP customer."
  );
  assert(
    !audience.data.customers.some((customer) => customer.email === regular.email),
    "VIP audience incorrectly included the seeded regular customer."
  );

  const today = new Date();
  const endDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const campaignName = `VIP Retention Audience Proof ${Date.now()}`;
  const campaign = await adminJson("/api/v1/restaurant/promotions/", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: campaignName,
      code: `VIP${Date.now().toString().slice(-6)}`,
      start_date: today.toISOString().slice(0, 10),
      end_date: endDate.toISOString().slice(0, 10),
      description: "VIP retention audience bridge proof",
      discount_type: "percentage",
      discount_value: 18,
      audience: "vip_guests",
      channel: "email",
      status: "active",
      message_template: "Hi {name}, your VIP Pizza Blitz offer is {offer}. Use {code} before {end_date}.",
    }),
  });
  assert(campaign.response.ok, `Could not create VIP promotion: ${JSON.stringify(campaign.data)}`);
  const promotionId = campaign.data.promotion.id;

  const dispatch = await adminJson(`/api/v1/restaurant/promotions/${promotionId}/dispatch`, cookie);
  assert(dispatch.response.ok, `VIP dispatch failed: ${JSON.stringify(dispatch.data)}`);
  assert(dispatch.data.audience === "vip_guests", "Dispatch did not keep the VIP audience.");
  assert(dispatch.data.contacts.some((contact) => contact.destination === vip.email), "Dispatch did not include seeded VIP email.");
  assert(!dispatch.data.contacts.some((contact) => contact.destination === regular.email), "Dispatch included regular customer in VIP audience.");

  await screenshotPromotionAudience(campaignName, vip.email);
  console.log(`Retention audience promotion proof passed for promotion #${promotionId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
