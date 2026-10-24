/* HR analytics proof: command center metrics, module links and payroll trend. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://localhost:8010";
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

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(portalLogin.ok, `Portal login failed: ${await portalLogin.text()}`);
  const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
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
    await page.goto(`${baseURL}/departments/hr`, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="department-detail"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });

    await page.getByTestId("hr-metric-headcount").waitFor({ timeout: 20000 });
    for (const metric of ["present-today", "on-leave-today", "latest-payroll"]) {
      const card = page.getByTestId(`hr-metric-${metric}`);
      await card.waitFor({ timeout: 15000 });
      assert((await card.innerText()).length > 0, `Metric ${metric} is empty.`);
    }

    const text = await page.getByTestId("department-detail").innerText();
    assert(/HR command center/i.test(text), "HR command center label missing.");
    assert(/Workforce mix/i.test(text), "Workforce panel missing.");
    assert(/Payroll trend/i.test(text), "Payroll trend panel missing.");
    assert(/Leave liability/i.test(text), "Leave liability metric missing.");
    assert(/Attrition/i.test(text), "Attrition metric missing.");

    const peopleModule = page.getByTestId("department-module-people");
    assert((await peopleModule.getAttribute("href")) === "/departments/hr/people", "People module link mismatch.");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-hr-analytics.png"),
      fullPage: false,
    });

    console.log("HR analytics proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
