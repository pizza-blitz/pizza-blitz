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
      phone: `85${suffix}01`,
      name: `Resend Ready ${suffix}`,
      email: `resend-ready-${suffix}@example.com`,
      opt_in_marketing: true,
    },
    missingEmail: {
      phone: `85${suffix}02`,
      name: `Resend Missing Email ${suffix}`,
      email: null,
      fixedEmail: `resend-fixed-${suffix}@example.com`,
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
        notes: "Campaign cleanup resend proof",
        items: [{ name: "Cleanup Resend Pizza", quantity: 1, price: 299 }],
      }),
    });
    assert(order.response.ok, `Could not seed resend contact: ${JSON.stringify(order.data)}`);
  }

  return contacts;
}

async function findCustomer(cookie, phone) {
  const result = await adminJson(`/api/v1/restaurant/customers/?q=${encodeURIComponent(phone)}`, cookie);
  assert(result.response.ok, `Customer lookup failed: ${JSON.stringify(result.data)}`);
  const customer = result.data.find((row) => row.phone === phone);
  assert(customer, `Could not find seeded customer ${phone}.`);
  return customer;
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

async function createCampaign(cookie) {
  const today = new Date();
  const endDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const suffix = Date.now().toString().slice(-8);
  const campaignName = `Cleanup Resend Proof ${suffix}`;
  const promotion = await adminJson("/api/v1/restaurant/promotions/", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: campaignName,
      code: `RSND${suffix.slice(-4)}`,
      start_date: today.toISOString().slice(0, 10),
      end_date: endDate.toISOString().slice(0, 10),
      description: "E2E cleanup resend proof",
      discount_type: "percentage",
      discount_value: 15,
      audience: "all_customers",
      channel: "email",
      status: "active",
      message_template: "Hi {name}, Pizza Blitz has {offer}. Use {code}.",
    }),
  });
  assert(promotion.response.ok, `Could not create resend campaign: ${JSON.stringify(promotion.data)}`);
  return { id: promotion.data.promotion.id, name: campaignName };
}

async function proveCleanupResend(campaign, contacts) {
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

    await page.goto(`${baseURL}/promotions?campaign=${campaign.id}`, { waitUntil: "domcontentloaded" });
    await page.getByText(campaign.name, { exact: false }).first().waitFor({ timeout: 15000 });
    await page.getByRole("link", { name: /Open Email Cleanup/i }).click();
    await page.waitForURL(new RegExp(`/customers\\?segment=missing_email&source=campaign_cleanup&campaign=${campaign.id}`), {
      timeout: 15000,
    });
    await page.getByText("Opened Missing Email cleanup queue from campaign audit.", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId(`customer-row-${contacts.missingEmail.id}`).waitFor({ timeout: 15000 });
    await page.getByTestId(`customer-email-${contacts.missingEmail.id}`).fill(contacts.missingEmail.fixedEmail);
    await Promise.all([
      page.waitForResponse(
        (apiResponse) =>
          apiResponse.url().includes(`/customers/${contacts.missingEmail.id}`) &&
          apiResponse.request().method() === "PATCH" &&
          apiResponse.ok(),
        { timeout: 15000 }
      ),
      page.getByTestId(`customer-save-${contacts.missingEmail.id}`).click(),
    ]);
    await page.getByText(`Updated ${contacts.missingEmail.name} for campaign cleanup.`, { exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole("link", { name: /Return To Campaigns/i }).click();
    await page.waitForURL(new RegExp(`/promotions\\?campaign=${campaign.id}&source=campaign_cleanup_return`), {
      timeout: 15000,
    });
    await page.getByTestId("cleanup-return-panel").waitFor({ timeout: 15000 });
    await page.getByText("1 contacts from this campaign", { exact: false }).waitFor({ timeout: 15000 });

    const [recheckResponse] = await Promise.all([
      page.waitForResponse(
        (apiResponse) =>
          apiResponse.url().includes(`/promotions/${campaign.id}/send`) &&
          apiResponse.request().method() === "POST" &&
          apiResponse.ok(),
        { timeout: 15000 }
      ),
      page.getByTestId("cleanup-recheck-ready").click(),
    ]);
    const recheck = await recheckResponse.json();
    assert(
      recheck.deliveries.some(
        (delivery) =>
          delivery.customer?.phone === contacts.missingEmail.phone &&
          delivery.status === "dry_run"
      ),
      "Re-check did not include the fixed cleanup customer as dry-run ready."
    );
    await page.getByText("Dry run checked", { exact: false }).waitFor({ timeout: 15000 });

    const health = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        textLength: text.trim().length,
        hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
        hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert(health.textLength > 300, "Cleanup resend view rendered too little content.");
    assert(!health.hasOverlay, "Cleanup resend view rendered a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Cleanup resend view rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Cleanup resend view has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    await page.screenshot({
      path: path.join(artifactsDir, "visible-campaign-cleanup-resend.png"),
      fullPage: true,
    });
    watch.assertClean("campaign cleanup resend");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const seeded = await seedContacts();
  const cookie = await portalLogin();
  const missingEmail = await findCustomer(cookie, seeded.missingEmail.phone);
  const campaign = await createCampaign(cookie);

  const dryRun = await adminJson(`/api/v1/restaurant/promotions/${campaign.id}/send`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true, limit: 50 }),
  });
  assert(dryRun.response.ok, `Initial cleanup resend dry run failed: ${JSON.stringify(dryRun.data)}`);
  assert(
    dryRun.data.deliveries.some(
      (delivery) =>
        delivery.customer?.phone === seeded.missingEmail.phone &&
        delivery.status === "skipped"
    ),
    "Initial dry run did not create a missing-email cleanup issue."
  );

  await proveCleanupResend(campaign, {
    missingEmail: { ...seeded.missingEmail, id: missingEmail.id },
  });

  const dispatch = await adminJson(`/api/v1/restaurant/promotions/${campaign.id}/dispatch`, cookie);
  assert(dispatch.response.ok, `Dispatch after cleanup failed: ${JSON.stringify(dispatch.data)}`);
  assert(
    dispatch.data.cleanup_recovered_ready_count >= 1,
    "Dispatch did not report the fixed cleanup customer as recovered ready."
  );

  console.log(`Campaign cleanup resend proof passed for promotion #${campaign.id}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
