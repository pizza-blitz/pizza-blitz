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
  const anonymousReadiness = await apiJson("/api/v1/restaurant/social/readiness");
  assert(
    anonymousReadiness.response.status === 401,
    `Anonymous social readiness should be blocked, got ${anonymousReadiness.response.status}.`
  );

  const readiness = await adminJson("/api/v1/restaurant/social/readiness", cookie);
  assert(readiness.response.ok, `Social readiness failed: ${JSON.stringify(readiness.data)}`);
  assert(readiness.data.providers.facebook.provider === "meta-facebook", "Facebook readiness provider was missing.");
  assert(readiness.data.providers.instagram.provider === "meta-instagram", "Instagram readiness provider was missing.");
  assert(Array.isArray(readiness.data.providers.facebook.credential_checks), "Facebook credential checks were missing.");
  assert(Array.isArray(readiness.data.providers.instagram.content_requirements), "Instagram content requirements were missing.");
  assert(readiness.data.schedule && typeof readiness.data.schedule.due_count === "number", "Schedule readiness was missing.");
  assert(readiness.data.audit && typeof readiness.data.audit.retryable_count === "number", "Audit readiness was missing.");

  const postTitle = `Social Readiness Proof ${Date.now()}`;
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const postResult = await adminJson("/api/v1/restaurant/social/posts", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: postTitle,
      message: "Pizza Blitz social readiness proof without image so Instagram audit has a retryable asset issue.",
      link_url: `${baseURL}/order`,
      platforms: ["instagram"],
      status: "scheduled",
      scheduled_at: yesterday,
    }),
  });
  assert(postResult.response.ok, `Could not create social readiness post: ${JSON.stringify(postResult.data)}`);
  const postId = postResult.data.post.id;

  const blockedSchedule = await adminJson("/api/v1/restaurant/social/auto-publish/status", cookie);
  assert(blockedSchedule.response.ok, `Auto-publish status failed: ${JSON.stringify(blockedSchedule.data)}`);
  assert(
    blockedSchedule.data.due_posts.some((post) => post.id === postId && post.blockers.includes("Instagram image_url")),
    "Scheduled post did not appear as blocked by missing Instagram image_url."
  );

  const dryRun = await adminJson(`/api/v1/restaurant/social/posts/${postId}/publish`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true }),
  });
  assert(dryRun.response.ok, `Social dry-run failed: ${JSON.stringify(dryRun.data)}`);
  assert(dryRun.data.skipped_count === 1, "Instagram post without image should create a skipped dry-run delivery.");

  const retry = await adminJson(`/api/v1/restaurant/social/posts/${postId}/deliveries/retry`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true, status: "needs_attention", limit: 10 }),
  });
  assert(retry.response.ok, `Social retry failed: ${JSON.stringify(retry.data)}`);
  assert(retry.data.retried_platform_count === 1, "Retry should recheck one platform.");
  assert(retry.data.asset_issue_count === 1, "Retry should retain the Instagram asset issue.");

  const deliveries = await adminJson(`/api/v1/restaurant/social/posts/${postId}/deliveries`, cookie);
  assert(deliveries.response.ok, `Social delivery history failed: ${JSON.stringify(deliveries.data)}`);
  assert(deliveries.data.retryable_count >= 1, "Delivery history did not expose retryable social issues.");
  assert(deliveries.data.asset_issue_count >= 1, "Delivery history did not expose asset social issues.");
  assert(
    deliveries.data.deliveries.some((delivery) => /Attach a public image URL/i.test(delivery.recovery_action || "")),
    "Delivery history did not include the expected recovery action."
  );

  return { postId, postTitle };
}

async function verifyBrowser(postId, postTitle) {
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

    const response = await page.goto(`${baseURL}/social?post=${postId}`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Social page returned HTTP ${response?.status() || "no response"}.`);
    const readinessCommand = page.getByTestId("social-readiness-command");
    await readinessCommand.waitFor({ timeout: 15000 });
    await page.getByText("Social Publishing Readiness", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Token setup, schedule blockers and delivery retry audit", { exact: false }).waitFor({ timeout: 15000 });
    await readinessCommand.getByTestId("social-provider-facebook").waitFor({ timeout: 15000 });
    await readinessCommand.getByTestId("social-provider-instagram").waitFor({ timeout: 15000 });
    await page.getByText("Schedule / Retry Queue", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText(postTitle, { exact: false }).first().waitFor({ timeout: 15000 });
    await page.getByText("Recent Delivery Attempts", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Attach a public image URL", { exact: false }).first().waitFor({ timeout: 15000 });

    await page.getByTestId("retry-social-delivery-issues").click();
    await page.getByText("Retry dry-run checked", { exact: false }).waitFor({ timeout: 15000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-social-publishing-readiness.png"),
      fullPage: true,
    });
    watch.assertClean("social publishing readiness command");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const cookie = await portalLogin();
  const proof = await verifyApiContract(cookie);
  await verifyBrowser(proof.postId, proof.postTitle);
  console.log(`Social publishing readiness proof passed for post #${proof.postId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
