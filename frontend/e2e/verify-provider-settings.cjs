/* Provider registry proof: encrypted save, masked reload, validation, reset. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://localhost:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");
const SECRET = `re_proof_${Date.now()}`;

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
    const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
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

    const email = page.getByTestId("provider-email");
    await email.waitFor({ timeout: 20000 });
    await email.locator('input[type="password"]').first().fill(SECRET);
    await email.locator('input[type="text"]').first().fill("proof@pizza-blitz.test");
    const enabled = email.locator('input[type="checkbox"]');
    if (!(await enabled.isChecked())) await enabled.check();

    await page.getByTestId("provider-save-email").click();
    await page.getByText("saved with encrypted credentials", { exact: false }).waitFor({
      timeout: 20000,
    });
    await page.waitForFunction(() => {
      const card = document.querySelector('[data-testid="provider-email"]');
      return card && card.textContent.includes("ready");
    });
    const cardText = await email.innerText();
    console.log("email card:", cardText.replace(/\n/g, " | "));
    assert(
      cardText.toLowerCase().includes("encrypted override"),
      "Encrypted override source not shown."
    );
    await page.screenshot({
      path: path.join(artifactsDir, "visible-provider-settings.png"),
      fullPage: false,
    });

    const adminToken = await fetch(`${apiURL}/api/v1/auth/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: adminId, password: adminPassword }),
    }).then((response) => response.json());
    const list = await fetch(`${apiURL}/api/v1/restaurant/provider-settings/`, {
      headers: { Authorization: `Bearer ${adminToken.access_token}` },
    }).then((response) => response.json());
    const emailRow = list.providers.find((row) => row.provider === "email");
    assert(emailRow.configured, "API provider not configured.");
    assert(
      !emailRow.fields.some((field) => field.value === SECRET),
      "Secret was returned by the API."
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="providers-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    const reloaded = page.getByTestId("provider-email");
    const secretInput = reloaded.locator('input[type="password"]').first();
    assert((await secretInput.inputValue()) === "", "Reloaded secret field should be blank.");
    assert(
      (await secretInput.getAttribute("placeholder")).includes("Saved"),
      "Saved-secret placeholder missing."
    );

    await reloaded.getByText("Validate", { exact: true }).click();
    await page.getByText("Required fields are present", { exact: false }).waitFor({
      timeout: 20000,
    });

    page.once("dialog", (dialog) => void dialog.accept());
    await reloaded.getByText("Reset", { exact: true }).click();
    await page.getByText("reset to the environment fallback", { exact: false }).waitFor({
      timeout: 20000,
    });

    console.log("Provider settings proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
