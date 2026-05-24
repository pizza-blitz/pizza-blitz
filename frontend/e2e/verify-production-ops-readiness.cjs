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

async function apiJson(endpoint, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function adminJson(endpoint, cookie, options = {}) {
  return apiJson(endpoint, {
    ...options,
    headers: {
      Cookie: cookie,
      ...(options.headers || {}),
    },
  });
}

function createBrowserWatch(page) {
  const issues = [];
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico|images\.unsplash\.com/i.test(text)) return;
    if (/Failed to fetch RSC payload/i.test(text) && /Falling back to browser navigation/i.test(text)) return;
    if (/Access to fetch at 'http:\/\/localhost:3011\/login'.*\/logout\?_rsc=/i.test(text)) return;
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

function flattenEnvironmentVariables(readiness) {
  return (readiness.environment_manifest || []).flatMap((group) => group.variables || []);
}

async function screenshotProductionOps() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
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
    await page.getByTestId("live-environment-execution-command").waitFor({ timeout: 15000 });
    await page.getByRole("heading", { name: "Live Environment Execution Command" }).waitFor({ timeout: 15000 });
    await page.getByTestId("credential-cutover-phase").waitFor({ timeout: 15000 });
    await page.getByTestId("database-migration-phase").waitFor({ timeout: 15000 });
    await page.getByTestId("secret-sync-phase").waitFor({ timeout: 15000 });
    await page.getByTestId("restore-rehearsal-phase").waitFor({ timeout: 15000 });
    await page.getByTestId("public-host-smoke-phase").waitFor({ timeout: 15000 });
    await page.getByTestId("go-no-go-checkpoint").waitFor({ timeout: 15000 });
    await page.getByTestId("production-launch-integrations-command").waitFor({ timeout: 15000 });
    await page.getByRole("heading", { name: "Production Launch Integrations Command" }).waitFor({ timeout: 15000 });
    await page.getByTestId("live-credentials-lane").waitFor({ timeout: 15000 });
    await page.getByTestId("managed-database-lane").waitFor({ timeout: 15000 });
    await page.getByTestId("backup-restore-lane").waitFor({ timeout: 15000 });
    await page.getByTestId("deployment-secrets-lane").waitFor({ timeout: 15000 });
    await page.getByTestId("production-smoke-lane").waitFor({ timeout: 15000 });
    await page.getByTestId("live-credentials-lane").getByText("Live Credentials", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("production-smoke-lane").getByText("Production Smoke", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("beta-delivery-checkpoint-command").waitFor({ timeout: 15000 });
    await page.getByRole("heading", { name: "Beta Delivery Checkpoint Command" }).waitFor({ timeout: 15000 });
    await page.getByText("Final Build and Smoke Proof Queue", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Known Gap Documentation", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("final-acceptance-walkthrough-command").waitFor({ timeout: 15000 });
    await page.getByRole("heading", { name: "Final Acceptance Walkthrough Command" }).waitFor({ timeout: 15000 });
    await page.getByText("Admin Walkthrough", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Beta Checkpoint Decision", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("launch-candidate-hardening-command").waitFor({ timeout: 15000 });
    await page.getByRole("heading", { name: "Launch Candidate Hardening Command" }).waitFor({ timeout: 15000 });
    await page.getByText("Critical Route Stability", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("E2E Failure Review", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Launch Control Matrix", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByTestId("production-database-path-command").waitFor({ timeout: 15000 });
    await page.getByRole("heading", { name: "Production Database Path Command" }).waitFor({ timeout: 15000 });
    await page.getByText("Backup And Restore Drill", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("environment-secrets-security-command").waitFor({ timeout: 15000 });
    await page.getByRole("heading", { name: "Environment Secrets Command" }).waitFor({ timeout: 15000 });
    await page.getByText("Rotation And Recovery Drill", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByTestId("deployment-pipeline-command").waitFor({ timeout: 15000 });
    await page.getByRole("heading", { name: "Deployment Pipeline Command" }).waitFor({ timeout: 15000 });
    await page.getByText("Rollback And Logs", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Product Catalog", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Finance Reporting", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Production Go-Live Checklist", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByRole("heading", { name: "Environment Inventory" }).waitFor({ timeout: 15000 });
    await page.getByText("Portal session secret", { exact: false }).first().waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: /Create Backup/i }).waitFor({ timeout: 15000 });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-production-ops-readiness.png"),
      fullPage: true,
    });
    watch.assertClean("production ops readiness console");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const anonymousReadiness = await apiJson("/api/v1/restaurant/ops/readiness");
  assert(anonymousReadiness.response.status === 401, `Anonymous ops readiness should be blocked, got ${anonymousReadiness.response.status}.`);

  const anonymousBackup = await apiJson("/api/v1/restaurant/ops/backups/create", { method: "POST" });
  assert(anonymousBackup.response.status === 401, `Anonymous backup creation should be blocked, got ${anonymousBackup.response.status}.`);

  const cookie = await portalLogin();
  const readiness = await adminJson("/api/v1/restaurant/ops/readiness", cookie);
  assert(readiness.response.ok, `Admin ops readiness failed: ${JSON.stringify(readiness.data)}`);
  assert(Array.isArray(readiness.data.environment_manifest), "Readiness did not include environment manifest.");
  assert(readiness.data.environment_summary?.required_total >= 1, "Readiness did not include required environment summary.");
  assert(readiness.data.production_database_plan, "Readiness did not include production database plan.");
  assert(
    readiness.data.production_database_plan.target_backend === "Managed PostgreSQL",
    "Production database plan did not choose Managed PostgreSQL."
  );
  assert(
    readiness.data.production_database_plan.migration_steps.some((step) => step.label === "Run Alembic migrations"),
    "Production database plan did not include migration proof."
  );
  assert(readiness.data.environment_security_plan, "Readiness did not include environment security plan.");
  assert(
    readiness.data.environment_security_plan.secret_controls.some((step) => step.label === "PIZZA_BLITZ_SESSION_SECRET"),
    "Environment security plan did not include portal session secret controls."
  );
  assert(
    readiness.data.environment_security_plan.rotation_drill.some((step) => step.label === "Session secret rotation"),
    "Environment security plan did not include session rotation drill."
  );
  assert(readiness.data.deployment_pipeline_plan, "Readiness did not include deployment pipeline plan.");
  assert(
    readiness.data.deployment_pipeline_plan.build_gate.some((step) => step.label === "Frontend production build"),
    "Deployment pipeline plan did not include frontend build gate."
  );
  assert(
    readiness.data.deployment_pipeline_plan.rollback_checks.some((step) => step.label === "Log inspection"),
    "Deployment pipeline plan did not include log inspection."
  );
  assert(Array.isArray(readiness.data.module_readiness), "Readiness did not include module readiness.");
  assert(readiness.data.launch_summary?.modules_total >= 7, "Launch summary did not include the module total.");
  assert(
    readiness.data.module_readiness.some((module) => module.key === "product_catalog"),
    "Module readiness did not include product catalog."
  );
  assert(
    readiness.data.module_readiness.some((module) => module.key === "finance_reporting"),
    "Module readiness did not include finance reporting."
  );
  assert(
    readiness.data.checks.some((check) => check.key === "staff_password"),
    "Readiness did not include the staff password check."
  );
  assert(
    readiness.data.checks.some((check) => check.key === "portal_session_secret"),
    "Readiness did not include the portal session secret check."
  );

  const variables = flattenEnvironmentVariables(readiness.data);
  assert(variables.some((variable) => variable.name === "SQLALCHEMY_DATABASE_URI"), "Environment manifest did not include the database URI.");
  assert(
    variables.filter((variable) => variable.sensitive).every((variable) => variable.value === null || variable.value === undefined),
    "Environment manifest leaked a sensitive value."
  );

  const backup = await adminJson("/api/v1/restaurant/ops/backups/create", cookie, { method: "POST" });
  assert(backup.response.ok, `Admin backup creation failed: ${JSON.stringify(backup.data)}`);
  assert(
    ["success", "skipped", "external_required", "failed"].includes(backup.data.backup?.status),
    `Unexpected backup status: ${JSON.stringify(backup.data)}`
  );

  const history = await adminJson("/api/v1/restaurant/ops/backups", cookie);
  assert(history.response.ok, `Backup history failed: ${JSON.stringify(history.data)}`);
  assert(history.data.backups.length >= 1, "Backup history did not include the latest backup attempt.");

  const productionLaunch = await adminJson("/api/v1/restaurant/ops/production-launch", cookie);
  assert(productionLaunch.response.ok, `Production launch report failed: ${JSON.stringify(productionLaunch.data)}`);
  assert(
    productionLaunch.data.lanes.some((lane) => lane.key === "live_credentials"),
    "Production launch report did not include live credentials."
  );
  assert(
    productionLaunch.data.lanes.some((lane) => lane.key === "production_smoke"),
    "Production launch report did not include production smoke."
  );

  const liveEnvironment = await adminJson("/api/v1/restaurant/ops/live-environment", cookie);
  assert(liveEnvironment.response.ok, `Live environment report failed: ${JSON.stringify(liveEnvironment.data)}`);
  assert(
    liveEnvironment.data.phases.some((phase) => phase.key === "credential_cutover"),
    "Live environment report did not include credential cutover."
  );
  assert(
    liveEnvironment.data.cutover_windows.some((window) => window.key === "rollback"),
    "Live environment report did not include rollback window."
  );

  await screenshotProductionOps();
  console.log(`Production ops readiness proof passed with backup status ${backup.data.backup.status}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
