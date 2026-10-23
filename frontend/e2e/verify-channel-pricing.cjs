/* Channel pricing proof: pickup vs delivery price on the customer menu + cart. */
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

  let itemId = null;
  let hiddenItemId = null;
  const browser = await chromium.launch({ headless: true });
  try {
    const created = await api(token, "/api/v1/restaurant/menu/menu", {
      method: "POST",
      body: JSON.stringify({
        name: "Channel Proof Pizza",
        category: "Pizza",
        selling_price: 299,
        cost_price: 110,
        is_available: true,
        channel_prices: [
          { channel: "takeaway", price: 299, is_available: true, is_visible: true },
          { channel: "delivery", price: 349, is_available: true, is_visible: true },
        ],
      }),
    });
    assert(created.response.ok, `Menu create failed: ${JSON.stringify(created.data)}`);
    itemId = created.data.id;

    const hidden = await api(token, "/api/v1/restaurant/menu/menu", {
      method: "POST",
      body: JSON.stringify({
        name: "Channel Hidden Proof Pizza",
        category: "Pizza",
        selling_price: 299,
        cost_price: 110,
        is_available: true,
        channel_prices: [
          { channel: "takeaway", price: 299, is_available: true, is_visible: true },
          { channel: "delivery", price: 349, is_available: true, is_visible: false },
        ],
      }),
    });
    assert(hidden.response.ok, `Hidden item create failed: ${JSON.stringify(hidden.data)}`);
    hiddenItemId = hidden.data.id;

    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    await page.goto(`${baseURL}/order`, { waitUntil: "networkidle" });
    const card = page.getByTestId(`customer-menu-card-${itemId}`);
    await card.waitFor({ timeout: 30000 });
    const pickupText = await card.innerText();
    assert(/Rs 299/.test(pickupText), `Pickup card read: ${pickupText}`);
    const hiddenCard = page.getByTestId(`customer-menu-card-${hiddenItemId}`);
    assert(
      (await hiddenCard.count()) === 1,
      "Hidden-in-delivery item should be visible for pickup."
    );

    await card.getByRole("button", { name: /Add/i }).click();
    await page.waitForFunction(
      () => {
        const body = document.body.innerText || "";
        return /Subtotal\s*Rs 299/.test(body.replace(/\s+/g, " "));
      },
      null,
      { timeout: 15000 }
    );

    await page.getByRole("button", { name: "Delivery", exact: true }).first().click();
    await page.waitForFunction(
      (id) => {
        const element = document.querySelector(`[data-testid="customer-menu-card-${id}"]`);
        return element ? /Rs 349/.test(element.innerText || "") : false;
      },
      itemId,
      { timeout: 20000 }
    );
    await page.waitForFunction(
      () => {
        const body = document.body.innerText || "";
        return /Subtotal\s*Rs 349/.test(body.replace(/\s+/g, " "));
      },
      null,
      { timeout: 15000 }
    );
    await page.waitForFunction(
      (id) => !document.querySelector(`[data-testid="customer-menu-card-${id}"]`),
      hiddenItemId,
      { timeout: 15000 }
    );

    await page.screenshot({
      path: path.join(artifactsDir, "visible-channel-pricing.png"),
      fullPage: false,
    });

    console.log("Channel pricing proof passed.");
  } finally {
    if (itemId) {
      await api(token, `/api/v1/restaurant/menu/menu/${itemId}`, {
        method: "DELETE",
      }).catch(() => {});
    }
    if (hiddenItemId) {
      await api(token, `/api/v1/restaurant/menu/menu/${hiddenItemId}`, {
        method: "DELETE",
      }).catch(() => {});
    }
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
