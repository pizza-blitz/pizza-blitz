/* Portal shell proof: grouped navigation, active state, search, collapse, mobile drawer. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
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
      if (response.ok || response.status === 401) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`${label} did not become ready at ${url}: ${lastError}`);
}

function cookieHeaderFromSetCookie(setCookie) {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie || ""];
  return values
    .flatMap((value) => value.split(/,(?=\s*pb_[^=]+=)/))
    .map((value) => value.split(";")[0].trim())
    .filter((value) => value.startsWith("pb_"))
    .join("; ");
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
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const login = await desktop.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin login failed: ${await login.text()}`);
    const cookie = cookieHeaderFromSetCookie(login.headers()["set-cookie"]);
    const [cookieName, ...cookieRest] = cookie.split("=");
    await desktop.addCookies([
      { name: cookieName, value: cookieRest.join("="), url: baseURL, httpOnly: true, sameSite: "Lax" },
    ]);

    const page = await desktop.newPage();
    const watch = createBrowserWatch(page);
    let response = await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Dashboard returned ${response?.status()}.`);

    const sidebar = page.getByTestId("portal-sidebar");
    await sidebar.waitFor({ timeout: 15000 });
    await page
      .locator('[data-testid="portal-shell"][data-hydrated="true"]')
      .waitFor({ timeout: 15000 });
    for (const group of ["Overview", "Service floor", "Menu & stock", "Customers & growth", "System"]) {
      assert(
        (await sidebar.getByText(group, { exact: true }).count()) === 1,
        `Sidebar group "${group}" is missing.`
      );
    }
    const activeLabel = (await sidebar.locator('[aria-current="page"]').innerText()).trim();
    assert(/Dashboard/.test(activeLabel), `Sidebar active item was "${activeLabel}".`);

    const search = page.locator("#portal-nav-search");
    await search.fill("inventory");
    await page.waitForTimeout(200);
    const filteredLinks = await sidebar.locator("nav a").count();
    assert(filteredLinks > 0 && filteredLinks < 10, `Search left ${filteredLinks} links.`);
    assert(
      (await sidebar.getByRole("link", { name: "Inventory", exact: true }).count()) === 1,
      "Search did not keep the Inventory link."
    );
    assert(
      (await sidebar.getByRole("link", { name: "Dashboard", exact: true }).count()) === 0,
      "Search did not filter out Dashboard."
    );
    await search.fill("");

    const widthBefore = (await sidebar.boundingBox()).width;
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await page.waitForTimeout(350);
    const widthAfter = (await sidebar.boundingBox()).width;
    assert(widthAfter < widthBefore - 100, `Sidebar did not collapse (${widthBefore} → ${widthAfter}).`);
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await page.waitForTimeout(350);

    await page.goto(`${baseURL}/orders`, { waitUntil: "domcontentloaded" });
    const ordersActive = (await sidebar.locator('[aria-current="page"]').innerText()).trim();
    assert(/POS \(Orders\)/.test(ordersActive), `Orders active label was "${ordersActive}".`);
    watch.assertClean("desktop portal shell");
    await page.screenshot({
      path: path.join(artifactsDir, "visible-portal-shell-desktop.png"),
      fullPage: false,
    });
    await desktop.close();

    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    const mobileLogin = await mobile.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(mobileLogin.ok(), `Mobile admin login failed: ${await mobileLogin.text()}`);
    const mobileCookie = cookieHeaderFromSetCookie(mobileLogin.headers()["set-cookie"]);
    const [mobileName, ...mobileRest] = mobileCookie.split("=");
    await mobile.addCookies([
      {
        name: mobileName,
        value: mobileRest.join("="),
        url: baseURL,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    const mobilePage = await mobile.newPage();
    const mobileWatch = createBrowserWatch(mobilePage);
    response = await mobilePage.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Mobile dashboard returned ${response?.status()}.`);
    await mobilePage
      .locator('[data-testid="portal-shell"][data-hydrated="true"]')
      .waitFor({ timeout: 15000 });

    const bottomNav = mobilePage.getByTestId("mobile-portal-nav");
    await bottomNav.waitFor({ timeout: 15000 });
    assert(
      (await bottomNav.locator('[aria-current="page"]').innerText()).includes("Dashboard"),
      "Mobile bottom nav did not mark Dashboard active."
    );
    await mobilePage.getByRole("button", { name: "Open navigation" }).click();
    const drawer = mobilePage.getByTestId("portal-drawer");
    await drawer.waitFor({ timeout: 10000 });
    assert(await drawer.isVisible(), "Mobile drawer did not open.");
    assert(
      (await drawer.getByText("Menu & stock", { exact: true }).count()) === 1,
      "Mobile drawer is missing nav groups."
    );
    await mobilePage.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden", timeout: 5000 });
    mobileWatch.assertClean("mobile portal shell");
    await mobilePage.screenshot({
      path: path.join(artifactsDir, "visible-portal-shell-mobile.png"),
      fullPage: false,
    });
    await mobile.close();

    console.log("Portal shell proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
