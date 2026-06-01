const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

async function portalLoginCookie() {
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

async function createCashOrder() {
  const response = await fetch(`${apiURL}/api/v1/restaurant/orders/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Daily Close Guest",
      customer_phone: "9400012401",
      payment_method: "cash",
      notes: "E2E daily close command",
      items: [
        {
          name: "Margherita Pizza",
          quantity: 1,
          price: 199,
        },
      ],
    }),
  });
  const data = await response.json();
  assert(response.ok, `Could not create cash order: ${JSON.stringify(data)}`);
  assert(data.order_id, "Cash order response did not include order_id.");
  return data.order_id;
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

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const adminCookie = await portalLoginCookie();
  const orderId = await createCashOrder();

  const ready = await apiJson(`/api/v1/restaurant/orders/${orderId}/status`, adminCookie, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "ready" }),
  });
  assert(ready.response.ok, `Could not ready order #${orderId}: ${JSON.stringify(ready.data)}`);

  const closed = await apiJson(`/api/v1/restaurant/orders/${orderId}/close?payment_method=cash`, adminCookie, {
    method: "PATCH",
  });
  assert(closed.response.ok, `Could not close order #${orderId}: ${JSON.stringify(closed.data)}`);

  const drawerBefore = await apiJson("/api/v1/restaurant/orders/cash-drawer/command", adminCookie);
  assert(drawerBefore.response.ok, `Cash drawer command failed: ${JSON.stringify(drawerBefore.data)}`);
  const expectedTotals = Object.fromEntries(
    drawerBefore.data.method_totals.map((row) => [row.method, row.expected_amount || 0])
  );
  const drawerClose = await apiJson("/api/v1/restaurant/orders/cash-drawer/close", adminCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      counted_cash: expectedTotals.cash || 0,
      counted_upi: expectedTotals.upi || 0,
      counted_card: expectedTotals.card || 0,
      counted_mixed: expectedTotals.mixed || 0,
      counted_prepaid: expectedTotals.prepaid || 0,
      counted_other: expectedTotals.other || 0,
      closed_by: "E2E Manager",
      notes: "E2E drawer close before daily close",
    }),
  });
  assert(drawerClose.response.ok, `Could not close drawer: ${JSON.stringify(drawerClose.data)}`);
  assert(drawerClose.data.status === "balanced", `Drawer did not balance: ${JSON.stringify(drawerClose.data)}`);

  const closeBefore = await apiJson("/api/v1/restaurant/ops/daily-close-command", adminCookie);
  assert(closeBefore.response.ok, `Daily close command failed: ${JSON.stringify(closeBefore.data)}`);
  assert(
    closeBefore.data.summary.blocker_count === 0,
    `Daily close should have no blockers after drawer close: ${JSON.stringify(closeBefore.data.summary)}`
  );

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/operations`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Operations returned HTTP ${response?.status() || "no response"}.`);
    await assertHealthyPage(page, "daily close command page");
    await page.getByTestId("daily-close-command").waitFor({ timeout: 15000 });
    await page.getByText("Daily Close Command Center", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByTestId("daily-close-manager").fill("E2E Manager");
    await page.getByTestId("daily-close-notes").fill("E2E daily close proof");
    await page.getByTestId("daily-close-record-proof").click();
    await page.getByTestId("daily-close-proof-result").waitFor({ timeout: 15000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-daily-close-command.png"),
      fullPage: true,
    });
    watch.assertClean("daily close command workflow");
  } finally {
    await browser.close();
  }

  const closeAfter = await apiJson("/api/v1/restaurant/ops/daily-close-command", adminCookie);
  assert(closeAfter.response.ok, `Daily close after proof failed: ${JSON.stringify(closeAfter.data)}`);
  assert(closeAfter.data.latest_daily_close, "Daily close proof did not create an audit event.");
  assert(
    closeAfter.data.summary.overall_status === "closed",
    `Daily close did not move to closed: ${JSON.stringify(closeAfter.data.summary)}`
  );

  console.log(`Daily close command passed for order #${orderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
