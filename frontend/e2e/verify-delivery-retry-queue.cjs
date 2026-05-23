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

function dateInputValue(offsetDays = 0) {
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + offsetDays);
  return nextDate.toISOString().slice(0, 10);
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
      phone: `73${suffix}10`,
      name: `Retry Ready ${suffix}`,
      email: `retry-ready-${suffix}@example.com`,
      opt_in_marketing: true,
    },
    missingEmail: {
      phone: `73${suffix}20`,
      name: `Retry Missing Email ${suffix}`,
      email: null,
      fixedEmail: `retry-fixed-${suffix}@example.com`,
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
        notes: "Delivery retry queue proof",
        items: [{ name: "Retry Queue Pizza", quantity: 1, price: 399 }],
      }),
    });
    assert(order.response.ok, `Could not seed retry contact: ${JSON.stringify(order.data)}`);
  }

  return { suffix, contacts };
}

async function findCustomer(cookie, phone) {
  const result = await adminJson(`/api/v1/restaurant/customers/?q=${encodeURIComponent(phone)}`, cookie);
  assert(result.response.ok, `Customer lookup failed: ${JSON.stringify(result.data)}`);
  const customer = result.data.find((row) => row.phone === phone);
  assert(customer, `Could not find seeded customer ${phone}.`);
  return customer;
}

async function createCampaign(cookie, suffix) {
  const created = await adminJson("/api/v1/restaurant/promotions/", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Delivery Retry Proof ${suffix}`,
      code: `RETRY${suffix.slice(-4)}`,
      start_date: dateInputValue(0),
      end_date: dateInputValue(7),
      description: "E2E targeted delivery retry proof",
      discount_type: "percentage",
      discount_value: 12,
      audience: "marketing_opt_in",
      channel: "email",
      status: "active",
      message_template: "Hi {name}, retry proof offer {offer}. Use {code}.",
    }),
  });
  assert(created.response.ok, `Could not create retry campaign: ${JSON.stringify(created.data)}`);
  return created.data.promotion;
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

async function proveRetryInBrowser(campaign) {
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

    const response = await page.goto(`${baseURL}/promotions?campaign=${campaign.id}`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Promotions page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByText(campaign.name, { exact: true }).first().waitFor({ timeout: 15000 });
    await page.getByText("Delivery Recovery", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("delivery-provider-gate").waitFor({ timeout: 15000 });

    await Promise.all([
      page.waitForResponse(
        (apiResponse) =>
          apiResponse.url().includes(`/promotions/${campaign.id}/deliveries`) &&
          apiResponse.url().includes("reason=missing_destination") &&
          apiResponse.ok(),
        { timeout: 15000 }
      ),
      page.getByTestId("delivery-reason-filter-missing_destination").click(),
    ]);
    await page.waitForFunction(() => {
      const button = document.querySelector("[data-testid='retry-current-delivery-issue']");
      return button && !button.hasAttribute("disabled");
    });

    const [retryResponse] = await Promise.all([
      page.waitForResponse(
        (apiResponse) =>
          apiResponse.url().includes(`/promotions/${campaign.id}/deliveries/retry`) &&
          apiResponse.request().method() === "POST" &&
          apiResponse.ok(),
        { timeout: 15000 }
      ),
      page.getByTestId("retry-current-delivery-issue").click(),
    ]);
    const retry = await retryResponse.json();
    assert(retry.retried_customer_count >= 1, "Retry endpoint did not retry the fixed customer.");
    assert(retry.dry_run_count >= 1, "Retry endpoint did not create a dry-run recovery row.");
    await page.getByText(/Retried \d+ customers from Missing Destination/i).waitFor({ timeout: 15000 });
    await page.waitForFunction(
      () => !(document.body.innerText || "").includes("RETRYING"),
      undefined,
      { timeout: 20000 }
    );

    const health = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        textLength: text.trim().length,
        hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
        hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert(health.textLength > 500, "Delivery retry view rendered too little content.");
    assert(!health.hasOverlay, "Delivery retry view rendered a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Delivery retry view rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Delivery retry view has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    const recoveryPanel = page.getByTestId("delivery-recovery-panel");
    await recoveryPanel.evaluate((node) => node.scrollIntoView({ block: "start", inline: "nearest" }));
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(artifactsDir, "visible-delivery-retry-queue.png"),
    });
    watch.assertClean("delivery retry queue");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const cookie = await portalLogin();
  const { suffix, contacts } = await seedContacts();
  const missingEmailCustomer = await findCustomer(cookie, contacts.missingEmail.phone);
  const campaign = await createCampaign(cookie, suffix);

  const initialDryRun = await adminJson(`/api/v1/restaurant/promotions/${campaign.id}/send`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true, limit: 50 }),
  });
  assert(initialDryRun.response.ok, `Initial dry run failed: ${JSON.stringify(initialDryRun.data)}`);
  assert(
    initialDryRun.data.deliveries.some(
      (delivery) =>
        delivery.customer?.phone === contacts.missingEmail.phone &&
        delivery.status === "skipped"
    ),
    "Initial dry run did not create a missing-destination recovery issue."
  );

  const anonymousRetry = await apiJson(`/api/v1/restaurant/promotions/${campaign.id}/deliveries/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true, reason: "missing_destination" }),
  });
  assert(anonymousRetry.response.status === 401, `Anonymous retry should be blocked, got ${anonymousRetry.response.status}.`);

  const invalidRetry = await adminJson(`/api/v1/restaurant/promotions/${campaign.id}/deliveries/retry`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true, status: "dry_run", reason: "missing_destination" }),
  });
  assert(invalidRetry.response.status === 422, `Invalid retry status should be rejected, got ${invalidRetry.response.status}.`);

  const fixed = await adminJson(`/api/v1/restaurant/customers/${missingEmailCustomer.id}`, cookie, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: contacts.missingEmail.fixedEmail }),
  });
  assert(fixed.response.ok, `Could not fix missing email: ${JSON.stringify(fixed.data)}`);

  await proveRetryInBrowser(campaign);

  const dryRuns = await adminJson(`/api/v1/restaurant/promotions/${campaign.id}/deliveries?status=dry_run&limit=50`, cookie);
  assert(dryRuns.response.ok, `Could not reload dry-run deliveries: ${JSON.stringify(dryRuns.data)}`);
  assert(
    dryRuns.data.deliveries.some(
      (delivery) =>
        delivery.customer?.phone === contacts.missingEmail.phone &&
        delivery.destination === contacts.missingEmail.fixedEmail
    ),
    "Targeted retry did not record a dry-run delivery for the fixed customer."
  );

  console.log(`Delivery retry queue proof passed for promotion #${campaign.id}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
