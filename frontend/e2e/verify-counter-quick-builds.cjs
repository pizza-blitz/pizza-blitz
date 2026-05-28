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

async function loadQuickBuild() {
  const { response, data } = await apiJson("/api/v1/restaurant/menu/customizations/quick-builds");
  assert(response.ok, `Could not load quick builds: ${JSON.stringify(data)}`);
  assert(data.summary?.quick_build_count >= 2, "Quick-build summary did not expose enough presets.");
  const build =
    data.builds.find((row) => row.id === "large-cheese-burst-combo") ||
    data.builds[0];
  assert(build?.item?.id, "No quick-build item was available.");
  assert(build.selected_options?.length >= 3, "Quick build did not include grouped selected options.");
  assert(Number(build.unit_price || 0) > Number(build.base_price || 0), "Quick build should include upgrade pricing.");
  return build;
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const adminCookie = await portalLogin();
  const build = await loadQuickBuild();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);
  const phone = `97${Date.now().toString().slice(-8)}`;

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    let response = await page.goto(`${baseURL}/orders`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Counter POS returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: "Counter POS" }).waitFor({ timeout: 15000 });
    await page.getByTestId("counter-new-takeaway").click();
    await page.getByRole("heading", { name: "Takeaway Order" }).waitFor({ timeout: 15000 });
    await page.getByTestId("counter-quick-builds").waitFor({ timeout: 15000 });
    await page.getByTestId(`counter-quick-build-${build.id}`).click();
    await page.getByTestId("counter-pos-message").getByText(build.name, { exact: false }).waitFor({ timeout: 10000 });
    await page.getByPlaceholder("Customer name").fill("Quick Build Proof");
    await page.getByPlaceholder("Customer phone").fill(phone);
    await page.getByTestId("counter-send-order").click();
    await page.getByText(/Order #\d+ sent to kitchen/i).waitFor({ timeout: 15000 });

    const message = await page.getByTestId("counter-pos-message").innerText();
    const orderMatch = message.match(/Order #(\d+) sent to kitchen/i);
    assert(orderMatch, `Could not find order id in POS message: ${message}`);
    const orderId = Number(orderMatch[1]);
    assert(orderId > 0, "Counter quick-build order id was not positive.");
    await page.getByTestId(`counter-order-card-${orderId}`).waitFor({ timeout: 15000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-counter-quick-builds.png"),
      fullPage: true,
    });

    const orderResult = await apiJson(`/api/v1/restaurant/orders/${orderId}`, adminCookie);
    assert(orderResult.response.ok, `Could not fetch quick-build order: ${JSON.stringify(orderResult.data)}`);
    const orderedItem = orderResult.data.items.find((item) => item.name === build.item.name);
    assert(orderedItem, `Quick-build order did not include ${build.item.name}.`);
    assert(Number(orderedItem.price) === Number(build.unit_price), "Quick-build unit price was not server-calculated.");
    const storedOptionNames = (orderedItem.selected_options || []).map((option) => option.option_name);
    for (const option of build.selected_options) {
      assert(
        storedOptionNames.includes(option.option_name),
        `Stored order missed quick-build option ${option.option_name}.`
      );
    }

    response = await page.goto(`${baseURL}/receipt/${orderId}`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Quick-build receipt returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: "Customer Receipt" }).waitFor({ timeout: 15000 });
    await page.getByText(`PB-ORDER-${orderId}`, { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText(build.selected_options[0].option_name, { exact: false }).waitFor({ timeout: 15000 });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-counter-quick-builds-receipt.png"),
      fullPage: true,
    });

    watch.assertClean("counter quick-build proof");
    console.log(`Counter quick-build proof passed for order #${orderId}.`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
