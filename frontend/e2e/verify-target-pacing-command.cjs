const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");
const monthlyTarget = "3000000";

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
    const failure = request.failure();
    if (failure?.errorText === "net::ERR_ABORTED") return;
    const url = request.url();
    if (!url.startsWith(baseURL) && !url.includes("/server/api/v1/restaurant")) return;
    issues.push(`request failed: ${request.method()} ${url} ${failure?.errorText || ""}`.trim());
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
  await waitForHttp(baseURL, "frontend");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1180 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    await signInAsAdmin(context);

    const response = await page.goto(`${baseURL}/reports`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Reports page returned HTTP ${response?.status() || "no response"}.`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    assert(!page.url().includes("/login"), "Reports page redirected back to login.");

    const command = page.getByTestId("target-pacing-command");
    await command.waitFor({ timeout: 30000 });
    await command.getByText("Target Pacing Command", { exact: false }).waitFor({ timeout: 10000 });
    await command.getByText("Monthly Target", { exact: true }).waitFor({ timeout: 10000 });
    await command.getByText("Required Daily", { exact: true }).waitFor({ timeout: 10000 });
    await command.getByText("Break-even Today", { exact: true }).waitFor({ timeout: 10000 });
    await page.getByTestId("target-pacing-progress").waitFor({ state: "attached", timeout: 10000 });

    const targetResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/v1/restaurant/stats/target/status") &&
        res.url().includes(`monthly_target=${monthlyTarget}`) &&
        res.ok(),
      { timeout: 20000 }
    );
    await page.getByTestId("target-pacing-input").fill("3000000");
    await page.getByTestId("target-pacing-apply").click();
    await targetResponse;
    await command.getByText("Rs 3,000,000", { exact: false }).first().waitFor({ timeout: 10000 });
    await command.getByText("Next Target Moves", { exact: true }).waitFor({ timeout: 10000 });

    const layout = await page.evaluate(() => ({
      bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(
        document.body.innerText || ""
      ),
      commandVisible: Boolean(document.querySelector('[data-testid="target-pacing-command"]')),
      progressAttached: Boolean(document.querySelector('[data-testid="target-pacing-progress"]')),
    }));
    assert(layout.commandVisible, "Target pacing command was not present in the DOM.");
    assert(layout.bodyOverflow <= 8, `Reports page has body-level horizontal overflow of ${layout.bodyOverflow}px.`);
    assert(!layout.hasFrameworkError, "Reports page rendered framework error text.");
    assert(layout.progressAttached, "Target pacing progress bar was not attached.");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-target-pacing-command.png"),
      fullPage: true,
    });

    watch.assertClean("target pacing command");
  } finally {
    await browser.close();
  }

  console.log("target-pacing-command verification passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
