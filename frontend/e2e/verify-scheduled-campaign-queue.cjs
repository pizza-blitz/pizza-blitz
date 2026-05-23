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
      customer_name: `Queue Proof ${suffix}`,
      customer_phone: `76${suffix}30`,
      customer_email: `campaign-queue-${suffix}@example.com`,
      opt_in_marketing: true,
      payment_method: "cash",
      notes: "Scheduled campaign queue proof customer",
      items: [{ name: "Queue Proof Pizza", quantity: 1, price: 899 }],
    }),
  });
  assert(order.response.ok, `Could not seed queue customer: ${JSON.stringify(order.data)}`);
  return suffix;
}

async function createScheduledCampaign(cookie, suffix, offsetDays, label) {
  const created = await adminJson("/api/v1/restaurant/promotions/", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `${label} Queue Proof ${suffix}`,
      code: `${label.slice(0, 3).toUpperCase()}${suffix}`,
      start_date: dateInputValue(offsetDays),
      end_date: dateInputValue(offsetDays + 4),
      description: `${label} scheduled campaign queue proof`,
      discount_type: "percentage",
      discount_value: label === "Due" ? 11 : 7,
      audience: "marketing_opt_in",
      channel: "whatsapp",
      status: "scheduled",
      message_template: "Hi {name}, queue proof offer {offer}. Use {code} before {end_date}.",
    }),
  });
  assert(created.response.ok, `Could not create ${label} scheduled campaign: ${JSON.stringify(created.data)}`);
  return created.data.promotion;
}

async function assertQueueEndpoint(cookie, dueCampaign, upcomingCampaign) {
  const anonymous = await apiJson("/api/v1/restaurant/promotions/schedule/queue");
  assert(anonymous.response.status === 401, `Anonymous schedule queue should be blocked, got ${anonymous.response.status}.`);

  const queue = await adminJson("/api/v1/restaurant/promotions/schedule/queue?limit=50", cookie);
  assert(queue.response.ok, `Schedule queue failed: ${JSON.stringify(queue.data)}`);
  const dueRow = queue.data.campaigns.find((row) => row.promotion.id === dueCampaign.id);
  const upcomingRow = queue.data.campaigns.find((row) => row.promotion.id === upcomingCampaign.id);
  assert(dueRow, "Due campaign was missing from schedule queue.");
  assert(upcomingRow, "Upcoming campaign was missing from schedule queue.");
  assert(dueRow.phase === "due_today", `Due campaign had wrong phase: ${dueRow.phase}.`);
  assert(dueRow.can_activate === true, "Due campaign was not activatable.");
  assert(upcomingRow.phase === "upcoming", `Upcoming campaign had wrong phase: ${upcomingRow.phase}.`);
  assert(queue.data.summary.due_today_count >= 1, "Queue summary did not count due campaigns.");
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

async function activateQueueInBrowser(dueCampaign, upcomingCampaign) {
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

    const response = await page.goto(`${baseURL}/promotions?campaign=${dueCampaign.id}`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Promotions page returned HTTP ${response?.status() || "no response"}.`);
    const queuePanel = page.getByTestId("scheduled-campaign-queue");
    await queuePanel.waitFor({ timeout: 20000 });
    await queuePanel.getByText("Scheduled Campaign Queue", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId(`scheduled-queue-row-${dueCampaign.id}`).waitFor({ timeout: 15000 });
    await page.getByTestId(`scheduled-queue-row-${upcomingCampaign.id}`).waitFor({ timeout: 15000 });
    await queuePanel.getByText("Due Today", { exact: true }).first().waitFor({ timeout: 15000 });

    await page.getByTestId("activate-due-campaigns").click();
    await page.getByText(/Activated \d+ due scheduled campaigns\./).waitFor({ timeout: 20000 });
    await queuePanel.getByText(upcomingCampaign.name, { exact: true }).waitFor({ timeout: 15000 });

    const health = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        textLength: text.trim().length,
        hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
        hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert(health.textLength > 500, "Scheduled campaign queue rendered too little content.");
    assert(!health.hasOverlay, "Scheduled campaign queue rendered a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Scheduled campaign queue rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Scheduled campaign queue has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    await queuePanel.screenshot({
      path: path.join(artifactsDir, "visible-scheduled-campaign-queue.png"),
    });
    watch.assertClean("scheduled campaign queue");
  } finally {
    await browser.close();
  }
}

async function assertActivationResult(cookie, dueCampaign, upcomingCampaign) {
  const promotions = await adminJson("/api/v1/restaurant/promotions/", cookie);
  assert(promotions.response.ok, `Could not reload promotions: ${JSON.stringify(promotions.data)}`);
  const due = promotions.data.find((promotion) => promotion.id === dueCampaign.id);
  const upcoming = promotions.data.find((promotion) => promotion.id === upcomingCampaign.id);
  assert(due?.status === "active", `Due campaign was not activated, got ${due?.status}.`);
  assert(upcoming?.status === "scheduled", `Upcoming campaign should remain scheduled, got ${upcoming?.status}.`);
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const cookie = await portalLogin();
  const suffix = await seedCustomer();
  const dueCampaign = await createScheduledCampaign(cookie, suffix, 0, "Due");
  const upcomingCampaign = await createScheduledCampaign(cookie, suffix, 2, "Upcoming");
  await assertQueueEndpoint(cookie, dueCampaign, upcomingCampaign);
  await activateQueueInBrowser(dueCampaign, upcomingCampaign);
  await assertActivationResult(cookie, dueCampaign, upcomingCampaign);

  console.log(`Scheduled campaign queue proof passed for due campaign ${dueCampaign.id}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
