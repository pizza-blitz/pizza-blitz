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

async function seedOrder({ phone, name, email, itemName = "Margherita Pizza (R)", price, quantity = 1, note }) {
  const { response, data } = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: name,
      customer_phone: phone,
      customer_email: email,
      opt_in_marketing: true,
      payment_method: "cash",
      notes: note,
      items: [{ name: itemName, quantity, price }],
    }),
  });
  assert(response.ok, `Could not seed customer order: ${JSON.stringify(data)}`);
}

async function seedRetentionCustomers() {
  const suffix = Date.now().toString().slice(-8);
  const regularPhone = `96${suffix}`;
  const vipPhone = `95${suffix}`;

  for (let index = 0; index < 3; index += 1) {
    await seedOrder({
      phone: regularPhone,
      name: "Retention Regular Proof",
      email: `regular-${suffix}@example.com`,
      price: 299,
      note: `Retention regular proof ${index + 1}`,
    });
  }
  await seedOrder({
    phone: vipPhone,
    name: "Retention VIP Proof",
    email: `vip-${suffix}@example.com`,
    itemName: "VIP Party Pack Proof",
    price: 5200,
    note: "Retention VIP proof",
  });

  return { regularPhone, vipPhone };
}

function createBrowserWatch(page) {
  const issues = [];
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico|images\.unsplash\.com/i.test(text)) return;
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

async function screenshotRetentionDashboard(vipPhone) {
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

    const response = await page.goto(`${baseURL}/customers`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Customers page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByText("Retention Command Center", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Customer loyalty and win-back queue", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByText("VIP Slice Club", { exact: false }).first().waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /^VIP$/i }).click();
    await page.getByText(vipPhone, { exact: false }).first().waitFor({ timeout: 15000 });

    const health = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        textLength: text.trim().length,
        hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
        hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert(health.textLength > 300, "Customers page rendered too little content.");
    assert(!health.hasOverlay, "Customers page rendered a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Customers page rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Customers page has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    await page.screenshot({
      path: path.join(artifactsDir, "visible-customer-retention-dashboard.png"),
      fullPage: true,
    });
    watch.assertClean("customer retention dashboard");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const anonymousRetention = await apiJson("/api/v1/restaurant/customers/retention");
  assert(anonymousRetention.response.status === 401, `Anonymous retention should be blocked, got ${anonymousRetention.response.status}.`);

  const { regularPhone, vipPhone } = await seedRetentionCustomers();
  const cookie = await portalLogin();

  const retention = await adminJson("/api/v1/restaurant/customers/retention", cookie);
  assert(retention.response.ok, `Admin retention failed: ${JSON.stringify(retention.data)}`);
  assert(retention.data.counts.regular_guests >= 1, "Retention counts did not include regular guests.");
  assert(retention.data.counts.vip_guests >= 1, "Retention counts did not include VIP guests.");
  assert(
    retention.data.customers.some((customer) => customer.phone === vipPhone && customer.tier === "VIP Slice Club"),
    "Retention rows did not include the seeded VIP customer."
  );

  const regularSegment = await adminJson("/api/v1/restaurant/customers/?segment=regular_guests", cookie);
  assert(regularSegment.response.ok, `Regular segment failed: ${JSON.stringify(regularSegment.data)}`);
  assert(
    regularSegment.data.some((customer) => customer.phone === regularPhone),
    "Regular segment did not include the seeded regular customer."
  );

  await screenshotRetentionDashboard(vipPhone);
  console.log(`Customer retention dashboard proof passed for VIP ${vipPhone}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
