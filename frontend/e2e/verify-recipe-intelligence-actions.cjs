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

async function installRecipeFixtures(context) {
  const requests = [];
  const recipes = [
    {
      id: "1",
      menu_item: "Classic Margherita",
      ingredients: [
        { name: "Dough Ball", quantity: 180, unit: "gm" },
        { name: "Mozzarella", quantity: 80, unit: "gm" },
      ],
    },
  ];
  let saveMode = "success";
  let predictionMode = "success";

  await context.route("**/api/v1/restaurant/recipes**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname.replace(/\/$/, "");
    requests.push(`${request.method()} ${pathname}`);

    if (pathname.endsWith("/next-day-prediction")) {
      await sleep(600);
      if (predictionMode === "error") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Prediction service is unavailable for this proof." }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          predictions: [
            { ingredient_name: "Dough Ball", total_required: 1800, unit: "gm", confidence: 0.81 },
            { ingredient_name: "Mozzarella", total_required: 800, unit: "gm", confidence: 0.74 },
          ],
        }),
      });
      return;
    }

    if (request.method() === "GET") {
      await sleep(250);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(recipes),
      });
      return;
    }

    if (request.method() === "POST") {
      await sleep(800);
      if (saveMode === "error") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Recipe save service is unavailable for this proof." }),
        });
        return;
      }

      const payload = request.postDataJSON();
      const row = { id: "proof-recipe-2", ...payload };
      const existingIndex = recipes.findIndex((recipe) => recipe.menu_item === row.menu_item);
      if (existingIndex >= 0) recipes[existingIndex] = row;
      else recipes.unshift(row);
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
    setSaveMode(nextMode) {
      saveMode = nextMode;
    },
    setPredictionMode(nextMode) {
      predictionMode = nextMode;
    },
  };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1100 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    await signInAsAdmin(context);
    const fixtures = await installRecipeFixtures(context);

    const response = await page.goto(`${baseURL}/recipes`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `/recipes returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: "Recipe Intelligence" }).waitFor({ timeout: 15000 });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
    await sleep(500);
    await page.getByText("Classic Margherita", { exact: true }).waitFor({ timeout: 15000 });

    await page.getByRole("button", { name: "Add Component", exact: true }).click();
    await page.getByLabel("Ingredient 2 name", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Remove ingredient 2", exact: true }).click();
    assert(
      (await page.getByLabel("Ingredient 2 name", { exact: true }).count()) === 0,
      "Remove ingredient did not remove the second ingredient row."
    );

    await page.getByRole("button", { name: "Add Component", exact: true }).click();
    await page.getByLabel("Recipe menu item", { exact: true }).fill("Proof Veg Supreme");
    await page.getByLabel("Ingredient 1 name", { exact: true }).fill("Proof Dough");
    await page.getByLabel("Quantity for ingredient 1", { exact: true }).fill("220");
    await page.getByLabel("Unit for ingredient 1", { exact: true }).selectOption("gm");
    await page.getByLabel("Ingredient 2 name", { exact: true }).fill("Proof Cheese");
    await page.getByLabel("Quantity for ingredient 2", { exact: true }).fill("90");
    await page.getByLabel("Unit for ingredient 2", { exact: true }).selectOption("gm");
    await page.getByRole("button", { name: "Register Recipe", exact: true }).click();
    await page.getByText("Saving master recipe...", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Proof Veg Supreme recipe saved with 2 ingredients.", { exact: true }).waitFor({
      timeout: 15000,
    });
    await page.getByText("Proof Veg Supreme", { exact: true }).waitFor({ timeout: 15000 });

    await page.getByRole("button", { name: "Run Predictive Analytics", exact: true }).click();
    await page.getByText("Running prep prediction...", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Prep prediction ready with 2 ingredient forecasts.", { exact: true }).waitFor({
      timeout: 15000,
    });
    await page.getByText("Dough Ball", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("1800", { exact: true }).waitFor({ timeout: 15000 });

    fixtures.setSaveMode("error");
    await page.getByLabel("Recipe menu item", { exact: true }).fill("Proof Failed Recipe");
    await page.getByLabel("Ingredient 1 name", { exact: true }).fill("Proof Sauce");
    await page.getByLabel("Quantity for ingredient 1", { exact: true }).fill("50");
    await page.getByRole("button", { name: "Register Recipe", exact: true }).click();
    await page.getByRole("alert").getByText("Recipe save service is unavailable for this proof.", { exact: true }).waitFor({
      timeout: 15000,
    });

    fixtures.setPredictionMode("error");
    await page.getByRole("button", { name: "Run Predictive Analytics", exact: true }).click();
    await page.getByRole("alert").getByText("Prediction service is unavailable for this proof.", { exact: true }).waitFor({
      timeout: 15000,
    });

    assert(fixtures.requests.length >= 5, `Expected at least 5 recipe requests, got ${fixtures.requests.length}.`);
    watch.assertClean("recipe intelligence actions");

    await page.screenshot({
      path: path.join(artifactsDir, "visible-recipe-intelligence-actions.png"),
      fullPage: true,
    });

    const artifact = {
      checkedAt: new Date().toISOString(),
      baseURL,
      requestCount: fixtures.requests.length,
      proofs: [
        "Recipe page loads registered recipes.",
        "Add and remove ingredient controls update the form.",
        "Register Recipe shows saving and success feedback with the saved recipe row.",
        "Predictive analytics shows loading and forecast output.",
        "Recipe save and prediction failures preserve backend detail in inline alerts.",
      ],
    };
    fs.writeFileSync(
      path.join(artifactsDir, "recipe-intelligence-actions.json"),
      `${JSON.stringify(artifact, null, 2)}\n`
    );

    console.log("Recipe intelligence actions proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
