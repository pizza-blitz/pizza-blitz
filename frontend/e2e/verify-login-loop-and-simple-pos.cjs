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
    await page.waitForURL(/\/dashboard/, { timeout: 30000 });

    for (const path of ["/reports", "/sales", "/orders", "/menu", "/dashboard"]) {
      const response = await page.goto(`${baseURL}${path}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      assert(response?.ok(), `${path} returned HTTP ${response?.status() || "no response"}.`);
      assert(!page.url().includes("/login"), `${path} redirected back to login.`);
    }

    await page.goto(`${baseURL}/roadmap`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("twelve-gap-delivery-program").waitFor({ timeout: 15000 });

    await page.goto(`${baseURL}/sales`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("sales-reconciliation-board").waitFor({ timeout: 15000 });
    const reconciliationResponse = await page.request.get(
      `${baseURL}/server/api/v1/restaurant/sales/reconciliation?expected_min_total=3000000`,
      { timeout: 70000 }
    );
    assert(reconciliationResponse.ok(), `Sales reconciliation API returned ${reconciliationResponse.status()}.`);
    const reconciliation = await reconciliationResponse.json();
    assert(
      typeof reconciliation.imported_total === "number",
      "Sales reconciliation API did not return imported_total."
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
    await page.getByTestId("counter-new-takeaway").click();
    await page.getByPlaceholder("Search pizza, sides, drinks").waitFor({ timeout: 15000 });
    await page.getByText("Current Bill", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /^cash$/i }).waitFor({ timeout: 15000 });
    assert(
      await page.getByPlaceholder("Search pizza, sides, drinks").isVisible(),
      "Simplified POS search was not visible."
    );
    assert(
      await page.getByText("Current Bill", { exact: true }).isVisible(),
      "POS bill rail was not visible."
    );
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
