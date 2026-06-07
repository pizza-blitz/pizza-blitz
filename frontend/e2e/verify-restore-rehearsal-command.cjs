const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cookieHeaderFromSetCookie(setCookie) {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie || ""];
  return values
    .flatMap((value) => value.split(/,(?=\s*pb_[^=]+=)/))
    .map((value) => value.split(";")[0].trim())
    .filter((value) => value.startsWith("pb_"))
    .join("; ");
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();

  try {
    const sessionResponse = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    const sessionData = await sessionResponse.json().catch(() => ({}));
    assert(sessionResponse.ok(), `Admin session failed: ${JSON.stringify(sessionData)}`);
    const cookie = cookieHeaderFromSetCookie(sessionResponse.headers()["set-cookie"]);
    assert(cookie.includes("pb_admin_session="), "Admin session did not return an admin cookie.");

    await page.goto(`${baseURL}/ops`, { waitUntil: "domcontentloaded" });
    const command = page.getByTestId("restore-rehearsal-proof-command");
    await command.waitFor({ timeout: 45000 });
    await command.getByText("Restore Rehearsal Command", { exact: false }).waitFor({ timeout: 10000 });
    await command.getByText("Proof Notes Template", { exact: false }).waitFor({ timeout: 10000 });
    await command.getByText("Admin login smoke", { exact: true }).waitFor({ timeout: 10000 });
    await command.getByText("Order flow smoke", { exact: true }).waitFor({ timeout: 10000 });
    await command.getByText("Report/export smoke", { exact: true }).waitFor({ timeout: 10000 });

    const readinessResponse = await context.request.get(`${apiURL}/api/v1/restaurant/ops/readiness`, {
      headers: { Cookie: cookie },
    });
    const readinessData = await readinessResponse.json();
    assert(readinessResponse.ok(), `Readiness API failed: ${JSON.stringify(readinessData)}`);
    assert(
      readinessData.restore_rehearsal_command?.evidence_requirements?.length >= 5,
      "Restore rehearsal command did not include the required evidence checklist."
    );

    const weakProofResponse = await context.request.post(`${apiURL}/api/v1/restaurant/ops/backups/proof`, {
      headers: { Cookie: cookie },
      data: {
        proof_type: "restore_rehearsal",
        reference: "restore-weak-proof",
        notes: "done",
      },
    });
    const weakProofData = await weakProofResponse.json().catch(() => ({}));
    assert(
      weakProofResponse.status() === 422,
      `Weak restore proof should be rejected, got ${weakProofResponse.status()}: ${JSON.stringify(weakProofData)}`
    );
    assert(
      /restore target|admin login|order smoke|report/i.test(String(weakProofData.detail || "")),
      `Weak restore proof rejection did not explain required evidence: ${JSON.stringify(weakProofData)}`
    );

    await page.getByTestId("run-restore-rehearsal").click();
    const restoreMessage = page.getByTestId("ops-message");
    await page.waitForTimeout(5000);
    let restoreMessageText = (await restoreMessage.textContent().catch(() => "")) || "";
    if (
      !/Restore rehearsal passed|restore rehearsal could not be completed|restore proof form is ready|restore_rehearsal proof|successful SQLite backup|file-backed SQLite database|Automated restore rehearsal|managed restore/i.test(
        restoreMessageText
      )
    ) {
      await page.screenshot({
        path: path.join(artifactsDir, "visible-restore-rehearsal-command.png"),
        fullPage: true,
      });
      const buttonText = (await page.getByTestId("run-restore-rehearsal").textContent().catch(() => "")) || "";
      const bodyText = ((await page.locator("body").textContent().catch(() => "")) || "").slice(0, 1200);
      throw new Error(
        `Restore rehearsal action did not show expected inline feedback. Button="${buttonText}" Message="${restoreMessageText}" Body="${bodyText}"`
      );
    }

    const afterRunResponse = await context.request.get(`${apiURL}/api/v1/restaurant/ops/readiness`, {
      headers: { Cookie: cookie },
    });
    const afterRunData = await afterRunResponse.json();
    assert(afterRunResponse.ok(), `Readiness after restore run failed: ${JSON.stringify(afterRunData)}`);
    const restorePassed = /Restore rehearsal passed/i.test(restoreMessageText);
    if (restorePassed) {
      assert(
        afterRunData.restore_rehearsal?.status === "pass",
        `Restore rehearsal status did not become pass: ${JSON.stringify(afterRunData.restore_rehearsal)}`
      );
      assert(
        afterRunData.restore_rehearsal_command?.summary?.restore_status === "pass",
        `Restore command summary did not become pass: ${JSON.stringify(afterRunData.restore_rehearsal_command?.summary)}`
      );
    } else {
      assert(
        /restore|backup|managed|proof/i.test(restoreMessageText),
        `Restore rehearsal blocker message was not specific enough: ${restoreMessageText}`
      );
      assert(
        afterRunData.restore_rehearsal_command?.evidence_requirements?.length >= 5,
        "Restore rehearsal blocker state did not keep the evidence checklist visible."
      );
    }

    await page.screenshot({
      path: path.join(artifactsDir, "visible-restore-rehearsal-command.png"),
      fullPage: true,
    });

    console.log(
      restorePassed
        ? "restore-rehearsal-command verification passed with strict weak-proof rejection and automated restore drill"
        : "restore-rehearsal-command verification passed with strict weak-proof rejection and visible restore blocker"
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
