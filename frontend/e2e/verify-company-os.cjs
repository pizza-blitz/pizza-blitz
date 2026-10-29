/* Company OS proof: work inbox, approval flow, scorecard, department workspace and scoped staff navigation. */
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
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function createBrowserWatch(page) {
  const issues = [];
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico|images\.unsplash\.com|Download the React DevTools|Failed to fetch RSC payload|Falling back to browser navigation/i.test(text)) {
      return;
    }
    issues.push(`console error: ${text}`);
  });
  return {
    assertClean(label) {
      assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
    },
  };
}

async function portalContext(browser, loginBody) {
  const login = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(loginBody),
  });
  assert(login.ok, `Portal login failed: ${await login.text()}`);
  const cookie = cookieHeaderFromSetCookie(login.headers.get("set-cookie"));
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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

async function workItemId(page, title) {
  const article = page
    .locator('article[data-testid^="work-item-"]')
    .filter({ hasText: title });
  await article.waitFor({ timeout: 20000 });
  const testid = await article.getAttribute("data-testid");
  return {
    article,
    id: Number(String(testid).replace("work-item-", "")),
  };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const adminLogin = await api(null, "/api/v1/auth/admin/login", {
    method: "POST",
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  });
  assert(adminLogin.response.ok, "Admin API login failed.");
  const token = adminLogin.data.access_token;

  const departments = await api(token, "/api/v1/restaurant/departments/");
  assert(departments.response.ok, "Department registry failed.");
  const operations = (departments.data.departments || []).find(
    (row) => row.key === "operations"
  );
  const hr = (departments.data.departments || []).find((row) => row.key === "hr");
  assert(operations, "Operations department not found.");
  assert(hr, "People & HR department not found.");

  const stamp = Date.now();
  const taskTitle = `Proof task ${stamp}`;
  const taskComment = `Counter drawer counted at ${stamp}.`;
  const approvalTitle = `Proof approval ${stamp}`;
  const staffTaskTitle = `Staff proof task ${stamp}`;
  const staffId = `company-proof-${stamp}`;
  const staffPassword = "CompanyProof123!";

  const credential = await api(token, "/api/v1/auth/staff/credential", {
    method: "POST",
    body: JSON.stringify({
      id: staffId,
      password: staffPassword,
      display_name: "Company OS Proof",
      is_active: true,
    }),
  });
  assert(
    credential.response.ok,
    `Staff credential failed: ${JSON.stringify(credential.data)}`
  );
  const membership = await api(
    token,
    `/api/v1/restaurant/departments/${operations.id}/members`,
    {
      method: "POST",
      body: JSON.stringify({ staff_id: staffId, role: "member" }),
    }
  );
  assert(
    membership.response.ok,
    `Operations membership failed: ${JSON.stringify(membership.data)}`
  );

  let adminTaskId = null;
  let approvalId = null;
  let staffTaskId = null;
  const browser = await chromium.launch({ headless: true });

  try {
    const adminContext = await portalContext(browser, {
      id: adminId,
      password: adminPassword,
      role: "admin",
    });
    const page = await adminContext.newPage();
    const watch = createBrowserWatch(page);

    // --- Work inbox: create a task, move it, comment on it. ---
    let response = await page.goto(`${baseURL}/work`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Work inbox returned ${response?.status()}.`);
    await page
      .locator('[data-testid="work-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    await page.getByRole("heading", { name: "My work" }).waitFor({ timeout: 30000 });

    const adminSidebar = page.getByTestId("portal-sidebar");
    const adminNav = adminSidebar.getByRole("navigation", { name: "Portal" });
    await adminNav
      .getByText("Department workspaces", { exact: true })
      .waitFor({ timeout: 20000 });
    assert(
      (await adminNav.locator('a[href="/departments/operations"]').count()) >= 1,
      "Admin navigation is missing the Operations workspace."
    );
    const switcher = page.locator("#portal-department-switcher");
    await switcher.waitFor({ timeout: 30000 });
    assert(
      (await switcher.locator('option[value="operations"]').count()) === 1,
      "The department switcher is missing Operations."
    );

    await page.getByTestId("work-create-open").click();
    const taskModal = page.getByTestId("work-create-modal");
    await taskModal.waitFor({ timeout: 30000 });
    const taskSelects = taskModal.locator("select");
    await taskSelects.nth(0).selectOption("operations");
    await taskModal.getByTestId("work-title").fill(taskTitle);
    await taskModal
      .locator("textarea")
      .fill("Count the evening drawer and log the variance.");
    await taskSelects.nth(2).selectOption("high");
    await page.getByTestId("work-submit").click();
    await page.getByTestId("work-create-modal").waitFor({ state: "detached", timeout: 30000 });

    const task = await workItemId(page, taskTitle);
    adminTaskId = task.id;
    assert(
      /High/i.test(await task.article.innerText()),
      "Created task lost its priority badge."
    );

    const status = task.article.getByLabel(`Status for ${taskTitle}`);
    await status.selectOption("in_progress");
    // The select is controlled by the server response, so wait for the reload
    // instead of assuming a fixed delay is enough on a slow machine.
    await page.waitForFunction(
      ({ title }) => {
        const el = document.querySelector(
          `select[aria-label="Status for ${title}"]`
        );
        return el instanceof HTMLSelectElement && el.value === "in_progress";
      },
      { title: taskTitle },
      { timeout: 20000 }
    );
    assert(
      (await status.inputValue()) === "in_progress",
      "Task status did not update to in_progress."
    );

    await task.article.getByRole("button", { name: /comments/i }).click();
    await page.getByTestId(`work-comment-input-${task.id}`).fill(taskComment);
    await page.getByTestId(`work-comment-submit-${task.id}`).click();
    await page.getByText(taskComment, { exact: true }).waitFor({ timeout: 30000 });

    // --- Raise an approval and approve it from the same inbox. ---
    await page.getByTestId("work-create-approval-open").click();
    const approvalModal = page.getByTestId("work-create-modal");
    await approvalModal.waitFor({ timeout: 30000 });
    await approvalModal.locator("select").nth(0).selectOption("operations");
    await approvalModal.locator("select").nth(1).selectOption("expense");
    await approvalModal.getByTestId("work-title").fill(approvalTitle);
    await approvalModal.locator('input[type="number"]').fill("850");
    await approvalModal
      .locator("textarea")
      .fill("Weekend gas reimbursement for delivery riders.");
    await page.getByTestId("work-submit").click();
    await page.getByTestId("work-create-modal").waitFor({ state: "detached", timeout: 30000 });
    const approvalCard = page
      .locator('article[data-testid^="approval-"]')
      .filter({ hasText: approvalTitle });
    await approvalCard.waitFor({ timeout: 20000 });
    approvalId = Number(
      String(await approvalCard.getAttribute("data-testid")).replace("approval-", "")
    );
    assert(
      /pending/i.test(await approvalCard.innerText()),
      "Raised approval is not pending."
    );

    await page.screenshot({
      path: path.join(artifactsDir, "visible-company-work.png"),
      fullPage: false,
    });

    // --- Company scorecard and department workspace read the same signals. ---
    response = await page.goto(`${baseURL}/departments`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Departments page returned ${response?.status()}.`);
    await page
      .locator('[data-testid="departments-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    await page.getByTestId("company-scorecard").waitFor({ timeout: 30000 });
    const scorecardOperations = page.getByTestId("scorecard-department-operations");
    await scorecardOperations.waitFor({ timeout: 30000 });
    assert(
      (await scorecardOperations.getAttribute("href")) === "/departments/operations",
      "Scorecard row does not link to the Operations workspace."
    );
    assert(
      /Operations/i.test(await scorecardOperations.innerText()),
      "Scorecard row is missing the Operations department."
    );
    await page.getByTestId("scorecard-department-hr").waitFor({ timeout: 30000 });

    response = await page.goto(`${baseURL}/departments/operations`, {
      waitUntil: "domcontentloaded",
    });
    assert(response && response.ok(), `Operations workspace returned ${response?.status()}.`);
    await page
      .locator('[data-testid="department-detail"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    const heading = await page.getByTestId("department-name-heading").innerText();
    assert(/Operations/i.test(heading), `Workspace heading read: ${heading}`);
    assert(
      (await page.locator('[data-testid^="department-kpi-"]').count()) >= 3,
      "Operations workspace is missing live KPIs."
    );
    const ordersModule = page.getByTestId("department-module-orders");
    await ordersModule.waitFor({ timeout: 30000 });
    assert(/active/i.test(await ordersModule.innerText()), "Orders module is not active.");
    assert(
      (await ordersModule.getAttribute("href")) === "/orders",
      "Orders module does not link to the POS orders page."
    );
    const needsApproval = page.getByTestId(`department-needs-approval-${approvalId}`);
    await needsApproval.waitFor({ timeout: 30000 });
    const needsText = await needsApproval.innerText();
    assert(
      /Weekend gas reimbursement/i.test(needsText) && /Rs 850/i.test(needsText),
      `Department workspace does not show the pending approval: ${needsText}`
    );
    await page.screenshot({
      path: path.join(artifactsDir, "visible-company-workspace.png"),
      fullPage: false,
    });

    // --- Approve from the inbox, confirm the task persisted, close it out. ---
    response = await page.goto(`${baseURL}/work`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Work inbox reload returned ${response?.status()}.`);
    await page
      .locator('[data-testid="work-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });

    const reloadedTask = await workItemId(page, taskTitle);
    assert(
      (await reloadedTask.article.getByLabel(`Status for ${taskTitle}`).inputValue()) ===
        "in_progress",
      "Task status did not persist after reload."
    );
    await reloadedTask.article.getByRole("button", { name: /comments/i }).click();
    await page.getByText(taskComment, { exact: true }).waitFor({ timeout: 30000 });

    const pendingApproval = page.getByTestId(`approval-${approvalId}`);
    await pendingApproval.waitFor({ timeout: 30000 });
    await page.getByTestId(`approval-approve-${approvalId}`).click();
    await pendingApproval.waitFor({ state: "detached", timeout: 20000 });

    const decided = await api(token, "/api/v1/restaurant/work/approvals?status=approved&limit=200");
    assert(decided.response.ok, "Approved approvals could not be listed.");
    assert(
      (decided.data.approvals || []).some(
        (row) => row.id === approvalId && row.status === "approved"
      ),
      "Approval decision was not persisted."
    );

    response = await page.goto(`${baseURL}/departments/operations`, {
      waitUntil: "domcontentloaded",
    });
    assert(response && response.ok(), "Operations workspace reload failed.");
    await page
      .locator('[data-testid="department-detail"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    assert(
      (await page.getByTestId(`department-needs-approval-${approvalId}`).count()) === 0,
      "Approved request is still in the department needs-you queue."
    );

    // Close the admin task so the shared queue is left clean.
    response = await page.goto(`${baseURL}/work`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), "Work inbox cleanup reload failed.");
    await page
      .locator('[data-testid="work-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    const closableTask = await workItemId(page, taskTitle);
    await closableTask.article
      .getByLabel(`Status for ${taskTitle}`)
      .selectOption("done");
    await closableTask.article.waitFor({ state: "detached", timeout: 20000 });

    watch.assertClean("admin company OS flow");
    await adminContext.close();

    // --- Scoped staff: only Operations and shared services, own queue only. ---
    const staffContext = await portalContext(browser, {
      id: staffId,
      password: staffPassword,
      role: "staff",
    });
    const staffPage = await staffContext.newPage();
    const staffWatch = createBrowserWatch(staffPage);

    response = await staffPage.goto(`${baseURL}/work`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Staff work inbox returned ${response?.status()}.`);
    await staffPage
      .locator('[data-testid="work-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    await staffPage
      .locator('[data-testid="portal-shell"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });

    const staffSidebar = staffPage.getByTestId("portal-sidebar");
    const staffNav = staffSidebar.getByRole("navigation", { name: "Portal" });
    await staffNav
      .getByRole("link", { name: "POS orders", exact: true })
      .waitFor({ timeout: 20000 });
    await staffNav
      .getByText("Shared services", { exact: true })
      .waitFor({ timeout: 20000 });
    assert(
      (await staffNav.getByText("Shared services", { exact: true }).count()) === 1,
      "Staff navigation is missing shared services."
    );
    assert(
      (await staffNav.getByText("Operations", { exact: true }).count()) === 1,
      "Staff navigation is missing the Operations group."
    );
    assert(
      (await staffNav.getByRole("link", { name: "My work", exact: true }).count()) === 1,
      "Staff navigation is missing My work."
    );
    assert(
      (await staffNav.getByText("Executive Office", { exact: true }).count()) === 0,
      "Staff navigation leaked the Executive Office group."
    );
    const operationsFilter = staffPage.getByRole("button", {
      name: operations.name,
      exact: true,
    });
    await operationsFilter.waitFor({ timeout: 20000 });
    assert(
      (await operationsFilter.count()) === 1,
      "Staff work queue is missing the Operations filter."
    );
    assert(
      (await staffPage.getByRole("button", { name: hr.name, exact: true }).count()) === 0,
      "Staff work queue leaked the People & HR filter."
    );

    // A staff-raised task defaults to its creator and stays in their queue.
    await staffPage.getByTestId("work-create-open").click();
    const staffModal = staffPage.getByTestId("work-create-modal");
    await staffModal.waitFor({ timeout: 30000 });
    await staffModal.locator("select").nth(0).selectOption("operations");
    await staffModal.getByTestId("work-title").fill(staffTaskTitle);
    await staffPage.getByTestId("work-submit").click();
    await staffPage
      .getByTestId("work-create-modal")
      .waitFor({ state: "detached", timeout: 30000 });
    const staffTask = await workItemId(staffPage, staffTaskTitle);
    staffTaskId = staffTask.id;
    assert(
      /Company OS Proof/i.test(await staffTask.article.innerText()),
      "Staff task is missing its owner."
    );
    await staffTask.article
      .getByLabel(`Status for ${staffTaskTitle}`)
      .selectOption("done");
    await staffTask.article.waitFor({ state: "detached", timeout: 20000 });

    response = await staffPage.goto(`${baseURL}/departments`, {
      waitUntil: "domcontentloaded",
    });
    assert(response && response.ok(), `Staff departments page returned ${response?.status()}.`);
    await staffPage
      .locator('[data-testid="departments-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    await staffPage.getByTestId("department-card-operations").waitFor({ timeout: 30000 });
    assert(
      (await staffPage.getByTestId("department-card-hr").count()) === 0,
      "Staff departments page leaked People & HR."
    );
    assert(
      (await staffPage.getByTestId("department-create-open").count()) === 0,
      "Staff departments page exposed the create button."
    );
    await staffPage.getByTestId("scorecard-department-operations").waitFor({ timeout: 30000 });
    assert(
      (await staffPage.getByTestId("scorecard-department-hr").count()) === 0,
      "Staff scorecard leaked People & HR."
    );

    response = await staffPage.goto(`${baseURL}/departments/operations`, {
      waitUntil: "domcontentloaded",
    });
    assert(response && response.ok(), `Staff workspace returned ${response?.status()}.`);
    await staffPage
      .locator('[data-testid="department-detail"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    assert(
      (await staffPage.locator('[data-testid^="department-kpi-"]').count()) >= 3,
      "Staff workspace is missing live KPIs."
    );
    await staffPage.getByTestId("department-module-orders").waitFor({ timeout: 30000 });
    assert(
      (await staffPage.getByLabel("Add module").count()) === 0,
      "Staff workspace exposed the add-module control."
    );
    assert(
      (await staffPage.getByLabel("Staff member").count()) === 0,
      "Staff workspace exposed the admin member picker."
    );

    await staffPage.screenshot({
      path: path.join(artifactsDir, "visible-company-staff-workspace.png"),
      fullPage: false,
    });
    staffWatch.assertClean("staff company OS flow");
    await staffContext.close();

    console.log("Company OS proof passed.");
  } finally {
    // Best-effort cleanup so repeated runs start from a quiet queue.
    const cleanup = [
      adminTaskId &&
        api(token, `/api/v1/restaurant/work/items/${adminTaskId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "done" }),
        }),
      staffTaskId &&
        api(token, `/api/v1/restaurant/work/items/${staffTaskId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "done" }),
        }),
      approvalId &&
        api(token, `/api/v1/restaurant/work/approvals/${approvalId}/decision`, {
          method: "POST",
          body: JSON.stringify({ decision: "approved", note: "Proof cleanup" }),
        }),
    ].filter(Boolean);
    await Promise.allSettled(cleanup);
    await api(
      token,
      `/api/v1/restaurant/departments/${operations.id}/members/${staffId}`,
      { method: "DELETE" }
    ).catch(() => {});
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
