/* Finance proof: outlet-scoped P&L, cost split, untracked ledger gap and POS cross-check. */
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

async function api(token, endpoint, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function portalContext(browser) {
  const login = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(login.ok, `Portal login failed: ${await login.text()}`);
  const cookie = cookieHeaderFromSetCookie(login.headers.get("set-cookie"));
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
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
  return context;
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const login = await api(null, "/api/v1/auth/admin/login", {
    method: "POST",
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  });
  assert(login.response.ok, `Admin API login failed: ${JSON.stringify(login.data)}`);
  const token = login.data.access_token;

  const stamp = Date.now();
  const storeCode = `FIN${String(stamp).slice(-6)}`;
  const storeName = `Pizza Blitz Finance Proof ${String(stamp).slice(-4)}`;
  const dayOne = "2031-03-01";
  const dayTwo = "2031-03-02";

  const created = await api(token, "/api/v1/restaurant/stores/", {
    method: "POST",
    body: JSON.stringify({ name: storeName, code: storeCode }),
  });
  assert(
    created.response.ok,
    `Proof outlet could not be created: ${JSON.stringify(created.data)}`
  );

  const listed = await api(token, "/api/v1/restaurant/stores/");
  assert(listed.response.ok, "Stores API failed.");
  const store = (listed.data.stores || []).find((row) => row.code === storeCode);
  assert(store, "Proof outlet was not persisted.");

  const categories = await api(token, "/api/v1/restaurant/expenses/categories");
  assert(categories.response.ok, "Expense categories failed.");
  const categoryId = (name) => {
    const row = (categories.data || []).find((category) => category.name === name);
    assert(row, `Expense category ${name} is missing.`);
    return row.id;
  };

  // Seed itemised expenses first; the daily entry then records the full ledger cost.
  for (const [day, category, amount] of [
    [dayOne, "Inventory Purchase", 800],
    [dayOne, "Marketing", 200],
    [dayTwo, "Utilities", 100],
  ]) {
    const expense = await api(token, "/api/v1/restaurant/expenses/expenses", {
      method: "POST",
      body: JSON.stringify({
        date: `${day}T12:00:00`,
        category_id: categoryId(category),
        amount,
        description: `Finance proof ${stamp} ${category}`,
        store_id: store.id,
      }),
    });
    assert(
      expense.response.ok,
      `Proof expense failed: ${JSON.stringify(expense.data)}`
    );
  }

  for (const [day, sale, expense] of [
    [dayOne, 5000, 1200],
    [dayTwo, 3000, 900],
  ]) {
    const entry = await api(token, "/api/v1/restaurant/sales/daily-entry", {
      method: "POST",
      body: JSON.stringify({
        date: day,
        total_sale: sale,
        cash_collected: sale / 2,
        total_expense: expense,
        payment_method: "mixed",
        notes: `Finance proof ${stamp}`,
        store_id: store.id,
      }),
    });
    assert(
      entry.response.ok,
      `Proof daily entry failed: ${JSON.stringify(entry.data)}`
    );
  }

  const pnl = await api(
    token,
    `/api/v1/restaurant/finance/outlet-pnl?start_date=${dayOne}&end_date=${dayTwo}&store_id=${store.id}`
  );
  assert(pnl.response.ok, `Outlet P&L API failed: ${JSON.stringify(pnl.data)}`);
  const summary = pnl.data.summary;
  assert(summary.revenue === 8000, `Revenue read ${summary.revenue}.`);
  assert(summary.cogs === 800, `COGS read ${summary.cogs}.`);
  assert(summary.opex === 300, `Opex read ${summary.opex}.`);
  assert(summary.ledger_expense === 2100, `Ledger expense read ${summary.ledger_expense}.`);
  assert(summary.untracked_cost === 1000, `Untracked cost read ${summary.untracked_cost}.`);
  assert(summary.total_cost === 2100, `Total cost read ${summary.total_cost}.`);
  assert(summary.gross_profit === 7200, `Gross profit read ${summary.gross_profit}.`);
  assert(summary.net_profit === 5900, `Net profit read ${summary.net_profit}.`);
  assert(summary.net_margin_percent === 73.75, `Net margin read ${summary.net_margin_percent}.`);
  assert(summary.days_with_sales === 2, `Ledger days read ${summary.days_with_sales}.`);
  assert(summary.expense_count === 3, `Expense count read ${summary.expense_count}.`);
  const flagLabels = (pnl.data.flags || []).map((flag) => flag.label);
  assert(
    flagLabels.includes("Unitemised ledger cost"),
    `Unitemised cost flag missing: ${flagLabels.join(", ")}`
  );

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await portalContext(browser);
    const page = await context.newPage();
    const consoleIssues = [];
    page.on("pageerror", (error) => consoleIssues.push(`page error: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (/Failed to load resource|favicon\.ico|Download the React DevTools/i.test(text)) return;
      consoleIssues.push(`console error: ${text}`);
    });

    const response = await page.goto(`${baseURL}/finance/pnl`, {
      waitUntil: "domcontentloaded",
    });
    assert(response && response.ok(), `Outlet P&L page returned ${response?.status()}.`);
    await page
      .locator('[data-testid="finance-pnl-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });

    const sidebar = page.getByTestId("portal-sidebar");
    await sidebar
      .getByRole("link", { name: "Outlet P&L", exact: true })
      .waitFor({ timeout: 20000 });

    const scopedResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/v1/restaurant/finance/outlet-pnl?") &&
        res.url().includes(`store_id=${store.id}`) &&
        res.status() === 200,
      { timeout: 30000 }
    );
    await page.getByLabel("P&L start date").fill(dayOne);
    await page.getByLabel("P&L end date").fill(dayTwo);
    await page.getByTestId("finance-store-select").selectOption(String(store.id));
    await page.getByTestId("finance-pnl-apply").click();
    await scopedResponse;

    await page.waitForFunction(
      () =>
        (document.querySelector('[data-testid="finance-revenue"]')?.textContent || "").includes(
          "8,000"
        ),
      null,
      { timeout: 20000 }
    );
    const revenueText = await page.getByTestId("finance-revenue").innerText();
    assert(/8,000/.test(revenueText), `Revenue card read: ${revenueText}`);
    const netProfitText = await page.getByTestId("finance-net-profit").innerText();
    assert(/5,900/.test(netProfitText), `Net profit card read: ${netProfitText}`);

    const tableText = await page.getByTestId("finance-store-table").innerText();
    assert(tableText.includes(storeName), `Store table missing ${storeName}: ${tableText}`);
    assert(/Rs\s*8,000/.test(tableText), `Store table missing revenue: ${tableText}`);
    assert(/Rs\s*800\b/.test(tableText), `Store table missing COGS: ${tableText}`);
    assert(/Rs\s*300\b/.test(tableText), `Store table missing opex: ${tableText}`);
    assert(/Rs\s*5,900/.test(tableText), `Store table missing net profit: ${tableText}`);
    assert(tableText.includes("73.75%"), `Store table missing margin: ${tableText}`);

    const pageText = (await page.locator("body").innerText()).toLowerCase();
    assert(
      pageText.includes("unitemised ledger cost"),
      "The P&L page did not surface the unitemised ledger cost flag."
    );
    assert(
      pageText.includes("inventory purchase") && pageText.includes("marketing"),
      "The cost mix is missing seeded expense categories."
    );

    await page.screenshot({
      path: path.join(artifactsDir, "visible-finance-pnl.png"),
      fullPage: false,
    });

    assert(
      !consoleIssues.length,
      `Finance P&L page produced browser issues:\n${consoleIssues.join("\n")}`
    );
    await context.close();
    console.log("Finance P&L proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
