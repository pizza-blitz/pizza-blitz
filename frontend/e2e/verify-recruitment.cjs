/* Recruitment proof: job + applicant -> board -> interview/offer -> hire -> onboarding. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://localhost:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");
const jobTitle = `Proof Line Chef ${Date.now()}`;

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
      department: "Kitchen",
      location: "Kolkata",
      employment_type: "full_time",
      description: "Proof job for the recruitment pipeline.",
      openings: 1,
      status: "open",
    }),
  });
  const job = await jobResponse.json();
  assert(jobResponse.ok, `Job create failed: ${JSON.stringify(job)}`);

  const applicationResponse = await fetch(
    `${apiURL}/api/v1/restaurant/hr/recruitment/applications`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        job_id: job.job.id,
        candidate_name: "Recruitment Proof Candidate",
        email: `recruitment-proof-${Date.now()}@pizza-blitz.test`,
        phone: "919822223333",
        source: "proof",
        expected_salary: 32000,
      }),
    }
  );
  const application = await applicationResponse.json();
  assert(
    applicationResponse.ok,
    `Application create failed: ${JSON.stringify(application)}`
  );
  const applicationId = application.application.id;

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
    await page.goto(`${baseURL}/departments/hr/recruitment`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('[data-testid="hr-recruitment-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });

    const jobCard = page.getByTestId(`recruitment-job-${job.job.id}`);
    await jobCard.waitFor({ timeout: 20000 });
    await jobCard.click();
    const candidate = page.getByTestId(`recruitment-candidate-${applicationId}`);
    await candidate.waitFor({ timeout: 20000 });
    await candidate.click();

    for (const stage of ["screening", "interview", "offer"]) {
      await page.getByTestId(`recruitment-stage-${stage}`).click();
      await page.getByText(`Candidate moved to ${stage}`, { exact: false }).waitFor({
        timeout: 20000,
      });
    }
    await page.getByTestId("recruitment-stage-hired").click();
    await page.getByText("handed off to onboarding candidate", { exact: false }).waitFor({
      timeout: 20000,
    });

    const detail = await fetch(
      `${apiURL}/api/v1/restaurant/hr/recruitment/applications/${applicationId}`,
      { headers }
    ).then((response) => response.json());
    assert(detail.application.stage === "hired", "Application was not hired.");
    assert(
      detail.application.onboarding_candidate_id,
      "Onboarding candidate was not created."
    );

    const pageText = await page.getByTestId("hr-recruitment-page").innerText();
    assert(pageText.includes("Onboarding candidate #"), "Onboarding handoff missing in UI.");
    assert(pageText.includes("hired"), "Hired stage missing in UI.");
    await page.screenshot({
      path: path.join(artifactsDir, "visible-recruitment.png"),
      fullPage: false,
    });

    console.log("Recruitment proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
