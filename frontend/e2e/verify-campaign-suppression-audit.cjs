const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
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

async function seedAuditContacts() {
  const suffix = Date.now().toString().slice(-8);
  const contacts = {
    ready: {
      phone: `88${suffix}01`,
      name: `Audit Ready ${suffix}`,
      email: `audit-ready-${suffix}@example.com`,
      opt_in_marketing: true,
    },
    missingEmail: {
      phone: `88${suffix}02`,
      name: `Audit Missing Email ${suffix}`,
      email: null,
      opt_in_marketing: true,
    },
    blocked: {
      phone: `88${suffix}03`,
      name: `Audit Consent Blocked ${suffix}`,
      email: `audit-blocked-${suffix}@example.com`,
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
        notes: "Campaign suppression audit proof",
        items: [{ name: "Suppression Audit Pizza", quantity: 1, price: 299 }],
      }),
    });
    assert(order.response.ok, `Could not seed audit contact: ${JSON.stringify(order.data)}`);
  }

  return contacts;
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

async function screenshotSuppressionAudit(campaignName, blockedName) {
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

    const response = await page.goto(`${baseURL}/promotions`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Promotions page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByText("Campaign List", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText(campaignName, { exact: false }).first().click();
    await page.getByText("Suppression Audit", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Needs Consent", { exact: true }).first().waitFor({ timeout: 15000 });
    await Promise.all([
      page.waitForResponse(
        (apiResponse) =>
          apiResponse.url().includes("/deliveries?reason=consent") &&
          apiResponse.ok(),
        { timeout: 15000 }
      ),
      page.getByRole("button", { name: /^Needs Consent$/i }).click(),
    ]);
    await page.getByText(blockedName, { exact: false }).first().waitFor({ timeout: 15000 });
    await page.getByText("Marketing consent not granted", { exact: false }).first().waitFor({ timeout: 15000 });
    await page.getByText("Needs Consent", { exact: true }).first().waitFor({ timeout: 15000 });

    const health = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        textLength: text.trim().length,
        hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
        hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert(health.textLength > 300, "Suppression audit view rendered too little content.");
    assert(!health.hasOverlay, "Suppression audit view rendered a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Suppression audit view rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Suppression audit view has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    await page.screenshot({
      path: path.join(artifactsDir, "visible-campaign-suppression-audit.png"),
      fullPage: true,
    });
    watch.assertClean("campaign suppression audit");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const anonymous = await apiJson("/api/v1/restaurant/promotions/1/deliveries?reason=consent");
  assert(anonymous.response.status === 401, `Anonymous delivery audit should be blocked, got ${anonymous.response.status}.`);

  const contacts = await seedAuditContacts();
  const cookie = await portalLogin();
  const today = new Date();
  const endDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const suffix = Date.now().toString().slice(-8);
  const campaignName = `Suppression Audit Proof ${suffix}`;

  const promotion = await adminJson("/api/v1/restaurant/promotions/", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: campaignName,
      code: `AUDIT${suffix.slice(-5)}`,
      start_date: today.toISOString().slice(0, 10),
      end_date: endDate.toISOString().slice(0, 10),
      description: "E2E suppression audit proof",
      discount_type: "percentage",
      discount_value: 15,
      audience: "all_customers",
      channel: "email",
      status: "active",
      message_template: "Hi {name}, Pizza Blitz has {offer}. Use {code}.",
    }),
  });
  assert(promotion.response.ok, `Could not create audit campaign: ${JSON.stringify(promotion.data)}`);
  const promotionId = promotion.data.promotion.id;

  const dryRun = await adminJson(`/api/v1/restaurant/promotions/${promotionId}/send`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true, limit: 12 }),
  });
  assert(dryRun.response.ok, `Audit dry run failed: ${JSON.stringify(dryRun.data)}`);
  assert(
    dryRun.data.deliveries.some((delivery) => delivery.customer?.phone === contacts.ready.phone && delivery.status === "dry_run"),
    "Audit dry run did not include the ready contact."
  );
  assert(
    dryRun.data.deliveries.some((delivery) => delivery.customer?.phone === contacts.blocked.phone && delivery.status === "skipped"),
    "Audit dry run did not skip the consent-blocked contact."
  );
  assert(
    dryRun.data.deliveries.some((delivery) => delivery.customer?.phone === contacts.missingEmail.phone && delivery.status === "skipped"),
    "Audit dry run did not skip the missing-email contact."
  );

  const allDeliveries = await adminJson(`/api/v1/restaurant/promotions/${promotionId}/deliveries`, cookie);
  assert(allDeliveries.response.ok, `Delivery audit failed: ${JSON.stringify(allDeliveries.data)}`);
  assert(allDeliveries.data.audit_counts.consent_blocked_count >= 1, "Audit counts did not include consent blocks.");
  assert(allDeliveries.data.audit_counts.missing_destination_count >= 1, "Audit counts did not include missing destinations.");

  const consentDeliveries = await adminJson(`/api/v1/restaurant/promotions/${promotionId}/deliveries?reason=consent`, cookie);
  assert(consentDeliveries.response.ok, `Consent delivery filter failed: ${JSON.stringify(consentDeliveries.data)}`);
  assert(consentDeliveries.data.reason_filter === "consent", "Consent delivery filter did not echo the reason.");
  assert(
    consentDeliveries.data.deliveries.every((delivery) => delivery.error === "Marketing consent not granted"),
    "Consent filter returned a non-consent delivery."
  );
  assert(
    consentDeliveries.data.deliveries.some((delivery) => delivery.customer?.phone === contacts.blocked.phone),
    "Consent filter did not include the seeded blocked contact."
  );

  const missingDeliveries = await adminJson(`/api/v1/restaurant/promotions/${promotionId}/deliveries?reason=missing_destination`, cookie);
  assert(missingDeliveries.response.ok, `Missing destination delivery filter failed: ${JSON.stringify(missingDeliveries.data)}`);
  assert(
    missingDeliveries.data.deliveries.some((delivery) => delivery.customer?.phone === contacts.missingEmail.phone),
    "Missing destination filter did not include the seeded missing-email contact."
  );

  await screenshotSuppressionAudit(campaignName, contacts.blocked.name);
  console.log(`Campaign suppression audit proof passed for promotion #${promotionId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
