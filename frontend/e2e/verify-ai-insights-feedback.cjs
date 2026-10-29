const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
  const dialogs = [];

  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss().catch(() => undefined);
  });
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico/i.test(text)) return;
    if (/Failed to fetch RSC payload/i.test(text) && /Falling back to browser navigation/i.test(text)) return;
    issues.push(`console error: ${text}`);
  });

  return {
    clear() {
      issues.length = 0;
      dialogs.length = 0;
    },
    assertClean(label) {
      assert(!dialogs.length, `${label} triggered blocking dialog(s): ${dialogs.join(" | ")}`);
      assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
    },
  };
}

async function signInAsAdmin(context) {
  const response = await context.request.post(`${baseURL}/api/admin-session`, {
    data: { id: adminId, password: adminPassword, role: "admin" },
  });
  assert(response.ok(), `Admin browser login failed: ${await response.text()}`);
}

function successPayload(summary, tips) {
  return {
    status: "success",
    ai_configured: true,
    data: {
      summary,
      tips,
    },
  };
}

function fallbackPayload(summary, tips, message) {
  return {
    status: "fallback",
    ai_configured: false,
    ai_error: "Gemini API Key not configured",
    message,
    data: {
      summary,
      tips,
    },
  };
}

async function installAiFixtures(context) {
  const requests = [];
  const phaseCounts = { initial: 0, fresh: 0, fallback: 0, error: 0 };
  let phase = "initial";

  await context.route("**/api/v1/restaurant/insights/ai-insights**", async (route) => {
    requests.push(route.request().url());
    phaseCounts[phase] += 1;

    if (phase === "initial") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          successPayload("Proof AI summary for the owner dashboard.", [
            "Prep proof vegetables before Friday rush.",
            "Move garlic bread bundle above the fold.",
          ])
        ),
      });
      return;
    }

    if (phase === "fresh") {
      await sleep(700);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          successPayload("Fresh AI resync summary with stronger inventory action.", [
            "Raise mozzarella par before Saturday dinner.",
            "Bundle soft drink with large pizza orders.",
            "Review low-margin delivery zones before next campaign.",
          ])
        ),
      });
      return;
    }

    if (phase === "fallback") {
      await sleep(400);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          fallbackPayload(
            "Standard guidance summary when no AI provider is configured.",
            [
              "Review supplier pricing for top 5 expenses.",
              "Increase visibility of high-margin side items.",
              "Optimize staff scheduling based on peak hour sales.",
            ],
            "AI provider is not configured. Showing standard operating guidance based on your sales and stock data."
          )
        ),
      });
      return;
    }

    await sleep(500);
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "AI provider quota is not available in this proof." }),
    });
  });
  return {
    requests,
    phaseCounts,
    setPhase(nextPhase) {
      phase = nextPhase;
    },
  };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);
  const observedApiRequests = [];

  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/api/v1/restaurant/insights")) observedApiRequests.push(url);
  });

  try {
    await signInAsAdmin(context);
    const fixtures = await installAiFixtures(context);

    watch.clear();
    const response = await page.goto(`${baseURL}/ai-insights`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `/ai-insights returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: "Neural Insights" }).waitFor({ timeout: 15000 });
    await page.getByText("Proof AI summary for the owner dashboard.", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("AI insights synced with 2 directives.", { exact: true }).waitFor({ timeout: 15000 });
    await page
      .getByTestId("ai-insights-model-status")
      .filter({ hasText: "AI provider connected" })
      .waitFor({ timeout: 15000 });

    fixtures.setPhase("fresh");
    await page.getByRole("button", { name: /Force Resync/i }).click();
    await page.getByRole("button", { name: /Syncing/i }).waitFor({ timeout: 15000 });
    await page.getByText("Fresh AI resync summary with stronger inventory action.", { exact: false }).waitFor({
      timeout: 15000,
    });
    await page.getByText("AI insights synced with 3 directives.", { exact: true }).waitFor({ timeout: 15000 });

    // Without an AI provider key the endpoint answers 200 with standard
    // guidance. The page must show that guidance with an honest warning, not
    // an error.
    fixtures.setPhase("fallback");
    await page.getByRole("button", { name: /Re-read my data/i }).click();
    await page.getByRole("button", { name: /Loading/i }).waitFor({ timeout: 15000 });
    await page
      .getByText("Standard guidance summary when no AI provider is configured.", { exact: false })
      .waitFor({ timeout: 15000 });
    await page
      .getByTestId("ai-insights-status")
      .filter({ hasText: "AI provider is not configured." })
      .waitFor({ timeout: 15000 });
    await page
      .getByTestId("ai-insights-model-status")
      .filter({ hasText: "AI provider not connected" })
      .waitFor({ timeout: 15000 });
    assert(
      (await page.getByText("Raise mozzarella par before Saturday dinner.").count()) === 0,
      "Fallback guidance left the previous AI directives on screen."
    );

    fixtures.setPhase("error");
    await page.getByRole("button", { name: /Force Resync/i }).click();
    await page.getByRole("button", { name: /Syncing/i }).waitFor({ timeout: 15000 });
    await page.getByText("AI provider quota is not available in this proof.", { exact: true }).waitFor({
      timeout: 15000,
    });
    await page.getByText("Standard guidance summary when no AI provider is configured.", { exact: false }).waitFor({
      timeout: 15000,
    });

    assert(fixtures.phaseCounts.initial >= 1, "Expected at least one initial AI insight request.");
    assert(fixtures.phaseCounts.fresh >= 1, "Expected Force Resync to request fresh AI insights.");
    assert(
      fixtures.phaseCounts.fallback >= 1,
      "Expected Re-read my data to request insights and handle the no-provider fallback."
    );
    assert(fixtures.phaseCounts.error >= 1, "Expected Force Resync to show a provider failure inline.");
    watch.assertClean("AI insights feedback");

    const artifact = {
      checkedAt: new Date().toISOString(),
      baseURL,
      requestCount: fixtures.requests.length,
      phaseCounts: fixtures.phaseCounts,
      proofs: [
        "Initial AI insights load shows a synced directive count and a connected model status.",
        "Force Resync shows a busy state and replaces the summary with fresh directives.",
        "A missing AI provider returns standard guidance with an amber warning instead of an error.",
        "Provider failure is shown inline while the last loaded summary stays on screen.",
      ],
    };
    fs.writeFileSync(
      path.join(artifactsDir, "ai-insights-feedback.json"),
      `${JSON.stringify(artifact, null, 2)}\n`
    );

    console.log("AI insights feedback proof passed.");
  } catch (error) {
    const debugArtifact = {
      checkedAt: new Date().toISOString(),
      baseURL,
      observedApiRequests,
      bodyText: await page.locator("body").innerText().catch(() => ""),
    };
    fs.writeFileSync(
      path.join(artifactsDir, "ai-insights-feedback-debug.json"),
      `${JSON.stringify(debugArtifact, null, 2)}\n`
    );
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
