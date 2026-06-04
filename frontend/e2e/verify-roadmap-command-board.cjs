const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
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
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico|images\.unsplash\.com/i.test(text)) return;
    if (/Failed to fetch RSC payload/i.test(text) && /Falling back to browser navigation/i.test(text)) return;
    if (/Access to fetch at 'http:\/\/localhost:3011\/login'.*\/logout\?_rsc=/i.test(text)) return;
    issues.push(`console error: ${text}`);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!url.startsWith(baseURL)) return;
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

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");

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

    const response = await page.goto(`${baseURL}/roadmap`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Roadmap page returned HTTP ${response?.status() || "no response"}.`);

    await page.getByRole("heading", { name: "Roadmap Command Board" }).waitFor({ timeout: 15000 });
    await page.getByText("Value Already Built", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Remaining Production Work", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Weekly Stabilization Command", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByTestId("weekly-beta-review-command").waitFor({ timeout: 15000 });
    await page.getByText("Weekly Beta Review Command", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Production database path", { exact: false }).first().waitFor({ timeout: 15000 });
    await page.getByText("verify-weekly-beta-review.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-production-database-path.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-environment-secrets-security.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-deployment-pipeline.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-full-customer-order-e2e.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-counter-order-e2e.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-delivery-order-e2e.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-visual-polish-suite.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-navigation-link-health.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-interactive-control-labels.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-safe-action-buttons.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-feature-action-coverage.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-route-action-inventory.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-action-placeholder-hygiene.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-action-feedback-hygiene.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-ai-insights-feedback.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-breakeven-setup-feedback.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-source-text-hygiene.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-dashboard-visual-polish.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-operational-dashboard-command.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-marketing-live-readiness-command.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-data-quality-export-command.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-launch-candidate-hardening.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-final-acceptance-walkthrough.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-beta-delivery-checkpoint.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-production-launch-integrations.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-live-environment-execution.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("verify-credential-activation-command.cjs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Live provider smoke:", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Route / View Audit", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("34 x 2", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Login and customer account route audit", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Navigation link health audit", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Interactive control label audit", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Safe action button audit", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Feature action coverage audit", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("feature-action-coverage.json", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Route action inventory audit", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("route-action-inventory.json", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Action placeholder hygiene audit", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("action-placeholder-hygiene.json", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Action feedback browser proof", { exact: true }).first().waitFor({ timeout: 15000 });
    await page.getByText("action-feedback-hygiene.json", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Break-even setup feedback proof", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("breakeven-setup-feedback.json", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("AI insights feedback proof", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("ai-insights-feedback.json", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Source text hygiene audit", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("source-text-hygiene.json", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("42 / 42", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("30 / 60 / 90 Day Direction", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Daily Execution Plan To 20 June", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Payment gateway production pass", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("npm run typecheck", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Frontend typecheck quality gate", { exact: true }).first().waitFor({ timeout: 15000 });
    await page.getByText("Frontend typecheck handoff", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Authentication and role hardening", { exact: true }).first().waitFor({ timeout: 15000 });
    await page.getByText("Customer account lifecycle", { exact: true }).first().waitFor({ timeout: 15000 });
    await page.getByText("Marketing live-readiness command", { exact: true }).first().waitFor({ timeout: 15000 });
    await page.getByText("Data quality and export command", { exact: true }).first().waitFor({ timeout: 15000 });
    await page.getByText("Launch candidate hardening command", { exact: true }).first().waitFor({ timeout: 15000 });
    await page.getByText("Final acceptance walkthrough command", { exact: true }).first().waitFor({ timeout: 15000 });
    await page.getByText("Beta delivery checkpoint command", { exact: true }).first().waitFor({ timeout: 15000 });
    await page.getByText("Production launch integrations command", { exact: true }).first().waitFor({ timeout: 15000 });
    await page.getByText("Live environment execution command", { exact: true }).first().waitFor({ timeout: 15000 });
    await page.getByText("Credential activation command", { exact: true }).first().waitFor({ timeout: 15000 });
    await page.getByRole("link", { name: /Roadmap/i }).waitFor({ timeout: 15000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-roadmap-command-board.png"),
      fullPage: true,
    });
    watch.assertClean("roadmap command board");
    console.log("Roadmap command board proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
