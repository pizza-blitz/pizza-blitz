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

async function seedContacts() {
  const suffix = Date.now().toString().slice(-8);
  const contacts = {
    ready: {
      phone: `84${suffix}01`,
      name: `Timeline Ready ${suffix}`,
      email: `timeline-ready-${suffix}@example.com`,
      opt_in_marketing: true,
    },
    missingEmail: {
      phone: `84${suffix}02`,
      name: `Timeline Missing Email ${suffix}`,
      email: null,
      opt_in_marketing: true,
    },
  };

  for (const contact of Object.values(contacts)) {
    const order = await apiJson("/api/v1/restaurant/orders/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_type: "takeaway",
        customer_name: contact.name,
        customer_phone: contact.phone,
        customer_email: contact.email,
        opt_in_marketing: contact.opt_in_marketing,
        payment_method: "cash",
        notes: "Campaign activity timeline seed",
        items: [{ name: "Timeline Proof Pizza", quantity: 1, price: 299 }],
      }),
    });
    assert(order.response.ok, `Could not seed timeline contact: ${JSON.stringify(order.data)}`);
  }

  return contacts;
}

async function createCampaign(cookie) {
  const today = new Date();
  const endDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const suffix = Date.now().toString().slice(-8);
  const code = `TIME${suffix.slice(-4)}`;
  const campaignName = `Activity Timeline Proof ${suffix}`;
  const promotion = await adminJson("/api/v1/restaurant/promotions/", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: campaignName,
      code,
      start_date: today.toISOString().slice(0, 10),
      end_date: endDate.toISOString().slice(0, 10),
      description: "E2E activity timeline proof",
      discount_type: "percentage",
      discount_value: 15,
      audience: "all_customers",
      channel: "email",
      status: "active",
      message_template: "Hi {name}, Pizza Blitz has {offer}. Use {code}.",
    }),
  });
  assert(promotion.response.ok, `Could not create timeline campaign: ${JSON.stringify(promotion.data)}`);
  return { id: promotion.data.promotion.id, name: campaignName, code };
}

async function seedActivity(cookie, campaign, contacts) {
  const dryRun = await adminJson(`/api/v1/restaurant/promotions/${campaign.id}/send`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true, limit: 50 }),
  });
  assert(dryRun.response.ok, `Timeline dry run failed: ${JSON.stringify(dryRun.data)}`);
  assert(
    dryRun.data.deliveries.some((delivery) => delivery.customer?.phone === contacts.ready.phone && delivery.status === "dry_run"),
    "Timeline dry run did not include ready customer."
  );
  assert(
    dryRun.data.deliveries.some((delivery) => delivery.customer?.phone === contacts.missingEmail.phone && delivery.status === "skipped"),
    "Timeline dry run did not include missing-email cleanup issue."
  );

  const couponOrder = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Timeline Coupon Buyer",
      customer_phone: `83${Date.now().toString().slice(-8)}`,
      customer_email: `timeline-coupon-${Date.now()}@example.com`,
      opt_in_marketing: true,
      payment_method: "cash",
      coupon_code: campaign.code,
      notes: "Campaign activity timeline coupon proof",
      items: [{ name: "Timeline Coupon Party Pack", quantity: 1, price: 999 }],
    }),
  });
  assert(couponOrder.response.ok, `Could not seed timeline coupon order: ${JSON.stringify(couponOrder.data)}`);
  assert(couponOrder.data.coupon_code === campaign.code, `Coupon order did not apply ${campaign.code}.`);

  const socialPost = await adminJson(`/api/v1/restaurant/promotions/${campaign.id}/social-post`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platforms: ["facebook", "instagram"],
      status: "ready",
      link_url: `${baseURL}/order?coupon=${campaign.code}`,
    }),
  });
  assert(socialPost.response.ok, `Could not create timeline social handoff: ${JSON.stringify(socialPost.data)}`);

  const adCampaign = await adminJson(`/api/v1/restaurant/promotions/${campaign.id}/ad-campaign`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platforms: ["facebook", "instagram"],
      status: "ready",
      daily_budget: 750,
      link_url: `${baseURL}/order?coupon=${campaign.code}`,
    }),
  });
  assert(adCampaign.response.ok, `Could not create timeline ad handoff: ${JSON.stringify(adCampaign.data)}`);
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

async function proveTimeline(campaign) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1250 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/promotions?campaign=${campaign.id}`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Promotions page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByText(campaign.name, { exact: false }).first().waitFor({ timeout: 15000 });
    await page.getByTestId("campaign-activity-timeline").waitFor({ timeout: 15000 });
    await page.getByText("Campaign Activity Timeline", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Dry run ready", { exact: true }).first().waitFor({ timeout: 15000 });
    await page.getByText("Cleanup issue found", { exact: true }).first().waitFor({ timeout: 15000 });
    await page.getByText("Coupon redeemed", { exact: true }).first().waitFor({ timeout: 15000 });
    await page.getByText("Social handoff created", { exact: true }).first().waitFor({ timeout: 15000 });
    await page.getByText("Ad handoff created", { exact: true }).first().waitFor({ timeout: 15000 });

    const health = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        textLength: text.trim().length,
        hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
        hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert(health.textLength > 300, "Campaign activity timeline rendered too little content.");
    assert(!health.hasOverlay, "Campaign activity timeline rendered a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Campaign activity timeline rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Campaign activity timeline has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    await page.getByTestId("campaign-activity-timeline").screenshot({
      path: path.join(artifactsDir, "visible-campaign-activity-timeline.png"),
    });
    watch.assertClean("campaign activity timeline");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const contacts = await seedContacts();
  const cookie = await portalLogin();
  const campaign = await createCampaign(cookie);
  await seedActivity(cookie, campaign, contacts);

  const anonymous = await apiJson(`/api/v1/restaurant/promotions/${campaign.id}/timeline`);
  assert(anonymous.response.status === 401, `Anonymous campaign timeline should be blocked, got ${anonymous.response.status}.`);

  const timeline = await adminJson(`/api/v1/restaurant/promotions/${campaign.id}/timeline`, cookie);
  assert(timeline.response.ok, `Campaign timeline failed: ${JSON.stringify(timeline.data)}`);
  const eventTypes = new Set(timeline.data.events.map((event) => event.type));
  for (const expectedType of ["campaign", "delivery", "cleanup", "redemption", "social", "ad"]) {
    assert(eventTypes.has(expectedType), `Campaign timeline did not include ${expectedType} event.`);
  }
  assert(timeline.data.summary.event_count >= 6, "Campaign timeline summary did not count all proof events.");

  await proveTimeline(campaign);
  console.log(`Campaign activity timeline proof passed for promotion #${campaign.id}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
