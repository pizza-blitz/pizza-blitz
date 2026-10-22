/* Saved address proof: OTP login -> account save -> checkout reuse. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
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

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const phone = `92${String(Date.now()).slice(-8)}`;
  const address = "22 Saved Street, Bengaluru";
  const created = await fetch(`${apiURL}/api/v1/restaurant/orders/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Address Proof Guest",
      customer_phone: phone,
      payment_method: "cash",
      items: [{ name: "Garlic Bread", quantity: 1, price: 119 }],
    }),
  });
  assert(created.ok, `Could not create order: ${await created.text()}`);

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
    assert(code, "Development OTP was not shown.");
    await page.getByLabel("Verification code").fill(code);
    await page.getByRole("button", { name: "Verify and sign in" }).click();
    await page.waitForURL("**/account", { timeout: 25000 });

    const addressSection = page.getByTestId("saved-addresses");
    await addressSection.waitFor({ timeout: 20000 });
    await page.getByLabel("Address label").fill("Home");
    await page.getByLabel("Saved address line").fill(address);
    await addressSection.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText(address, { exact: true }).waitFor({ timeout: 20000 });
    await page.getByText("Default", { exact: true }).first().waitFor({ timeout: 10000 });
    await addressSection.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactsDir, "visible-saved-address-account.png"),
      fullPage: false,
    });

    await page.goto(`${baseURL}/order`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Delivery", exact: true }).first().click();
    const chip = page.locator('[data-testid^="saved-address-chip-"]').first();
    await chip.waitFor({ timeout: 20000 });
    const chipText = (await chip.innerText()).trim();
    assert(/Home/.test(chipText), `Saved chip read "${chipText}".`);
    await chip.click();
    const addressInput = page.getByLabel("Delivery address");
    await addressInput.waitFor({ timeout: 10000 });
    assert(
      (await addressInput.inputValue()) === address,
      `Checkout address was "${await addressInput.inputValue()}".`
    );
    await addressInput.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactsDir, "visible-saved-address-checkout.png"),
      fullPage: false,
    });

    console.log("Saved address proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
