const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const staffId = process.env.E2E_STAFF_ID || "delivery-e2e-staff";
const staffPassword = process.env.E2E_STAFF_PASSWORD || "Delivery-Staff-123!";
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
  const text = await response.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${role} login returned non-JSON: ${text.slice(0, 220)}`);
  }
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

async function activateManagedStaffCredential() {
  const adminCookie = await portalLogin("admin");
  const { response, data } = await apiJson("/api/v1/auth/staff/credential", {
    method: "POST",
    headers: {
      Cookie: adminCookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: staffId,
      password: staffPassword,
      display_name: "E2E Delivery Staff",
      is_active: true,
    }),
  });
  assert(response.ok, `Could not activate managed staff credential: ${JSON.stringify(data)}`);
  assert(data.configured === true, "Managed staff credential was not active after save.");
}

async function createDeliveryOrder(zoneId, address) {
  const { response, data } = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "delivery",
      customer_name: "Delivery Zone Proof",
      customer_phone: `95${Date.now().toString().slice(-8)}`,
      customer_email: "delivery-proof@example.com",
      payment_method: "cash",
      delivery_address: address,
      delivery_zone_id: zoneId,
      notes: "E2E delivery zone and assignment proof",
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
    viewport: { width: 1440, height: 1000 },
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
    await page.getByText(`Order #${orderId}`, { exact: false }).first().waitFor({ timeout: 10000 });
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("input")).some((input) => input.value === "Ravi Rider"),
      null,
      { timeout: 10000 }
    );
    await page.screenshot({
      path: path.join(artifactsDir, "visible-delivery-zone-assignment.png"),
      fullPage: true,
    });
    watch.assertClean("delivery zone assignment operations screenshot");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const invalidQuote = await apiJson("/api/v1/restaurant/delivery/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: "x", subtotal: 250 }),
  });
  assert(invalidQuote.response.status === 422, `Short address should fail, got ${invalidQuote.response.status}.`);

  const zonesResult = await apiJson("/api/v1/restaurant/delivery/zones");
  assert(zonesResult.response.ok, `Could not load zones: ${JSON.stringify(zonesResult.data)}`);
  const zones = zonesResult.data;
  const outerZone = zones.find((zone) => zone.name === "Outer Ring") || zones[zones.length - 1];
  assert(outerZone?.id, "Outer delivery zone was not available.");

  const address = "Gate 4 Airport bypass warehouse, Outer Ring service road";
  const quoteResult = await apiJson("/api/v1/restaurant/delivery/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, subtotal: 249 }),
  });
  assert(quoteResult.response.ok, `Delivery quote failed: ${JSON.stringify(quoteResult.data)}`);
  assert(quoteResult.data.is_deliverable, "Delivery quote was not deliverable.");
  assert(quoteResult.data.zone?.id === outerZone.id, "Quote did not use the selected outer delivery zone.");
  assert(quoteResult.data.address_validation?.score >= 80, "Delivery address score was not good enough.");
  assert(quoteResult.data.charge_breakdown?.total_with_delivery === 318, "Delivery total should include Rs 69 fee.");

  const orderId = await createDeliveryOrder(outerZone.id, address);
  const readCookie = await portalLogin("admin");
  const orderResult = await apiJson(`/api/v1/restaurant/orders/${orderId}`, {
    headers: { Cookie: readCookie },
  });
  assert(orderResult.response.ok, `Could not read delivery order: ${JSON.stringify(orderResult.data)}`);
  assert(orderResult.data.delivery_assignment?.status === "unassigned", "New delivery order did not create an unassigned dispatch record.");
  assert(orderResult.data.delivery_assignment?.zone?.name === outerZone.name, "Dispatch record did not keep the delivery zone.");

  await activateManagedStaffCredential();
  const staffCookie = await portalLogin("staff");
  const queueResult = await fetch(`${apiURL}/api/v1/restaurant/delivery/queue`, {
    headers: { Cookie: staffCookie },
    cache: "no-store",
  });
  const queue = await queueResult.json();
  assert(queueResult.ok, `Staff could not load delivery queue: ${JSON.stringify(queue)}`);
  assert(queue.orders.some((order) => order.id === orderId), "Delivery queue did not include the new order.");

  const assignResult = await fetch(`${apiURL}/api/v1/restaurant/delivery/orders/${orderId}/assignment`, {
    method: "PATCH",
    headers: {
      Cookie: staffCookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assigned_to: "Ravi Rider",
      status: "assigned",
      notes: "Carry thermal bag; verify gate 4 landmark.",
    }),
  });
  const assigned = await assignResult.json();
  assert(assignResult.ok, `Could not assign delivery: ${JSON.stringify(assigned)}`);
  assert(assigned.assignment.status === "assigned", "Assignment did not move to assigned.");

  const dispatchResult = await fetch(`${apiURL}/api/v1/restaurant/delivery/orders/${orderId}/assignment`, {
    method: "PATCH",
    headers: {
      Cookie: staffCookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assigned_to: "Ravi Rider",
      status: "out_for_delivery",
      notes: "Rider left for airport bypass gate 4.",
    }),
  });
  const dispatched = await dispatchResult.json();
  assert(dispatchResult.ok, `Could not dispatch delivery: ${JSON.stringify(dispatched)}`);
  assert(dispatched.assignment.status === "out_for_delivery", "Assignment did not move to out for delivery.");
  assert(dispatched.assignment.next_action, "Assignment response did not include next action.");

  await screenshotOperations(orderId);
  console.log(`Delivery zone assignment proof passed for order #${orderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
