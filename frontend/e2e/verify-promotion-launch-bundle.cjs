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

async function apiJson(endpoint, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: { ...(options.headers || {}) },
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

async function portalLogin() {
  const response = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  const data = await response.json().catch(() => ({}));
  assert(response.ok, `Admin portal login failed: ${JSON.stringify(data)}`);
  const cookie = cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
  assert(cookie.includes("pb_admin_session="), "Admin login did not return an admin session cookie.");
  return cookie;
}

async function createPromotion(cookie) {
  const suffix = Date.now().toString().slice(-8);
  const today = new Date();
  const endDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const response = await adminJson("/api/v1/restaurant/promotions/", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Launch Bundle Proof ${suffix}`,
      code: `BUN${suffix.slice(-5)}`,
      start_date: today.toISOString().slice(0, 10),
      end_date: endDate.toISOString().slice(0, 10),
      description: "E2E launch bundle proof",
      discount_type: "percentage",
      discount_value: 14,
      audience: "marketing_opt_in",
      channel: "email",
      status: "active",
      message_template: "Hi {name}, Pizza Blitz has {offer}. Use {code}. Order here: {order_link}",
    }),
  });
  assert(response.response.ok, `Could not create launch bundle promotion: ${JSON.stringify(response.data)}`);
  return response.data.promotion;
}

async function waitForLaunchBundle(campaignId, cookie) {
  const startedAt = Date.now();
  let latest = null;

  while (Date.now() - startedAt < 90000) {
    const result = await adminJson(`/api/v1/restaurant/promotions/performance/${campaignId}`, cookie);
    assert(result.response.ok, `Could not load launch bundle performance: ${JSON.stringify(result.data)}`);
    latest = result.data;
    if (result.data.social?.latest_post_id && result.data.ads?.latest_campaign_id) {
      return result.data;
    }
    await sleep(1500);
  }

  throw new Error(`Launch bundle did not create both handoffs: ${JSON.stringify(latest)}`);
}

async function waitForCampaignSelection(page, campaign) {
  const deadline = Date.now() + 90000;
  let lastText = "";

  while (Date.now() < deadline) {
    try {
      await page.locator("h2", { hasText: campaign.name }).first().waitFor({ timeout: 20000 });
      await page.getByTestId("promotion-launch-bundle").waitFor({ timeout: 20000 });
      await page.getByTestId("promotion-launch-supervisor").waitFor({ timeout: 20000 });
      return;
    } catch {
      lastText = await page.evaluate(() => document.body.innerText.slice(0, 2200)).catch(() => "");
      if (Date.now() >= deadline) break;
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
  }

  await page.screenshot({
    path: path.join(artifactsDir, "debug-promotion-launch-bundle-missing.png"),
    fullPage: false,
  }).catch(() => undefined);
  throw new Error(`Promotions page did not select ${campaign.name}. Last visible text:\n${lastText}`);
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
    if (!url.startsWith(baseURL) && !url.startsWith(apiURL)) return;
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

async function proveLaunchBundle(campaign, cookie) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1250 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/promotions?campaign=${campaign.id}&proof=${Date.now()}`, {
      waitUntil: "domcontentloaded",
    });
    assert(response && response.ok(), `Promotions page returned HTTP ${response?.status() || "no response"}.`);
    await waitForCampaignSelection(page, campaign);
    await page.getByTestId("launch-bundle-social-card").getByText("pending").waitFor({ timeout: 30000 });
    await page.getByTestId("launch-bundle-ad-card").getByText("pending").waitFor({ timeout: 30000 });
    const pendingSocialSupervisor = await page.getByTestId("launch-supervisor-social").textContent();
    const pendingAdSupervisor = await page.getByTestId("launch-supervisor-ad").textContent();
    assert(/Build the launch bundle/i.test(pendingSocialSupervisor || ""), "Launch supervisor did not flag social handoff as pending.");
    assert(
      /Build the launch bundle|credential|setting|configure|activate|provider/i.test(pendingAdSupervisor || ""),
      `Launch supervisor did not flag ad handoff as pending or provider-gated: ${pendingAdSupervisor}`
    );

    await page.getByTestId("create-launch-bundle-button").click();
    await page.getByText(/Launch bundle ready/i).waitFor({ timeout: 45000 });

    const bundle = await waitForLaunchBundle(campaign.id, cookie);
    await page.getByTestId("launch-bundle-social-card").getByText(`#${bundle.social.latest_post_id}`).waitFor({ timeout: 30000 });
    await page.getByTestId("launch-bundle-ad-card").getByText(/budget/i).waitFor({ timeout: 30000 });
    await page.getByTestId("launch-supervisor-social").waitFor({ state: "attached", timeout: 30000 });
    await page.getByTestId("launch-supervisor-ad").waitFor({ state: "attached", timeout: 30000 });
    const readySocialSupervisor = await page.getByTestId("launch-supervisor-social").textContent();
    const readyAdSupervisor = await page.getByTestId("launch-supervisor-ad").textContent();
    assert(
      (readySocialSupervisor || "").includes(`Post #${bundle.social.latest_post_id}`),
      `Launch supervisor missed social post #${bundle.social.latest_post_id}.`
    );
    assert(
      (readyAdSupervisor || "").includes(`Ad #${bundle.ads.latest_campaign_id}`),
      `Launch supervisor missed ad campaign #${bundle.ads.latest_campaign_id}.`
    );
    const supervisorScore = await page.getByTestId("launch-supervisor-score").innerText();
    assert(/^[2-4]\/4 clear/i.test(supervisorScore), `Launch supervisor score did not include created handoffs: ${supervisorScore}`);

    const socialHref = await page.getByTestId("launch-bundle-social-link").getAttribute("href");
    const adHref = await page.getByTestId("launch-bundle-ad-link").getAttribute("href");
    assert(socialHref && socialHref.includes(`/social?post=${bundle.social.latest_post_id}`), "Social launch bundle link missed created post.");
    assert(adHref && adHref.includes(`/ads?campaign=${bundle.ads.latest_campaign_id}`), "Ad launch bundle link missed created campaign.");

    const timeline = await adminJson(`/api/v1/restaurant/promotions/${campaign.id}/timeline`, cookie);
    assert(timeline.response.ok, `Could not load launch bundle timeline: ${JSON.stringify(timeline.data)}`);
    const eventTypes = new Set((timeline.data.events || []).map((event) => event.type));
    assert(eventTypes.has("social"), "Launch bundle timeline missed social handoff event.");
    assert(eventTypes.has("ad"), "Launch bundle timeline missed ad handoff event.");

    const health = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        textLength: text.trim().length,
        hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
        hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert(health.textLength > 1000, "Promotion launch bundle rendered too little content.");
    assert(!health.hasOverlay, "Promotion launch bundle rendered a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Promotion launch bundle rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Promotion launch bundle has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    await page.getByTestId("promotion-launch-bundle").screenshot({
      path: path.join(artifactsDir, "visible-promotion-launch-bundle.png"),
    });
    await page.getByTestId("promotion-launch-supervisor").scrollIntoViewIfNeeded();
    await page.getByTestId("promotion-launch-supervisor").screenshot({
      path: path.join(artifactsDir, "visible-promotion-launch-supervisor.png"),
    });
    watch.assertClean("promotion launch bundle");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const cookie = await portalLogin();
  const campaign = await createPromotion(cookie);
  await proveLaunchBundle(campaign, cookie);
  console.log(`Promotion launch bundle proof passed for campaign #${campaign.id}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
