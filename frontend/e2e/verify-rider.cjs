/* Rider proof: rider link -> dispatch -> GPS -> proof -> delivery tracking. */
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

async function api(token, endpoint, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const login = await api(null, "/api/v1/auth/admin/login", {
    method: "POST",
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  });
  assert(login.response.ok, "Admin login failed.");
  const adminToken = login.data.access_token;
  const phone = `94${String(Date.now()).slice(-8)}`;

  const created = await api(adminToken, "/api/v1/restaurant/orders/", {
    method: "POST",
    body: JSON.stringify({
      order_type: "delivery",
      customer_name: "Rider Proof Guest",
      customer_phone: phone,
      delivery_address: "12 Park Street",
      payment_method: "cash",
      items: [{ name: "Garlic Bread", quantity: 1, price: 119 }],
    }),
  });
  assert(created.response.ok, `Delivery order failed: ${JSON.stringify(created.data)}`);
  const orderId = created.data.order_id;

  const assigned = await api(
    adminToken,
    `/api/v1/restaurant/delivery/orders/${orderId}/assignment`,
    {
      method: "PATCH",
      body: JSON.stringify({ status: "assigned", assigned_to: "Ravi Proof" }),
    }
  );
  assert(assigned.response.ok, `Assign failed: ${JSON.stringify(assigned.data)}`);

  const link = await api(
    adminToken,
    `/api/v1/restaurant/delivery/orders/${orderId}/rider-link`
  );
  assert(link.response.ok, `Rider link failed: ${JSON.stringify(link.data)}`);
  assert(link.data.rider_path, "Rider path missing.");

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 430, height: 932 },
      geolocation: { latitude: 12.9716, longitude: 77.5946 },
      permissions: ["geolocation"],
    });
    const page = await context.newPage();
    await page.goto(`${baseURL}${link.data.rider_path}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("rider-page").waitFor({ timeout: 20000 });
    await page.getByTestId("rider-start").click();
    await page.getByTestId("rider-deliver").waitFor({ state: "detached" }).catch(() => {});
    await page.getByTestId("rider-proof-reference").waitFor({ timeout: 20000 });

    await page.getByTestId("rider-location").click();
    await page
      .getByText(/Updated \d{2}:\d{2}/)
      .first()
      .waitFor({ timeout: 15000 });

    await page.getByTestId("rider-proof-reference").fill("POD-PROOF-1");
    await page.getByLabel("Proof notes").fill("Handed to customer");
    await page.getByTestId("rider-proof-submit").click();
    await page.getByTestId("rider-deliver").waitFor({ timeout: 15000 });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-rider-app.png"),
      fullPage: false,
    });

    await page.getByTestId("rider-deliver").click();
    await page.getByText("Delivered", { exact: true }).first().waitFor({ timeout: 20000 });

    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(`${baseURL}/track?order=${orderId}&phone=${phone}`, {
      waitUntil: "networkidle",
    });
    const riderCard = page.getByTestId("track-rider");
    await riderCard.waitFor({ timeout: 20000 });
    const riderText = (await riderCard.innerText()).toLowerCase();
    assert(riderText.includes("delivered"), `Tracking rider read "${riderText}".`);
    assert(riderText.includes("proof captured"), "Tracking did not show proof.");
    await riderCard.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactsDir, "visible-rider-tracking.png"),
      fullPage: false,
    });

    console.log("Rider proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
