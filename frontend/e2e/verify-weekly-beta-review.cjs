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

  page.on("pageerror", (error) => {
    issues.push(`page error: ${error.message}`);
  });

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
    await page.getByTestId("weekly-beta-review-command").waitFor({ timeout: 15000 });
    await page.getByRole("heading", { name: "Weekly Beta Review Command" }).waitFor({ timeout: 15000 });
    await page.getByText("Proof Audit", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText(/^\d+ \/ \d+$/).waitFor({ timeout: 15000 });
    await page.getByText("Known Blockers", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Controlled Beta", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Review Outcomes", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Remaining Beta Blockers", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Production Database Path", { exact: true }).waitFor({ timeout: 15000 });
    for (const proofName of [
      "verify-weekly-beta-review.cjs",
      "verify-production-database-path.cjs",
      "verify-environment-secrets-security.cjs",
      "verify-deployment-pipeline.cjs",
      "verify-full-customer-order-e2e.cjs",
      "verify-counter-order-e2e.cjs",
      "verify-delivery-order-e2e.cjs",
      "verify-dashboard-visual-polish.cjs",
      "verify-operational-dashboard-command.cjs",
      "verify-marketing-live-readiness-command.cjs",
      "verify-data-quality-export-command.cjs",
      "verify-launch-candidate-hardening.cjs",
      "verify-final-acceptance-walkthrough.cjs",
      "verify-beta-delivery-checkpoint.cjs",
      "verify-production-launch-integrations.cjs",
      "verify-live-environment-execution.cjs",
      "verify-credential-activation-command.cjs",
    ]) {
      await page.getByText(proofName, { exact: true }).first().waitFor({ timeout: 15000 });
    }
    await page.getByText("Delivery order E2E handoff", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Visual polish handoff", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Operational dashboards handoff", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Marketing live-readiness handoff", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Data quality handoff", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Launch candidate hardening handoff", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Final acceptance walkthrough handoff", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Beta delivery checkpoint handoff", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Post-beta production integrations handoff", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Live environment execution handoff", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Credential activation handoff", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Live provider smoke handoff", { exact: true }).waitFor({ timeout: 15000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-weekly-beta-review.png"),
      fullPage: true,
    });

    watch.assertClean("weekly beta review command");
    console.log("Weekly beta review proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
