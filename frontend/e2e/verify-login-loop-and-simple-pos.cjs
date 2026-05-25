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

    await page.goto(`${baseURL}/orders`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("counter-new-takeaway").click();
    await page.getByPlaceholder("Search pizza, sides, drinks").waitFor({ timeout: 15000 });
    assert(
      await page.getByPlaceholder("Search pizza, sides, drinks").isVisible(),
      "Simplified POS search was not visible."
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
