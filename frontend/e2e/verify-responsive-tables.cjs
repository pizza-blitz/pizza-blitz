/* Responsive table proof: dense pages use cards on mobile and tables on desktop. */
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

async function loginContext(browser, viewport) {
  const login = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(login.ok, `Admin login failed: ${await login.text()}`);
  const context = await browser.newContext({ viewport, isMobile: viewport.width < 600 });
  const cookie = cookieHeaderFromSetCookie(login.headers.get("set-cookie"));
  await context.addCookies(
    cookie
      .split(/;\s*/)
      .filter(Boolean)
      .map((pair) => {
        const [name, ...rest] = pair.split("=");
        return { name, value: rest.join("="), url: baseURL, httpOnly: true, sameSite: "Lax" };
      })
  );
  return context;
}

async function visibleTables(page) {
  return page.locator("table").evaluateAll((nodes) =>
    nodes.filter((node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && rect.width > 0 && rect.height > 0;
    }).length
  );
}

async function assertNoOverflow(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 2
  );
  assert(!overflow, `${label} has horizontal page overflow.`);
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  const browser = await chromium.launch({ headless: true });

  try {
    const mobile = await loginContext(browser, { width: 390, height: 844 });

    const reports = await mobile.newPage();
    await reports.goto(`${baseURL}/reports`, { waitUntil: "domcontentloaded" });
    await reports.getByRole("heading", { name: /Financial Audit Logs/i }).waitFor({ timeout: 20000 });
    await reports.getByTestId("mobile-report-card").first().waitFor({ timeout: 25000 });
    assert((await visibleTables(reports)) === 0, "Reports still shows a table on mobile.");
    await assertNoOverflow(reports, "Mobile reports");
    const reportCards = await reports.getByTestId("mobile-report-card").count();
    assert(reportCards >= 3, `Reports rendered only ${reportCards} mobile cards.`);
    await reports.getByTestId("mobile-report-card").first().scrollIntoViewIfNeeded();
    await reports.screenshot({
      path: path.join(artifactsDir, "visible-responsive-reports-mobile.png"),
      fullPage: false,
    });

    const menu = await mobile.newPage();
    await menu.goto(`${baseURL}/menu`, { waitUntil: "domcontentloaded" });
    await menu.getByTestId("mobile-menu-list").waitFor({ timeout: 20000 });
    await menu.getByTestId("mobile-menu-list").getByRole("button", { name: /^Edit / }).first().waitFor({ timeout: 20000 });
    assert((await visibleTables(menu)) === 0, "Menu still shows a table on mobile.");
    const menuCards = await menu.getByTestId("mobile-menu-list").locator("article").count();
    assert(menuCards >= 8, `Menu rendered only ${menuCards} mobile cards.`);
    const editTarget = await menu
      .getByTestId("mobile-menu-list")
      .getByRole("button", { name: /^Edit / })
      .first()
      .boundingBox();
    assert(editTarget && editTarget.height >= 40, `Menu edit target is ${editTarget?.height}px.`);
    await assertNoOverflow(menu, "Mobile menu");
    await menu.screenshot({
      path: path.join(artifactsDir, "visible-responsive-menu-mobile.png"),
      fullPage: true,
    });

    const inventory = await mobile.newPage();
    await inventory.goto(`${baseURL}/inventory`, { waitUntil: "domcontentloaded" });
    await inventory.getByTestId("mobile-stock-list").waitFor({ timeout: 20000 });
    assert((await visibleTables(inventory)) === 0, "Inventory still shows a table on mobile.");
    await assertNoOverflow(inventory, "Mobile inventory");
    const inventoryHeader = await inventory.getByRole("heading", { name: "Inventory Management" }).boundingBox();
    assert(inventoryHeader && inventoryHeader.width > 120, "Inventory heading collapsed on mobile.");
    await inventory.screenshot({
      path: path.join(artifactsDir, "visible-responsive-inventory-mobile.png"),
      fullPage: false,
    });
    await mobile.close();

    const desktop = await loginContext(browser, { width: 1440, height: 1000 });
    const desktopReports = await desktop.newPage();
    await desktopReports.goto(`${baseURL}/reports`, { waitUntil: "domcontentloaded" });
    await desktopReports.getByRole("heading", { name: /Financial Audit Logs/i }).waitFor({ timeout: 20000 });
    await desktopReports.locator("table").first().waitFor({ timeout: 20000 });
    assert((await visibleTables(desktopReports)) > 0, "Desktop reports lost its tables.");
    assert(
      !(await desktopReports.getByTestId("mobile-report-card").first().isVisible().catch(() => false)),
      "Mobile report cards are visible on desktop."
    );

    const desktopMenu = await desktop.newPage();
    await desktopMenu.goto(`${baseURL}/menu`, { waitUntil: "domcontentloaded" });
    await desktopMenu.locator("table").first().waitFor({ timeout: 20000 });
    assert((await visibleTables(desktopMenu)) > 0, "Desktop menu lost its table.");
    assert(
      !(await desktopMenu.getByTestId("mobile-menu-list").isVisible().catch(() => false)),
      "Mobile menu cards are visible on desktop."
    );
    await desktop.close();

    console.log("Responsive table proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
