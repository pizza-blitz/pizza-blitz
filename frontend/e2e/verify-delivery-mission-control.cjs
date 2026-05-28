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

async function portalLogin() {
  const response = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: adminId,
      password: adminPassword,
      role: "admin",
    }),
  });
  const text = await response.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`admin login returned non-JSON: ${text.slice(0, 220)}`);
  }
  assert(response.ok, `admin login failed: ${JSON.stringify(data)}`);
  const cookie = cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
  assert(cookie.includes("pb_admin_session="), "Admin login did not return a portal session cookie.");
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
  const phoneTail = Date.now().toString().slice(-8);
  const { response, data } = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "delivery",
      customer_name: "Delivery Mission Proof",
      customer_phone: `96${phoneTail}`,
      customer_email: "delivery-mission-proof@example.com",
      payment_method: "prepaid",
      delivery_address: address,
      delivery_zone_id: zoneId,
      notes: "E2E delivery mission-control proof",
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

async function screenshotOperations(orderId) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1040 },
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
    await page.getByTestId("delivery-operations-mission-control").waitFor({ timeout: 15000 });
    await page.getByText(/address validation gate/i).waitFor({ timeout: 10000 });
    await page.getByText(/zone coverage/i).waitFor({ timeout: 10000 });
    await page.getByTestId(`delivery-handoff-order-${orderId}`).waitFor({ timeout: 10000 });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-delivery-mission-control.png"),
      fullPage: true,
    });
    watch.assertClean("delivery mission-control operations screenshot");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const anonymousMission = await apiJson("/api/v1/restaurant/delivery/mission-control");
  assert(
    anonymousMission.response.status === 401,
    `Anonymous mission control should be protected, got ${anonymousMission.response.status}.`
  );

  const zonesResult = await apiJson("/api/v1/restaurant/delivery/zones");
  assert(zonesResult.response.ok, `Could not load zones: ${JSON.stringify(zonesResult.data)}`);
  const outerZone = zonesResult.data.find((zone) => zone.name === "Outer Ring") || zonesResult.data.at(-1);
  assert(outerZone?.id, "Outer delivery zone was not available.");

  const reviewAddress = "Airport bypass service road outer ring";
  const quoteResult = await apiJson("/api/v1/restaurant/delivery/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: reviewAddress, subtotal: 249 }),
  });
  assert(quoteResult.response.ok, `Delivery quote failed: ${JSON.stringify(quoteResult.data)}`);
  assert(quoteResult.data.zone?.id === outerZone.id, "Quote did not select the outer delivery zone.");
  assert(
    quoteResult.data.address_validation?.requires_review,
    "Review address should require operator confirmation."
  );

  const orderId = await createDeliveryOrder(outerZone.id, reviewAddress);
  const adminCookie = await portalLogin();
  const missionResult = await fetch(`${apiURL}/api/v1/restaurant/delivery/mission-control`, {
    headers: { Cookie: adminCookie },
    cache: "no-store",
  });
  const mission = await missionResult.json();
  assert(missionResult.ok, `Admin could not load delivery mission control: ${JSON.stringify(mission)}`);
  assert(mission.summary.active_zone_count >= 1, "Mission control did not report active delivery zones.");
  assert(mission.summary.open_delivery_count >= 1, "Mission control did not report open deliveries.");
  assert(mission.summary.address_review_count >= 1, "Mission control did not report address review blockers.");
  assert(mission.summary.payment_due_count >= 1, "Mission control did not report prepaid payment blockers.");
  for (const label of [
    "Zone pricing gate",
    "Address validation gate",
    "Rider assignment gate",
    "Payment close gate",
    "ETA handoff",
  ]) {
    assert(mission.controls.some((control) => control.label === label), `Missing mission control: ${label}`);
  }

  const assignResult = await fetch(`${apiURL}/api/v1/restaurant/delivery/orders/${orderId}/assignment`, {
    method: "PATCH",
    headers: {
      Cookie: adminCookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assigned_to: "Maya Rider",
      status: "assigned",
      notes: "Confirm exact gate before dispatch.",
    }),
  });
  const assigned = await assignResult.json();
  assert(assignResult.ok, `Could not assign delivery: ${JSON.stringify(assigned)}`);
  assert(assigned.assignment.assigned_to === "Maya Rider", "Assignment did not keep the rider name.");
  assert(assigned.assignment.status === "assigned", "Assignment did not move to assigned.");

  const queueResult = await fetch(`${apiURL}/api/v1/restaurant/delivery/queue`, {
    headers: { Cookie: adminCookie },
    cache: "no-store",
  });
  const queue = await queueResult.json();
  const queueOrder = queue.orders.find((order) => order.id === orderId);
  assert(queueResult.ok, `Admin could not load delivery queue: ${JSON.stringify(queue)}`);
  assert(queueOrder, "Delivery queue did not include the mission proof order.");
  assert(queueOrder.assigned_to === "Maya Rider", "Delivery queue did not show the assigned rider.");
  assert(queueOrder.requires_address_review, "Delivery queue did not preserve address review status.");

  await screenshotOperations(orderId);
  console.log(`Delivery mission-control proof passed for order #${orderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
