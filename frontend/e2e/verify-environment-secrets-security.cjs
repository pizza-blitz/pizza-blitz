const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

async function portalLogin() {
  const response = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  const data = await response.json();
  assert(response.ok, `Admin portal login failed: ${JSON.stringify(data)}`);
  const cookie = cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
  assert(cookie.includes("pb_admin_session="), "Admin login did not return an admin session cookie.");
  return cookie;
}

async function adminJson(endpoint, cookie) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    headers: { Cookie: cookie },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function flattenEnvironmentVariables(readiness) {
  return (readiness.environment_manifest || []).flatMap((group) => group.variables || []);
}

function createBrowserWatch(page) {
  const issues = [];

  page.on("pageerror", (error) => {
    issues.push(`page error: ${error.message}`);
  });

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico|images\.unsplash\.com/i.test(text)) return;
    if (/Failed to fetch RSC payload/i.test(text) && /Falling back to browser navigation/i.test(text)) return;
    issues.push(`console error: ${text}`);
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    const localRequest = url.startsWith(baseURL) || url.startsWith(apiURL);
    if (!localRequest) return;
    const failure = request.failure();
    if (failure?.errorText === "net::ERR_ABORTED") return;
    issues.push(`request failed: ${request.method()} ${url} ${failure?.errorText || ""}`.trim());
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

  const cookie = await portalLogin();
  const readiness = await adminJson("/api/v1/restaurant/ops/readiness", cookie);
  assert(readiness.response.ok, `Admin ops readiness failed: ${JSON.stringify(readiness.data)}`);

  const plan = readiness.data.environment_security_plan;
  assert(plan, "Readiness did not include environment_security_plan.");
  assert(
    plan.secret_controls.some((step) => step.label === "PIZZA_BLITZ_SESSION_SECRET"),
    "Secret controls did not include the portal session secret."
  );
  assert(
    plan.deployment_env.some((step) => step.label === "BACKEND_CORS_ORIGINS"),
    "Deployment environment did not include CORS origin readiness."
  );
  assert(
    plan.rotation_drill.some((step) => step.label === "Session secret rotation"),
    "Rotation drill did not include session secret rotation."
  );
  assert(Array.isArray(plan.blockers), "Environment security blockers were not included.");

  const variables = flattenEnvironmentVariables(readiness.data);
  assert(variables.some((variable) => variable.name === "AUTH_SECRET_KEY"), "Environment manifest did not include AUTH_SECRET_KEY.");
  assert(
    variables.filter((variable) => variable.sensitive).every((variable) => variable.value === null || variable.value === undefined),
    "Environment readiness leaked a sensitive value."
  );

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/ops`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Production Ops returned HTTP ${response?.status() || "no response"}.`);

    const command = page.getByTestId("environment-secrets-security-command");
    await command.waitFor({ timeout: 15000 });
    await command.getByRole("heading", { name: "Environment Secrets Command" }).waitFor({ timeout: 15000 });
    await command.getByText("Required Env", { exact: true }).waitFor({ timeout: 15000 });
    await command.getByText("Secret Controls", { exact: true }).waitFor({ timeout: 15000 });
    await command.getByText("PIZZA_BLITZ_SESSION_SECRET", { exact: true }).waitFor({ timeout: 15000 });
    await command.getByText("Secret value masking", { exact: true }).waitFor({ timeout: 15000 });
    await command.getByText("Deployment Environment", { exact: true }).waitFor({ timeout: 15000 });
    await command.getByText("BACKEND_CORS_ORIGINS", { exact: true }).waitFor({ timeout: 15000 });
    await command.getByText("Rotation And Recovery Drill", { exact: true }).waitFor({ timeout: 15000 });
    await command.getByText("Session secret rotation", { exact: true }).waitFor({ timeout: 15000 });
    await command.getByText("Security Blockers", { exact: true }).waitFor({ timeout: 15000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-environment-secrets-security.png"),
      fullPage: true,
    });

    watch.assertClean("environment secrets security command");
    console.log("Environment secrets security proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
