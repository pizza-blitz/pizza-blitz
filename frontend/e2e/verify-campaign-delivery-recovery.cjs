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

async function seedMarketingCustomer({ withEmail, suffix }) {
  const phone = `${withEmail ? "94" : "93"}${suffix}`;
  const email = withEmail ? `delivery-recovery-${suffix}@example.com` : null;
  const result = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: withEmail ? "Recovery Ready Customer" : "Recovery Missing Email Customer",
      customer_phone: phone,
      customer_email: email,
      opt_in_marketing: true,
      payment_method: "cash",
      notes: "Delivery recovery proof seed",
      items: [{ name: "Recovery Proof Pizza", quantity: 1, price: 299 }],
    }),
  });
  assert(result.response.ok, `Could not seed ${withEmail ? "ready" : "missing email"} customer: ${JSON.stringify(result.data)}`);
  return { phone, email };
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

async function screenshotRecovery(campaignName) {
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
    await page.getByTestId("messaging-readiness-command").waitFor({ timeout: 15000 });
    await page.getByText(campaignName, { exact: true }).first().click();
    await page.getByText("Delivery Recovery", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /Needs Attention/i }).click();
    await page.getByTestId("delivery-reason-filter-missing_destination").click();
    await page.getByText("Add or correct the customer's email address.", { exact: false }).first().waitFor({ timeout: 15000 });

    const health = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        textLength: text.trim().length,
        hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
        hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert(health.textLength > 300, "Promotions recovery view rendered too little content.");
    assert(!health.hasOverlay, "Promotions recovery view rendered a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Promotions recovery view rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Promotions recovery view has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    await page.screenshot({
      path: path.join(artifactsDir, "visible-campaign-delivery-recovery.png"),
      fullPage: true,
    });
    watch.assertClean("campaign delivery recovery");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const suffix = Date.now().toString().slice(-8);
  const readyCustomer = await seedMarketingCustomer({ withEmail: true, suffix });
  const missingEmailCustomer = await seedMarketingCustomer({ withEmail: false, suffix });
  const cookie = await portalLogin();

  const today = new Date();
  const endDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const campaignName = `Delivery Recovery Proof ${suffix}`;
  const promotionResult = await adminJson("/api/v1/restaurant/promotions/", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: campaignName,
      code: `REC${suffix.slice(-6)}`,
      start_date: today.toISOString().slice(0, 10),
      end_date: endDate.toISOString().slice(0, 10),
      description: "E2E delivery recovery proof",
      discount_type: "percentage",
      discount_value: 10,
      audience: "marketing_opt_in",
      channel: "email",
      status: "active",
      message_template: "Hi {name}, use {code} for {offer}.",
    }),
  });
  assert(promotionResult.response.ok, `Could not create recovery campaign: ${JSON.stringify(promotionResult.data)}`);
  const promotionId = promotionResult.data.promotion.id;

  const dryRun = await adminJson(`/api/v1/restaurant/promotions/${promotionId}/send`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true, limit: 25 }),
  });
  assert(dryRun.response.ok, `Dry run failed: ${JSON.stringify(dryRun.data)}`);
  assert(
    dryRun.data.deliveries.some((delivery) => delivery.destination === readyCustomer.email && delivery.status === "dry_run"),
    "Dry run did not include the ready email customer."
  );
  assert(
    dryRun.data.deliveries.some((delivery) => delivery.customer_id && delivery.status === "skipped"),
    "Dry run did not record a skipped delivery for the missing-email customer."
  );

  const allDeliveries = await adminJson(`/api/v1/restaurant/promotions/${promotionId}/deliveries`, cookie);
  assert(allDeliveries.response.ok, `Delivery history failed: ${JSON.stringify(allDeliveries.data)}`);
  assert(allDeliveries.data.dry_run_count >= 1, "Delivery history did not count dry runs.");
  assert(allDeliveries.data.needs_attention_count >= 1, "Delivery history did not count needs-attention rows.");

  const needsAttention = await adminJson(`/api/v1/restaurant/promotions/${promotionId}/deliveries?status=needs_attention`, cookie);
  assert(needsAttention.response.ok, `Needs-attention filter failed: ${JSON.stringify(needsAttention.data)}`);
  assert(needsAttention.data.status_filter === "needs_attention", "Needs-attention filter did not echo the active filter.");
  assert(needsAttention.data.deliveries.every((delivery) => ["failed", "skipped"].includes(delivery.status)), "Needs-attention filter returned a resolved delivery.");
  assert(
    needsAttention.data.deliveries.some(
      (delivery) =>
        delivery.customer?.phone === missingEmailCustomer.phone &&
        delivery.recovery_action.includes("email")
    ),
    "Needs-attention delivery did not include customer context and email recovery guidance."
  );

  const invalidFilter = await adminJson(`/api/v1/restaurant/promotions/${promotionId}/deliveries?status=unknown`, cookie);
  assert(invalidFilter.response.status === 422, `Invalid filter should be rejected, got ${invalidFilter.response.status}.`);

  await screenshotRecovery(campaignName);
  console.log(`Campaign delivery recovery proof passed for promotion #${promotionId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
