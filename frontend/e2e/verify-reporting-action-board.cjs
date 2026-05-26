const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "https://pizza-blitz.vercel.app";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

  return {
    assertClean(label) {
      assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
    },
  };
}

async function signInAsAdmin(context) {
  const response = await context.request.post(`${baseURL}/api/admin-session`, {
    data: { id: adminId, password: adminPassword, role: "admin" },
  });
  assert(response.ok(), `Admin session failed: ${await response.text()}`);
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    await signInAsAdmin(context);
    const response = await page.goto(`${baseURL}/reports`, { waitUntil: "domcontentloaded" });
    assert(response?.ok(), `Reports page returned HTTP ${response?.status() || "no response"}.`);
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => undefined);
    assert(!page.url().includes("/login"), "Reports page redirected back to login.");

    await page.getByTestId("reporting-action-board").waitFor({ timeout: 20000 });
    await page.getByText("What Needs Attention Next", { exact: true }).waitFor({ timeout: 10000 });
    await page.getByText("Daily Recovery Queue", { exact: true }).waitFor({ timeout: 10000 });
    await page.getByText("Owner Moves", { exact: true }).waitFor({ timeout: 10000 });
    await page.getByText("Revenue Recovery", { exact: true }).waitFor({ timeout: 10000 });
    await page.getByText("Profit Direction", { exact: true }).waitFor({ timeout: 10000 });

    const layout = await page.evaluate(() => ({
      bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(document.body.innerText || ""),
    }));
    assert(layout.bodyOverflow <= 8, `Reports page has body-level horizontal overflow of ${layout.bodyOverflow}px.`);
    assert(!layout.hasFrameworkError, "Reports page rendered framework error text.");

    await page.screenshot({
      path: path.join(artifactsDir, "reporting-action-board-live.png"),
      fullPage: true,
    });
    watch.assertClean("reporting action board");
  } finally {
    await browser.close();
  }

  console.log("reporting-action-board live verification passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
