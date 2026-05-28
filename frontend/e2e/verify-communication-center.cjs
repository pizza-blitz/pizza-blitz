const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
  const data = await response.json().catch(() => ({}));
  assert(response.ok, `Admin portal login failed: ${JSON.stringify(data)}`);
  const cookie = cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
  assert(cookie.includes("pb_admin_session="), "Admin login did not return an admin session cookie.");
  return cookie;
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

async function waitForDryRunProof(campaignId, cookie) {
  const startedAt = Date.now();
  let latest = null;
  while (Date.now() - startedAt < 90000) {
    const result = await adminJson(`/api/v1/restaurant/promotions/${campaignId}/deliveries`, cookie);
    assert(result.response.ok, `Could not fetch dry-run proof: ${JSON.stringify(result.data)}`);
    latest = result.data;
    if (result.data.dry_run_count > 0) return result.data;
    await sleep(1500);
  }
  throw new Error(`Communication center dry-run action did not record dry-run deliveries: ${JSON.stringify(latest)}`);
}

async function seedCommunicationProof(cookie) {
  const suffix = Date.now().toString().slice(-8);
  const contactPhone = `82${suffix}`;
  const contactEmail = `comms-${suffix}@example.com`;
  const missingPhone = `81${suffix}`;
  const repairedEmail = `comms-fixed-${suffix}@example.com`;

  const order = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: `Comms Proof ${suffix}`,
      customer_phone: contactPhone,
      customer_email: contactEmail,
      opt_in_marketing: true,
      payment_method: "cash",
      notes: "Communication center proof contact",
      items: [{ name: "Comms Proof Pizza", quantity: 1, price: 299 }],
    }),
  });
  assert(order.response.ok, `Could not seed communication contact: ${JSON.stringify(order.data)}`);

  const missingOrder = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: `Comms Missing Email ${suffix}`,
      customer_phone: missingPhone,
      customer_email: null,
      opt_in_marketing: true,
      payment_method: "cash",
      notes: "Communication center cleanup proof contact",
      items: [{ name: "Comms Cleanup Pizza", quantity: 1, price: 249 }],
    }),
  });
  assert(missingOrder.response.ok, `Could not seed communication cleanup contact: ${JSON.stringify(missingOrder.data)}`);

  const missingLookup = await adminJson(`/api/v1/restaurant/customers/?q=${missingPhone}`, cookie);
  assert(missingLookup.response.ok, `Could not look up cleanup contact: ${JSON.stringify(missingLookup.data)}`);
  const missingCustomer = missingLookup.data.find((customer) => customer.phone === missingPhone);
  assert(missingCustomer?.id, `Could not find cleanup contact ${missingPhone}.`);

  const today = new Date();
  const endDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const code = `COM${suffix.slice(-5)}`;
  const name = `Communication Center Proof ${suffix}`;
  const campaign = await adminJson("/api/v1/restaurant/promotions/", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      code,
      start_date: today.toISOString().slice(0, 10),
      end_date: endDate.toISOString().slice(0, 10),
      description: "E2E communication center proof",
      discount_type: "percentage",
      discount_value: 10,
      audience: "marketing_opt_in",
      channel: "email",
      status: "active",
      message_template: "Hi {name}, Pizza Blitz has {offer}. Use {code}. Order here: {order_link}",
    }),
  });
  assert(campaign.response.ok, `Could not create communication campaign: ${JSON.stringify(campaign.data)}`);
  const campaignId = campaign.data.promotion.id;

  return {
    campaignId,
    name,
    code,
    contactPhone,
    contactEmail,
    missingPhone,
    missingCustomerId: missingCustomer.id,
    repairedEmail,
  };
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

