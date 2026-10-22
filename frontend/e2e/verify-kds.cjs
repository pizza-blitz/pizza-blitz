/* KDS proof: staff access, live ticket, station bump, order ready, controls. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const staffId = process.env.E2E_STAFF_ID || "staff";
const staffPassword = process.env.E2E_STAFF_PASSWORD || "staff123";
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

function cookieHeaderFromSetCookie(setCookie) {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie || ""];
  return values
    .flatMap((value) => value.split(/,(?=\s*pb_[^=]+=)/))
    .map((value) => value.split(";")[0].trim())
    .filter((value) => value.startsWith("pb_"))
    .join("; ");
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const created = await fetch(`${apiURL}/api/v1/restaurant/orders/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "KDS Proof Guest",
      customer_phone: "9812345699",
      payment_method: "cash",
      items: [
        { name: "Garlic Bread", quantity: 1, price: 119 },
        { name: "Cold Coffee", quantity: 2, price: 99 },
      ],
    }),
  });
  const order = await created.json();
  assert(created.ok, `Could not create KDS order: ${JSON.stringify(order)}`);
  const orderId = order.order_id;

  const login = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: staffId, password: staffPassword, role: "staff" }),
  });
  assert(login.ok, `Staff portal login failed: ${await login.text()}`);
  const cookie = cookieHeaderFromSetCookie(login.headers.get("set-cookie"));
  assert(cookie.includes("pb_staff_session="), "Staff login did not return a staff cookie.");

  const apiLogin = await fetch(`${apiURL}/api/v1/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "admin", password: "admin123" }),
  });
  if (!apiLogin.ok) throw new Error(`Admin API login failed: ${await apiLogin.text()}`);
  const apiToken = (await apiLogin.json()).access_token;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 800 } });
    await context.addCookies(
      cookie
        .split(/;\s*/)
        .filter(Boolean)
        .map((pair) => {
          const [name, ...rest] = pair.split("=");
          return { name, value: rest.join("="), url: baseURL, httpOnly: true, sameSite: "Lax" };
        })
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(`${baseURL}/kds`, { waitUntil: "domcontentloaded" });
    const card = page.getByTestId(`kds-order-${orderId}`);
    await card.waitFor({ timeout: 25000 });
    await page.getByTestId(`kds-timer-${orderId}`).waitFor({ timeout: 10000 });
    const line = page.getByTestId(`kds-line-${orderId}-0`);
    await line.waitFor({ timeout: 10000 });
    const lineText = (await line.innerText()).toLowerCase();
    assert(lineText.includes("garlic bread"), `KDS line read "${lineText}".`);
    assert(lineText.includes("oven"), "KDS line did not show its station.");

    await page.getByRole("button", { name: "Enable new order sound" }).click();
    await page.getByRole("button", { name: "Mute new order sound" }).waitFor({ timeout: 5000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-kds-board.png"),
      fullPage: false,
    });

    const bump = page.getByTestId(`kds-bump-${orderId}-0`);
    await bump.click();
    await page.getByRole("button", { name: "Recall" }).first().waitFor({ timeout: 15000 });

    const ready = await fetch(`${apiURL}/api/v1/restaurant/orders/${orderId}/status`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "ready" }),
    });
    assert(ready.ok, `Could not mark the order ready: ${await ready.text()}`);

    await page
      .getByTestId("kds-column-ready")
      .getByTestId(`kds-order-${orderId}`)
      .waitFor({ timeout: 25000 });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-kds-ready.png"),
      fullPage: false,
    });

    const readyText = (await page.getByTestId(`kds-order-${orderId}`).innerText()).toLowerCase();
    assert(readyText.includes("recall"), "Ready ticket did not offer recall.");
    assert(!errors.length, `KDS threw browser errors: ${errors.join("; ")}`);
    console.log("KDS proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
