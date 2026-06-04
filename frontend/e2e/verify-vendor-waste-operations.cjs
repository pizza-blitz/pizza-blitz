const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, label) {
  const startedAt = Date.now();
  let lastError = "";

  while (Date.now() - startedAt < 30000) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok || response.status === 401 || response.status === 403) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(750);
  }

  throw new Error(`${label} did not become ready at ${url}: ${lastError}`);
}

function createBrowserWatch(page) {
  const issues = [];
  const dialogs = [];

  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss().catch(() => undefined);
  });
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico/i.test(text)) return;
    if (/Failed to fetch RSC payload/i.test(text) && /Falling back to browser navigation/i.test(text)) return;
    issues.push(`console error: ${text}`);
  });

  return {
    assertClean(label) {
      assert(!dialogs.length, `${label} triggered blocking dialog(s): ${dialogs.join(" | ")}`);
      assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
    },
  };
}

async function signInAsAdmin(context) {
  const response = await context.request.post(`${baseURL}/api/admin-session`, {
    data: { id: adminId, password: adminPassword, role: "admin" },
  });
  assert(response.ok(), `Admin browser login failed: ${await response.text()}`);
}

function vendorHistory(itemName) {
  if (/mozzarella/i.test(itemName)) {
    return [
      {
        id: 11,
        vendor_id: 1,
        vendor_name: "Prime Dairy",
        item_name: "Mozzarella",
        recorded_date: "2026-06-03",
        price_per_unit: 310,
        unit: "kg",
      },
      {
        id: 12,
        vendor_id: 2,
        vendor_name: "Value Dairy",
        item_name: "Mozzarella",
        recorded_date: "2026-06-04",
        price_per_unit: 295,
        unit: "kg",
      },
    ];
  }

  return [
    {
      id: 7,
      vendor_id: 3,
      vendor_name: "Sauce House",
      item_name: "Tomato Sauce",
      recorded_date: "2026-06-02",
      price_per_unit: 88,
      unit: "kg",
    },
  ];
}

async function installVendorFixtures(context) {
  const requests = [];

  await context.route("**/api/v1/restaurant/vendors/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    await sleep(250);

    if (url.pathname.endsWith("/prices/alerts/increases")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            item_name: "Cheese",
            vendor_name: "Prime Dairy",
            prev_price: 280,
            price_per_unit: 310,
            pct_increase: 10.7,
          },
        ]),
      });
      return;
    }

    if (url.pathname.endsWith("/prices/recent")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 7,
            vendor_name: "Sauce House",
            item_name: "Tomato Sauce",
            recorded_date: "2026-06-02",
            price_per_unit: 88,
            unit: "kg",
          },
        ]),
      });
      return;
    }

    const historyMatch = url.pathname.match(/\/prices\/history\/(.+)$/);
    if (historyMatch) {
      const itemName = decodeURIComponent(historyMatch[1]);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(vendorHistory(itemName)),
      });
      return;
    }

    const cheapestMatch = url.pathname.match(/\/intelligence\/cheapest\/(.+)$/);
    if (cheapestMatch) {
      const itemName = decodeURIComponent(cheapestMatch[1]);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          vendorHistory(itemName)
            .map((row) => ({
              vendor_name: row.vendor_name,
              price_per_unit: row.price_per_unit,
              unit: row.unit,
            }))
            .sort((a, b) => a.price_per_unit - b.price_per_unit)
        ),
      });
      return;
    }

    await route.fallback();
  });

  return { requests };
}

async function installWasteFixtures(context) {
  const requests = [];
  const wasteRows = [];
  let postMode = "success";

  function summary() {
    const total = wasteRows.reduce((sum, row) => sum + Number(row.estimated_cost || 0), 0);
    return {
      total_waste_cost: total,
      count: wasteRows.length,
      top_items: wasteRows.map((row) => ({
        item_name: row.item_name,
        cost: row.estimated_cost,
        percentage: total ? Math.round((row.estimated_cost / total) * 1000) / 10 : 0,
      })),
    };
  }

  await context.route("**/api/v1/restaurant/sales/waste**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(`${request.method()} ${url.pathname}`);
    await sleep(request.method() === "POST" ? 1000 : 250);

    if (request.method() === "GET" && url.pathname.endsWith("/waste/summary")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(summary()),
      });
      return;
    }

    if (request.method() === "GET" && url.pathname.endsWith("/waste")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(wasteRows),
      });
      return;
    }

    if (request.method() === "POST" && url.pathname.endsWith("/waste")) {
      if (postMode === "error") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Waste log service is unavailable for this proof." }),
        });
        return;
      }

      const payload = request.postDataJSON();
      const row = { id: "proof-waste-1", ...payload };
      wasteRows.unshift(row);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(row),
      });
      return;
    }

    await route.fallback();
  });

  return {
    requests,
    setPostMode(nextMode) {
      postMode = nextMode;
    },
  };
}