async function assertHealthyPage(page, label) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => undefined);
  const health = await page.evaluate(() => {
    const text = document.body.innerText || "";
    return {
      textLength: text.trim().length,
      hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
      hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
      bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  assert(health.textLength > 800, `${label} rendered too little content.`);
  assert(!health.hasOverlay, `${label} has a Next.js error overlay.`);
  assert(!health.hasFrameworkError, `${label} rendered framework error text.`);
  assert(health.bodyOverflow <= 8, `${label} has body-level horizontal overflow of ${health.bodyOverflow}px.`);
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const adminCookie = await portalLogin();
  const proof = await seedCommunicationProof(adminCookie);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/communications`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Communications page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: "Messaging command board" }).waitFor({ timeout: 20000 });
    await page.getByTestId("communications-metrics").waitFor({ timeout: 20000 });
    await page.getByTestId("communications-provider-status").waitFor({ timeout: 20000 });
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid="communications-channel-whatsapp"], [data-testid="communications-channel-sms"], [data-testid="communications-channel-email"]').length === 3,
      null,
      { timeout: 60000 }
    );
    await page.getByTestId("communications-send-queue").waitFor({ timeout: 20000 });
    await page.getByTestId("communications-segments").waitFor({ timeout: 20000 });
    await page.getByTestId("communications-next-action").waitFor({ timeout: 20000 });
    await page.getByTestId("communications-performance").waitFor({ timeout: 20000 });
    await page.getByTestId("communications-recent-events").waitFor({ timeout: 20000 });

    const bodyText = await page.locator("body").innerText();
    assert(/reachable/i.test(bodyText), "Communications metrics did not include reachable contact status.");
    assert(/ready to send/i.test(bodyText), "Communications metrics did not include send queue status.");
    assert(/provider readiness/i.test(bodyText), "Communications page missed provider readiness section.");
    assert(bodyText.includes(proof.name), `Communications page did not surface seeded campaign ${proof.name}.`);

    await page.getByTestId(`communications-review-contacts-${proof.campaignId}`).waitFor({ timeout: 60000 });
    await page.getByTestId(`communications-review-contacts-${proof.campaignId}`).click();
    await page.getByTestId("communications-cleanup-review").waitFor({ timeout: 30000 });
    await page.getByTestId(`communications-cleanup-contact-${proof.missingCustomerId}`).waitFor({ timeout: 30000 });
    const cleanupBefore = await page.getByTestId(`communications-cleanup-contact-${proof.missingCustomerId}`).innerText();
    assert(/missing email/i.test(cleanupBefore), `Cleanup review did not show missing email blocker: ${cleanupBefore}`);
    await page.getByTestId(`communications-cleanup-email-${proof.missingCustomerId}`).fill(proof.repairedEmail);
    await page.getByTestId(`communications-save-cleanup-${proof.missingCustomerId}`).click();
    await page
      .getByTestId("communications-message")
      .getByText(new RegExp(`Updated .*${proof.missingPhone}|Updated .*cleanup`, "i"))
      .waitFor({ timeout: 30000 });
    const repairedLookup = await adminJson(`/api/v1/restaurant/customers/?q=${proof.missingPhone}`, adminCookie);
    assert(repairedLookup.response.ok, `Could not recheck cleanup contact: ${JSON.stringify(repairedLookup.data)}`);
    const repairedCustomer = repairedLookup.data.find((customer) => customer.phone === proof.missingPhone);
    assert(
      repairedCustomer?.email === proof.repairedEmail,
      `Cleanup email was not saved. Expected ${proof.repairedEmail}, got ${repairedCustomer?.email}.`
    );
    await page.getByTestId(`communications-cleanup-contact-${proof.missingCustomerId}`).getByText("Ready").waitFor({ timeout: 30000 });

    await page.getByTestId(`communications-run-dry-run-${proof.campaignId}`).waitFor({ timeout: 60000 });
    const beforeDryRun = await adminJson(`/api/v1/restaurant/promotions/${proof.campaignId}/deliveries`, adminCookie);
    assert(beforeDryRun.response.ok, `Could not precheck dry-run proof: ${JSON.stringify(beforeDryRun.data)}`);
    assert(beforeDryRun.data.dry_run_count === 0, `Seeded campaign already had dry-runs before click: ${JSON.stringify(beforeDryRun.data)}`);
    await page.getByTestId(`communications-run-dry-run-${proof.campaignId}`).click();
    const dryRunResult = await waitForDryRunProof(proof.campaignId, adminCookie);
    assert(dryRunResult.dry_run_count > 0, "Communication center dry-run action did not record dry-run deliveries.");
    await page.getByTestId("communications-refresh").click();
    await page.getByTestId("communications-recent-events").getByText(/dry run/i).first().waitFor({ timeout: 30000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-communication-center.png"),
      fullPage: true,
    });

    watch.assertClean("communication center proof");
  } finally {
    await browser.close();
  }

  console.log(`Communication center proof passed for campaign #${proof.campaignId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
