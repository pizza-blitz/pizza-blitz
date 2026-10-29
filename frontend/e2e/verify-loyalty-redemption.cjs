/* Loyalty redemption proof: points -> reward -> discounted checkout. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
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

  const phone = `93${String(Date.now()).slice(-8)}`;
  const created = await api(adminToken, "/api/v1/restaurant/orders/", {
    method: "POST",
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Redeem Proof Guest",
      customer_phone: phone,
      payment_method: "cash",
      items: [{ name: "Garlic Bread", quantity: 2, price: 119 }],
    }),
  });
  assert(created.response.ok, `Could not create seed order: ${JSON.stringify(created.data)}`);
  const orderId = created.data.order_id;
  for (const status of ["preparing", "ready"]) {
    const moved = await api(adminToken, `/api/v1/restaurant/orders/${orderId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    assert(moved.response.ok, `Status ${status} failed.`);
  }
  const closed = await api(
    adminToken,
    `/api/v1/restaurant/orders/${orderId}/close?payment_method=cash`,
    { method: "PATCH" }
  );
  assert(closed.response.ok, `Close failed: ${JSON.stringify(closed.data)}`);
  const earnedPoints = Math.floor(created.data.total);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();

    await page.goto(`${baseURL}/account/login`, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="customer-login"][data-hydrated="true"]')
      .waitFor({ timeout: 20000 });
    await page.getByLabel("Phone number").fill(phone);
    await page.getByRole("button", { name: "Send verification code" }).click();
    const debug = page.getByTestId("customer-otp-debug");
    await debug.waitFor({ timeout: 20000 });
    const code = (await debug.innerText()).match(/\d{6}/)?.[0];
    assert(code, "No development code shown.");
    await page.getByLabel("Verification code").fill(code);
    await page.getByRole("button", { name: "Verify and sign in" }).click();
    await page.waitForURL("**/account", { timeout: 25000 });

    await page.goto(`${baseURL}/order`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Add/i }).first().click();
    const panel = page.getByTestId("loyalty-redeem-panel");
    await panel.waitFor({ timeout: 20000 });
    const panelText = (await panel.innerText()).toLowerCase();
    assert(panelText.includes(`${earnedPoints} pts`), `Panel read "${panelText}".`);

    await panel.getByRole("button", { name: /100 pts/i }).click();
    const applied = page.getByTestId("loyalty-redemption-applied");
    await applied.waitFor({ timeout: 20000 });
    const appliedText = (await applied.innerText()).toLowerCase();
    assert(appliedText.includes("100 points"), `Applied reward read "${appliedText}".`);
    const totalsText = (await page.locator("#checkout").innerText()).toLowerCase();
    assert(totalsText.includes("points reward"), "Totals did not show the points reward.");
    await applied.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactsDir, "visible-loyalty-redemption.png"),
      fullPage: false,
    });

    await page.getByPlaceholder("Name").fill("Redeem Proof Guest");
    await page.getByPlaceholder("Phone").fill(phone);
    await page.getByTestId("customer-place-order").click();
    await page.getByText(/Order #\d+ placed/).waitFor({ timeout: 25000 });

    const summary = await page.evaluate(async () => {
      const response = await fetch("/api/customer-loyalty", { cache: "no-store" });
      return response.ok ? response.json() : null;
    });
    assert(summary, "Could not read loyalty after checkout.");
    assert(
      summary.points_balance === earnedPoints - 100,
      `Balance after redemption was ${summary.points_balance}.`
    );
    assert(
      summary.transactions.some((row) => row.type === "redeem" && row.points === -100),
      "Redeem transaction missing."
    );

    console.log("Loyalty redemption proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
