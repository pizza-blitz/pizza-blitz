/* Billing settings proof: change tax, footer and tips; verify public order tax; reset. */
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
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
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
    await page.goto(`${baseURL}/settings/billing`, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="billing-settings-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });

    await page.getByTestId("billing-tax-rate").fill("12");
    await page.getByTestId("billing-tax-label").fill("VAT");
    await page.getByTestId("billing-invoice-footer").fill("Proof footer: thank you from Pizza Blitz.");
    await page.getByTestId("billing-tip-presets").fill("0, 10, 20");
    await page.getByTestId("billing-save").click();
    await page.getByText("Billing settings saved", { exact: false }).waitFor({ timeout: 20000 });
    const pageText = await page.getByTestId("billing-settings-page").innerText();
    assert(pageText.includes("VAT 12%"), "Tax preview did not update to VAT 12%.");
    assert(pageText.includes("Rs 560"), "Tax total preview did not recalculate.");
    await page.screenshot({
      path: path.join(artifactsDir, "visible-billing-settings.png"),
      fullPage: false,
    });

    const publicSettings = await fetch(`${apiURL}/api/v1/restaurant/billing-settings/public`).then((r) => r.json());
    assert(publicSettings.settings.tax_rate === 12, "Public tax rate not updated.");
    assert(publicSettings.settings.tax_label === "VAT", "Public tax label not updated.");
    assert(
      publicSettings.settings.tip_presets.join(",") === "0,10,20",
      "Public tip presets not updated."
    );

    const orderResponse = await fetch(`${apiURL}/api/v1/restaurant/orders/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_type: "takeaway",
        customer_name: "Billing Proof Guest",
        customer_phone: `98123${Date.now().toString().slice(-6)}`,
        payment_method: "cash",
        items: [{ name: "Garlic Bread", quantity: 2, price: 119 }],
      }),
    });
    const order = await orderResponse.json();
    assert(orderResponse.ok, `Order creation failed: ${JSON.stringify(order)}`);
    assert(order.tax === 28.56, `Expected 12% tax 28.56, received ${order.tax}.`);

    await page.goto(`${baseURL}/invoices`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("invoice-footer").waitFor({ timeout: 20000 });
    assert(
      (await page.getByTestId("invoice-footer").innerText()).includes("Proof footer"),
      "Invoice footer missing."
    );

    await page.goto(`${baseURL}/settings/billing`, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="billing-settings-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    await page.getByTestId("billing-tax-rate").fill("5");
    await page.getByTestId("billing-tax-label").fill("GST");
    await page.getByTestId("billing-invoice-footer").fill("");
    await page.getByTestId("billing-tip-presets").fill("0, 5, 10, 15");
    await page.getByTestId("billing-save").click();
    await page.getByText("Billing settings saved", { exact: false }).waitFor({ timeout: 20000 });
    const reset = await fetch(`${apiURL}/api/v1/restaurant/billing-settings/public`).then((r) => r.json());
    assert(reset.settings.tax_rate === 5, "Tax rate was not reset to 5%.");

    console.log("Billing settings proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
