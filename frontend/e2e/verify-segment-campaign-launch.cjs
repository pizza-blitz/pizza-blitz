const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");

const launchableSegments = new Set([
  "all_customers",
  "marketing_opt_in",
  "repeat_customers",
  "high_spenders",
  "new_guests",
  "regular_guests",
  "vip_guests",
  "active_customers",
  "comeback_customers",
  "win_back_customers",
]);

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

async function seedCampaignCustomer() {
  const suffix = Date.now().toString().slice(-8);
  const customer = {
    name: `Segment Launch VIP ${suffix}`,
    phone: `78${suffix}41`,
    email: `segment-launch-${suffix}@example.com`,
  };
  const order = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: customer.name,
      customer_phone: customer.phone,
      customer_email: customer.email,
      opt_in_marketing: true,
      payment_method: "cash",
      notes: "Segment campaign launch proof",
      items: [{ name: "Segment Launch Party Pack", quantity: 1, price: 7200 }],
    }),
  });
  assert(order.response.ok, `Could not seed segment launch order: ${JSON.stringify(order.data)}`);
  return { ...customer, suffix };
}

async function assertSegmentCampaignEndpoint(cookie, suffix) {
  const anonymous = await apiJson("/api/v1/restaurant/promotions/segment-campaign/marketing_opt_in", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "active", duration_days: 7 }),
  });
  assert(anonymous.response.status === 401, `Anonymous segment launch should be blocked, got ${anonymous.response.status}.`);

  const created = await adminJson("/api/v1/restaurant/promotions/segment-campaign/marketing_opt_in", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "active",
      duration_days: 7,
      code: `SEGM${suffix}`,
      name: "Segment Endpoint Proof",
    }),
  });
  assert(created.response.ok, `Segment campaign endpoint failed: ${JSON.stringify(created.data)}`);
  assert(created.data.status === "segment campaign created", "Segment campaign endpoint returned the wrong status.");
  assert(created.data.audience === "marketing_opt_in", "Segment campaign endpoint targeted the wrong audience.");
  assert(created.data.audience_count >= 1, "Segment campaign endpoint did not count a reachable audience.");
  assert(created.data.promotion.code === `SEGM${suffix}`, "Segment campaign endpoint did not keep the requested code.");
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

async function chooseVisibleSegment(cookie) {
  const report = await adminJson("/api/v1/restaurant/customers/segments/report", cookie);
  assert(report.response.ok, `Customer segment report failed: ${JSON.stringify(report.data)}`);
  const visibleRows = Array.isArray(report.data.segments) ? report.data.segments.slice(0, 6) : [];
  const target = visibleRows.find((row) => launchableSegments.has(row.segment));
  assert(target, "No launchable segment appeared in the visible ranking rows.");
  return target;
}

async function proveSegmentLaunch(target) {
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

    const response = await page.goto(`${baseURL}/reports`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Reports page returned HTTP ${response?.status() || "no response"}.`);
    const panel = page.getByTestId("customer-segment-intelligence");
    await panel.waitFor({ timeout: 20000 });
    await panel.getByText("Customer Segment Intelligence", { exact: true }).waitFor({ timeout: 15000 });
    await panel.getByText("Launch Segment Campaign", { exact: true }).waitFor({ timeout: 15000 });

    const launchButton = panel.getByTestId(`launch-segment-row-${target.segment}`);
    await launchButton.waitFor({ timeout: 15000 });
    await launchButton.click();
    const message = page.getByTestId("segment-launch-message");
    await message.waitFor({ timeout: 20000 });
    await message.getByText(/Created .* for /i).waitFor({ timeout: 15000 });

    const health = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        textLength: text.trim().length,
        hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
        hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert(health.textLength > 500, "Segment campaign launch rendered too little content.");
    assert(!health.hasOverlay, "Segment campaign launch rendered a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Segment campaign launch rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Segment campaign launch has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    await panel.screenshot({
      path: path.join(artifactsDir, "visible-segment-campaign-launch.png"),
    });
    watch.assertClean("segment campaign launch");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const customer = await seedCampaignCustomer();
  const cookie = await portalLogin();
  await assertSegmentCampaignEndpoint(cookie, customer.suffix);
  const target = await chooseVisibleSegment(cookie);
  await proveSegmentLaunch(target);

  console.log(`Segment campaign launch proof passed for ${target.segment} after seeding ${customer.email}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
