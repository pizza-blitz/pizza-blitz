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
  const data = await response.json();
  assert(response.ok, `Admin portal login failed: ${JSON.stringify(data)}`);
  const cookie = cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
  assert(cookie.includes("pb_admin_session="), "Admin login did not return an admin session cookie.");
  return cookie;
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

async function seedOptInCustomer() {
  const menuResult = await apiJson("/api/v1/restaurant/menu/menu-with-customizations");
  assert(menuResult.response.ok, `Could not load menu: ${JSON.stringify(menuResult.data)}`);
  const item = menuResult.data.find((row) => row.is_available) || menuResult.data[0];
  assert(item, "No menu item was available to seed a customer.");

  const phone = `97${Date.now().toString().slice(-8)}`;
  const email = `campaign-proof-${Date.now()}@example.com`;
  const response = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Campaign Proof Customer",
      customer_phone: phone,
      customer_email: email,
      opt_in_marketing: true,
      payment_method: "cash",
      notes: "E2E campaign sending contact seed",
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
  assert(response.response.ok, `Could not seed customer order: ${JSON.stringify(response.data)}`);
  return { phone, email };
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
  return {
    assertClean(label) {
      assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
    },
  };
}

async function screenshotCampaignConsole(campaignName) {
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
    await page.getByText("WhatsApp / SMS / Email Readiness", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText(campaignName, { exact: false }).first().click();
    await page.getByText("Recent Delivery Attempts", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("dry run", { exact: false }).first().waitFor({ timeout: 15000 });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-campaign-sending.png"),
      fullPage: true,
    });
    watch.assertClean("campaign sending console");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const anonymousList = await apiJson("/api/v1/restaurant/promotions/");
  assert(anonymousList.response.status === 401, `Anonymous promotion list should be blocked, got ${anonymousList.response.status}.`);

  const anonymousCustomerSummary = await apiJson("/api/v1/restaurant/customers/summary");
  assert(
    anonymousCustomerSummary.response.status === 401,
    `Anonymous customer summary should be blocked, got ${anonymousCustomerSummary.response.status}.`
  );

  const activePublic = await apiJson("/api/v1/restaurant/promotions/active");
  assert(activePublic.response.ok, `Public active promotions should remain available: ${JSON.stringify(activePublic.data)}`);

  const contact = await seedOptInCustomer();
  const cookie = await portalLogin();

  const providerResult = await adminJson("/api/v1/restaurant/promotions/providers/status", cookie);
  assert(providerResult.response.ok, `Provider readiness failed: ${JSON.stringify(providerResult.data)}`);
  assert(
    providerResult.data.channels.some((channel) => channel.channel === "email"),
    "Provider readiness did not include email."
  );

  const customerSummary = await adminJson("/api/v1/restaurant/customers/summary", cookie);
  assert(customerSummary.response.ok, `Admin customer summary failed: ${JSON.stringify(customerSummary.data)}`);

  const today = new Date();
  const endDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const campaignName = `Campaign Send Proof ${Date.now()}`;
  const promotionResult = await adminJson("/api/v1/restaurant/promotions/", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: campaignName,
      code: `SEND${Date.now().toString().slice(-6)}`,
      start_date: today.toISOString().slice(0, 10),
      end_date: endDate.toISOString().slice(0, 10),
      description: "E2E dry-run campaign sending proof",
      discount_type: "percentage",
      discount_value: 12,
      audience: "marketing_opt_in",
      channel: "email",
      status: "active",
      message_template: "Hi {name}, Pizza Blitz has {offer}. Use {code} before {end_date}.",
    }),
  });
  assert(promotionResult.response.ok, `Could not create promotion: ${JSON.stringify(promotionResult.data)}`);
  const promotionId = promotionResult.data.promotion.id;

  const dispatchResult = await adminJson(`/api/v1/restaurant/promotions/${promotionId}/dispatch`, cookie);
  assert(dispatchResult.response.ok, `Dispatch preview failed: ${JSON.stringify(dispatchResult.data)}`);
  assert(dispatchResult.data.send_ready_count >= 1, "Dispatch preview did not find any send-ready contacts.");
  assert(
    dispatchResult.data.contacts.some((row) => row.destination === contact.email),
    "Dispatch preview did not include the seeded email contact."
  );

  const anonymousSend = await apiJson(`/api/v1/restaurant/promotions/${promotionId}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true, limit: 5 }),
  });
  assert(anonymousSend.response.status === 401, `Anonymous send should be blocked, got ${anonymousSend.response.status}.`);

  const dryRun = await adminJson(`/api/v1/restaurant/promotions/${promotionId}/send`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true, limit: 5 }),
  });
  assert(dryRun.response.ok, `Dry run failed: ${JSON.stringify(dryRun.data)}`);
  assert(dryRun.data.dry_run_count >= 1, "Dry run did not record a dry_run delivery.");
  assert(
    dryRun.data.deliveries.some((delivery) => delivery.destination === contact.email && delivery.status === "dry_run"),
    "Dry run delivery did not include the seeded email contact."
  );

  const deliveries = await adminJson(`/api/v1/restaurant/promotions/${promotionId}/deliveries`, cookie);
  assert(deliveries.response.ok, `Delivery history failed: ${JSON.stringify(deliveries.data)}`);
  assert(deliveries.data.dry_run_count >= 1, "Delivery history did not retain the dry run.");

  await screenshotCampaignConsole(campaignName);
  console.log(`Campaign sending proof passed for promotion #${promotionId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
