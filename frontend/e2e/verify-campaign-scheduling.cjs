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
      customer_name: `Scheduling Proof ${suffix}`,
      customer_phone: `77${suffix}10`,
      customer_email: `campaign-schedule-${suffix}@example.com`,
      opt_in_marketing: true,
      payment_method: "cash",
      notes: "Campaign scheduling proof customer",
      items: [{ name: "Scheduling Proof Pizza", quantity: 1, price: 799 }],
    }),
  });
  assert(order.response.ok, `Could not seed scheduling customer: ${JSON.stringify(order.data)}`);
  return suffix;
}

async function createCampaign(cookie, suffix) {
  const created = await adminJson("/api/v1/restaurant/promotions/", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Scheduled Send Proof ${suffix}`,
      code: `SCH${suffix}`,
      start_date: dateInputValue(),
      end_date: dateInputValue(),
      description: "Proof campaign for future scheduling guard",
      discount_type: "percentage",
      discount_value: 9,
      audience: "marketing_opt_in",
      channel: "whatsapp",
      status: "active",
      message_template: "Hi {name}, schedule proof offer {offer}. Use {code} before {end_date}.",
    }),
  });
  assert(created.response.ok, `Could not create scheduling campaign: ${JSON.stringify(created.data)}`);
  return created.data.promotion;
}

async function assertAnonymousScheduleBlocked(promotionId) {
  const anonymous = await apiJson(`/api/v1/restaurant/promotions/${promotionId}/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start_date: dateInputValue(1), duration_days: 5 }),
  });
  assert(anonymous.response.status === 401, `Anonymous schedule should be blocked, got ${anonymous.response.status}.`);
}

async function assertScheduledSendGuard(cookie, promotionId) {
  const liveSend = await adminJson(`/api/v1/restaurant/promotions/${promotionId}/send`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: false, limit: 1 }),
  });
  assert(liveSend.response.status === 409, `Future scheduled live send should be blocked, got ${liveSend.response.status}.`);
  assert(/not due until/i.test(liveSend.data.detail || ""), `Future send guard returned unexpected detail: ${JSON.stringify(liveSend.data)}`);

  const dryRun = await adminJson(`/api/v1/restaurant/promotions/${promotionId}/send`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true, limit: 1 }),
  });
  assert(dryRun.response.ok, `Future scheduled dry run should be allowed: ${JSON.stringify(dryRun.data)}`);
  assert(dryRun.data.dry_run === true, "Dry-run response did not preserve dry_run=true.");
  assert(dryRun.data.attempted_count >= 1, "Dry-run did not inspect any contacts.");
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

async function scheduleInBrowser(promotion) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/promotions?campaign=${promotion.id}`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Promotions page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByTestId("campaign-schedule-panel").waitFor({ timeout: 20000 });
    await page.getByText("Campaign Schedule", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole("heading", { name: promotion.name, exact: true }).waitFor({ timeout: 15000 });
    await page.getByLabel("Start Date").fill(dateInputValue(1));
    await page.getByLabel("Duration Days").fill("5");
    await page.getByTestId("schedule-campaign-button").click();
    await page.getByText(`Scheduled ${promotion.name} for ${dateInputValue(1)}.`, { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText(`Queued for ${dateInputValue(1)}`, { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Live send held", { exact: true }).waitFor({ timeout: 15000 });

    const health = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        textLength: text.trim().length,
        hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
        hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert(health.textLength > 500, "Campaign scheduling rendered too little content.");
    assert(!health.hasOverlay, "Campaign scheduling rendered a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Campaign scheduling rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Campaign scheduling has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    await page.getByTestId("campaign-schedule-panel").screenshot({
      path: path.join(artifactsDir, "visible-campaign-scheduling.png"),
    });
    watch.assertClean("campaign scheduling");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const cookie = await portalLogin();
  const suffix = await seedCustomer();
  const promotion = await createCampaign(cookie, suffix);
  await assertAnonymousScheduleBlocked(promotion.id);
  await scheduleInBrowser(promotion);
  await assertScheduledSendGuard(cookie, promotion.id);

  console.log(`Campaign scheduling proof passed for promotion ${promotion.id}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
