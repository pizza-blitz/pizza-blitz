const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`${label} did not become ready at ${url}: ${lastError}`);
}

async function main() {
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const itemName = `E2E Basil ${Date.now()}`;

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/inventory`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Inventory page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: "Inventory Management" }).waitFor({ timeout: 15000 });

    await page.getByRole("button", { name: "Add Item", exact: true }).click();
    await page.getByLabel("Item name", { exact: true }).fill(itemName);
    await page.getByLabel("Category", { exact: true }).fill("Fresh Produce");
    await page.getByLabel("Unit", { exact: true }).fill("kg");
    await page.getByLabel("Supplier", { exact: true }).fill("E2E Supplier");
    await page.getByLabel("Current stock", { exact: true }).fill("1");
    await page.getByLabel("Minimum stock", { exact: true }).fill("5");
    await page.getByLabel("Cost per unit", { exact: true }).fill("120");
    await page.getByLabel("Supplier WhatsApp", { exact: true }).fill("919999999999");
    await page.getByRole("button", { name: "Save Item", exact: true }).click();
    await page.getByText(`${itemName} added to inventory.`, { exact: true }).waitFor({ timeout: 15000 });

    await page.getByLabel("Search stock items", { exact: true }).fill(itemName);
    await page.getByRole("table").getByText(itemName, { exact: true }).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: `Adjust stock for ${itemName}`, exact: true }).click();
    await page.getByLabel("Quantity", { exact: true }).fill("2");
    await page.getByLabel("Notes", { exact: true }).fill("E2E inventory command proof");
    await page.getByRole("button", { name: "Save Adjustment", exact: true }).click();
    await page.getByText(`${itemName} stock updated to 3 kg.`, { exact: true }).waitFor({ timeout: 15000 });

    const draftButton = page.getByRole("button", { name: "Create PO Drafts", exact: true });
    assert(await draftButton.isEnabled(), "Create PO Drafts stayed disabled for a low-stock item.");
    await draftButton.click();
    await page.getByText(/Created \d+ purchase order drafts?\.|No low-stock items need reorder drafts\./).waitFor({ timeout: 15000 });

    console.log(`Inventory command board proof passed for ${itemName}.`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
