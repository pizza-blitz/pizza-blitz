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

async function collectControls(page, watch, route) {
  watch.clear();
  const response = await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded" });
  assert(response && response.ok(), `${route} returned HTTP ${response?.status() || "no response"}.`);
  await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => undefined);

  const controls = await page.evaluate(() => {
    const interactiveSelector = [
      "a[href]",
      "button",
      "input:not([type='hidden'])",
      "select",
      "textarea",
      "[role='button']",
      "[role='link']",
    ].join(",");

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

    function labelForInput(element) {
      const id = element.getAttribute("id");
      if (id) {
        const label = document.querySelector(`label[for='${CSS.escape(id)}']`);
        if (label) return clean(label.textContent);
      }
      const wrappedLabel = element.closest("label");
      if (wrappedLabel) return clean(wrappedLabel.textContent);
      return "";
    }

    function accessibleName(element) {
      const ariaLabel = clean(element.getAttribute("aria-label"));
      if (ariaLabel) return ariaLabel;

      const labelledBy = clean(element.getAttribute("aria-labelledby"));
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => clean(document.getElementById(id)?.textContent))
          .filter(Boolean)
          .join(" ");
        if (text) return text;
      }

      const inputLabel = element.matches("input,select,textarea") ? labelForInput(element) : "";
      if (inputLabel) return inputLabel;

      const text = clean(element.textContent);
      if (text) return text;

      const placeholder = clean(element.getAttribute("placeholder"));
      if (placeholder) return placeholder;

      const title = clean(element.getAttribute("title"));
      if (title) return title;

      return "";
    }

    function describe(element, index) {
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute("role") || "";
      const testId = element.getAttribute("data-testid") || "";
      const id = element.getAttribute("id") || "";
      const href = element.getAttribute("href") || "";
      const classes = clean(element.getAttribute("class")).split(" ").slice(0, 4).join(" ");
      return `${tag}${role ? `[role=${role}]` : ""}${id ? `#${id}` : ""}${
        testId ? `[data-testid=${testId}]` : ""
      }${href ? `[href=${href}]` : ""}${classes ? `.${classes}` : ""} @${index}`;
    }

    return Array.from(document.querySelectorAll(interactiveSelector))
      .map((element, index) => ({
        index,
        visible: isVisible(element),
        name: accessibleName(element),
        description: describe(element, index),
      }))
      .filter((control) => control.visible)
      .map(({ name, description }) => ({ name, description, hasName: Boolean(name) }));
  });

  watch.assertClean(route);
  return controls.map((control) => ({ route, ...control }));
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
    const controls = [];
    for (const route of publicRoutes) {
      controls.push(...(await collectControls(page, watch, route)));
    }

    await signInAsAdmin(context);
    for (const route of adminRoutes) {
      controls.push(...(await collectControls(page, watch, route)));
    }

    const failures = controls.filter((control) => !control.hasName);
    const artifact = {
      checkedAt: new Date().toISOString(),
      baseURL,
      sourceRoutes: publicRoutes.length + adminRoutes.length,
      controlsChecked: controls.length,
      missingNames: failures,
      byRoute: controls.reduce((summary, control) => {
        summary[control.route] = summary[control.route] || { controls: 0, missingNames: 0 };
        summary[control.route].controls += 1;
        if (!control.hasName) summary[control.route].missingNames += 1;
        return summary;
      }, {}),
    };

    fs.writeFileSync(
      path.join(artifactsDir, "interactive-control-labels.json"),
      `${JSON.stringify(artifact, null, 2)}\n`
    );

    assert(
      failures.length === 0,
      `Interactive control label audit found ${failures.length} unlabeled visible control(s):\n${failures
        .slice(0, 25)
        .map((failure) => `${failure.route}: ${failure.description}`)
        .join("\n")}`
    );

    console.log(
      `Interactive control labels passed: ${controls.length} visible controls across ${
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
