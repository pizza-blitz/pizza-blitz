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
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(750);
  }

  throw new Error(`${label} did not become ready at ${url}: ${lastError}`);
}

async function apiJson(endpoint, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
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
  return {
    assertClean(label) {
      assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
    },
  };
}

function pickOptions(item) {
  const choices = [
    ["Size", ["Large"]],
    ["Crust", ["Cheese Burst"]],
    ["Toppings", ["Extra Cheese", "Paneer Cubes"]],
    ["Add-ons", ["Choco Lava Dessert"]],
    ["Combo", ["Garlic Bread + Drink"]],
    ["Sauce", ["Spicy Schezwan"]],
  ];
  const selected = [];

  for (const [groupName, optionNames] of choices) {
    const group = (item.customization_groups || []).find((row) => row.name === groupName);
    assert(group, `${item.name} is missing ${groupName} customization group.`);
    for (const optionName of optionNames) {
      const option = group.options.find((row) => row.name === optionName);
      assert(option, `${groupName} is missing option ${optionName}.`);
      selected.push({
        group_id: group.id,
        group_name: group.name,
        option_id: option.id,
        option_name: option.name,
        price_delta: Number(option.price_delta || 0),
      });
    }
  }

  return selected;
}

async function screenshotPublicCustomization(item, selectedOptions) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const response = await page.goto(`${baseURL}/order`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Public order page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: "Checkout" }).waitFor({ timeout: 10000 });

    const search = page.getByPlaceholder(/search/i).first();
    if (await search.count()) {
      await search.fill(item.name);
    }

    const card = page.locator("article").filter({ hasText: item.name }).first();
    await card.waitFor({ timeout: 10000 });
    await card.getByRole("button", { name: /Customize/i }).click();
    for (const option of selectedOptions) {
      await card.getByRole("button", { name: new RegExp(option.option_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).click();
    }
    await card.getByRole("button", { name: /^Add$/i }).click();

    await page.locator("#checkout").getByText("Large", { exact: false }).first().waitFor({ timeout: 10000 });
    await page
      .locator("#checkout")
      .getByText("Garlic Bread + Drink", { exact: false })
      .first()
      .waitFor({ timeout: 10000 });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-product-customization.png"),
      fullPage: true,
    });
    watch.assertClean("public product customization");
  } finally {
    await browser.close();
  }
}

async function screenshotCustomizationCommand(orderId) {
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

    const response = await page.goto(`${baseURL}/menu`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Menu page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: "Menu Intelligence" }).waitFor({ timeout: 10000 });
    await page.getByText("Customization Command", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByText("Max Upgrade", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByText("Kitchen-Safe Lines", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByText(`#${orderId}`, { exact: false }).waitFor({ timeout: 10000 });
    await page.getByText("Combo: Garlic Bread + Drink", { exact: false }).first().waitFor({ timeout: 10000 });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-product-customization-command.png"),
      fullPage: true,
    });
    watch.assertClean("customization command board");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const menuResult = await apiJson("/api/v1/restaurant/menu/menu-with-customizations");
  assert(menuResult.response.ok, `Could not load customized menu: ${JSON.stringify(menuResult.data)}`);
  const readinessBefore = await apiJson("/api/v1/restaurant/menu/customizations/readiness");
  assert(readinessBefore.response.ok, `Could not load customization readiness: ${JSON.stringify(readinessBefore.data)}`);
  assert(readinessBefore.data.summary?.active_group_count >= 6, "Customization readiness did not expose all option groups.");
  assert(readinessBefore.data.groups?.some((group) => group.name === "Combo" && group.status === "ready"), "Combo group is not ready.");
  const pizza = menuResult.data.find(
    (item) =>
      item.category === "Pizza" &&
      (item.customization_groups || []).some((group) => group.name === "Size")
  );
  assert(pizza, "No pizza item with customization groups was available.");

  const selectedOptions = pickOptions(pizza);
  const selectedDelta = selectedOptions.reduce((sum, option) => sum + Number(option.price_delta || 0), 0);
  const expectedUnitPrice = Number((Number(pizza.selling_price || 0) + selectedDelta).toFixed(2));

  const quoteResult = await apiJson("/api/v1/restaurant/menu/customizations/price", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      menu_item_id: pizza.id,
      item_name: pizza.name,
      selected_options: selectedOptions,
    }),
  });
  assert(quoteResult.response.ok, `Customization quote failed: ${JSON.stringify(quoteResult.data)}`);
  assert(
    Number(quoteResult.data.unit_price) === expectedUnitPrice,
    `Expected unit price ${expectedUnitPrice}, received ${quoteResult.data.unit_price}.`
  );

  const customerPhone = `96${Date.now().toString().slice(-8)}`;
  const orderResult = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Customization Proof",
      customer_phone: customerPhone,
      customer_email: "customization-proof@example.com",
      payment_method: "cash",
      notes: "E2E customized item proof with tampered client price",
      items: [
        {
          menu_item_id: pizza.id,
          name: pizza.name,
          quantity: 1,
          price: 1,
          base_price: 1,
          customization_total: 0,
          selected_options: selectedOptions,
        },
      ],
    }),
  });
  assert(orderResult.response.ok, `Customized order failed: ${JSON.stringify(orderResult.data)}`);
  assert(Number(orderResult.data.subtotal) === expectedUnitPrice, "Backend did not recalculate the tampered item price.");

  const orderId = orderResult.data.order_id;
  const orderRead = await apiJson(
    `/api/v1/restaurant/orders/customer-receipt/${orderId}?phone=${encodeURIComponent(customerPhone)}`
  );
  assert(orderRead.response.ok, `Could not read customized order: ${JSON.stringify(orderRead.data)}`);
  const orderedItem = orderRead.data.items[0];
  assert(Number(orderedItem.price) === expectedUnitPrice, "Stored order item price was not server calculated.");
  assert(Number(orderedItem.customization_total) === selectedDelta, "Stored customization total is incorrect.");
  assert(
    orderedItem.selected_options.some((option) => option.option_name === "Garlic Bread + Drink"),
    "Stored selected options did not include combo choice."
  );
  assert(
    orderedItem.selected_options.some((option) => option.group_name === "Size" && option.option_name === "Large"),
    "Stored selected options did not keep grouped size detail."
  );

  const readinessAfter = await apiJson("/api/v1/restaurant/menu/customizations/readiness");
  assert(readinessAfter.response.ok, `Could not refresh customization readiness: ${JSON.stringify(readinessAfter.data)}`);
  assert(
    readinessAfter.data.recent_customized_lines?.some((line) => line.order_id === orderId),
    "Customization readiness did not show the latest customized kitchen line."
  );
  assert(
    readinessAfter.data.top_options?.some((option) => /Garlic Bread \+ Drink/.test(option.option)),
    "Customization readiness did not count the combo choice."
  );

  await screenshotPublicCustomization(pizza, selectedOptions);
  await screenshotCustomizationCommand(orderId);
  console.log(`Product customization proof passed for order #${orderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
