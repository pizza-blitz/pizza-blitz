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

async function adminJson(endpoint, cookie, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      Cookie: cookie,
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function createBrowserWatch(page) {
  const issues = [];
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico/i.test(text)) return;
    issues.push(`console error: ${text}`);
  });
  return {
    assertClean(label) {
      assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
    },
  };
}

async function verifyBrowser(marker) {
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

    const response = await page.goto(`${baseURL}/settings`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Settings returned HTTP ${response?.status() || "no response"}.`);
    await page.getByTestId("operational-audit-trail").waitFor({ timeout: 15000 });
    await page.getByTestId("audit-total-count").waitFor({ timeout: 10000 });
    await page.getByTestId("audit-sensitive-count").waitFor({ timeout: 10000 });
    const latest = page.getByTestId("audit-latest-event");
    await latest.waitFor({ timeout: 10000 });
    const latestText = await latest.textContent();
    assert(
      latestText && latestText.includes(marker),
      `Latest audit event did not include proof marker ${marker}. Text: ${latestText}`
    );
    await page.screenshot({
      path: path.join(artifactsDir, "visible-operational-audit-trail.png"),
      fullPage: true,
    });
    watch.assertClean("operational audit settings view");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/api/v1/restaurant/ops/audit-events`, "audit API");
  await waitForHttp(baseURL, "frontend");

  const anonymous = await fetch(`${apiURL}/api/v1/restaurant/ops/audit-events`, { cache: "no-store" });
  assert(anonymous.status === 401, `Anonymous audit trail should be blocked, got ${anonymous.status}.`);

  const cookie = await portalLogin();
  const marker = `Operational Audit Proof ${Date.now()}`;
  const proof = await adminJson("/api/v1/restaurant/ops/audit-events/proof", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_type: "security",
      action: "settings_audit_probe",
      resource_type: "settings",
      resource_id: marker,
      detail: marker,
      metadata: { proof: "e2e", visible_on: "settings" },
    }),
  });
  assert(proof.response.ok, `Audit proof failed: ${JSON.stringify(proof.data)}`);
  assert(proof.data.event?.detail === marker, "Audit proof did not return the created event.");
  assert(proof.data.event?.actor_role === "admin", "Audit proof did not capture admin actor role.");

  const report = await adminJson("/api/v1/restaurant/ops/audit-events?limit=20", cookie);
  assert(report.response.ok, `Audit report failed: ${JSON.stringify(report.data)}`);
  assert(report.data.summary?.total_event_count >= 1, "Audit report did not count events.");
  assert(report.data.summary?.sensitive_event_count >= 1, "Audit report did not count sensitive events.");
  assert(
    report.data.events?.some((event) => event.detail === marker && event.action === "settings_audit_probe"),
    "Audit report did not include the proof event."
  );
  assert(
    report.data.controls?.some((control) => control.name === "Admin-only ledger"),
    "Audit controls did not include admin-only ledger proof."
  );

  await verifyBrowser(marker);
  console.log("Operational audit trail proof passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
