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

async function seedCleanupActionContacts() {
  const suffix = Date.now().toString().slice(-8);
  const contacts = {
    missingEmail: {
      phone: `86${suffix}02`,
      name: `Action Missing Email ${suffix}`,
      email: null,
      fixedEmail: `action-fixed-${suffix}@example.com`,
      opt_in_marketing: true,
    },
    blocked: {
      phone: `86${suffix}03`,
      name: `Action Consent Blocked ${suffix}`,
      email: `action-blocked-${suffix}@example.com`,
      opt_in_marketing: false,
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
        notes: "Campaign cleanup action proof",
        items: [{ name: "Cleanup Action Pizza", quantity: 1, price: 299 }],
      }),
    });
    assert(order.response.ok, `Could not seed cleanup action contact: ${JSON.stringify(order.data)}`);
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

async function proveCleanupActions(contacts) {
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

    await page.goto(`${baseURL}/customers?segment=opted_out&source=campaign_cleanup`, { waitUntil: "domcontentloaded" });
    await page.getByText("Opened Opted Out cleanup queue from campaign audit.", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId(`customer-row-${contacts.blocked.id}`).waitFor({ timeout: 15000 });
    await page.getByTestId(`customer-consent-${contacts.blocked.id}`).check();
    await Promise.all([
      page.waitForResponse(
        (apiResponse) =>
          apiResponse.url().includes(`/customers/${contacts.blocked.id}`) &&
          apiResponse.request().method() === "PATCH" &&
          apiResponse.ok(),
        { timeout: 15000 }
      ),
      page.getByTestId(`customer-save-${contacts.blocked.id}`).click(),
    ]);
    await page.getByText(`Updated ${contacts.blocked.name} for campaign cleanup.`, { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId(`customer-row-${contacts.blocked.id}`).waitFor({ state: "detached", timeout: 15000 });

    await page.goto(`${baseURL}/customers?segment=missing_email&source=campaign_cleanup`, { waitUntil: "domcontentloaded" });
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
    await page.getByTestId(`customer-row-${contacts.missingEmail.id}`).waitFor({ state: "detached", timeout: 15000 });

    const health = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        textLength: text.trim().length,
        hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
        hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert(health.textLength > 300, "Cleanup action view rendered too little content.");
    assert(!health.hasOverlay, "Cleanup action view rendered a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Cleanup action view rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Cleanup action view has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    await page.screenshot({
      path: path.join(artifactsDir, "visible-campaign-cleanup-actions.png"),
      fullPage: true,
    });

    await page.getByRole("link", { name: /Return To Campaigns/i }).click();
    await page.waitForURL(/\/promotions/, { timeout: 15000 });
    await page.getByText("Campaign List", { exact: false }).waitFor({ timeout: 15000 });
    watch.assertClean("campaign cleanup actions");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const seeded = await seedCleanupActionContacts();
  const cookie = await portalLogin();
  const blocked = await findCustomer(cookie, seeded.blocked.phone);
  const missingEmail = await findCustomer(cookie, seeded.missingEmail.phone);

  const anonymous = await apiJson(`/api/v1/restaurant/customers/${blocked.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ opt_in_marketing: true }),
  });
  assert(anonymous.response.status === 401, `Anonymous customer cleanup update should be blocked, got ${anonymous.response.status}.`);

  await proveCleanupActions({
    blocked: { ...seeded.blocked, id: blocked.id },
    missingEmail: { ...seeded.missingEmail, id: missingEmail.id },
  });

  const fixedConsent = await findCustomer(cookie, seeded.blocked.phone);
  assert(fixedConsent.opt_in_marketing === true, "Consent cleanup action did not persist opt-in status.");

  const fixedEmail = await findCustomer(cookie, seeded.missingEmail.phone);
  assert(fixedEmail.email === seeded.missingEmail.fixedEmail, "Email cleanup action did not persist the fixed email.");

  console.log(`Campaign cleanup action proof passed for customers #${blocked.id} and #${missingEmail.id}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
