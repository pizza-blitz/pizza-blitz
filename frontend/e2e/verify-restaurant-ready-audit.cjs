const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || `${baseURL}/server`;
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
    const audit = page.getByTestId("restaurant-ready-audit");
    await audit.waitFor({ timeout: 30000 });
    await audit.getByText("100% Restaurant Readiness Tracker", { exact: false }).waitFor({ timeout: 10000 });

    const expectedLabels = [
      "Counter POS Order Taking",
      "Kitchen Station And KOT Flow",
      "Employee Attendance, CL/PL And Role Coverage",
      "Cashfree / Direct Bank Payment Settlement",
      "Owner/Admin And Production Controls",
      "Customer Website Ordering And Checkout",
      "Delivery Charges, Zones And Assignment",
    ];

    for (const label of expectedLabels) {
      await audit.getByText(label, { exact: false }).waitFor({ timeout: 10000 });
    }

    const bodyText = await audit.innerText();
    assert(/Score\s+\d+%/i.test(bodyText), "Restaurant ready audit did not render a score.");
    assert(/Ready\s+\d+/i.test(bodyText), "Restaurant ready audit did not render ready count.");
    assert(/Attention\s+\d+/i.test(bodyText), "Restaurant ready audit did not render attention count.");

    const apiAudit = await page.evaluate(async (readinessUrl) => {
      const response = await fetch(readinessUrl, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await response.json();
      return { ok: response.ok, status: response.status, data };
    }, `${apiURL}/api/v1/restaurant/ops/readiness`);
    assert(apiAudit.ok, `Readiness API failed with ${apiAudit.status}: ${JSON.stringify(apiAudit.data)}`);
    assert(
      Array.isArray(apiAudit.data.restaurant_ready_audit?.requirements),
      "Readiness API did not include restaurant_ready_audit.requirements."
    );
    assert(
      apiAudit.data.restaurant_ready_audit.requirements.length >= 10,
      `Expected at least 10 restaurant requirements, got ${apiAudit.data.restaurant_ready_audit.requirements.length}.`
    );
    assert(
      typeof apiAudit.data.restaurant_ready_audit.score === "number",
      "Restaurant ready audit score is not numeric."
    );

    console.log(
      `restaurant-ready-audit verification passed with ${apiAudit.data.restaurant_ready_audit.requirements.length} requirements`
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
