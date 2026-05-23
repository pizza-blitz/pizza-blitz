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

async function seedCustomer() {
  const suffix = Date.now().toString().slice(-8);
  const order = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: `Send Queue Proof ${suffix}`,
      customer_phone: `77${suffix}40`,
      customer_email: `send-queue-${suffix}@example.com`,
      opt_in_marketing: true,
      payment_method: "cash",
      notes: "Campaign send queue proof customer",
      items: [{ name: "Send Queue Proof Pizza", quantity: 1, price: 799 }],
    }),
  });
  assert(order.response.ok, `Could not seed send queue customer: ${JSON.stringify(order.data)}`);
  return suffix;
}

async function createActiveCampaign(cookie, suffix) {
  const created = await adminJson("/api/v1/restaurant/promotions/", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Send Queue Proof ${suffix}`,
      code: `SEND${suffix.slice(-4)}`,
      start_date: dateInputValue(0),
      end_date: dateInputValue(5),
      description: "E2E send queue proof",
      discount_type: "percentage",
      discount_value: 13,
      audience: "marketing_opt_in",
      channel: "whatsapp",
      status: "active",
      message_template: "Hi {name}, send queue proof {offer}. Use {code} before {end_date}.",
    }),
  });
  assert(created.response.ok, `Could not create active send queue campaign: ${JSON.stringify(created.data)}`);
  return created.data.promotion;
}

async function assertSendQueueEndpoint(cookie, campaign) {
  const anonymous = await apiJson("/api/v1/restaurant/promotions/send/queue");
  assert(anonymous.response.status === 401, `Anonymous send queue should be blocked, got ${anonymous.response.status}.`);

  const queue = await adminJson("/api/v1/restaurant/promotions/send/queue?limit=50", cookie);
  assert(queue.response.ok, `Send queue failed: ${JSON.stringify(queue.data)}`);
  const row = queue.data.campaigns.find((item) => item.promotion.id === campaign.id);
  assert(row, "Active campaign was missing from send queue.");
  assert(row.ready_count >= 1, `Send queue did not find ready contacts, got ${row.ready_count}.`);
  assert(row.can_dry_run === true, "Send queue did not mark the campaign dry-run ready.");
  assert(row.queue_status === "provider_blocked", `Send queue gave wrong status: ${row.queue_status}.`);
  assert(row.can_send === false, "Provider-blocked campaign should not be live-send enabled.");
  assert(row.live_send_blockers.length >= 1, "Provider-blocked campaign should explain live-send blockers.");
  assert(queue.data.summary.send_ready_contacts >= row.ready_count, "Send queue summary did not count ready contacts.");

  const providerBlocked = await adminJson("/api/v1/restaurant/promotions/send/queue?limit=50&view=provider_blocked", cookie);
  assert(providerBlocked.response.ok, `Provider-blocked send queue failed: ${JSON.stringify(providerBlocked.data)}`);
  assert(providerBlocked.data.summary.view === "provider_blocked", "Provider-blocked queue did not echo the selected view.");
  assert(
    providerBlocked.data.campaigns.some((item) => item.promotion.id === campaign.id),
    "Active campaign was missing from provider-blocked queue view."
  );

  const invalid = await adminJson("/api/v1/restaurant/promotions/send/queue?view=unknown", cookie);
  assert(invalid.response.status === 422, `Invalid send queue view should be rejected, got ${invalid.response.status}.`);
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

async function proveSendQueueInBrowser(campaign) {
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

    const response = await page.goto(`${baseURL}/promotions?campaign=${campaign.id}`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Promotions page returned HTTP ${response?.status() || "no response"}.`);

    const queuePanel = page.getByTestId("campaign-send-queue");
    await queuePanel.waitFor({ timeout: 20000 });
    await queuePanel.getByText("Campaign Send Queue", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId(`send-queue-row-${campaign.id}`).waitFor({ timeout: 15000 });
    await queuePanel.getByText(campaign.name, { exact: true }).waitFor({ timeout: 15000 });

    await Promise.all([
      page.waitForResponse(
        (apiResponse) =>
          apiResponse.url().includes("/promotions/send/queue") &&
          apiResponse.url().includes("view=provider_blocked") &&
          apiResponse.ok(),
        { timeout: 15000 }
      ),
      page.getByTestId("send-queue-filter-provider_blocked").click(),
    ]);
    await page.getByTestId(`send-queue-row-${campaign.id}`).waitFor({ timeout: 15000 });
    const liveSendButton = page.getByTestId(`send-queue-live-send-${campaign.id}`);
    assert(await liveSendButton.isDisabled(), "Provider-blocked campaign should render disabled live-send action.");

    const dryRunResponse = page.waitForResponse(
      (apiResponse) =>
        apiResponse.url().includes(`/promotions/${campaign.id}/send`) &&
        apiResponse.request().method() === "POST" &&
        apiResponse.ok(),
      { timeout: 15000 }
    );
    const refreshedQueue = page.waitForResponse(
      (apiResponse) =>
        apiResponse.url().includes("/promotions/send/queue") &&
        apiResponse.request().method() === "GET" &&
        apiResponse.ok(),
      { timeout: 20000 }
    );
    await page.getByTestId(`send-queue-dry-run-${campaign.id}`).click();
    await dryRunResponse;
    await page.getByText(/Queue dry run checked \d+ contacts/).waitFor({ timeout: 15000 });
    await refreshedQueue;
    await page.waitForFunction(
      () => !(document.body.innerText || "").includes("CHECKING"),
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
    assert(health.textLength > 500, "Campaign send queue rendered too little content.");
    assert(!health.hasOverlay, "Campaign send queue rendered a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Campaign send queue rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Campaign send queue has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    await queuePanel.evaluate((node) => node.scrollIntoView({ block: "start", inline: "nearest" }));
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(artifactsDir, "visible-campaign-send-queue.png"),
    });
    watch.assertClean("campaign send queue");
  } finally {
    await browser.close();
  }
}

async function assertDryRunRecorded(cookie, campaign) {
  const deliveries = await adminJson(`/api/v1/restaurant/promotions/${campaign.id}/deliveries?status=dry_run&limit=50`, cookie);
  assert(deliveries.response.ok, `Could not load campaign dry runs: ${JSON.stringify(deliveries.data)}`);
  assert(deliveries.data.dry_run_count >= 1, "Dry-run delivery audit was not recorded.");

  const queue = await adminJson("/api/v1/restaurant/promotions/send/queue?limit=50", cookie);
  const row = queue.data.campaigns.find((item) => item.promotion.id === campaign.id);
  assert(row?.dry_run_count >= 1, "Send queue did not refresh dry-run count after row action.");

  const providerBlocked = await adminJson("/api/v1/restaurant/promotions/send/queue?limit=50&view=provider_blocked", cookie);
  assert(
    providerBlocked.data.campaigns.some((item) => item.promotion.id === campaign.id && item.queue_status === "provider_blocked"),
    "Dry-run campaign should remain provider-blocked until provider settings are configured."
  );
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const cookie = await portalLogin();
  const suffix = await seedCustomer();
  const campaign = await createActiveCampaign(cookie, suffix);
  await assertSendQueueEndpoint(cookie, campaign);
  await proveSendQueueInBrowser(campaign);
  await assertDryRunRecorded(cookie, campaign);

  console.log(`Campaign send queue proof passed for promotion #${campaign.id}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
