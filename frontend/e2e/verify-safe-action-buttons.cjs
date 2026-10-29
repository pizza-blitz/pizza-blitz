const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
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
  "/kds",
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

const safeNamePattern =
  /\b(refresh|reload|filter|all|active|ready|delivery|pickup|takeaway|today|week|month|daily|weekly|monthly|last|next|vip|needs attention|needs consent|missing destination|provider blocked|auto on|auto off|cancel|back)\b/i;

const unsafeNamePattern =
  /\b(add|apply|archive|approve|assign|close|commit|copy|create|delete|download|duplicate|export|import|launch|log|mark|pay|place order|print|publish|receive|record|register|remove|resume|retry|run|save|send|share|start|submit|sync|test|upload|void)\b/i;

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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

async function loadRoute(page, watch, route) {
  watch.clear();
  const response = await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded" });
  assert(response && response.ok(), `${route} returned HTTP ${response?.status() || "no response"}.`);
  await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => undefined);
  watch.assertClean(`${route} load`);
}

async function collectSafeButtonNames(page) {
  return page.evaluate(
    ({ safeSource, unsafeSource }) => {
      const safePattern = new RegExp(safeSource, "i");
      const unsafePattern = new RegExp(unsafeSource, "i");

      function clean(value) {
        return (value || "").replace(/\s+/g, " ").trim();
      }

      function isVisible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      }

      function accessibleName(element) {
        const ariaLabel = clean(element.getAttribute("aria-label"));
        if (ariaLabel) return ariaLabel;
        const text = clean(element.textContent);
        if (text) return text;
        const title = clean(element.getAttribute("title"));
        if (title) return title;
        return "";
      }

      return Array.from(document.querySelectorAll("button"))
        .filter((button) => isVisible(button))
        .filter((button) => !button.disabled)
        .filter((button) => !button.closest("form"))
        .map((button) => accessibleName(button))
        .filter(Boolean)
        .filter((name) => safePattern.test(name))
        .filter((name) => !unsafePattern.test(name))
        .filter((name, index, names) => names.indexOf(name) === index)
        .slice(0, 4);
    },
    {
      safeSource: safeNamePattern.source,
      unsafeSource: unsafeNamePattern.source,
    }
  );
}

async function assertPageHealthy(page, label) {
  const health = await page.evaluate(() => {
    const text = document.body.innerText || "";
    return {
      hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
      hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
      textLength: text.trim().length,
    };
  });
  assert(!health.hasFrameworkError, `${label} rendered framework error text.`);
  assert(!health.hasOverlay, `${label} rendered a framework error overlay.`);
  assert(health.textLength > 40, `${label} rendered too little content after click.`);
}

async function clickSafeButtons(page, watch, route) {
  await loadRoute(page, watch, route);
  const candidates = await collectSafeButtonNames(page);
  const clicked = [];
  const skipped = [];

  for (const name of candidates) {
    await loadRoute(page, watch, route);
    const locator = page.getByRole("button", { name: new RegExp(`^${escapeRegExp(name)}$`, "i") }).first();
    const count = await locator.count();
    if (!count) {
      skipped.push({ route, name, reason: "not found by role" });
      continue;
    }

    watch.clear();
    try {
      await locator.click({ timeout: 6000 });
      await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => undefined);
      await assertPageHealthy(page, `${route} button ${name}`);
      watch.assertClean(`${route} button ${name}`);
      clicked.push({ route, name });
    } catch (error) {
      throw new Error(`${route} safe button "${name}" failed: ${error.message}`);
    }
  }

  return { clicked, skipped, candidates };
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
    const routeResults = [];
    let clicked = [];
    let skipped = [];

    for (const route of publicRoutes) {
      const result = await clickSafeButtons(page, watch, route);
      routeResults.push({ route, candidates: result.candidates, clicked: result.clicked });
      clicked = clicked.concat(result.clicked);
      skipped = skipped.concat(result.skipped);
    }

    await signInAsAdmin(context);
    for (const route of adminRoutes) {
      const result = await clickSafeButtons(page, watch, route);
      routeResults.push({ route, candidates: result.candidates, clicked: result.clicked });
      clicked = clicked.concat(result.clicked);
      skipped = skipped.concat(result.skipped);
    }

    const artifact = {
      checkedAt: new Date().toISOString(),
      baseURL,
      sourceRoutes: publicRoutes.length + adminRoutes.length,
      clickedCount: clicked.length,
      clicked,
      skipped,
      routeResults,
    };
    fs.writeFileSync(
      path.join(artifactsDir, "safe-action-buttons.json"),
      `${JSON.stringify(artifact, null, 2)}\n`
    );

    assert(clicked.length >= 20, `Expected at least 20 safe action clicks, only clicked ${clicked.length}.`);
    assert(
      skipped.length === 0,
      `Safe action buttons had unclickable role/name candidates:\n${skipped
        .map((item) => `${item.route}: ${item.name} (${item.reason})`)
        .join("\n")}`
    );
    console.log(
      `Safe action buttons passed: ${clicked.length} non-destructive clicks across ${
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
