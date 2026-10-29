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
  const anonymous = await apiJson("/api/v1/restaurant/promotions/providers/dispatch-control");
  assert(anonymous.response.status === 401, `Anonymous dispatch control should be blocked, got ${anonymous.response.status}.`);

  const control = await adminJson("/api/v1/restaurant/promotions/providers/dispatch-control", cookie);
  assert(control.response.ok, `Dispatch control failed: ${JSON.stringify(control.data)}`);
  assert(control.data.summary?.overall_status, "Dispatch control summary did not include overall status.");
  assert(typeof control.data.summary.configured_count === "number", "Dispatch control missing configured count.");
  assert(Array.isArray(control.data.controls), "Dispatch control missing operator controls.");
  assert(control.data.controls.some((item) => item.label === "Consent gate"), "Consent gate control was missing.");
  assert(control.data.controls.some((item) => item.label === "Dry-run proof"), "Dry-run proof control was missing.");

  for (const channel of ["whatsapp", "sms", "email"]) {
    const row = control.data.channels.find((item) => item.channel === channel);
    assert(row, `Dispatch control missing ${channel}.`);
    assert(row.provider_status?.provider, `${channel} provider status was missing.`);
    assert(row.activation_status, `${channel} activation status was missing.`);
    assert(row.counts && typeof row.counts.attempted_count === "number", `${channel} counts were missing.`);
    assert(Array.isArray(row.blockers), `${channel} blockers should be an array.`);
    assert(row.next_action, `${channel} next action was missing.`);
  }

  const testSend = await adminJson("/api/v1/restaurant/promotions/providers/test-send", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: "email",
      recipient: "dispatch-proof@example.com",
      message_template: "Hi {name}, Pizza Blitz has {offer}. Use {code} before {end_date}. Order here: {order_link}",
    }),
  });
  assert(testSend.response.ok, `Safe test send failed: ${JSON.stringify(testSend.data)}`);
  assert(testSend.data.status === "dry_run_test_generated", "Safe test did not return a dry-run receipt.");
  assert(testSend.data.live_send_blocked === true, "Safe test should block live sends.");
}

async function verifyBrowser() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1200 },
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

    await page.getByTestId("campaign-dispatch-control").waitFor({ timeout: 25000 });
    await page.getByText("Campaign Dispatch Control", { exact: false }).waitFor({ timeout: 25000 });
    await page.getByText("Live-provider blockers and send proof", { exact: false }).waitFor({ timeout: 25000 });
    await page.getByTestId("dispatch-channel-whatsapp").waitFor({ timeout: 25000 });
    await page.getByTestId("dispatch-channel-sms").waitFor({ timeout: 25000 });
    await page.getByTestId("dispatch-channel-email").waitFor({ timeout: 25000 });
    const dispatchPanel = page.getByTestId("campaign-dispatch-control");
    await dispatchPanel.getByText("Consent gate", { exact: true }).waitFor({ timeout: 25000 });
    await dispatchPanel.getByText("Dry-run proof", { exact: true }).first().waitFor({ timeout: 25000 });

    const safeTestForm = page.getByTestId("safe-test-send-form");
    await safeTestForm.locator("select").selectOption("email");
    await page.getByTestId("safe-test-recipient").fill("dispatch-proof@example.com");
    await page.getByTestId("safe-test-template").fill(
      "Hi {name}, Pizza Blitz has {offer}. Use {code} before {end_date}. Order here: {order_link}"
    );
    await page.getByTestId("run-safe-test-send").click();
    await page.getByText("Dry-run test generated", { exact: false }).waitFor({ timeout: 25000 });
    await page.getByText("Live send blocked", { exact: false }).waitFor({ timeout: 25000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-campaign-dispatch-control.png"),
      fullPage: true,
    });
    watch.assertClean("campaign dispatch control");
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
  console.log("Campaign dispatch control proof passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
