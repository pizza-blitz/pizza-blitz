const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
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

function cookieHeaderFromSetCookie(setCookie) {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie || ""];
  return values
    .flatMap((value) => value.split(/,(?=\s*pb_[^=]+=)/))
    .map((value) => value.split(";")[0].trim())
    .filter((value) => value.startsWith("pb_"))
    .join("; ");
}

async function portalLogin() {
  const response = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  const data = await response.json().catch(() => ({}));
  assert(response.ok, `Admin portal login failed: ${JSON.stringify(data)}`);
  const cookie = cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
  assert(cookie.includes("pb_admin_session="), "Admin login did not return an admin session cookie.");
  return cookie;
}

async function apiJson(endpoint, cookie, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function createBrowserWatch(page) {
  const issues = [];
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
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
      bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  assert(health.textLength > 300, `${label} rendered too little content.`);
  assert(!health.hasOverlay, `${label} has a Next.js error overlay.`);
  assert(!health.hasFrameworkError, `${label} rendered framework error text.`);
  assert(health.bodyOverflow <= 8, `${label} has body-level horizontal overflow of ${health.bodyOverflow}px.`);
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const adminCookie = await portalLogin();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);
  const phone = `93${Date.now().toString().slice(-8)}`;
  let orderId = 0;

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const menuLoaded = page
      .waitForResponse((response) => response.url().includes("/menu/menu-with-customizations") && response.ok(), {
        timeout: 20000,
      })
      .catch(() => null);
    let response = await page.goto(`${baseURL}/orders`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Counter POS returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: "Counter POS" }).waitFor({ timeout: 15000 });
    await menuLoaded;
    await assertHealthyPage(page, "counter kitchen ticket source page");

    await page.getByTestId("counter-new-takeaway").click();
    await page.getByRole("heading", { name: "Takeaway Order" }).waitFor({ timeout: 15000 });
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid^="counter-quick-add-"]').length > 0 ||
        document.querySelectorAll('[data-testid^="counter-item-quantity-"]').length > 0,
      null,
      { timeout: 60000 }
    );
    const quickAdd = page.locator('[data-testid^="counter-quick-add-"]').first();
    if ((await quickAdd.count()) > 0) {
      await quickAdd.click();
    } else {
      await page.locator('[data-testid^="counter-item-quantity-"]').first().fill("1");
    }
    await page.getByText("Ready to send", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByPlaceholder("Customer name").fill("Kitchen Ticket Proof");
    await page.getByPlaceholder("Customer phone").fill(phone);
    await page.getByTestId("counter-send-order").click();
    await page.getByTestId("counter-pos-message").getByText(/Order #\d+ sent to kitchen/i).waitFor({ timeout: 15000 });

    const message = await page.getByTestId("counter-pos-message").innerText();
    const orderMatch = message.match(/Order #(\d+) sent to kitchen/i);
    assert(orderMatch, `Could not find kitchen-ticket order id in POS message: ${message}`);
    orderId = Number(orderMatch[1]);
    assert(orderId > 0, "Kitchen-ticket order id was not positive.");

    const orderResult = await apiJson(`/api/v1/restaurant/orders/${orderId}`, adminCookie);
    assert(orderResult.response.ok, `Could not fetch kitchen-ticket order: ${JSON.stringify(orderResult.data)}`);
    const firstItem = orderResult.data.items?.[0];
    assert(firstItem?.name, `Kitchen-ticket order ${orderId} did not include items.`);

    const kotHref = await page.getByTestId("counter-post-order-kitchen-ticket").getAttribute("href");
    assert(kotHref === `/kitchen-ticket/${orderId}`, `Expected KOT href for order ${orderId}, got ${kotHref}.`);
    await page.getByTestId("counter-post-order-kitchen-ticket").click();
    await page.waitForURL(new RegExp(`/kitchen-ticket/${orderId}$`), { timeout: 15000 });
    await page.getByTestId("kot-ticket").waitFor({ timeout: 15000 });
    await page.getByTestId("kot-order-id").getByText(`#${orderId}`, { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("KOT", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText(firstItem.name, { exact: false }).waitFor({ timeout: 15000 });
    await page.getByTestId("kot-item-row").first().waitFor({ timeout: 15000 });
    await page.getByTestId("kot-print-command").waitFor({ timeout: 15000 });
    await assertHealthyPage(page, "kitchen ticket page");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-counter-kitchen-ticket.png"),
      fullPage: true,
    });

    response = await page.goto(`${baseURL}/orders`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Counter POS return returned HTTP ${response?.status() || "no response"}.`);
    await page.getByTestId(`counter-kitchen-ticket-${orderId}`).waitFor({ timeout: 20000 }).catch(() => undefined);
    watch.assertClean("counter kitchen ticket proof");
  } finally {
    await browser.close();
  }

  console.log(`Counter kitchen ticket proof passed for order #${orderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
