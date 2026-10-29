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
    issues.push(`console error: ${text}`);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!url.startsWith(baseURL)) return;
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

async function verifyApiContract(cookie) {
  const anonymousReadiness = await apiJson("/api/v1/restaurant/promotions/providers/status");
  assert(
    anonymousReadiness.response.status === 401,
    `Anonymous provider readiness should be blocked, got ${anonymousReadiness.response.status}.`
  );

  const readiness = await adminJson("/api/v1/restaurant/promotions/providers/status", cookie);
  assert(readiness.response.ok, `Messaging readiness failed: ${JSON.stringify(readiness.data)}`);
  assert(readiness.data.safe_test_mode === "dry_run_only", "Provider readiness should expose dry-run-only mode.");
  assert(Array.isArray(readiness.data.compliance_summary), "Readiness should include a compliance summary.");
  for (const channel of ["whatsapp", "sms", "email"]) {
    const status = readiness.data.channels.find((row) => row.channel === channel);
    assert(status, `Readiness missing ${channel}.`);
    assert(Array.isArray(status.credential_checks), `${channel} credential checks were missing.`);
    assert(status.safe_test_send?.mode === "dry_run_only", `${channel} safe test mode was not dry-run-only.`);
    assert(status.template_label, `${channel} template label was missing.`);
  }

  const testSend = await adminJson("/api/v1/restaurant/promotions/providers/test-send", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: "email",
      recipient: "readiness-proof@example.com",
      message_template: "Hi {name}, Pizza Blitz has {offer}. Use {code} before {end_date}. Order here: {order_link}",
    }),
  });
  assert(testSend.response.ok, `Safe test send failed: ${JSON.stringify(testSend.data)}`);
  assert(testSend.data.status === "dry_run_test_generated", "Safe test did not return a dry-run receipt.");
  assert(testSend.data.live_send_blocked === true, "Safe test should block live sends.");
  assert(testSend.data.queued === false, "Safe test should not queue a real provider message.");
  assert(/Test Customer/.test(testSend.data.message_preview), "Safe test did not render the message template.");
  assert(/^\w{2}\*\*\*@example\.com$/.test(testSend.data.recipient_masked), "Safe test did not mask email recipient.");
}

async function verifyBrowser() {
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

    const response = await page.goto(`${baseURL}/promotions`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Promotions page returned HTTP ${response?.status() || "no response"}.`);

    await page.getByTestId("messaging-readiness-command").waitFor({ timeout: 15000 });
    await page.getByText("WhatsApp / SMS / Email Readiness", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Provider setup, template compliance and safe test-send", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByTestId("provider-readiness-whatsapp").waitFor({ timeout: 15000 });
    await page.getByTestId("provider-readiness-sms").waitFor({ timeout: 15000 });
    await page.getByTestId("provider-readiness-email").waitFor({ timeout: 15000 });

    const safeTestForm = page.getByTestId("safe-test-send-form");
    await safeTestForm.locator("select").selectOption("email");
    await page.waitForFunction(() => {
      const select = document.querySelector('[data-testid="safe-test-send-form"] select');
      return select && select.value === "email";
    });
    await page.getByTestId("safe-test-recipient").fill("readiness-proof@example.com");
    await page.getByTestId("safe-test-template").fill(
      "Hi {name}, Pizza Blitz has {offer}. Use {code} before {end_date}. Order here: {order_link}"
    );
    await page.getByTestId("run-safe-test-send").click();
    await page.getByText("Dry-run test generated", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Live send blocked", { exact: false }).waitFor({ timeout: 15000 });
    await page
      .getByTestId("safe-test-send-result")
      .getByText("re***@example.com", { exact: false })
      .waitFor({ timeout: 15000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-messaging-readiness.png"),
      fullPage: true,
    });
    watch.assertClean("messaging readiness command");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const cookie = await portalLogin();
  await verifyApiContract(cookie);
  await verifyBrowser();
  console.log("Messaging readiness proof passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
