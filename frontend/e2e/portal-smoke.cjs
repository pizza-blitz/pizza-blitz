const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");

const protectedRoutes = [
  "/dashboard",
  "/orders",
  "/operations",
  "/customers",
  "/promotions",
  "/social",
  "/ads",
  "/ops",
  "/reports",
];

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
      if (response.ok) {
        return;
      }
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
    if (
      /Failed to fetch RSC payload/i.test(text) &&
      /Falling back to browser navigation/i.test(text)
    ) {
      return;
    }
    issues.push(`console error: ${text}`);
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    const localRequest = url.startsWith(baseURL) || url.startsWith(apiURL);
    if (!localRequest) return;
    const failure = request.failure();
    if (failure?.errorText === "net::ERR_ABORTED") return;
    issues.push(`request failed: ${request.method()} ${url} ${failure?.errorText || ""}`.trim());
  });

  return {
    clear() {
      issues.length = 0;
    },
    assertClean(label) {
      assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
    },
  };
}

async function assertHealthyPage(page, label) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => undefined);

  const bodyText = await page.locator("body").innerText({ timeout: 7000 });
  assert(bodyText.trim().length > 40, `${label} rendered too little content.`);
  assert(
    !/Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(bodyText),
    `${label} rendered a framework error overlay.`
  );

  const overlayCount = await page
    .locator("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")
    .count();
  assert(overlayCount === 0, `${label} has a Next.js error overlay.`);
}

async function gotoAndCheck(page, watch, route, label, expectedText) {
  watch.clear();
  const response = await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded" });
  assert(response && response.ok(), `${label} returned HTTP ${response?.status() || "no response"}.`);
  await assertHealthyPage(page, label);
  if (expectedText) {
    await page.getByText(expectedText, { exact: false }).first().waitFor({ timeout: 7000 });
  }
  watch.assertClean(label);
}

async function signInAsAdmin(page, watch) {
  await gotoAndCheck(page, watch, "/login", "admin login page", "Sign In to Portal");
  watch.clear();

  await page.getByPlaceholder("Enter admin ID").fill(adminId);
  await page.getByPlaceholder("Enter password").fill(adminPassword);
  await Promise.all([
    page.waitForURL(/\/dashboard$/, { timeout: 15000 }),
    page.getByRole("button", { name: /Sign In/i }).click(),
  ]);

  await assertHealthyPage(page, "dashboard after login");
  assert(page.url().endsWith("/dashboard"), `Expected dashboard after login, got ${page.url()}.`);
  watch.assertClean("admin login");
}

async function verifyProtectedRoutes(page, watch) {
  for (const route of protectedRoutes) {
    await gotoAndCheck(page, watch, route, `protected route ${route}`);
    assert(!page.url().includes("/login"), `${route} redirected back to login.`);
  }
}

async function completeCustomerOrder(page, watch) {
  await gotoAndCheck(page, watch, "/order", "customer order page", "Checkout");
  await page.getByRole("button", { name: /^Add$/i }).first().click();
  await page.getByText("Cart is empty.").waitFor({ state: "detached", timeout: 7000 }).catch(() => undefined);

  await page.getByPlaceholder("Name").fill("Portal Smoke Customer");
  await page.getByPlaceholder("Phone").fill("9990001111");
  await page.getByPlaceholder("Email for receipts and offers").fill("smoke@example.com");
  await page.getByRole("button", { name: "Cash" }).click();
  await page.getByRole("button", { name: /Place Order/i }).click();
  await page.waitForFunction(
    () => /Order #\d+ confirmed/.test(document.body.innerText),
    null,
    { timeout: 15000 }
  );

  const orderText = await page.locator("body").innerText();
  const orderMatch = orderText.match(/Order #(\d+) confirmed/);
  assert(orderMatch, "Customer order did not return a confirmed order id.");

  await page.screenshot({
    path: path.join(artifactsDir, "customer-order-confirmed.png"),
    fullPage: true,
  });
  watch.assertClean("customer checkout");

  watch.clear();
  await page.getByRole("link", { name: /Track this order/i }).click();
  await page.waitForURL(/\/track\?/, { timeout: 10000 });
  await assertHealthyPage(page, "order tracking page");
  await page.getByText("Order Details", { exact: false }).waitFor({ timeout: 10000 });
  watch.assertClean("order tracking");
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/api/v1/restaurant/menu/menu-with-customizations`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    await gotoAndCheck(page, watch, "/", "public home page", "Pizza Blitz");
    await completeCustomerOrder(page, watch);
    await signInAsAdmin(page, watch);
    await verifyProtectedRoutes(page, watch);
    await page.screenshot({
      path: path.join(artifactsDir, "admin-dashboard.png"),
      fullPage: true,
    });
  } finally {
    await browser.close();
  }

  console.log("Portal browser smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
