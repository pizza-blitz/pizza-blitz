/* Aggregator proof: connect Swiggy, post a webhook order, see it accepted. */
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

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

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
    await page.goto(`${baseURL}/settings/integrations`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('[data-testid="integrations-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });

    await page.getByTestId("aggregator-platform").selectOption("swiggy");
    await page.getByTestId("connect-aggregator").click();
    const card = page
      .locator('[data-testid^="integration-card-"]')
      .filter({ hasText: "Swiggy" })
      .first();
    await card.waitFor({ timeout: 25000 });
    const testId = await card.getAttribute("data-testid");
    const integrationId = Number(String(testId).replace("integration-card-", ""));
    assert(integrationId > 0, "Integration id was not found.");

    const webhookUrl = await page.getByTestId(`integration-url-${integrationId}`).inputValue();
    const token = await page
      .getByTestId(`integration-token-${integrationId}`)
      .inputValue();
    assert(webhookUrl.includes("/webhook/swiggy"), "Webhook URL was wrong.");
    assert(token.startsWith("AG-"), "Webhook token was wrong.");

    const externalId = `SWG-PROOF-${Date.now()}`;
    const payload = {
      external_order_id: externalId,
      customer: { name: "Aggregator Proof Guest", phone: `99${String(Date.now()).slice(-8)}` },
      delivery_address: "12 Park Street",
      items: [{ name: "Garlic Bread", quantity: 1, price: 119 }],
      payment_method: "prepaid",
      payment_status: "paid",
      notes: "Aggregator proof",
    };
    const delivered = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Aggregator-Token": token,
      },
      body: JSON.stringify(payload),
    });
    const accepted = await delivered.json().catch(() => ({}));
    assert(delivered.ok, `Webhook failed: ${JSON.stringify(accepted)}`);
    assert(accepted.status === "accepted", "Webhook did not accept the order.");

    const duplicate = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Aggregator-Token": token,
      },
      body: JSON.stringify(payload),
    });
    const repeated = await duplicate.json().catch(() => ({}));
    assert(repeated.duplicate === true, "Duplicate webhook was not idempotent.");
    assert(repeated.order_id === accepted.order_id, "Duplicate returned a new order.");

    await page.reload({ waitUntil: "networkidle" });
    await page
      .locator('[data-testid="integrations-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    const refreshedCard = page.getByTestId(`integration-card-${integrationId}`);
    await refreshedCard.waitFor({ timeout: 20000 });
    await page.waitForFunction(
      (id) => {
        const element = document.querySelector(`[data-testid="integration-card-${id}"]`);
        if (!element) return false;
        const match = (element.innerText || "").match(/(\d+)\s+orders?/i);
        return match ? Number(match[1]) >= 1 : false;
      },
      integrationId,
      { timeout: 20000 }
    );

    await refreshedCard.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactsDir, "visible-aggregators.png"),
      fullPage: false,
    });

    console.log("Aggregator proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
