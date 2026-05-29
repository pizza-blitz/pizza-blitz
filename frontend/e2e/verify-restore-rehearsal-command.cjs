const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
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

    await page.goto(`${baseURL}/ops`, { waitUntil: "domcontentloaded" });
    const command = page.getByTestId("restore-rehearsal-proof-command");
    await command.waitFor({ timeout: 45000 });
    await command.getByText("Restore Rehearsal Command", { exact: false }).waitFor({ timeout: 10000 });
    await command.getByText("Proof Notes Template", { exact: false }).waitFor({ timeout: 10000 });
    await command.getByText("Admin login smoke", { exact: true }).waitFor({ timeout: 10000 });
    await command.getByText("Order flow smoke", { exact: true }).waitFor({ timeout: 10000 });
    await command.getByText("Report/export smoke", { exact: true }).waitFor({ timeout: 10000 });

    const readinessResponse = await context.request.get("/server/api/v1/restaurant/ops/readiness");
    const readinessData = await readinessResponse.json();
    assert(readinessResponse.ok(), `Readiness API failed: ${JSON.stringify(readinessData)}`);
    assert(
      readinessData.restore_rehearsal_command?.evidence_requirements?.length >= 5,
      "Restore rehearsal command did not include the required evidence checklist."
    );

    const weakProofResponse = await context.request.post("/server/api/v1/restaurant/ops/backups/proof", {
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

    console.log("restore-rehearsal-command verification passed with strict weak-proof rejection");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
