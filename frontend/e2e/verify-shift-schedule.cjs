/* Workforce proof: schedule a shift, see labour cost and confirm it. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
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

function businessToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
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
    await page.goto(`${baseURL}/shifts/schedule`, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="schedule-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });

    await page.getByTestId("schedule-staff").fill("Proof Chef");
    await page.getByTestId("schedule-role").selectOption("Kitchen / Oven");
    await page.getByLabel("Scheduled shift date").fill(businessToday());
    await page.getByLabel("Scheduled shift start").fill("11:00");
    await page.getByLabel("Scheduled shift end").fill("15:00");
    await page.getByTestId("schedule-rate").fill("200");
    await page.getByTestId("schedule-create").click();

    const card = page
      .locator('[data-testid^="scheduled-shift-"]')
      .filter({ hasText: "Proof Chef" })
      .first();
    await card.waitFor({ timeout: 25000 });
    const cardText = await card.innerText();
    assert(cardText.includes("4h"), `Shift card read "${cardText}".`);
    assert(/Rs 800/.test(cardText), `Shift cost read "${cardText}".`);

    const costText = await page.getByTestId("labour-cost").innerText();
    const costValue = Number(costText.replace(/[^0-9.]/g, ""));
    assert(costValue >= 800, `Labour cost read "${costText}".`);

    const hoursText = await page.getByTestId("labour-hours").innerText();
    assert(Number(hoursText) >= 4, `Labour hours read "${hoursText}".`);

    await page.screenshot({
      path: path.join(artifactsDir, "visible-shift-schedule.png"),
      fullPage: false,
    });

    await card.getByRole("button", { name: /Confirm Proof Chef/i }).click();
    await page.waitForFunction(
      () => {
        const element = [...document.querySelectorAll('[data-testid^="scheduled-shift-"]')].find(
          (node) => (node.innerText || "").includes("Proof Chef")
        );
        return element ? /confirmed/i.test(element.innerText || "") : false;
      },
      null,
      { timeout: 20000 }
    );

    await page
      .locator('[data-testid^="scheduled-shift-"]')
      .filter({ hasText: "Proof Chef" })
      .first()
      .getByRole("button", { name: /Delete Proof Chef/i })
      .click();
    await page.getByText("Scheduled shift removed.").waitFor({ timeout: 15000 });

    console.log("Workforce proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
