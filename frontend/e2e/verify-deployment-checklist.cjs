/* Deployment readiness proof: checklist loads with real gates and commands. */
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
    await page.goto(`${baseURL}/settings/deployment`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('[data-testid="deployment-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    const checks = page.getByTestId("deployment-checks");
    await checks.waitFor({ timeout: 30000 });

    const database = page.getByTestId("deployment-check-database");
    await database.waitFor({ timeout: 15000 });
    assert(/ready/i.test(await database.innerText()), "Database check was not ready.");
    const admin = page.getByTestId("deployment-check-admin_credentials");
    assert(/ready/i.test(await admin.innerText()), "Admin credential check was not ready.");
    const security = page.getByTestId("deployment-check-security_headers");
    assert(/ready/i.test(await security.innerText()), "Security header check was not ready.");
    const bodyText = await page.getByTestId("deployment-page").innerText();
    assert(/Verification commands/i.test(bodyText), "Verification commands missing.");
    assert(/npm run verify:audit/i.test(bodyText), "Audit command missing.");

    await checks.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactsDir, "visible-deployment-readiness.png"),
      fullPage: false,
    });

    console.log("Deployment readiness proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
