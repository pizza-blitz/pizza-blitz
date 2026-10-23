/* POS hardware proof: save printer/drawer config, test print, drawer pulse. */
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
    await page.goto(`${baseURL}/settings/hardware`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('[data-testid="hardware-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });

    await page.getByTestId("hardware-printer-name").fill("Epson TM-T82 Proof");
    await page.getByTestId("hardware-paper-width").selectOption("80");
    await page.getByTestId("hardware-drawer-enabled").check();
    await page.getByTestId("hardware-display-url").fill(`${baseURL}/customer-display`);
    await page.getByTestId("hardware-save").click();
    await page.getByText("Hardware settings saved.").waitFor({ timeout: 20000 });

    await page.getByTestId("hardware-test-print").click();
    const preview = page.getByTestId("hardware-print-preview");
    await preview.waitFor({ timeout: 20000 });
    const previewText = await preview.innerText();
    assert(/TEST PRINT/i.test(previewText), `Preview read: ${previewText}`);
    assert(/Epson TM-T82 Proof/i.test(previewText), "Printer name missing from preview.");

    await preview.getByRole("button", { name: /Close/i }).click();
    await page.getByTestId("hardware-drawer-open").click();
    const drawer = page.getByTestId("hardware-drawer-result");
    await drawer.waitFor({ timeout: 20000 });
    const drawerText = await drawer.innerText();
    assert(/1B700019FA/i.test(drawerText), `Drawer result read: ${drawerText}`);

    await drawer.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactsDir, "visible-pos-hardware.png"),
      fullPage: false,
    });

    console.log("POS hardware proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
