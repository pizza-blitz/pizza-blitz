/* HR onboarding proof: candidate, checklist, conversion to employee. */
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

async function api(token, endpoint, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const login = await api(null, "/api/v1/auth/admin/login", {
    method: "POST",
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  });
  assert(login.response.ok, "Admin login failed.");
  const token = login.data.access_token;
  const stamp = Date.now();
  const email = `onboard-proof-${stamp}@example.com`;

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(portalLogin.ok, `Portal login failed: ${await portalLogin.text()}`);
  const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));

  let employeeId = null;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
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
    await page.goto(`${baseURL}/departments/hr/onboarding`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('[data-testid="hr-onboarding-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });

    await page.getByTestId("onboarding-create-open").click();
    await page.getByTestId("onboarding-create-form").waitFor({ timeout: 15000 });
    await page.getByTestId("onboarding-name").fill("Onboarding Proof Chef");
    await page.getByTestId("onboarding-email").fill(email);
    await page.getByTestId("onboarding-date").fill("2026-12-01");
    await page.getByTestId("onboarding-create-submit").click();
    await page.getByTestId("onboarding-detail").waitFor({ timeout: 20000 });

    const candidates = await api(
      token,
      "/api/v1/restaurant/hr/onboarding/candidates"
    );
    const candidate = (candidates.data.candidates || []).find(
      (row) => row.email === email
    );
    assert(candidate, "Candidate was not created.");
    for (const task of candidate.tasks) {
      await page.getByTestId(`onboarding-task-${task.id}`).click();
      await page
        .getByLabel(`Reopen ${task.title}`)
        .waitFor({ timeout: 15000 });
    }
    let completed = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const detail = await api(
        token,
        `/api/v1/restaurant/hr/onboarding/candidates/${candidate.id}`
      );
      if (detail.data.progress === 100) {
        completed = detail.data;
        break;
      }
      await page.waitForTimeout(500);
    }
    assert(completed, "Checklist did not reach 100%.");
    await page
      .waitForFunction(
        () => {
          const button = document.querySelector(
            '[data-testid="onboarding-convert"]'
          );
          return button && !button.disabled;
        },
        null,
        { timeout: 20000 }
      )
      .catch(() => {});
    const convert = page.getByTestId("onboarding-convert");
    await convert.waitFor({ timeout: 15000 });
    assert(await convert.isEnabled(), "Convert button did not enable after checklist.");

    await convert.click();
    await page.getByText("joined as", { exact: false }).waitFor({ timeout: 20000 });
    const detail = await page.getByTestId("onboarding-detail").innerText();
    assert(/Employee created/i.test(detail), "Joined state missing.");
    await page.screenshot({
      path: path.join(artifactsDir, "visible-hr-onboarding.png"),
      fullPage: false,
    });

    const employees = await api(
      token,
      "/api/v1/restaurant/hr/employees?q=Onboarding%20Proof%20Chef"
    );
    const employee = (employees.data.employees || [])[0];
    assert(employee, "Converted employee not found.");
    employeeId = employee.id;

    console.log("HR onboarding proof passed.");
  } finally {
    if (employeeId) {
      await api(token, `/api/v1/restaurant/hr/employees/${employeeId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "exited", notes: "Proof cleanup" }),
      }).catch(() => {});
    }
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
