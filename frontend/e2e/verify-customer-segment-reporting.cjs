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

async function createOrder({ name, phone, email, optIn, price }) {
  const order = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: name,
      customer_phone: phone,
      customer_email: email,
      opt_in_marketing: optIn,
      payment_method: "cash",
      notes: "Customer segment reporting proof",
      items: [{ name: "Segment Proof Pizza", quantity: 1, price }],
    }),
  });
  assert(order.response.ok, `Could not seed segment order: ${JSON.stringify(order.data)}`);
  return order.data.order_id || order.data.id;
}

async function seedSegmentCustomers() {
  const suffix = Date.now().toString().slice(-8);
  await createOrder({
    name: `Segment VIP ${suffix}`,
    phone: `79${suffix}01`,
    email: `segment-vip-${suffix}@example.com`,
    optIn: true,
    price: 6200,
  });
  await createOrder({
    name: `Segment Regular ${suffix}`,
    phone: `79${suffix}02`,
    email: `segment-regular-${suffix}@example.com`,
    optIn: true,
    price: 1499,
  });
  await createOrder({
    name: `Segment Cleanup ${suffix}`,
    phone: `79${suffix}03`,
    email: null,
    optIn: true,
    price: 349,
  });
  await createOrder({
    name: `Segment Opted Out ${suffix}`,
    phone: `79${suffix}04`,
    email: `segment-out-${suffix}@example.com`,
    optIn: false,
    price: 899,
  });
  return suffix;
}

async function assertSegmentEndpoint(cookie) {
  const anonymous = await apiJson("/api/v1/restaurant/customers/segments/report");
  assert(anonymous.response.status === 401, `Anonymous segment report should be blocked, got ${anonymous.response.status}.`);

  const response = await apiJson("/api/v1/restaurant/customers/segments/report", {
    headers: { Cookie: cookie },
  });
  assert(response.response.ok, `Customer segment report failed: ${JSON.stringify(response.data)}`);
  assert(response.data.summary.total_customers >= 4, "Segment report did not include seeded customers.");
  assert(response.data.summary.reachable_customers >= 2, "Segment report did not count reachable customers.");
  assert(Array.isArray(response.data.segments), "Segment report did not return segment rows.");
  assert(response.data.segments.some((row) => row.segment === "vip_guests" && row.total_spend > 0), "VIP segment row is missing spend.");
  assert(response.data.segments.some((row) => row.segment === "missing_email" && row.email_gap_count > 0), "Missing-email segment row is missing cleanup gaps.");
  assert(response.data.top_segment && response.data.top_segment.recommended_action, "Segment report did not include a recommended top segment.");
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

async function proveSegmentReport() {
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
    await panel.getByText("Who to target next", { exact: true }).waitFor({ timeout: 15000 });
    await panel.getByText("Best Next Segment", { exact: true }).waitFor({ timeout: 15000 });
    await panel.getByText("Segment Ranking", { exact: true }).waitFor({ timeout: 15000 });
    await panel.getByText("Open Segment Queue", { exact: true }).waitFor({ timeout: 15000 });

    const health = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        textLength: text.trim().length,
        hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
        hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert(health.textLength > 500, "Customer segment report rendered too little content.");
    assert(!health.hasOverlay, "Customer segment report rendered a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Customer segment report rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Customer segment report has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    await panel.screenshot({
      path: path.join(artifactsDir, "visible-customer-segment-reporting.png"),
    });
    watch.assertClean("customer segment reporting");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const cookie = await portalLogin();
  const suffix = await seedSegmentCustomers();
  await assertSegmentEndpoint(cookie);
  await proveSegmentReport();

  console.log(`Customer segment reporting proof passed for seed ${suffix}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
