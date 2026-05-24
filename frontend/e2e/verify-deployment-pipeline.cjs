const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
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

  const plan = readiness.data.deployment_pipeline_plan;
  assert(plan, "Readiness did not include deployment_pipeline_plan.");
  assert(
    plan.build_gate.some((step) => step.label === "Frontend production build"),
    "Deployment plan did not include frontend build gate."
  );
  assert(
    plan.release_steps.some((step) => step.label === "Promote release"),
    "Deployment plan did not include release promotion."
  );
  assert(
    plan.rollback_checks.some((step) => step.label === "Log inspection"),
    "Deployment plan did not include log inspection."
  );
  assert(
    plan.production_smoke.some((step) => step.label === "Customer order smoke"),
    "Deployment plan did not include customer order smoke."
  );
  assert(Array.isArray(plan.blockers), "Deployment blockers were not included.");

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

    const command = page.getByTestId("deployment-pipeline-command");
    await command.waitFor({ timeout: 15000 });
    await command.getByRole("heading", { name: "Deployment Pipeline Command" }).waitFor({ timeout: 15000 });
    await command.getByRole("heading", { name: "Build Gate" }).waitFor({ timeout: 15000 });
    await command.getByText("Frontend production build", { exact: true }).waitFor({ timeout: 15000 });
    await command.getByRole("heading", { name: "Release Steps" }).waitFor({ timeout: 15000 });
    await command.getByText("Promote release", { exact: true }).waitFor({ timeout: 15000 });
    await command.getByRole("heading", { name: "Rollback And Logs" }).waitFor({ timeout: 15000 });
    await command.getByText("Log inspection", { exact: true }).waitFor({ timeout: 15000 });
    await command.getByRole("heading", { name: "Production Smoke" }).waitFor({ timeout: 15000 });
    await command.getByText("Customer order smoke", { exact: true }).waitFor({ timeout: 15000 });
    await command.getByText("Deployment Blockers", { exact: true }).waitFor({ timeout: 15000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-deployment-pipeline.png"),
      fullPage: true,
    });

    watch.assertClean("deployment pipeline command");
    console.log("Deployment pipeline proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
