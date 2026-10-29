/* Landing conversion proof: quick-add, mobile order bar, draft handoff, Blaze hero entry. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const artifactsDir = path.join(__dirname, "artifacts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForHttp(url, label) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < 30000) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
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
    issues.push(`console error: ${text}`);
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

  try {
    /* Mobile: quick-add two items, confirm the sticky bar, then hand off to /order. */
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    const page = await mobile.newPage();
    const watch = createBrowserWatch(page);
    await page.goto(baseURL, { waitUntil: "networkidle" });
    await page.evaluate(() => window.localStorage.removeItem("pizza_blitz_order_draft"));
    await page.reload({ waitUntil: "networkidle" });

    const cards = page.locator("#menu article");
    await cards.first().waitFor();
    const firstCard = cards.nth(0);
    const secondCard = cards.nth(1);
    const firstName = (await firstCard.locator("h3").innerText()).trim();
    const secondName = (await secondCard.locator("h3").innerText()).trim();

    await firstCard.locator("button").first().click();
    await page.getByText("1 item in your order", { exact: true }).waitFor({ timeout: 10000 });
    await secondCard.locator("button").first().click();
    await page.getByText("2 items in your order", { exact: true }).waitFor({ timeout: 10000 });

    const stored = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("pizza_blitz_order_draft") || "{}")
    );
    assert(stored.version === 1, "Quick-add did not write a versioned order draft.");
    assert(
      Array.isArray(stored.cart) && stored.cart.length === 2,
      `Quick-add wrote ${stored.cart?.length || 0} cart lines instead of 2.`
    );

    await page.locator("#menu").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifactsDir, "landing-quick-add-mobile.png") });

    await page.getByRole("link", { name: /View order/i }).click();
    await page.waitForURL(/\/order(\?|$)/, { timeout: 15000 });
    const summary = page.locator('[data-testid="customer-cart-summary"]');
    await summary.waitFor({ timeout: 20000 });
    try {
      await summary.getByText(firstName, { exact: false }).first().waitFor({ timeout: 20000 });
      await summary.getByText(secondName, { exact: false }).first().waitFor({ timeout: 20000 });
    } catch (error) {
      const summaryText = await summary.innerText().catch(() => "<summary unavailable>");
      const draft = await page
        .evaluate(() => window.localStorage.getItem("pizza_blitz_order_draft") || "")
        .catch(() => "<draft unavailable>");
      await page
        .screenshot({
          path: path.join(artifactsDir, "landing-quick-add-failure.png"),
          fullPage: true,
        })
        .catch(() => {});
      throw new Error(
        `Restored cart is missing a quick-added item (wanted "${firstName}" and "${secondName}").\n` +
          `Summary:\n${summaryText}\nDraft:\n${draft}\n${error.message}`
      );
    }
    const summaryText = await summary.innerText();
    assert(
      summaryText.includes(firstName) && summaryText.includes(secondName),
      `Restored cart is missing quick-added items.\n${summaryText}`
    );
    await page.screenshot({ path: path.join(artifactsDir, "landing-quick-add-restored.png") });
    watch.assertClean("landing quick-add flow");
    await mobile.close();

    /* Desktop: the hero concierge card opens the live 3D ordering assistant. */
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const desktopPage = await desktop.newPage();
    const desktopWatch = createBrowserWatch(desktopPage);
    await desktopPage.goto(baseURL, { waitUntil: "networkidle" });
    await desktopPage.getByRole("button", { name: /Ask Blaze or speak your order/i }).click();
    const dialog = desktopPage.getByRole("dialog", { name: /ordering concierge/i });
    await dialog.waitFor({ timeout: 15000 });
    await dialog.locator("canvas").first().waitFor({ timeout: 20000 });
    await desktopPage.screenshot({ path: path.join(artifactsDir, "landing-blaze-hero-open.png") });
    await dialog.getByRole("button", { name: "Close Blaze" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 10000 });
    desktopWatch.assertClean("landing Blaze hero");
    await desktop.close();

    console.log("Landing conversion proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
