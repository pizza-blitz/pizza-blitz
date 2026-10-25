/* Offer letter proof: generate -> secure public page -> accept -> hired/onboarding. */
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

  const login = await fetch(`${apiURL}/api/v1/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  }).then((response) => response.json());
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${login.access_token}`,
  };
  const job = await fetch(`${apiURL}/api/v1/restaurant/hr/recruitment/jobs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: `Offer Proof Chef ${Date.now()}`,
      department: "Kitchen",
      location: "Kolkata",
      status: "open",
      offer_approvals_required: true,
    }),
  }).then((response) => response.json());
  const template = await fetch(
    `${apiURL}/api/v1/restaurant/hr/recruitment/offer-templates`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: `Chef terms ${Date.now()}`,
        body: "Proof terms: probation is 90 days and the notice period is 30 days.",
        is_default: true,
      }),
    }
  ).then((response) => response.json());
  const application = await fetch(
    `${apiURL}/api/v1/restaurant/hr/recruitment/applications`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        job_id: job.job.id,
        candidate_name: "Ananya Offer",
        email: `ananya-${Date.now()}@example.com`,
      }),
    }
  ).then((response) => response.json());
  const applicationId = application.application.id;
  for (const stage of ["screening", "interview"]) {
    const response = await fetch(
      `${apiURL}/api/v1/restaurant/hr/recruitment/applications/${applicationId}/stage`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ stage, note: `Move to ${stage}.` }),
      }
    );
    assert(response.ok, `Stage ${stage} failed: ${await response.text()}`);
  }
  const offerStage = await fetch(
    `${apiURL}/api/v1/restaurant/hr/recruitment/applications/${applicationId}/stage`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        stage: "offer",
        note: "Offer approved.",
        offered_salary: 38000,
        joining_date: "2026-12-20",
      }),
    }
  );
  assert(offerStage.ok, `Offer stage failed: ${await offerStage.text()}`);

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(portalLogin.ok, "Portal login failed.");
  const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1050 } });
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
    await page.getByTestId(`recruitment-job-${job.job.id}`).click();
    await page.getByTestId(`recruitment-candidate-${applicationId}`).click();
    const approvalRequest = page.waitForResponse(
      (response) =>
        response.url().includes("/offer/approvals") &&
        response.request().method() === "POST" &&
        response.status() === 200,
      { timeout: 20000 }
    );
    await page.getByTestId("recruitment-request-approvals").click();
    await approvalRequest;
    await page.getByTestId("recruitment-offer-approvals").waitFor({ timeout: 20000 });
    const approvalDetail = await fetch(
      `${apiURL}/api/v1/restaurant/hr/recruitment/applications/${applicationId}`,
      { headers }
    ).then((response) => response.json());
    const approvals = approvalDetail.application.offer_approvals || [];
    assert(approvals.length === 2, "Two approval steps were not created.");
    for (const approval of approvals) {
      page.once("dialog", (dialog) => void dialog.accept("Approved in proof"));
      await page.getByTestId(`recruitment-approve-${approval.id}`).click();
      await page.getByText("Approval step approved", { exact: false }).waitFor({
        timeout: 20000,
      });
    }
    await page
      .getByTestId("recruitment-offer-template")
      .selectOption(String(template.template.id));
    await page.getByTestId("recruitment-generate-offer").click();
    const link = page.getByTestId("recruitment-offer-link");
    await link.waitFor({ timeout: 30000 });
    const offerUrl = await link.getAttribute("href");
    assert(offerUrl && offerUrl.includes("/offer/"), "Offer link was not generated.");

    page.once("dialog", (dialog) => void dialog.accept("People Lead"));
    await page.getByTestId("recruitment-countersign-offer").click();
    await page.getByText("Offer countersigned by People Lead", { exact: false }).waitFor({
      timeout: 30000,
    });
    await page.getByTestId("recruitment-send-offer").click();
    await page.getByText("Email not sent", { exact: false }).waitFor({
      timeout: 30000,
    });

    const offerPage = await context.newPage();
    await offerPage.goto(offerUrl, { waitUntil: "domcontentloaded" });
    await offerPage.getByTestId("public-offer").waitFor({ timeout: 30000 });
    const offerText = await offerPage.getByTestId("public-offer").innerText();
    assert(
      offerText.toLowerCase().includes("offer of employment"),
      "Offer page header missing."
    );
    assert(offerText.includes("Ananya Offer"), "Candidate name missing.");
    assert(offerText.includes("38,000"), "Offered salary missing.");
    assert(
      offerText.toLowerCase().includes("probation is 90 days"),
      "Offer template terms missing from public offer."
    );
    assert(
      offerText.includes("Countersigned for Pizza Blitz by People Lead"),
      "Countersignature missing from public offer."
    );
    await offerPage.screenshot({
      path: path.join(artifactsDir, "visible-offer-letter.png"),
      fullPage: false,
    });

    await offerPage.getByTestId("offer-signed-name").fill("Ananya Offer");
    await offerPage.getByTestId("offer-submit").click();
    await offerPage.getByText("Offer accepted. Your onboarding", { exact: false }).waitFor({
      timeout: 30000,
    });

    const detail = await fetch(
      `${apiURL}/api/v1/restaurant/hr/recruitment/applications/${applicationId}`,
      { headers }
    ).then((response) => response.json());
    assert(detail.application.stage === "hired", "Candidate was not marked hired.");
    assert(
      detail.application.offer.status === "accepted",
      "Offer acceptance was not recorded."
    );
    assert(
      detail.application.offer.signed_name === "Ananya Offer",
      "Electronic signature was not recorded."
    );
    assert(
      detail.application.onboarding_candidate_id,
      "Onboarding handoff was not created."
    );

    console.log("Offer letter proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
