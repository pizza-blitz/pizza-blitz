/* Department workspace tools proof: every new module renders live data for an admin. */
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
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`${label} did not become ready at ${url}: ${lastError}`);
}

async function portalContext(browser) {
  const login = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(login.ok, `Portal login failed: ${await login.text()}`);
  const cookie = cookieHeaderFromSetCookie(login.headers.get("set-cookie"));
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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
  return context;
}

function watch(page, label) {
  const issues = [];
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (
      /Failed to load resource|favicon\.ico|images\.unsplash\.com|Download the React DevTools|Failed to fetch RSC payload|Falling back to browser navigation/i.test(
        text
      )
    ) {
      return;
    }
    issues.push(`console error: ${text}`);
  });
  return () => assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
}

const PAGES = [
  {
    route: "/departments/operations/checklists",
    title: "Daily checklists",
    marker: '[data-testid="checklists-page"]',
  },
  {
    route: "/departments/facilities/assets",
    title: "Assets & maintenance",
    marker: '[data-testid="assets-page"]',
  },
  {
    route: "/departments/quality/audits",
    title: "Audits & food safety",
    marker: '[data-testid="audits-page"]',
  },
  {
    route: "/departments/legal/licences",
    title: "Licences & contracts",
    marker: '[data-testid="licences-page"]',
  },
  {
    route: "/departments/training/lms",
    title: "Training & certification",
    marker: "main, body",
  },
  {
    route: "/departments/franchise/pipeline",
    title: "Franchise pipeline",
    marker: "main, body",
  },
  {
    route: "/departments/executive/budget",
    title: "Budget & goals",
    marker: "main, body",
  },
  {
    route: "/departments/revenue/gift-cards",
    title: "Loyalty & gift cards",
    marker: '[data-testid="gift-cards-page"]',
  },
  {
    route: "/departments/supply/stocktake",
    title: "Stocktake",
    marker: '[data-testid="stocktake-page"]',
  },
  {
    route: "/departments/kitchen/engineering",
    title: "Menu engineering",
    marker: '[data-testid="menu-engineering-page"]',
  },
  {
    route: "/departments/technology/data",
    title: "Data & BI",
    marker: '[data-testid="data-page"]',
  },
];

async function run() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await portalContext(browser);
    for (const entry of PAGES) {
      const page = await context.newPage();
      const assertClean = watch(page, entry.route);
      const response = await page.goto(`${baseURL}${entry.route}`, {
        waitUntil: "domcontentloaded",
      });
      assert(response && response.ok(), `${entry.route} returned ${response?.status()}.`);
      await page.getByRole("heading", { name: entry.title, exact: true }).first().waitFor({
        timeout: 30000,
      });
      await page.locator(entry.marker).first().waitFor({ timeout: 30000 });
      const bodyText = (await page.locator("body").innerText()).toLowerCase();
      assert(
        !bodyText.includes("something went wrong"),
        `${entry.route} rendered an error state.`
      );
      assert(
        !bodyText.includes("online ordering is temporarily unavailable"),
        `${entry.route} unexpectedly showed a storefront error.`
      );
      assertClean(entry.route);
      await page.screenshot({
        path: path.join(artifactsDir, `workspace-${entry.route.split("/").pop()}.png`),
        fullPage: false,
      });
      await page.close();
    }

    const navPage = await context.newPage();
    await navPage.goto(`${baseURL}/departments/operations`, {
      waitUntil: "domcontentloaded",
    });
    await navPage
      .getByRole("link", { name: /Daily checklists/i })
      .first()
      .waitFor({ timeout: 30000 });
    await navPage.goto(`${baseURL}/departments/quality`, {
      waitUntil: "domcontentloaded",
    });
    await navPage
      .getByRole("link", { name: /Audits & CAPA/i })
      .first()
      .waitFor({ timeout: 30000 });
    await navPage.close();
  } finally {
    await browser.close();
  }
  console.log(`Department workspace proof passed for ${PAGES.length} modules.`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
