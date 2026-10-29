const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
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
    issues.push(`console error: ${text}`);
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!url.startsWith(baseURL) && !url.startsWith(apiURL)) return;
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

async function assertHealthyPage(page, label) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => undefined);
  const health = await page.evaluate(() => {
    const text = document.body.innerText || "";
    return {
      textLength: text.trim().length,
      hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
      hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
      hasTextCorruption: /ï¿½|Ã¢â‚¬|Ã¢â‚¬â„¢|Ã¢â‚¬Å“|Ã¢â‚¬ï¿½|Ã¢â€šÂ¹|Ã‚/.test(text),
      bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  assert(health.textLength > 300, `${label} rendered too little content.`);
  assert(!health.hasOverlay, `${label} has a Next.js error overlay.`);
  assert(!health.hasFrameworkError, `${label} rendered framework error text.`);
  assert(!health.hasTextCorruption, `${label} rendered corrupted text.`);
  assert(health.bodyOverflow <= 8, `${label} has body-level horizontal overflow of ${health.bodyOverflow}px.`);
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    let response = await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Mobile dashboard returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: "Business Intelligence" }).waitFor({ timeout: 15000 });
    await page.getByTestId("mobile-portal-nav").waitFor({ timeout: 15000 });
    await page.getByTestId("mobile-portal-nav").locator('[aria-current="page"]').getByText("Dashboard", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Net Revenue", { exact: true }).waitFor({ timeout: 15000 });
    await page.locator('[data-testid="dashboard-metric-card"]').nth(3).waitFor({ timeout: 15000 });
    await assertHealthyPage(page, "mobile dashboard visual polish");

    const mobileLayout = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid="dashboard-metric-card"]'))
        .slice(0, 4)
        .map((card) => {
          const rect = card.getBoundingClientRect();
          return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        });
      const activeNav = document.querySelector('[data-testid="mobile-portal-nav"] [aria-current="page"]');
      return {
        cards,
        activeNavText: activeNav?.textContent || "",
        firstRowAligned: cards.length >= 2 && Math.abs(cards[0].top - cards[1].top) <= 8,
        secondColumnVisible: cards.length >= 2 && cards[1].left > cards[0].left + cards[0].width * 0.75,
        secondRowVisible: cards.length >= 4 && cards[2].top > cards[0].top + 40 && cards[3].top > cards[1].top + 40,
      };
    });
    assert(mobileLayout.cards.length === 4, `Expected 4 dashboard metric cards, got ${mobileLayout.cards.length}.`);
    assert(/Dashboard/.test(mobileLayout.activeNavText), "Mobile active nav did not identify Dashboard.");
    assert(mobileLayout.firstRowAligned, "Mobile metric cards are not aligned into a compact first row.");
    assert(mobileLayout.secondColumnVisible, "Mobile metric cards are not using a visible second column.");
    assert(mobileLayout.secondRowVisible, "Mobile metric cards are not forming the expected second row.");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-dashboard-visual-polish-mobile.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    response = await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Desktop dashboard returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: "Business Intelligence" }).waitFor({ timeout: 15000 });
    await assertHealthyPage(page, "desktop dashboard visual polish");
    const desktopNavVisible = await page.getByTestId("mobile-portal-nav").isVisible().catch(() => false);
    assert(!desktopNavVisible, "Mobile portal nav should be hidden on desktop.");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-dashboard-visual-polish-desktop.png"),
      fullPage: true,
    });

    watch.assertClean("dashboard visual polish");
    console.log("Dashboard visual polish proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
