const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const staffId = process.env.E2E_STAFF_ID || "staff";
const staffPassword = process.env.E2E_STAFF_PASSWORD || "staff123";
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
      if (response.ok) return;
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

async function portalLogin(role) {
  const response = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: role === "staff" ? staffId : adminId,
      password: role === "staff" ? staffPassword : adminPassword,
      role,
    }),
  });
  const data = await response.json().catch(() => ({}));
  assert(response.ok, `${role} login failed: ${JSON.stringify(data)}`);
  const cookie = cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
  assert(cookie.includes(`pb_${role}_session=`), `${role} login did not return a portal session cookie.`);
  return cookie;
}

async function apiJson(endpoint, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function createDeliveryOrder(zoneId, address) {
  const { response, data } = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "delivery",
      customer_name: "Address Review Proof",
      customer_phone: `96${Date.now().toString().slice(-8)}`,
      customer_email: "address-review-proof@example.com",
      payment_method: "cash",
      delivery_address: address,
      delivery_zone_id: zoneId,
      notes: "E2E delivery assignment readiness proof",
      items: [
        {
          name: "Farmhouse Pizza (R)",
          quantity: 1,
          price: 249,
        },
      ],
    }),
  });
  assert(response.ok, `Delivery order failed: ${JSON.stringify(data)}`);
  assert(data.order_id, "Delivery order response did not include order_id.");
  return data.order_id;
}

function createBrowserWatch(page) {
  const issues = [];
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico/i.test(text)) return;
    issues.push(`console error: ${text}`);
  });
  return {
    assertClean(label) {
      assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
    },
  };
}

async function proveOperationsAssignment(orderId) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1050 },
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
    await page.getByText("Delivery Dispatch Board", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByTestId("delivery-mission-control").waitFor({ timeout: 10000 });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="delivery-next-priority"]')?.textContent?.includes("Order #"),
      null,
      { timeout: 30000 }
    );
    await page.getByTestId("delivery-priority-address-review").getByText("Address Review", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByTestId("delivery-priority-need-rider").getByText("Need Rider", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByText("Address Review", { exact: false }).first().waitFor({ timeout: 10000 });

    const card = page.locator("article").filter({ hasText: `Order #${orderId}` }).first();
    await card.waitFor({ timeout: 10000 });
    await page.getByTestId(`delivery-status-rail-${orderId}`).waitFor({ timeout: 10000 });
    await page.getByTestId(`delivery-address-score-${orderId}`).waitFor({ timeout: 10000 });
    await card.getByText("Address Review Required", { exact: false }).waitFor({ timeout: 10000 });
    await card.getByText("Next action:", { exact: false }).waitFor({ timeout: 10000 });

    await page.getByTestId(`delivery-rider-${orderId}-anita-rider`).click();
    await page.waitForFunction(
      (id) => {
        const card = document.querySelector(`[data-testid="delivery-handoff-order-${id}"]`);
        return Array.from(card?.querySelectorAll("input") || []).some((input) => input.value === "Anita Rider");
      },
      orderId,
      { timeout: 10000 }
    );
    await card.getByPlaceholder("Handoff note or failure reason").fill("Call before dispatch; verify warehouse gate.");
    await page.getByTestId(`delivery-assign-${orderId}`).click();
    await page
      .getByText(`Delivery for order #${orderId} moved to assigned.`, { exact: false })
      .waitFor({ timeout: 10000 });
    await page.getByTestId(`delivery-assignment-status-${orderId}`).getByText("assigned", { exact: true }).waitFor({ timeout: 10000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-delivery-assignment-readiness.png"),
      fullPage: true,
    });
    watch.assertClean("delivery assignment readiness operations proof");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const zonesResult = await apiJson("/api/v1/restaurant/delivery/zones");
  assert(zonesResult.response.ok, `Could not load zones: ${JSON.stringify(zonesResult.data)}`);
  const zones = zonesResult.data;
  const outerZone = zones.find((zone) => zone.name === "Outer Ring") || zones[zones.length - 1];
  assert(outerZone?.id, "Outer delivery zone was not available.");

  const address = "Airport bypass warehouse";
  const quoteResult = await apiJson("/api/v1/restaurant/delivery/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, subtotal: 249, zone_id: outerZone.id }),
  });
  assert(quoteResult.response.ok, `Delivery quote failed: ${JSON.stringify(quoteResult.data)}`);
  assert(quoteResult.data.is_deliverable, "Delivery quote was not deliverable.");
  assert(quoteResult.data.address_validation?.requires_review, "Quote did not flag the weak address for review.");
  assert(
    quoteResult.data.address_validation?.warnings?.some((warning) => /house|flat|shop|gate|building/i.test(warning)),
    "Quote did not explain the missing house or building detail."
  );

  const orderId = await createDeliveryOrder(outerZone.id, address);
  const staffCookie = await portalLogin("admin");
  const queueResult = await fetch(`${apiURL}/api/v1/restaurant/delivery/queue`, {
    headers: { Cookie: staffCookie },
    cache: "no-store",
  });
  const queue = await queueResult.json();
  assert(queueResult.ok, `Staff could not load delivery queue: ${JSON.stringify(queue)}`);
  assert(queue.summary?.address_review_count >= 1, "Queue summary did not count address-review orders.");
  const queueOrder = queue.orders.find((order) => order.id === orderId);
  assert(queueOrder, "Delivery queue did not include the new address-review order.");
  assert(queueOrder.address_validation?.requires_review, "Queue order did not keep address validation.");
  assert(queueOrder.requires_address_review, "Queue order did not expose requires_address_review.");
  assert(/confirm address/i.test(queueOrder.next_action), "Queue next action did not guide staff to confirm the address.");

  await proveOperationsAssignment(orderId);
  console.log(`Delivery assignment readiness proof passed for order #${orderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
