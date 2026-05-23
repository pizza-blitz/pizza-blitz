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
    issues.push(`console error: ${text}`);
  });
  return {
    assertClean(label) {
      assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
    },
  };
}

async function screenshotSocialConsole(postTitle) {
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

    const response = await page.goto(`${baseURL}/social`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Social page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByText("Auto-Posting Console", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText(postTitle, { exact: false }).first().click();
    await page.getByText("Recent Delivery Attempts", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("dry_run", { exact: false }).first().waitFor({ timeout: 15000 });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-social-autoposting.png"),
      fullPage: true,
    });
    watch.assertClean("social auto-posting console");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const anonymousStatus = await apiJson("/api/v1/restaurant/social/provider-status");
  assert(anonymousStatus.response.status === 401, `Anonymous social provider status should be blocked, got ${anonymousStatus.response.status}.`);

  const anonymousCreate = await apiJson("/api/v1/restaurant/social/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Blocked anonymous social post",
      message: "Anonymous users must not create posts.",
      platforms: ["facebook"],
      status: "ready",
    }),
  });
  assert(anonymousCreate.response.status === 401, `Anonymous social post create should be blocked, got ${anonymousCreate.response.status}.`);

  const cookie = await portalLogin();
  const providerResult = await adminJson("/api/v1/restaurant/social/provider-status", cookie);
  assert(providerResult.response.ok, `Admin provider status failed: ${JSON.stringify(providerResult.data)}`);
  assert(providerResult.data.facebook.provider === "meta-facebook", "Facebook provider status was not returned.");
  assert(providerResult.data.instagram.provider === "meta-instagram", "Instagram provider status was not returned.");

  const autoStatus = await adminJson("/api/v1/restaurant/social/auto-publish/status", cookie);
  assert(autoStatus.response.ok, `Auto-publish status failed: ${JSON.stringify(autoStatus.data)}`);
  assert(typeof autoStatus.data.interval_minutes === "number", "Auto-publish status did not include interval minutes.");

  const postTitle = `Social Auto Proof ${Date.now()}`;
  const postResult = await adminJson("/api/v1/restaurant/social/posts", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: postTitle,
      message: "Pizza Blitz social dry-run proof with provider readiness and delivery history.",
      link_url: `${baseURL}/order`,
      image_url: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1200&q=80",
      platforms: ["facebook", "instagram"],
      status: "ready",
    }),
  });
  assert(postResult.response.ok, `Could not create social post: ${JSON.stringify(postResult.data)}`);
  const postId = postResult.data.post.id;

  const anonymousPublish = await apiJson(`/api/v1/restaurant/social/posts/${postId}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true }),
  });
  assert(anonymousPublish.response.status === 401, `Anonymous social publish should be blocked, got ${anonymousPublish.response.status}.`);

  const dryRun = await adminJson(`/api/v1/restaurant/social/posts/${postId}/publish`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true }),
  });
  assert(dryRun.response.ok, `Social dry run failed: ${JSON.stringify(dryRun.data)}`);
  assert(dryRun.data.dry_run_count === 2, `Expected two dry-run platform records, got ${dryRun.data.dry_run_count}.`);
  assert(
    dryRun.data.deliveries.some((delivery) => delivery.platform === "facebook" && delivery.provider === "meta-facebook"),
    "Dry run did not retain the Facebook provider."
  );
  assert(
    dryRun.data.deliveries.some((delivery) => delivery.platform === "instagram" && delivery.provider === "meta-instagram"),
    "Dry run did not retain the Instagram provider."
  );

  const deliveries = await adminJson(`/api/v1/restaurant/social/posts/${postId}/deliveries`, cookie);
  assert(deliveries.response.ok, `Social delivery history failed: ${JSON.stringify(deliveries.data)}`);
  assert(deliveries.data.dry_run_count >= 2, "Social delivery history did not retain both dry-run records.");

  await screenshotSocialConsole(postTitle);
  console.log(`Social auto-posting proof passed for post #${postId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
