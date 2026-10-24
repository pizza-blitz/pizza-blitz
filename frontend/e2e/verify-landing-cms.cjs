/* Landing CMS proof: edit hero/story, pick Media Studio image, publish, verify, reset. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://localhost:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");
const PIZZA = fs.readFileSync(path.join(__dirname, "fixtures", "pizza-proof.jpg"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cookieHeaderFromSetCookie(setCookie) {
  if (!setCookie) return "";
  return setCookie
    .split(/,(?=[^;]+=)/)
    .map((part) => part.split(";")[0].trim())
    .join("; ");
}

async function waitForHttp(url, label) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < 30000) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok || response.status === 401) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`${label} did not become ready at ${url}: ${lastError}`);
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(portalLogin.ok, `Portal login failed: ${await portalLogin.text()}`);
  const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
    await context.addCookies(
      cookie
        .split(/;\s*/)
        .filter(Boolean)
        .map((pair) => {
          const [name, ...rest] = pair.split("=");
          return {
            name,
            value: rest.join("="),
            url: baseURL,
            httpOnly: true,
            sameSite: "Lax",
          };
        })
    );
    const page = await context.newPage();
    await page.goto(`${baseURL}/settings/content`, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="landing-content-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });

    await page.getByTestId("landing-hero-title").fill("Proof-fired pizza");
    await page.getByTestId("landing-hero-highlight").fill("ready in minutes.");
    await page
      .getByTestId("landing-hero-subtitle")
      .fill("A custom storefront subtitle saved from the admin content studio.");
    await page.getByTestId("landing-story-title").fill("A proof kitchen, live");
    await page
      .getByTestId("landing-story-body")
      .fill("This story copy was changed from the admin landing page editor without a deploy.");

    await page.getByTestId("landing-hero-image-open").click();
    await page.getByTestId("landing-hero-image-dialog").waitFor({ timeout: 15000 });
    await page
      .locator('[data-testid="landing-hero-image-dialog"] input[type="file"]')
      .setInputFiles({
        name: "landing-proof.jpg",
        mimeType: "image/jpeg",
        buffer: PIZZA,
      });
    await page.getByTestId("landing-hero-image-dialog").waitFor({ state: "hidden", timeout: 20000 });
    const heroValue = await page.getByTestId("landing-hero-image").locator("input").first().inputValue();
    assert(heroValue.includes("/media/library/"), "Hero image was not selected from Media Studio.");

    await page.getByTestId("landing-save").click();
    await page.getByText("Landing page saved", { exact: false }).waitFor({ timeout: 20000 });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-landing-cms.png"),
      fullPage: false,
    });

    await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
    await page.getByText("Proof-fired pizza", { exact: false }).waitFor({ timeout: 30000 });
    const landingText = await page.locator("main").innerText();
    assert(landingText.includes("ready in minutes."), "Custom highlight not on storefront.");
    assert(
      landingText.includes("A custom storefront subtitle saved from the admin content studio."),
      "Custom hero subtitle not on storefront."
    );
    assert(landingText.includes("A proof kitchen, live"), "Custom story title not on storefront.");
    await page.waitForFunction(() => {
      const image = document.querySelector("main section img");
      return image && image.complete && image.naturalWidth > 0;
    });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(artifactsDir, "visible-landing-custom.png"),
      fullPage: false,
    });

    await page.goto(`${baseURL}/settings/content`, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="landing-content-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByTestId("landing-reset").click();
    await page.getByText("Original landing content restored", { exact: false }).waitFor({ timeout: 20000 });

    await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
    await page.getByText("Pizza that shows up", { exact: false }).waitFor({ timeout: 30000 });

    console.log("Landing CMS proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
