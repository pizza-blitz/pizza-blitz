/* Multi-store proof: create a franchise, tag an order, consolidated reporting. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
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

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(portalLogin.ok, `Portal login failed: ${await portalLogin.text()}`);
  const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));

  const storeCode = `IND${String(Date.now()).slice(-6)}`;
  const storeName = "Pizza Blitz Indiranagar";

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
    await page.goto(`${baseURL}/settings/stores`, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="stores-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });

    await page.getByTestId("store-name").fill(storeName);
    await page.getByTestId("store-code").fill(storeCode);
    await page.getByTestId("store-address").fill("100 Franchise Road, Bengaluru");
    await page.getByTestId("store-phone").fill("08012345678");
    await page.getByTestId("create-store").click();
    await page
      .getByTestId("stores-page")
      .getByText(`${storeName} added to the franchise.`)
      .waitFor({ timeout: 20000 });

    const listed = await api(token, "/api/v1/restaurant/stores/?days=30");
    assert(listed.response.ok, "Stores API failed.");
    const store = listed.data.stores.find((row) => row.code === storeCode);
    assert(store, "Created store was not persisted.");

    const order = await api(token, "/api/v1/restaurant/orders/", {
      method: "POST",
      body: JSON.stringify({
        order_type: "takeaway",
        store_id: store.id,
        customer_name: "Franchise Proof Guest",
        customer_phone: `97${String(Date.now()).slice(-8)}`,
        payment_method: "cash",
        items: [{ name: "Garlic Bread", quantity: 1, price: 119 }],
      }),
    });
    assert(order.response.ok, `Store order failed: ${JSON.stringify(order.data)}`);
    assert(order.data.store_id === store.id, "Order was not tagged to the store.");

    await page.reload({ waitUntil: "networkidle" });
    await page
      .locator('[data-testid="stores-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    const row = page.getByTestId(`store-row-${store.id}`);
    await row.waitFor({ timeout: 20000 });
    await page.waitForFunction(
      (storeId) => {
        const element = document.querySelector(`[data-testid="store-row-${storeId}"]`);
        return element ? /\b1\b/.test(element.innerText || "") : false;
      },
      store.id,
      { timeout: 20000 }
    );
    const rowText = await row.innerText();
    assert(/1/.test(rowText), `Store row did not show the order: ${rowText}`);

    await page.waitForFunction(
      () => {
        const element = document.querySelector('[data-testid="consolidated-total-orders"]');
        return element ? Number((element.textContent || "").replace(/[^0-9]/g, "")) >= 1 : false;
      },
      null,
      { timeout: 20000 }
    );

    const totalOrders = Number(
      (await page.getByTestId("consolidated-total-orders").innerText()).replace(
        /[^0-9]/g,
        ""
      )
    );
    assert(totalOrders >= 1, "Consolidated total orders was empty.");

    await page.getByTestId(`toggle-store-${store.id}`).click();
    await page.getByText(`${storeName} is now paused.`).waitFor({ timeout: 15000 });
    await page.reload({ waitUntil: "networkidle" });
    await page
      .locator('[data-testid="stores-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    await page.waitForFunction(
      (storeId) => {
        const element = document.querySelector(`[data-testid="store-row-${storeId}"]`);
        return element ? /paused/i.test(element.innerText || "") : false;
      },
      store.id,
      { timeout: 20000 }
    );

    await page.getByTestId("consolidated-table").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactsDir, "visible-stores-franchise.png"),
      fullPage: false,
    });

    console.log("Multi-store proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
