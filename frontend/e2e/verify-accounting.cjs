/* Accounting proof: GST summary, payment/store tables, CSV export. */
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

function cookieHeaderFromSetCookie(setCookie) {
  if (!setCookie) return "";
  return setCookie
    .split(/,(?=[^;]+=)/)
    .map((part) => part.split(";")[0].trim())
    .join("; ");
}

async function waitForHttp(url, label) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < 30000) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok || response.status === 401) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`${label} did not become ready at ${url}: ${lastError}`);
}

async function api(token, endpoint, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const login = await api(null, "/api/v1/auth/admin/login", {
    method: "POST",
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  });
  assert(login.response.ok, "Admin login failed.");
  const token = login.data.access_token;

  const created = await api(token, "/api/v1/restaurant/orders/", {
    method: "POST",
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Accounting Proof Guest",
      customer_phone: `98${String(Date.now()).slice(-8)}`,
      payment_method: "cash",
      tip_amount: 20,
      items: [{ name: "Garlic Bread", quantity: 2, price: 119 }],
    }),
  });
  assert(created.response.ok, `Order failed: ${JSON.stringify(created.data)}`);

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(portalLogin.ok, `Portal login failed: ${await portalLogin.text()}`);
  const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.addCookies(
      cookie
        .split(/;\s*/)
        .filter(Boolean)
        .map((pair) => {
          const [name, ...rest] = pair.split("=");
          return {
            name,
            value: rest.join("="),
            url: baseURL,
            httpOnly: true,
            sameSite: "Lax",
          };
        })
    );
    const page = await context.newPage();
    await page.goto(`${baseURL}/accounting`, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="accounting-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    await page.waitForFunction(
      () => {
        const element = document.querySelector('[data-testid="accounting-gross"]');
        return element ? /[1-9]/.test(element.textContent || "") : false;
      },
      null,
      { timeout: 20000 }
    );

    const gross = await page.getByTestId("accounting-gross").innerText();
    const tax = await page.getByTestId("accounting-tax").innerText();
    const net = await page.getByTestId("accounting-net").innerText();
    assert(/Rs/.test(gross), `Gross card read "${gross}".`);
    assert(/Rs/.test(tax), `Tax card read "${tax}".`);
    assert(/Rs/.test(net), `Net card read "${net}".`);

    const paymentText = (await page.getByTestId("accounting-payment-table").innerText()).toLowerCase();
    assert(paymentText.includes("cash"), "Payment mix did not show cash.");
    const storeText = (await page.getByTestId("accounting-store-table").innerText()).toLowerCase();
    assert(storeText.includes("main"), "Store totals did not show MAIN.");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-accounting-gst.png"),
      fullPage: false,
    });

    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const exported = await fetch(
      `${apiURL}/api/v1/restaurant/accounting/export?start_date=${today}&end_date=${today}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    assert(exported.ok, "Accounting CSV export failed.");
    const csv = await exported.text();
    assert(csv.includes("cgst"), "CSV header did not include cgst.");
    assert(
      csv.split(/\r?\n/).some((line) => line.startsWith(String(created.data.order_id))),
      "CSV did not include the created order."
    );

    console.log("Accounting proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
