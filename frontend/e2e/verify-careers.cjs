/* Public careers proof: open role -> application form -> HR pipeline. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://localhost:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");
const jobTitle = `Careers Proof Host ${Date.now()}`;
const email = `careers-ui-${Date.now()}@pizza-blitz.test`;

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

  const adminToken = await fetch(`${apiURL}/api/v1/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  }).then((response) => response.json());
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${adminToken.access_token}`,
  };
  const jobResponse = await fetch(`${apiURL}/api/v1/restaurant/hr/recruitment/jobs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: jobTitle,
      department: "Service floor",
      location: "Kolkata",
      employment_type: "full_time",
      description: "Host our guests, run the counter and keep handoff smooth.",
      requirements: "Warm communication, reliable shifts and a love for pizza.",
      salary_min: 22000,
      salary_max: 28000,
      openings: 1,
      status: "open",
    }),
  });
  const job = await jobResponse.json();
  assert(jobResponse.ok, `Job create failed: ${JSON.stringify(job)}`);

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(portalLogin.ok, "Portal login failed.");
  const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));

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
    await page.goto(`${baseURL}/careers`, { waitUntil: "domcontentloaded" });
    const jobCard = page.getByTestId(`career-job-${job.job.id}`);
    await jobCard.waitFor({ timeout: 30000 });
    assert((await jobCard.innerText()).includes(jobTitle), "Job title missing from careers list.");
    await page.screenshot({
      path: path.join(artifactsDir, "visible-careers.png"),
      fullPage: false,
    });

    await jobCard.getByText("View role", { exact: false }).click();
    await page.getByTestId("career-name").waitFor({ timeout: 30000 });
    await page.getByTestId("career-name").fill("Careers UI Proof Applicant");
    await page.getByTestId("career-email").fill(email);
    await page.getByTestId("career-phone").fill("919844445555");
    await page.getByTestId("career-submit").click();
    await page.getByTestId("career-application-success").waitFor({ timeout: 20000 });

    const applications = await fetch(
      `${apiURL}/api/v1/restaurant/hr/recruitment/applications?job_id=${job.job.id}`,
      { headers }
    ).then((response) => response.json());
    const created = applications.applications.find((row) => row.email === email);
    assert(created, "Public application did not reach the recruitment pipeline.");
    assert(created.source === "Careers page", "Application source was not the careers page.");
    assert(created.stage === "applied", "New application should start in applied.");

    console.log("Careers page proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
