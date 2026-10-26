/* Support proof: guest ticket -> staff reply/internal note -> customer follow-up. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://localhost:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");
const subject = `Cold pizza proof ${Date.now()}`;

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

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1050 } });
    const page = await context.newPage();
    await page.goto(`${baseURL}/support`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("support-name").fill("Support Proof Guest");
    await page.locator('input[type="email"]').fill("support-proof@example.com");
    await page.getByTestId("support-subject").fill(subject);
    await page
      .getByTestId("support-message")
      .fill("The pizza arrived cold and the rider could not find the gate.");
    await page.getByTestId("support-submit").click();
    await page.getByTestId("support-ticket-created").waitFor({ timeout: 30000 });
    const href = await page.getByTestId("support-ticket-link").getAttribute("href");
    assert(href && href.includes("/support/ticket/"), "Support ticket link missing.");

    const ticketPage = await context.newPage();
    await ticketPage.goto(`${baseURL}${href}`, { waitUntil: "domcontentloaded" });
    await ticketPage.getByTestId("public-support-ticket").waitFor({ timeout: 30000 });
    const publicText = await ticketPage.getByTestId("public-support-ticket").innerText();
    assert(publicText.includes("Cold pizza proof"), "Public ticket subject missing.");
    assert(
      publicText.toLowerCase().includes("arrived cold"),
      "Public ticket message missing."
    );
    assert(
      publicText.toLowerCase().includes("reply target"),
      "Public SLA target missing."
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

    const inbox = await context.newPage();
    await inbox.goto(`${baseURL}/support-inbox`, { waitUntil: "domcontentloaded" });
    await inbox
      .locator('[data-testid="support-inbox-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    await inbox.getByText(subject, { exact: false }).first().click();
    await inbox.getByTestId("support-inbox-reply").fill(
      "We are sorry about that. The kitchen lead is checking the dispatch time."
    );
    await inbox.getByTestId("support-inbox-send").click();
    await inbox.getByText("Reply saved.", { exact: false }).waitFor({ timeout: 30000 });
    await inbox.getByTestId("support-sla-summary").waitFor({ timeout: 20000 });
    await inbox.getByTestId("support-run-sla-check").click();
    await inbox.waitForTimeout(800);
    const slaText = await inbox.getByTestId("support-sla-summary").innerText();
    assert(slaText.toLowerCase().includes("overdue"), "SLA summary missing overdue count.");
    assert(
      slaText.toLowerCase().includes("avg first reply"),
      "SLA summary missing first-reply average."
    );
    await inbox.getByTestId("support-sla-policy-button").click();
    await inbox.getByTestId("support-sla-policy-modal").waitFor({ timeout: 10000 });
    const policyText = await inbox.getByTestId("support-sla-policy-modal").innerText();
    assert(
      policyText.toLowerCase().includes("first reply"),
      "SLA policy modal missing response targets."
    );
    await inbox.getByLabel("Close SLA policy").click();

    const statusUpdate = inbox.waitForResponse(
      (response) =>
        response.url().includes(`/tickets/`) &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
      { timeout: 20000 }
    );
    await inbox.getByLabel("Ticket status").selectOption("resolved");
    await statusUpdate;
    await inbox.screenshot({
      path: path.join(artifactsDir, "visible-support-inbox.png"),
      fullPage: false,
    });

    await ticketPage.reload({ waitUntil: "domcontentloaded" });
    await ticketPage.getByTestId("public-support-ticket").waitFor({ timeout: 30000 });
    const repliedText = await ticketPage.getByTestId("public-support-ticket").innerText();
    const pageText = await ticketPage.locator("body").innerText();
    assert(
      repliedText.toLowerCase().includes("kitchen lead"),
      "Staff reply missing from the public thread."
    );
    assert(
      pageText.toLowerCase().includes("resolved"),
      "Resolved status missing."
    );

    await ticketPage.getByTestId("support-reply-body").fill("Thanks, that explains it.");
    await ticketPage.getByTestId("support-reply-submit").click();
    await ticketPage.getByText("Thanks, that explains it.", { exact: false }).waitFor({
      timeout: 30000,
    });

    console.log("Support ticket proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
