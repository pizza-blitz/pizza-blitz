const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");

const adminRoutes = [
  "/dashboard",
  "/roadmap",
  "/ceo",
  "/orders",
  "/counter",
  "/operations",
  "/shifts",
  "/daily",
  "/sales",
  "/reports",
  "/invoices",
  "/breakeven",
  "/menu",
  "/inventory",
  "/inventory/scan",
  "/recipes",
  "/customers",
  "/promotions",
  "/communications",
  "/social",
  "/ads",
  "/ops",
  "/vendors",
  "/waste",
  "/expenses",
  "/ai-insights",
  "/purchase-orders",
  "/settings",
];

const publicRoutes = ["/", "/order", "/track", "/login", "/account/login", "/account"];

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

function normalizeUrl(href) {
  try {
    const base = new URL(baseURL);
    const url = new URL(href, base);
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function shouldVerifyLink(url) {
  if (!url) return false;
  const base = new URL(baseURL);
  if (url.origin !== base.origin) return false;
  if (url.pathname === "/logout") return false;
  if (url.pathname.startsWith("/_next/")) return false;
  if (url.pathname.startsWith("/api/")) return false;
  return true;
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
    clear() {
      issues.length = 0;
    },
    assertClean(label) {
      assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
    },
  };
}

async function signInAsAdmin(context) {
  const response = await context.request.post(`${baseURL}/api/admin-session`, {
    data: { id: adminId, password: adminPassword, role: "admin" },
  });
  assert(response.ok(), `Admin browser login failed: ${await response.text()}`);
}

async function collectLinks(page, watch, route) {
  watch.clear();
  const response = await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded" });
  assert(response && response.ok(), `${route} returned HTTP ${response?.status() || "no response"}.`);
  await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => undefined);

  const rawLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]")).map((anchor) => ({
      href: anchor.getAttribute("href") || "",
      text: (anchor.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
    }))
  );

  watch.assertClean(route);
  return rawLinks
    .map((link) => ({ ...link, url: normalizeUrl(link.href) }))
    .filter((link) => shouldVerifyLink(link.url))
    .map((link) => ({
      sourceRoute: route,
      href: `${link.url.pathname}${link.url.search}`,
      text: link.text || "(icon/link)",
      url: link.url.toString(),
    }));
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const collected = [];
    for (const route of publicRoutes) {
      collected.push(...(await collectLinks(page, watch, route)));
    }

    await signInAsAdmin(context);
    for (const route of adminRoutes) {
      collected.push(...(await collectLinks(page, watch, route)));
    }

    const uniqueLinks = Array.from(
      new Map(collected.map((link) => [`${link.href}`, link])).values()
    ).sort((a, b) => a.href.localeCompare(b.href));

    const failures = [];
    for (const link of uniqueLinks) {
      const response = await context.request.get(link.url, {
        failOnStatusCode: false,
        maxRedirects: 3,
      });
      if (response.status() >= 400) {
        failures.push({
          sourceRoute: link.sourceRoute,
          href: link.href,
          text: link.text,
          status: response.status(),
        });
      }
    }

    const artifact = {
      checkedAt: new Date().toISOString(),
      baseURL,
      sourceRoutes: publicRoutes.length + adminRoutes.length,
      linksChecked: uniqueLinks.length,
      failures,
      links: uniqueLinks.map(({ sourceRoute, href, text }) => ({ sourceRoute, href, text })),
    };
    fs.writeFileSync(
      path.join(artifactsDir, "navigation-link-health.json"),
      `${JSON.stringify(artifact, null, 2)}\n`
    );

    assert(
      failures.length === 0,
      `Navigation link health found ${failures.length} broken link(s):\n${failures
        .map((failure) => `${failure.status} ${failure.href} from ${failure.sourceRoute} (${failure.text})`)
        .join("\n")}`
    );
    console.log(
      `Navigation link health passed: ${uniqueLinks.length} same-site links across ${
        publicRoutes.length + adminRoutes.length
      } source routes.`
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