async function verifyVendors(page) {
  const response = await page.goto(`${baseURL}/vendors`, { waitUntil: "domcontentloaded" });
  assert(response && response.ok(), `/vendors returned HTTP ${response?.status() || "no response"}.`);
  await page.getByRole("heading", { name: "Vendor Price Intelligence" }).waitFor({ timeout: 15000 });
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  await sleep(500);
  await page.getByText("Vendor comparison loaded for Tomato Sauce: 1 price point and 1 vendor option.", {
    exact: true,
  }).waitFor({ timeout: 15000 });

  await page.getByLabel("Vendor item search", { exact: true }).fill("Mozzarella");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await page.getByRole("button", { name: "Analyzing", exact: true }).waitFor({ timeout: 15000 });
  await page.getByText("Vendor comparison loaded for Mozzarella: 2 price points and 2 vendor options.", {
    exact: true,
  }).waitFor({ timeout: 15000 });
  await page.getByText("Best current price", { exact: true }).waitFor({ timeout: 15000 });
  await page.getByText("Value Dairy", { exact: true }).waitFor({ timeout: 15000 });
  await page.getByText("Rs. 295", { exact: true }).waitFor({ timeout: 15000 });
}

async function verifyWaste(page, fixtures) {
  const response = await page.goto(`${baseURL}/waste`, { waitUntil: "domcontentloaded" });
  assert(response && response.ok(), `/waste returned HTTP ${response?.status() || "no response"}.`);
  await page.getByRole("heading", { name: "Waste Management" }).waitFor({ timeout: 15000 });
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  await sleep(500);

  await page.getByLabel("Waste item name", { exact: true }).fill("Proof Dough");
  await page.getByLabel("Waste quantity", { exact: true }).fill("2");
  await page.getByLabel("Estimated waste cost", { exact: true }).fill("180");
  await page.getByLabel("Reason for waste", { exact: true }).fill("Proof overproofed batch");
  await page.getByRole("button", { name: "Commit to Waste Log", exact: true }).click();
  await page.getByRole("button", { name: /Saving Waste Entry/i }).waitFor({ timeout: 15000 });
  await page.getByText("Proof Dough logged to waste audit for Rs 180.", { exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole("cell", { name: "Proof Dough", exact: true }).waitFor({ timeout: 15000 });
  await page.getByText("Rs 180", { exact: true }).first().waitFor({ timeout: 15000 });

  fixtures.setPostMode("error");
  await page.getByLabel("Waste item name", { exact: true }).fill("Proof Sauce");
  await page.getByLabel("Waste quantity", { exact: true }).fill("1");
  await page.getByLabel("Estimated waste cost", { exact: true }).fill("90");
  await page.getByLabel("Reason for waste", { exact: true }).fill("Proof failed save path");
  await page.getByRole("button", { name: "Commit to Waste Log", exact: true }).click();
  await page.getByRole("alert").getByText("Waste log service is unavailable for this proof.", { exact: true }).waitFor({
    timeout: 15000,
  });
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1050 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    await signInAsAdmin(context);
    const vendorFixtures = await installVendorFixtures(context);
    const wasteFixtures = await installWasteFixtures(context);

    await verifyVendors(page);
    await verifyWaste(page, wasteFixtures);
    watch.assertClean("vendor and waste operations");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-vendor-waste-operations.png"),
      fullPage: true,
    });

    const artifact = {
      checkedAt: new Date().toISOString(),
      baseURL,
      vendorRequestCount: vendorFixtures.requests.length,
      wasteRequestCount: wasteFixtures.requests.length,
      proofs: [
        "Vendor Analyze shows loading and success feedback with cheapest-vendor results.",
        "Waste Commit shows saving state, success feedback and a new audit-table row.",
        "Waste API failure preserves backend detail in an inline alert without a blocking dialog.",
      ],
    };
    fs.writeFileSync(
      path.join(artifactsDir, "vendor-waste-operations.json"),
      `${JSON.stringify(artifact, null, 2)}\n`
    );

    console.log("Vendor and waste operations proof passed.");
  } catch (error) {
    const debugArtifact = {
      checkedAt: new Date().toISOString(),
      baseURL,
      bodyText: await page.locator("body").innerText().catch(() => ""),
      buttonTexts: await page.locator("button").allTextContents().catch(() => []),
    };
    fs.writeFileSync(
      path.join(artifactsDir, "vendor-waste-operations-debug.json"),
      `${JSON.stringify(debugArtifact, null, 2)}\n`
    );
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
