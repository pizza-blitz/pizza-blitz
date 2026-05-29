const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
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

async function apiJson(endpoint, init = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init,
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function seedCustomerOrder(phone) {
  const { response, data } = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Lifecycle Starter",
      customer_phone: phone,
      customer_email: "starter-lifecycle@example.com",
      opt_in_marketing: true,
      payment_method: "cash",
      notes: "Customer lifecycle proof order",
      items: [
        { name: "Margherita Pizza (R)", quantity: 1, price: 199 },
        { name: "Garlic Bread", quantity: 1, price: 119 },
      ],
    }),
  });
  assert(response.ok, `Could not seed lifecycle order: ${JSON.stringify(data)}`);
  assert(data.order_id, "Seed order response did not include order_id.");
  return data.order_id;
}

function createBrowserWatch(page) {
  const issues = [];

  page.on("pageerror", (error) => {
    issues.push(`page error: ${error.message}`);
  });

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico|images\.unsplash\.com/i.test(text)) return;
    if (/Failed to fetch RSC payload/i.test(text) && /Falling back to browser navigation/i.test(text)) return;
    issues.push(`console error: ${text}`);
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    const localRequest = url.startsWith(baseURL) || url.startsWith(apiURL);
    if (!localRequest) return;
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

async function assertUpdatedHistory(phone, expectedEmail) {
  const { response, data } = await apiJson(`/api/v1/restaurant/orders/customer-history/${encodeURIComponent(phone)}`);
  assert(response.ok, `Customer history failed after profile save: ${JSON.stringify(data)}`);
  assert(data.customer?.name === "Lifecycle Customer", `Expected updated name, got ${data.customer?.name}.`);
  assert(data.customer?.email === expectedEmail, `Expected updated email, got ${data.customer?.email}.`);
  assert(data.customer?.opt_in_marketing === false, "Expected marketing consent to be disabled.");
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const phone = `97${Date.now().toString().slice(-8)}`;
  const expectedEmail = `lifecycle-${Date.now()}@example.com`;
  const orderId = await seedCustomerOrder(phone);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    let response = await page.goto(`${baseURL}/account/login`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Customer login returned HTTP ${response?.status() || "no response"}.`);
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
    await page.getByPlaceholder("Phone number").fill(phone);
    await page.getByPlaceholder("Recent order ID").fill(String(orderId));
    const loginResponsePromise = page.waitForResponse(
      (apiResponse) =>
        apiResponse.url().includes("/api/customer-session") &&
        apiResponse.request().method() === "POST",
      { timeout: 15000 }
    );
    await page.getByRole("button", { name: /View My Orders/i }).click();
    response = await loginResponsePromise;
    assert(response.ok(), `Customer login proof failed: ${await response.text()}`);
    await page.waitForURL(/\/account(?:\?|$)/, { timeout: 15000 }).catch(async () => {
      await page.goto(`${baseURL}/account`, { waitUntil: "domcontentloaded" });
    });

    response = await page.goto(`${baseURL}/account`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Customer account returned HTTP ${response?.status() || "no response"}.`);
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);

    await page.getByText("Customer Lifecycle Command", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Profile & Contact Preferences", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Consent Ledger", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText(`Order #${orderId}`, { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Margherita Pizza (R)", { exact: false }).first().waitFor({ timeout: 10000 });

    await page.getByPlaceholder("Customer name").fill("Lifecycle Customer");
    await page.getByPlaceholder("Email for receipts and offers").fill(expectedEmail);
    await page.getByLabel(/Allow Pizza Blitz offers and updates/i).setChecked(false);
    await page.getByRole("button", { name: /^Save Profile$/i }).click();
    await page.getByText("Profile and consent preferences saved.", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Promotional audiences", { exact: true }).waitFor({ timeout: 10000 });
    await page.getByText("Suppressed", { exact: true }).waitFor({ timeout: 10000 });

    const storageCustomer = await page.evaluate(() => JSON.parse(window.localStorage.getItem("pizza_blitz_customer") || "{}"));
    assert(storageCustomer.name === "Lifecycle Customer", "Local customer draft did not store updated name.");
    assert(storageCustomer.email === expectedEmail, "Local customer draft did not store updated email.");
    assert(storageCustomer.opt_in_marketing === false, "Local customer draft did not store updated consent.");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-customer-account-lifecycle.png"),
      fullPage: true,
    });
    watch.assertClean("customer account lifecycle");
  } finally {
    await browser.close();
  }

  await assertUpdatedHistory(phone, expectedEmail);
  console.log(`Customer account lifecycle proof passed for ${phone}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
