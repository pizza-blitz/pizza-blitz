/* Feedback proof: customer rates a closed order; admin sees NPS and comment. */
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

function cookieHeaderFromSetCookie(setCookie) {
  if (!setCookie) return "";
  return setCookie
    .split(/,(?=[^;]+=)/)
    .map((part) => part.split(";")[0].trim())
    .join("; ");
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
  const token = login.data.access_token;
  const phone = `95${String(Date.now()).slice(-8)}`;

  const created = await api(token, "/api/v1/restaurant/orders/", {
    method: "POST",
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Feedback Proof Guest",
      customer_phone: phone,
      payment_method: "cash",
      items: [{ name: "Garlic Bread", quantity: 1, price: 119 }],
    }),
  });
  assert(created.response.ok, `Order failed: ${JSON.stringify(created.data)}`);
  const orderId = created.data.order_id;
  for (const status of ["preparing", "ready"]) {
    const moved = await api(
      token,
      `/api/v1/restaurant/orders/${orderId}/status`,
      { method: "PATCH", body: JSON.stringify({ status }) }
    );
    assert(moved.response.ok, `Status ${status} failed.`);
  }
  const closed = await api(
    token,
    `/api/v1/restaurant/orders/${orderId}/close?payment_method=cash`,
    { method: "PATCH" }
  );
  assert(closed.response.ok, `Close failed: ${JSON.stringify(closed.data)}`);

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(portalLogin.ok, `Portal login failed: ${await portalLogin.text()}`);
  const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));

  const browser = await chromium.launch({ headless: true });
  try {
    const customer = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
    });
    const customerPage = await customer.newPage();
    await customerPage.goto(
      `${baseURL}/track?order=${orderId}&phone=${phone}`,
      { waitUntil: "networkidle" }
    );
    const form = customerPage.getByTestId("feedback-form");
    await form.waitFor({ timeout: 30000 });
    await customerPage.getByTestId("feedback-rating-5").click();
    await customerPage.getByTestId("feedback-nps-10").click();
    await customerPage.getByTestId("feedback-comment").fill("Proof feedback: hot and fast");
    await customerPage.getByRole("button", { name: "Hot food" }).click();
    await customerPage.getByTestId("feedback-submit").click();
    await customerPage.getByTestId("feedback-thanks").waitFor({ timeout: 20000 });

    const adminContext = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
    });
    await adminContext.addCookies(
      cookie
        .split(/;\s*/)
        .filter(Boolean)
        .map((pair) => {
          const [name, ...rest] = pair.split("=");
          return {
            name,
            value: rest.join("="),
            url: baseURL,
            httpOnly: true,
            sameSite: "Lax",
          };
        })
    );
    const adminPage = await adminContext.newPage();
    await adminPage.goto(`${baseURL}/feedback`, { waitUntil: "domcontentloaded" });
    await adminPage
      .locator('[data-testid="feedback-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    await adminPage.getByTestId("feedback-nps-score").waitFor({ timeout: 20000 });
    const nps = Number(
      (await adminPage.getByTestId("feedback-nps-score").innerText()).trim()
    );
    assert(Number.isFinite(nps), "NPS score did not render.");
    await adminPage
      .getByText("Proof feedback: hot and fast")
      .first()
      .waitFor({ timeout: 15000 });

    await adminPage.screenshot({
      path: path.join(artifactsDir, "visible-feedback-nps.png"),
      fullPage: false,
    });

    console.log("Feedback proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
