const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
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

async function installScanFixtures(context) {
  const requests = [];
  let mode = "success";

  await context.route("**/api/v1/restaurant/ocr/scan-bill**", async (route) => {
    requests.push({ mode, url: route.request().url() });
    await sleep(500);

    if (mode === "success") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total_items_found: 2,
          updated_inventory: ["mozzarella", "basil"],
          extracted_items: [
            { item_name: "mozzarella", quantity: 4, unit: "kg", price_per_unit: 360 },
            { item_name: "basil", quantity: 12, unit: "bunch", price_per_unit: 30 },
          ],
        }),
      });
      return;
    }

    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "OCR provider is unavailable for this proof." }),
    });
  });

  return {
    requests,
    setMode(nextMode) {
      mode = nextMode;
    },
  };
}

async function uploadProofImage(page, name) {
  await page.locator('input[type="file"]').first().setInputFiles({
    name,
    mimeType: "image/png",
    buffer: Buffer.from("pizza-blitz-proof-image"),
  });
  await page.waitForFunction(
    (expectedName) => document.querySelector('input[type="file"]')?.files?.[0]?.name === expectedName,
    name,
    { timeout: 5000 }
  );
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1360, height: 1050 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    await signInAsAdmin(context);
    const fixtures = await installScanFixtures(context);

    const response = await page.goto(`${baseURL}/inventory/scan`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `/inventory/scan returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: "Scan Bill / Invoice" }).waitFor({ timeout: 15000 });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
    await sleep(500);

    await uploadProofImage(page, "vendor-bill-proof.png");
    await page.getByText("vendor-bill-proof.png ready for bill scanning.", { exact: true }).waitFor({
      timeout: 15000,
    });
    await page.getByRole("button", { name: "Scan Bill", exact: true }).click();
    await page.getByRole("button", { name: "Scanning...", exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Scan complete: 2 items extracted, 2 inventory records updated.", { exact: true }).waitFor({
      timeout: 15000,
    });
    await page.getByText("2 items extracted", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole("cell", { name: "mozzarella", exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole("cell", { name: "basil", exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Inventory updated for: mozzarella, basil", { exact: true }).waitFor({ timeout: 15000 });

    fixtures.setMode("error");
    await uploadProofImage(page, "provider-error-proof.png");
    await page.getByText("provider-error-proof.png ready for bill scanning.", { exact: true }).waitFor({
      timeout: 15000,
    });
    await page.getByRole("button", { name: "Scan Bill", exact: true }).click();
    await page.getByRole("button", { name: "Scanning...", exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole("alert").getByText("OCR provider is unavailable for this proof.", { exact: true }).waitFor({
      timeout: 15000,
    });

    assert(fixtures.requests.length === 2, `Expected 2 scan requests, got ${fixtures.requests.length}.`);
    watch.assertClean("inventory scan feedback");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-inventory-scan-feedback.png"),
      fullPage: true,
    });

    const artifact = {
      checkedAt: new Date().toISOString(),
      baseURL,
      requestCount: fixtures.requests.length,
      proofs: [
        "Uploading a bill image shows selected-file feedback before scanning.",
        "Successful OCR scan renders extracted rows and updated inventory feedback.",
        "Provider failure preserves backend detail in an inline alert without a blocking dialog.",
      ],
    };
    fs.writeFileSync(
      path.join(artifactsDir, "inventory-scan-feedback.json"),
      `${JSON.stringify(artifact, null, 2)}\n`
    );

    console.log("Inventory scan feedback proof passed.");
  } catch (error) {
    const debugArtifact = {
      checkedAt: new Date().toISOString(),
      baseURL,
      bodyText: await page.locator("body").innerText().catch(() => ""),
      uploadInputCount: await page.locator('input[type="file"]').count().catch(() => -1),
      selectedFileTextVisible: await page.getByText("vendor-bill-proof.png", { exact: false }).count().catch(() => -1),
    };
    fs.writeFileSync(
      path.join(artifactsDir, "inventory-scan-feedback-debug.json"),
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
