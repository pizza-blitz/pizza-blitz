const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "https://pizza-blitz.vercel.app";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const logoutPrefetches = [];

  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("/logout")) {
      logoutPrefetches.push(text.slice(0, 180));
    }
  });

  try {
    await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
    await page.getByPlaceholder("Enter admin ID").fill(adminId);
    await page.getByPlaceholder("Enter password").fill(adminPassword);
    await page.getByRole("button", { name: /Sign In to Portal/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 45000, waitUntil: "domcontentloaded" });

    await page.goto(`${baseURL}/roadmap`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("twelve-gap-delivery-program").waitFor({ timeout: 15000 });

    await page.goto(`${baseURL}/sales`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("sales-reconciliation-board").waitFor({ timeout: 15000 });
    await page.getByTestId("sales-repair-queue").waitFor({ timeout: 15000 });
    await page.getByTestId("sales-repair-import-command").waitFor({ timeout: 15000 });
    await page.getByTestId("sales-source-missing-board").waitFor({ timeout: 15000 });
    await page.waitForFunction(
      () => {
        const text = document.body.innerText.toLowerCase();
        return (
          text.includes("import 20") ||
          text.includes("all imported months are complete.") ||
          text.includes("reconciliation needs retry.")
        );
      },
      null,
      { timeout: 120000 }
    );

    await page.goto(`${baseURL}/operations`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("kitchen-command-strip").waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /Ready To Bill/i }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /Auto (On|Off)/i }).waitFor({ timeout: 15000 });
    for (const lane of ["open", "preparing", "ready", "closed"]) {
      await page.getByTestId(`kitchen-lane-${lane}`).waitFor({ timeout: 15000 });
    }
    await page.getByTestId("delivery-dispatch-board").waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /Needs Rider/i }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /Ready Dispatch/i }).waitFor({ timeout: 15000 });

    await page.goto(`${baseURL}/orders`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("counter-operator-board").waitFor({ timeout: 15000 });
    await page.getByTestId("counter-command-takeaway").waitFor({ timeout: 15000 });
    await page.getByTestId("counter-command-delivery").waitFor({ timeout: 15000 });
    await page.getByTestId("counter-new-takeaway").click();
    await page.getByTestId("counter-mode-switch").waitFor({ timeout: 15000 });
    await page.getByTestId("counter-mode-delivery").click();
    await page.getByText("Delivery Details", { exact: true }).waitFor({ timeout: 10000 });
    await page.getByTestId("counter-mode-takeaway").click();
    await page.getByTestId("counter-speed-bar").waitFor({ timeout: 15000 });
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid^="counter-quick-add-"]').length > 0 ||
        document.querySelectorAll('[data-testid^="counter-item-quantity-"]').length > 0,
      null,
      { timeout: 60000 }
    );
    const quickAdd = page.locator('[data-testid^="counter-quick-add-"]').first();
    if ((await quickAdd.count()) > 0) {
      await quickAdd.click();
    } else {
      await page.locator('[data-testid^="counter-item-quantity-"]').first().fill("1");
    }
    await page.getByPlaceholder("Search pizza, sides, drinks").waitFor({ timeout: 15000 });
    await page.getByText("Current Bill", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Ready to send", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("counter-payment-rail").waitFor({ timeout: 15000 });
    await page.getByTestId("counter-payment-cash").waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /^cash$/i }).waitFor({ timeout: 15000 });
    assert(
      await page.getByTestId("counter-speed-bar").isVisible(),
      "Counter speed bar was not visible."
    );
    assert(
      await page.getByPlaceholder("Search pizza, sides, drinks").isVisible(),
      "Simplified POS search was not visible."
    );
    assert(
      await page.getByText("Current Bill", { exact: true }).isVisible(),
      "POS bill rail was not visible."
    );
    assert(
      await page.getByTestId("counter-operator-board").isVisible(),
      "Counter operator command board was not visible."
    );

    for (const path of ["/reports", "/menu", "/dashboard"]) {
      const response = await page.goto(`${baseURL}${path}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      assert(response?.ok(), `${path} returned HTTP ${response?.status() || "no response"}.`);
      assert(!page.url().includes("/login"), `${path} redirected back to login.`);
    }
    assert(logoutPrefetches.length === 0, `Logout route was prefetched:\n${logoutPrefetches.join("\n")}`);

    console.log("login-loop-and-simple-pos verification passed");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
