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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, label) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < 30000) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok || response.status === 401 || response.status === 403) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(750);
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

async function portalLogin(id, password) {
  const response = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, password, role: "admin" }),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data, cookie: cookieHeaderFromSetCookie(response.headers.get("set-cookie")) };
}

function createBrowserWatch(page) {
  const issues = [];
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico|images\.unsplash\.com/i.test(text)) return;
    issues.push(`console error: ${text}`);
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure();
    if (failure?.errorText === "net::ERR_ABORTED") return;
    issues.push(`request failed: ${request.method()} ${request.url()} ${failure?.errorText || ""}`.trim());
  });
  return {
    assertClean(label) {
      assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
    },
  };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const suffix = Date.now().toString().slice(-8);
  const managedId = `master-e2e-${suffix}`;
  const managedPassword = `Master-E2E-${suffix}!`;
  const initialLogin = await portalLogin(adminId, adminPassword);
  assert(initialLogin.response.ok, `Environment admin login failed: ${JSON.stringify(initialLogin.data)}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1200 } });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);
  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/settings`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Settings returned HTTP ${response?.status() || "no response"}.`);
    const command = page.getByTestId("admin-credential-command");
    await command.waitFor({ timeout: 15000 });
    await page.waitForFunction(() => {
      const input = document.querySelector('[data-testid="admin-credential-command"] input[type="text"]');
      return input && !input.disabled;
    });
    await command.locator('input[type="text"]').fill(managedId);
    await command.locator('input[type="password"]').fill(managedPassword);
    await command.getByTestId("admin-credential-save").click();
    await page
      .getByTestId("admin-credential-message")
      .getByText("Master admin credential saved", { exact: false })
      .waitFor({ timeout: 15000 });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-admin-credential-command.png"),
      fullPage: true,
    });
    watch.assertClean("admin credential command");
  } finally {
    await browser.close();
  }

  const managedLogin = await portalLogin(managedId, managedPassword);
  assert(managedLogin.response.ok, `Managed admin login failed: ${JSON.stringify(managedLogin.data)}`);
  assert(managedLogin.data.role === "admin", "Managed credential did not sign in as admin.");
  assert(managedLogin.data.source === "managed", "Managed credential login did not report managed source.");
  assert(managedLogin.cookie.includes("pb_admin_session="), "Managed login did not return an admin session cookie.");

  console.log(`Admin credential command proof passed for ${managedId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
