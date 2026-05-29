const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });

  try {
    await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("Enter admin ID").fill(adminId);
    await page.getByPlaceholder("Enter password").fill(adminPassword);
    await page.getByRole("button", { name: /Sign In to Portal/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 45000 });

    await page.goto(`${baseURL}/counter`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("quick-counter-page").waitFor({ timeout: 20000 });
    await page.getByTestId("quick-counter-speed-rail").waitFor({ timeout: 20000 });
    await page.getByTestId("quick-counter-bill").waitFor({ timeout: 20000 });
    await page.getByTestId("quick-counter-search").fill("pizza");
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid^="quick-counter-build-"]').length > 0 ||
        document.querySelectorAll('[data-testid^="quick-counter-menu-item-"] button').length > 0,
      null,
      { timeout: 60000 }
    );

    const quickBuild = page.locator('[data-testid^="quick-counter-build-"]').first();
    const menuItem = page.locator('[data-testid^="quick-counter-menu-item-"] button').first();
    if ((await quickBuild.count()) > 0) {
      await quickBuild.click();
    } else {
      await menuItem.click();
    }

    await page.getByText("Current Bill", { exact: true }).waitFor({ timeout: 10000 });
    const sendButton = page.getByTestId("quick-counter-send-order");
    await sendButton.waitFor({ timeout: 10000 });
    assert(await sendButton.isEnabled(), "Quick counter send button stayed disabled after adding an item.");
    assert(
      await page.getByRole("link", { name: /Full POS/i }).isVisible(),
      "Full POS escape route was not visible."
    );
    assert(
      await page.getByRole("link", { name: /Kitchen Board/i }).isVisible(),
      "Kitchen board handoff was not visible."
    );

    console.log("quick-counter-page verification passed");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
