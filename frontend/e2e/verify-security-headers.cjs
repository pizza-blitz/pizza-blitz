/* Security headers + client error monitoring proof. */
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

function cookieHeaderFromSetCookie(setCookie) {
  if (!setCookie) return "";
  return setCookie
    .split(/,(?=[^;]+=)/)
    .map((part) => part.split(";")[0].trim())
    .join("; ");
}

async function waitForHttp(url, label) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < 30000) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok || response.status === 401) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`${label} did not become ready at ${url}: ${lastError}`);
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const pageHeaders = await fetch(`${baseURL}/`, {
    redirect: "follow",
    cache: "no-store",
  });
  assert(pageHeaders.ok, "Frontend page did not load.");
  const csp = pageHeaders.headers.get("content-security-policy") || "";
  assert(csp.includes("default-src 'self'"), "Page CSP is missing.");
  assert(csp.includes("frame-ancestors 'none'"), "Page CSP framing rule is missing.");
  assert(
    pageHeaders.headers.get("x-frame-options") === "DENY",
    "Page X-Frame-Options is missing."
  );
  assert(
    pageHeaders.headers.get("x-content-type-options") === "nosniff",
    "Page nosniff header is missing."
  );
  assert(
    (pageHeaders.headers.get("strict-transport-security") || "").includes("max-age"),
    "HSTS header is missing."
  );
  assert(
    (pageHeaders.headers.get("permissions-policy") || "").includes("geolocation=(self)"),
    "Permissions-Policy is missing."
  );

  const apiHealth = await fetch(`${apiURL}/health`, {
    headers: { "X-Request-ID": "proof-header-1" },
  });
  assert(apiHealth.ok, "API health failed.");
  assert(
    apiHealth.headers.get("x-request-id") === "proof-header-1",
    "Request ID was not echoed."
  );
  assert(
    (apiHealth.headers.get("content-security-policy") || "").includes("default-src 'none'"),
    "API CSP is missing."
  );

  const reported = await fetch(
    `${apiURL}/api/v1/restaurant/ops/client-errors`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Proof: client error monitor is receiving reports",
        stack: "Error: proof\n at verify-security-headers",
        url: `${baseURL}/dashboard`,
        user_agent: "Playwright proof",
      }),
    }
  );
  assert(reported.status === 202, `Client error report failed: ${reported.status}`);

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(portalLogin.ok, `Portal login failed: ${await portalLogin.text()}`);
  const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies(
      cookie
        .split(/;\s*/)
        .filter(Boolean)
        .map((pair) => {
          const [name, ...rest] = pair.split("=");
          return {
            name,
            value: rest.join("="),
            url: baseURL,
            httpOnly: true,
            sameSite: "Lax",
          };
        })
    );
    const page = await context.newPage();
    const cspViolations = [];
    page.on("console", (message) => {
      if (/content security policy/i.test(message.text())) {
        cspViolations.push(message.text());
      }
    });
    await page.goto(`${baseURL}/ops`, { waitUntil: "networkidle" });
    const monitor = page.getByTestId("client-error-monitor");
    await monitor.waitFor({ timeout: 30000 });
    const monitorText = await monitor.innerText();
    assert(
      /Proof: client error monitor is receiving reports/i.test(monitorText),
      `Monitor read: ${monitorText}`
    );
    assert(cspViolations.length === 0, `CSP violations: ${cspViolations.join(" | ")}`);

    await monitor.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactsDir, "visible-security-headers.png"),
      fullPage: false,
    });

    console.log("Security headers proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
