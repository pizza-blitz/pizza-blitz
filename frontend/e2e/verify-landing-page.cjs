/* Landing page proof: content, SEO data, and responsive layout. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
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

async function assertLanding(page, label) {
  const title = await page.title();
  assert(/Pizza Blitz/i.test(title), `${label} title did not mention Pizza Blitz: ${title}`);

  const h1 = (await page.locator("h1").first().innerText()).trim();
  assert(/Blitz|Pizza/i.test(h1), `${label} h1 looked wrong: ${h1}`);

  for (const section of ["#menu", "#offers", "#standards", "#faq"]) {
    assert((await page.locator(section).count()) === 1, `${label} is missing section ${section}.`);
  }

  const menuCards = await page.locator("#menu article").count();
  assert(menuCards >= 3, `${label} rendered only ${menuCards} menu cards.`);

  const faqCount = await page.locator("#faq details").count();
  assert(faqCount >= 4, `${label} rendered only ${faqCount} FAQ entries.`);

  const jsonLd = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(
      (node) => node.textContent || ""
    )
  );
  assert(jsonLd.length >= 2, `${label} is missing JSON-LD blocks.`);
  const restaurant = jsonLd
    .map((raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })
    .find((value) => value && value["@type"] === "Restaurant");
  assert(Boolean(restaurant), `${label} is missing Restaurant JSON-LD.`);
  assert(
    (await page.locator('a[href="/order"]').count()) >= 2,
    `${label} does not link to the order flow.`
  );
  assert((await page.locator("footer").count()) === 1, `${label} is missing a footer.`);
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");

  const browser = await chromium.launch({ headless: true });

  try {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const desktopPage = await desktop.newPage();
    const desktopWatch = createBrowserWatch(desktopPage);
    await desktopPage.goto(baseURL, { waitUntil: "networkidle" });
    await assertLanding(desktopPage, "desktop landing");
    assert(
      await desktopPage.getByRole("navigation", { name: "Primary" }).isVisible(),
      "Desktop primary navigation is not visible."
    );
    const desktopCards = await desktopPage.locator("#menu article").evaluateAll((nodes) =>
      nodes.slice(0, 3).map((node) => node.getBoundingClientRect().top)
    );
    assert(
      desktopCards.length === 3 && Math.abs(desktopCards[0] - desktopCards[2]) <= 8,
      "Desktop menu cards are not rendered in a three-column row."
    );
    desktopWatch.assertClean("desktop landing");
    await desktopPage.screenshot({
      path: path.join(artifactsDir, "visible-landing-page-desktop.png"),
      fullPage: true,
    });
    await desktop.close();

    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    const mobilePage = await mobile.newPage();
    const mobileWatch = createBrowserWatch(mobilePage);
    await mobilePage.goto(baseURL, { waitUntil: "networkidle" });
    await assertLanding(mobilePage, "mobile landing");
    const overflow = await mobilePage.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 2
    );
    assert(!overflow, "Mobile landing page has horizontal overflow.");
    const mobileCards = await mobilePage.locator("#menu article").evaluateAll((nodes) =>
      nodes.slice(0, 2).map((node) => node.getBoundingClientRect().top)
    );
    assert(
      mobileCards.length === 2 && mobileCards[1] > mobileCards[0] + 40,
      "Mobile menu cards are not stacked vertically."
    );
    mobileWatch.assertClean("mobile landing");
    await mobilePage.screenshot({
      path: path.join(artifactsDir, "visible-landing-page-mobile.png"),
      fullPage: true,
    });
    await mobile.close();

    console.log("Landing page proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
