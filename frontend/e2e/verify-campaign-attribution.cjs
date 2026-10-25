/* Campaign attribution proof: coupon + social + ads -> channel credit and lift. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://localhost:8010";
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

function isoDay(offset) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const token = await fetch(`${apiURL}/api/v1/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  }).then((response) => response.json());
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token.access_token}`,
  };
  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  const code = `ATR${suffix}`;
  const promoResponse = await fetch(`${apiURL}/api/v1/restaurant/promotions/`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: `Attribution proof ${suffix}`,
      code,
      start_date: isoDay(-1),
      end_date: isoDay(5),
      description: "Channel attribution proof.",
      discount_type: "percentage",
      discount_value: 10,
      audience: "marketing_opt_in",
      channel: "email",
      status: "active",
    }),
  });
  const promoBody = await promoResponse.json();
  assert(promoResponse.ok, `Promotion create failed: ${JSON.stringify(promoBody)}`);
  const promo = promoBody.promotion;

  const orderResponse = await fetch(`${apiURL}/api/v1/restaurant/orders/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Attribution Guest",
      customer_phone: `81${Date.now().toString().slice(-8)}`,
      customer_email: `attribution-${suffix}@example.com`,
      payment_method: "cash",
      coupon_code: code,
      items: [{ name: "Attribution Proof Pizza", quantity: 1, price: 549 }],
    }),
  });
  const order = await orderResponse.json();
  assert(orderResponse.ok, `Order create failed: ${JSON.stringify(order)}`);

  const performance = await fetch(
    `${apiURL}/api/v1/restaurant/promotions/performance/${promo.id}`,
    { headers }
  ).then((response) => response.json());
  assert(performance.attribution, "Attribution block missing.");
  assert(
    performance.attribution.channels.some((item) => item.channel === "coupon"),
    "Coupon credit missing."
  );
  assert(typeof performance.lift.incremental_revenue === "number", "Lift missing.");

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 1280, height: 1100 },
    });
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Portal login failed: ${await login.text()}`);
    const page = await context.newPage();
    await page.goto(`${baseURL}/promotions?campaign=${promo.id}`, {
      waitUntil: "domcontentloaded",
    });
    const panel = page.getByTestId("campaign-attribution");
    await panel.waitFor({ timeout: 30000 });
    const text = (await panel.innerText()).toLowerCase();
    assert(text.includes("attribution"), "Attribution heading missing.");
    assert(text.includes("incremental revenue"), "Incremental revenue missing.");
    assert(text.includes("coupon"), "Coupon channel missing in UI.");
    await page.getByTestId("campaign-person-attribution").waitFor({ timeout: 20000 });
    assert(
      text.includes("person-level multi-touch"),
      "Person-level attribution panel missing."
    );
    assert(text.includes("first touch"), "First-touch model missing.");
    assert(text.includes("last touch"), "Last-touch model missing.");
    await panel.screenshot({
      path: path.join(artifactsDir, "visible-campaign-attribution.png"),
    });

    console.log("Campaign attribution proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
