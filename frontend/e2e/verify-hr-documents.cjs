/* HR documents proof: upload a private PDF, issue and verify a letter. */
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

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const login = await api(null, "/api/v1/auth/admin/login", {
    method: "POST",
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  });
  assert(login.response.ok, "Admin login failed.");
  const token = login.data.access_token;

  const employee = await api(token, "/api/v1/restaurant/hr/employees", {
    method: "POST",
    body: JSON.stringify({
      employee_code: `EMP-DOC-${Date.now()}`,
      full_name: "Documents Proof Employee",
      designation: "Shift Lead",
      employment_type: "full_time",
      status: "active",
      joining_date: "2025-06-01",
    }),
  });
  assert(employee.response.ok, `Employee create failed: ${JSON.stringify(employee.data)}`);

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(portalLogin.ok, `Portal login failed: ${await portalLogin.text()}`);
  const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));

  const browser = await chromium.launch({ headless: true });
  let documentId = null;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
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
    await page.goto(`${baseURL}/departments/hr/documents`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('[data-testid="hr-documents-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });

    await page.getByTestId("document-upload-open").click();
    await page.getByTestId("document-upload-form").waitFor({ timeout: 15000 });
    await page
      .getByTestId("document-employee")
      .selectOption(String(employee.data.id));
    await page.getByTestId("document-title").fill("Proof ID Document");
    await page.getByTestId("document-file").setInputFiles({
      name: "proof-id.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"),
    });
    await page.getByTestId("document-upload-submit").click();
    await page.getByText("Proof ID Document").waitFor({ timeout: 20000 });
    const documents = await api(token, "/api/v1/restaurant/hr/documents");
    documentId = (documents.data.documents || []).find(
      (row) => row.title === "Proof ID Document"
    )?.id;

    await page.getByTestId("documents-tab-letters").click();
    await page.getByTestId("letter-issue-open").click();
    await page.getByTestId("letter-employee").selectOption(String(employee.data.id));
    await page.getByTestId("letter-type").selectOption("offer");
    await page.getByTestId("letter-issue-submit").click();
    await page.getByTestId("letter-modal").waitFor({ timeout: 20000 });
    const letterText = await page.getByTestId("letter-modal").innerText();
    assert(/Documents Proof Employee/i.test(letterText), "Letter name missing.");
    assert(/Offer of employment/i.test(letterText), "Offer letter body missing.");
    assert(/PBL-/.test(letterText), "Verification code missing.");

    const code = (letterText.match(/PBL-[A-F0-9]{12}/) || [])[0];
    assert(code, "Verification code was not readable.");
    const verified = await api(
      null,
      `/api/v1/restaurant/hr/verify-letter/${code}`
    );
    assert(verified.data.valid === true, `Public verification failed: ${JSON.stringify(verified.data)}`);

    await page.screenshot({
      path: path.join(artifactsDir, "visible-hr-documents.png"),
      fullPage: false,
    });

    console.log("HR documents proof passed.");
  } finally {
    if (documentId) {
      await api(token, `/api/v1/restaurant/hr/documents/${documentId}`, {
        method: "DELETE",
      }).catch(() => {});
    }
    await api(token, `/api/v1/restaurant/hr/employees/${employee.data.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "exited", notes: "Proof cleanup" }),
    }).catch(() => {});
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
