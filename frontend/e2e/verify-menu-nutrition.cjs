/* Menu nutrition proof: allergens/dietary/calories appear on the customer menu. */
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
  const browser = await chromium.launch({ headless: true });
  try {
    const created = await api(token, "/api/v1/restaurant/menu/menu", {
      method: "POST",
      body: JSON.stringify({
        name: "Proof Nutrition Pizza",
        category: "Pizza",
        selling_price: 329,
        cost_price: 120,
        is_available: true,
        allergens: ["Milk", "Wheat"],
        dietary_tags: ["Vegetarian"],
        calories: 520,
        protein_g: 22,
        carbs_g: 60,
        fat_g: 18,
      }),
    });
    assert(created.response.ok, `Menu create failed: ${JSON.stringify(created.data)}`);
    itemId = created.data.id;

    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    await page.goto(`${baseURL}/order`, { waitUntil: "networkidle" });
    const card = page.getByTestId(`customer-menu-card-${itemId}`);
    await card.waitFor({ timeout: 30000 });
    const text = await card.innerText();
    assert(/520 kcal/i.test(text), `Card read: ${text}`);
    assert(/Vegetarian/i.test(text), "Dietary tag was missing.");
    assert(/Contains:\s*Milk,\s*Wheat/i.test(text), "Allergens were missing.");

    await card.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactsDir, "visible-menu-nutrition.png"),
      fullPage: false,
    });

    console.log("Menu nutrition proof passed.");
  } finally {
    if (itemId) {
      await api(token, `/api/v1/restaurant/menu/menu/${itemId}`, {
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
