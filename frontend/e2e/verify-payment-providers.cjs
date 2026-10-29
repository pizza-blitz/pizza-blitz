/* Payment provider proof: save encrypted direct-bank details, validate and reset. */
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
  assert(portalLogin.ok, "Portal login failed.");
  const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
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
    await page.goto(`${baseURL}/settings/providers`, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="providers-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });

    const bank = page.getByTestId("provider-direct_bank");
    await bank.waitFor({ timeout: 20000 });
    await bank.locator('input[type="text"]').first().fill("pizzablitz@upi");
    await bank.locator('input[type="text"]').nth(1).fill("Pizza Blitz");
    await bank.locator('input[type="password"]').first().fill("123456789012");
    const enabled = bank.locator('input[type="checkbox"]');
    if (!(await enabled.isChecked())) await enabled.check();
    await page.getByTestId("provider-save-direct_bank").click();
    // Wait for the save to finish before validating. "Payments" is the group
    // heading and is already on screen, so waiting for it let Validate race the
    // save and overwrite the validation message with the later save response.
    await page
      .getByText("saved with encrypted credentials", { exact: false })
      .waitFor({ timeout: 20000 });
    await bank.getByText("Validate", { exact: true }).click();
    await page.getByText("Required fields are present", { exact: false }).waitFor({
      timeout: 20000,
    });

    const token = await fetch(`${apiURL}/api/v1/auth/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: adminId, password: adminPassword }),
    }).then((response) => response.json());
    const providers = await fetch(`${apiURL}/api/v1/restaurant/provider-settings/`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    }).then((response) => response.json());
    const bankRow = providers.providers.find((row) => row.provider === "direct_bank");
    assert(bankRow, "Direct bank provider missing.");
    assert(bankRow.configured, "Direct bank was not configured.");
    assert(
      !bankRow.fields.some((field) => field.value.includes("123456789012")),
      "Secret account number should not be returned unmasked."
    );

    await bank.screenshot({
      path: path.join(artifactsDir, "visible-payment-providers.png"),
    });

    await page.goto(`${baseURL}/settings/billing`, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="billing-settings-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    await page.getByTestId("billing-payment-provider").selectOption("direct_bank");
    await page.getByTestId("billing-save").click();
    await page.getByText("Billing settings saved", { exact: false }).waitFor({
      timeout: 20000,
    });
    const publicSettings = await fetch(
      `${apiURL}/api/v1/restaurant/billing-settings/public`
    ).then((response) => response.json());
    assert(
      publicSettings.settings.payment_provider === "direct_bank",
      "Active payment provider did not switch to direct bank."
    );

    await page.getByTestId("billing-payment-provider").selectOption("manual");
    await page.getByTestId("billing-save").click();
    await page.getByText("Billing settings saved", { exact: false }).waitFor({
      timeout: 20000,
    });

    await page.goto(`${baseURL}/settings/providers`, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="providers-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    const resetBank = page.getByTestId("provider-direct_bank");
    await resetBank.waitFor({ timeout: 20000 });
    page.once("dialog", (dialog) => void dialog.accept());
    await resetBank.getByText("Reset", { exact: true }).click();
    await page.getByText("reset to the environment fallback", { exact: false }).waitFor({
      timeout: 20000,
    });

    console.log("Payment provider proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
