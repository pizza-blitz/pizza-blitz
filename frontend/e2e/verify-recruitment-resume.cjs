/* Resume + scorecard proof: public upload -> parsed profile -> interview score. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://localhost:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");
const jobTitle = `Resume Proof Chef ${Date.now()}`;
const resume = Buffer.from(
  "Riya Sharma\nriya.resume@example.com\n+91 98765 43210\nPizza chef with food safety, kitchen inventory and customer service experience.\n",
  "utf8"
);

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
  const job = await fetch(`${apiURL}/api/v1/restaurant/hr/recruitment/jobs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: jobTitle,
      department: "Kitchen",
      location: "Kolkata",
      status: "open",
      description: "Pizza chef role for the resume proof.",
    }),
  }).then((response) => response.json());

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
    const page = await context.newPage();
    await page.goto(`${baseURL}/careers/${job.job.id}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("career-name").fill("Riya Sharma");
    await page.locator('input[type="file"]').setInputFiles({
      name: "riya-resume.txt",
      mimeType: "text/plain",
      buffer: resume,
    });
    await page.getByTestId("career-submit").click();
    await page.getByTestId("career-application-success").waitFor({ timeout: 30000 });

    const applications = await fetch(
      `${apiURL}/api/v1/restaurant/hr/recruitment/applications?job_id=${job.job.id}`,
      { headers }
    ).then((response) => response.json());
    const application = applications.applications.find(
      (row) => row.candidate_name === "Riya Sharma"
    );
    assert(application, "Resume application did not reach the pipeline.");
    const detail = await fetch(
      `${apiURL}/api/v1/restaurant/hr/recruitment/applications/${application.id}`,
      { headers }
    ).then((response) => response.json());
    assert(
      detail.application.email === "riya.resume@example.com",
      "Parsed email was not saved."
    );
    assert(
      detail.application.resume.parsed.skills.includes("pizza"),
      "Resume skills were not parsed."
    );

    const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
    });
    const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));
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

    await page.goto(`${baseURL}/departments/hr/recruitment`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('[data-testid="hr-recruitment-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    await page.getByTestId(`recruitment-job-${job.job.id}`).click();
    await page.getByTestId(`recruitment-candidate-${application.id}`).click();
    const drawer = page.getByTestId("recruitment-drawer");
    await drawer.getByText("riya-resume.txt", { exact: false }).waitFor({
      timeout: 20000,
    });
    assert((await drawer.innerText()).includes("pizza"), "Parsed resume skills missing.");

    await drawer.locator('input[type="datetime-local"]').fill("2026-12-05T10:00");
    const interviewResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/interviews") &&
        response.request().method() === "POST" &&
        response.status() === 201,
      { timeout: 20000 }
    );
    await drawer.getByRole("button", { name: "Add", exact: true }).click();
    await interviewResponse;
    await page.getByLabel(/Score interview/).first().waitFor({ timeout: 20000 });
    const interview = await fetch(
      `${apiURL}/api/v1/restaurant/hr/recruitment/applications/${application.id}`,
      { headers }
    ).then((response) => response.json());
    const interviewId = interview.application.interviews[0].id;

    await page.getByLabel(`Score interview ${interviewId}`).selectOption("4");
    await page.getByText("Interview scorecard saved", { exact: false }).waitFor({
      timeout: 20000,
    });
    await page
      .getByLabel(`Recommendation interview ${interviewId}`)
      .selectOption("strong_yes");
    await page.getByText("Interview scorecard saved", { exact: false }).waitFor({
      timeout: 20000,
    });

    const scored = await fetch(
      `${apiURL}/api/v1/restaurant/hr/recruitment/applications/${application.id}`,
      { headers }
    ).then((response) => response.json());
    assert(scored.application.interviews[0].score === 4, "Interview score was not saved.");
    assert(
      scored.application.interviews[0].recommendation === "strong_yes",
      "Recommendation was not saved."
    );

    await page.screenshot({
      path: path.join(artifactsDir, "visible-recruitment-resume.png"),
      fullPage: false,
    });

    console.log("Recruitment resume proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
