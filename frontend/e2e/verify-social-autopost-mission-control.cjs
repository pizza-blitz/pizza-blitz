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
  const anonymous = await apiJson("/api/v1/restaurant/social/auto-post/mission-control");
  assert(anonymous.response.status === 401, `Anonymous social auto-post mission control should be blocked, got ${anonymous.response.status}.`);

  const control = await adminJson("/api/v1/restaurant/social/auto-post/mission-control?limit=100", cookie);
  assert(control.response.ok, `Social auto-post mission control failed: ${JSON.stringify(control.data)}`);
  assert(control.data.summary?.overall_status, "Mission control summary did not include overall status.");
  assert(typeof control.data.summary.configured_count === "number", "Mission control missing configured count.");
  assert(Array.isArray(control.data.controls), "Mission control missing operator controls.");
  assert(control.data.controls.some((item) => item.label === "Secret-safe Meta tokens"), "Token safety control was missing.");
  assert(control.data.controls.some((item) => item.label === "Instagram asset gate"), "Instagram asset gate was missing.");

  for (const platform of ["facebook", "instagram"]) {
    const row = control.data.platforms.find((item) => item.platform === platform);
    assert(row, `Mission control missing ${platform}.`);
    assert(row.provider_status?.provider, `${platform} provider status was missing.`);
    assert(row.activation_status, `${platform} activation status was missing.`);
    assert(row.counts && typeof row.counts.attempted_count === "number", `${platform} delivery counts were missing.`);
    assert(Array.isArray(row.blockers), `${platform} blockers should be an array.`);
    assert(row.next_action, `${platform} next action was missing.`);
  }

  const postTitle = `Social Mission Proof ${Date.now()}`;
  const dueAt = "1900-01-01T00:00:00.000Z";
  const postResult = await adminJson("/api/v1/restaurant/social/posts", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: postTitle,
      message: "Pizza Blitz mission-control proof without an image so Instagram remains blocked until content is fixed.",
      link_url: `${baseURL}/order`,
      platforms: ["instagram"],
      status: "scheduled",
      scheduled_at: dueAt,
    }),
  });
  assert(postResult.response.ok, `Could not create mission-control social post: ${JSON.stringify(postResult.data)}`);
  const postId = postResult.data.post.id;

  const dryRun = await adminJson(`/api/v1/restaurant/social/posts/${postId}/publish`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true }),
  });
  assert(dryRun.response.ok, `Mission-control dry run failed: ${JSON.stringify(dryRun.data)}`);
  assert(dryRun.data.skipped_count === 1, "Instagram post without image should create one skipped delivery.");

  const updated = await adminJson("/api/v1/restaurant/social/auto-post/mission-control?limit=100", cookie);
  assert(updated.response.ok, `Updated mission control failed: ${JSON.stringify(updated.data)}`);
  const duePost = updated.data.due_posts.find((post) => post.id === postId);
  assert(duePost, "Created due social post did not appear in mission-control due posts.");
  assert(duePost.blockers.includes("Instagram image_url"), "Mission control did not expose the Instagram image blocker.");
  const instagram = updated.data.platforms.find((item) => item.platform === "instagram");
  assert(instagram.blocked_due_count >= 1, "Instagram mission row did not count blocked due posts.");
  assert(instagram.latest_issue?.issue_reason === "asset", "Instagram latest issue did not classify the missing image as an asset blocker.");

  return { postId, postTitle };
}

async function verifyBrowser(postId, postTitle) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1300 },
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

    const missionControl = page.getByTestId("social-autopost-mission-control");
    await missionControl.waitFor({ timeout: 25000 });
    await missionControl.getByText("Social Auto-Post Mission Control", { exact: false }).waitFor({ timeout: 25000 });
    await missionControl.getByText("Due-post gates, Meta provider proof and recovery", { exact: false }).waitFor({ timeout: 25000 });
    await missionControl.getByText("Secret-safe Meta tokens", { exact: true }).waitFor({ timeout: 25000 });
    await missionControl.getByText("Instagram asset gate", { exact: true }).waitFor({ timeout: 25000 });
    await missionControl.getByTestId("autopost-platform-facebook").waitFor({ timeout: 25000 });
    await missionControl.getByTestId("autopost-platform-instagram").waitFor({ timeout: 25000 });
    await missionControl.getByTestId("autopost-due-lane").waitFor({ timeout: 25000 });
    await page.getByText("Attach a public image URL", { exact: false }).first().waitFor({ timeout: 25000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-social-autopost-mission-control.png"),
      fullPage: true,
    });
    watch.assertClean("social auto-post mission control");
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
  console.log(`Social auto-post mission control proof passed for post #${proof.postId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
