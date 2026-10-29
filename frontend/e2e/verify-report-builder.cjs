/* Report builder proof: run a custom view, save it, and rerun it. */
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

  for (const [index, orderType] of ["takeaway", "delivery"].entries()) {
    const payload = {
      order_type: orderType,
      customer_name: "Report Builder Guest",
      customer_phone: `96${String(Date.now() + index).slice(-8)}`,
      payment_method: "cash",
      items: [{ name: "Garlic Bread", quantity: 1, price: 119 }],
    };
    if (orderType === "delivery") payload.delivery_address = "12 Park Street";
    const created = await api(token, "/api/v1/restaurant/orders/", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    assert(created.response.ok, `Seed order failed: ${JSON.stringify(created.data)}`);
  }

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(portalLogin.ok, `Portal login failed: ${await portalLogin.text()}`);
  const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.addCookies(
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
    const page = await context.newPage();
    await page.goto(`${baseURL}/reports`, { waitUntil: "domcontentloaded" });
    const builder = page.getByTestId("report-builder");
    await builder.waitFor({ timeout: 30000 });
    await page
      .locator('[data-testid="report-builder"][data-hydrated="true"]')
      .waitFor({ timeout: 20000 });

    await page.getByTestId("report-builder-run").click();
    await page
      .locator('[data-testid="report-builder"] tbody tr')
      .first()
      .waitFor({ timeout: 25000 });
    const bodyText = await builder.innerText();
    assert(/Totals/i.test(bodyText), "Report totals did not render.");

    const beforeSaved = await api(token, "/api/v1/restaurant/reports/saved");
    const beforeIds = new Set(
      (beforeSaved.data || []).map((row) => row.id)
    );

    await page.getByLabel("Saved report name").fill("E2E Custom Sales");
    await page.getByLabel("Saved report range days").fill("7");
    await page.getByLabel("Saved report schedule").selectOption("daily");
    await page.getByLabel("Saved report recipients").fill("owner@example.com");
    await page.getByTestId("report-builder-save").click();

    let createdId = null;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline && !createdId) {
      const listed = await api(token, "/api/v1/restaurant/reports/saved");
      const fresh = (listed.data || []).find((row) => !beforeIds.has(row.id));
      if (fresh) createdId = fresh.id;
      else await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert(createdId, "New saved report did not appear.");

    const savedCard = page.getByTestId(`saved-report-${createdId}`);
    await savedCard.waitFor({ timeout: 25000 });
    await savedCard.getByRole("button", { name: /Run/i }).click();
    await page.getByText("Saved report refreshed.").waitFor({ timeout: 20000 });

    await builder.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactsDir, "visible-report-builder.png"),
      fullPage: false,
    });

    const savedList = await api(token, "/api/v1/restaurant/reports/saved");
    assert(savedList.response.ok, "Saved reports API failed.");
    const saved = savedList.data.find((row) => row.id === createdId);
    assert(saved, "Saved report was not persisted.");
    assert(saved.schedule === "daily", "Schedule was not persisted.");
    assert(saved.last_run_at, "Saved report was not marked run.");

    console.log("Report builder proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
