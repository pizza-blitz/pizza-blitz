const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = (process.env.E2E_BASE_URL || "http://127.0.0.1:3011").replace(/\/$/, "");
const apiURL = (
  process.env.E2E_API_URL ||
  (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(baseURL)
    ? "http://127.0.0.1:8010"
    : `${baseURL}/server`)
).replace(/\/$/, "");
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

async function waitForStationOrder(page, station, orderId) {
  const testId = `kitchen-station-order-${station}-${orderId}`;
  let lastVisibleCards = "";

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const target = page.getByTestId(testId);
    if ((await target.count()) > 0) {
      await target.waitFor({ timeout: 10000 });
      return;
    }

    lastVisibleCards = await page
      .locator('[data-testid^="kitchen-station-order-"]')
      .evaluateAll((nodes) =>
        nodes
          .slice(0, 12)
          .map((node) => node.getAttribute("data-testid"))
          .filter(Boolean)
          .join(", ")
      )
      .catch(() => "");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("kitchen-station-board").waitFor({ timeout: 20000 });
    await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => undefined);
  }

  throw new Error(
    `Station ${station} did not show order #${orderId}. Visible station cards: ${lastVisibleCards || "none"}.`
  );
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const adminCookie = await portalLogin();
  const phone = `94${Date.now().toString().slice(-8)}`;
  let orderId = 0;

  const createResult = await apiJson("/api/v1/restaurant/orders/", "", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Kitchen Station Board Proof",
      customer_phone: phone,
      payment_method: "cash",
      notes: "E2E: kitchen station board proof",
      items: [
        { name: "Station Board Proof Pizza", quantity: 1, price: 249 },
        { name: "Station Board Proof Fries", quantity: 2, price: 99 },
        { name: "Station Board Proof Cola", quantity: 1, price: 59 },
      ],
    }),
  });
  assert(createResult.response.ok, `Could not create station-board order: ${JSON.stringify(createResult.data)}`);
  orderId = Number(createResult.data.order_id);
  assert(orderId > 0, `Station-board order id was invalid: ${JSON.stringify(createResult.data)}`);

  const orderResult = await apiJson(`/api/v1/restaurant/orders/${orderId}`, adminCookie);
  assert(orderResult.response.ok, `Could not fetch station-board order: ${JSON.stringify(orderResult.data)}`);
  const stationKeys = new Set((orderResult.data.items || []).map((item) => item.kitchen_station));
  ["oven", "fryer", "cold"].forEach((station) => {
    assert(stationKeys.has(station), `Created order #${orderId} missed ${station} station routing.`);
  });

  const stationCommandResult = await apiJson("/api/v1/restaurant/orders/station-command", adminCookie);
  assert(
    stationCommandResult.response.ok,
    `Station command API failed: ${JSON.stringify(stationCommandResult.data)}`
  );
  assert(
    stationCommandResult.data.summary?.routed_line_count >= 3,
    `Station command did not count routed lines: ${JSON.stringify(stationCommandResult.data.summary)}`
  );
  for (const station of ["oven", "fryer", "cold"]) {
    const commandStation = (stationCommandResult.data.stations || []).find((entry) => entry.key === station);
    assert(commandStation, `Station command missed ${station}.`);
    const commandOrder = (commandStation.orders || []).find((entry) => Number(entry.order_id) === orderId);
    assert(commandOrder, `Station command ${station} missed order #${orderId}.`);
    assert(commandOrder.lines?.length > 0, `Station command ${station} order #${orderId} had no lines.`);
    assert(
      commandOrder.lines.every((line) => line.routing_source === "saved"),
      `Station command ${station} did not use saved routing for order #${orderId}.`
    );
  }

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
    assert(response && response.ok(), `Operations page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: "Kitchen Operations" }).waitFor({ timeout: 15000 });
    await page.getByTestId("kitchen-station-board").waitFor({ timeout: 20000 });
    await page.getByTestId("kitchen-station-command").waitFor({ timeout: 20000 });
    await page.getByTestId("station-command-status").getByText(/station|line|blocker|rush|handoff|clear/i).waitFor({ timeout: 15000 });
    await assertHealthyPage(page, "kitchen station board page");

    for (const station of ["oven", "fryer", "cold"]) {
      await page.getByTestId(`station-command-station-${station}`).waitFor({ timeout: 15000 });
      await page.getByTestId(`station-command-order-${station}-${orderId}`).waitFor({ timeout: 15000 });
      await page.getByTestId(`kitchen-station-${station}`).waitFor({ timeout: 15000 });
      await waitForStationOrder(page, station, orderId);
      await page.getByTestId(`kitchen-station-lines-${station}-${orderId}`).waitFor({ timeout: 15000 });
      const ticketHref = await page.getByTestId(`kitchen-station-ticket-${station}-${orderId}`).getAttribute("href");
      assert(
        ticketHref === `/kitchen-ticket/${orderId}?station=${station}`,
        `Expected KOT href for ${station}, got ${ticketHref}.`
      );
    }

    await page.screenshot({
      path: path.join(artifactsDir, "visible-kitchen-station-board.png"),
      fullPage: true,
    });

    await page.getByTestId(`kitchen-station-start-oven-${orderId}`).click();
    await page.getByText(new RegExp(`Order #${orderId} moved to preparing`, "i")).waitFor({ timeout: 15000 });
    await page.getByTestId(`kitchen-station-ready-oven-${orderId}`).waitFor({ timeout: 15000 });

    await page.getByTestId(`kitchen-station-ready-oven-${orderId}`).click();
    await page.getByText(new RegExp(`Order #${orderId} moved to ready`, "i")).waitFor({ timeout: 15000 });

    const readyResult = await apiJson(`/api/v1/restaurant/orders/${orderId}`, adminCookie);
    assert(readyResult.response.ok, `Could not refetch station-board order: ${JSON.stringify(readyResult.data)}`);
    assert(readyResult.data.status === "ready", `Expected station-board order ready, got ${readyResult.data.status}.`);

    await page.screenshot({
      path: path.join(artifactsDir, "visible-kitchen-station-board-ready.png"),
      fullPage: true,
    });

    watch.assertClean("kitchen station board proof");
  } finally {
    if (orderId) {
      await apiJson(`/api/v1/restaurant/orders/${orderId}/close?payment_method=cash`, adminCookie, {
        method: "PATCH",
      }).catch(() => undefined);
    }
    await browser.close();
  }

  console.log(`Kitchen station board verification passed for order #${orderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
