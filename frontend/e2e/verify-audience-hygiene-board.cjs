const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

function cookieHeaderFromSetCookie(setCookie) {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie || ""];
  return values
    .flatMap((value) => value.split(/,(?=\s*pb_[^=]+=)/))
    .map((value) => value.split(";")[0].trim())
    .filter((value) => value.startsWith("pb_"))
    .join("; ");
}

async function apiJson(endpoint, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: { ...(options.headers || {}) },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function adminJson(endpoint, cookie, options = {}) {
  return apiJson(endpoint, {
    ...options,
    headers: {
      Cookie: cookie,
      ...(options.headers || {}),
    },
  });
}

async function portalLogin() {
  const response = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  const data = await response.json();
  assert(response.ok, `Admin portal login failed: ${JSON.stringify(data)}`);
  const cookie = cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
  assert(cookie.includes("pb_admin_session="), "Admin login did not return an admin session cookie.");
  return cookie;
}

async function seedAudienceHygieneContacts() {
  const suffix = Date.now().toString().slice(-8);
  const contacts = {
    emailReady: {
      phone: `91${suffix}01`,
      name: `Hygiene Email Ready ${suffix}`,
      email: `hygiene-ready-${suffix}@example.com`,
      opt_in_marketing: true,
    },
    missingEmail: {
      phone: `91${suffix}02`,
      name: `Hygiene Email Gap ${suffix}`,
      email: null,
      opt_in_marketing: true,
    },
    optedOut: {
      phone: `91${suffix}03`,
      name: `Hygiene Opted Out ${suffix}`,
      email: `hygiene-optout-${suffix}@example.com`,
      opt_in_marketing: false,
    },
  };

  for (const contact of Object.values(contacts)) {
    const result = await apiJson("/api/v1/restaurant/orders/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_type: "takeaway",
        customer_name: contact.name,
        customer_phone: contact.phone,
        customer_email: contact.email,
        opt_in_marketing: contact.opt_in_marketing,
        payment_method: "cash",
        notes: "Audience hygiene E2E proof",
        items: [{ name: "Audience Hygiene Proof Pizza", quantity: 1, price: 299 }],
      }),
    });
    assert(result.response.ok, `Could not seed hygiene contact: ${JSON.stringify(result.data)}`);
  }

  return contacts;
}

function createBrowserWatch(page) {
  const issues = [];
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico|images\.unsplash\.com/i.test(text)) return;
    if (/Failed to fetch RSC payload/i.test(text) && /Falling back to browser navigation/i.test(text)) return;
    issues.push(`console error: ${text}`);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!url.startsWith(baseURL) && !url.startsWith(apiURL)) return;
    const failure = request.failure();
    if (failure?.errorText === "net::ERR_ABORTED") return;
    issues.push(`request failed: ${request.method()} ${url} ${failure?.errorText || ""}`.trim());
  });
  return {
    assertClean(label) {
      assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
    },
  };
}

async function screenshotAudienceHygiene(contacts) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1150 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/promotions`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Promotions page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByText("Audience Hygiene", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Contact readiness before campaign sends", { exact: true }).waitFor({ timeout: 15000 });
    await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => undefined);
    const hygieneSelect = page
      .locator("label")
      .filter({ hasText: "Audience Hygiene Segment" })
      .locator("select");
    const [selectionResponse] = await Promise.all([
      page.waitForResponse(
        (apiResponse) =>
          apiResponse.url().includes("/api/v1/restaurant/promotions/audience?audience=all_customers") &&
          apiResponse.ok(),
        { timeout: 15000 }
      ),
      hygieneSelect.selectOption("all_customers"),
    ]);
    assert(
      selectionResponse.url().includes("audience=all_customers"),
      `Audience hygiene selection used the wrong segment: ${selectionResponse.url()}`
    );
    assert(
      (await hygieneSelect.inputValue()) === "all_customers",
      "Audience hygiene selector did not switch to all customers."
    );
    await page.waitForTimeout(250);
    const [audienceResponse] = await Promise.all([
      page.waitForResponse(
        (apiResponse) =>
          apiResponse.url().includes("/api/v1/restaurant/promotions/audience") &&
          apiResponse.ok(),
        { timeout: 15000 }
      ),
      page.getByRole("button", { name: /Refresh Hygiene/i }).click(),
    ]);
    assert(
      audienceResponse.url().includes("audience=all_customers"),
      `Audience hygiene refresh used the wrong segment: ${audienceResponse.url()}`
    );
    await page.getByText("Recommended Channel", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Email Gaps", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Opted Out", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText(contacts.optedOut.name, { exact: false }).first().waitFor({ timeout: 15000 });
    await page.getByText(contacts.missingEmail.name, { exact: false }).first().waitFor({ timeout: 15000 });

    const health = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        textLength: text.trim().length,
        hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
        hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert(health.textLength > 300, "Audience hygiene board rendered too little content.");
    assert(!health.hasOverlay, "Audience hygiene board rendered a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Audience hygiene board rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Audience hygiene board has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    await page.screenshot({
      path: path.join(artifactsDir, "visible-audience-hygiene-board.png"),
      fullPage: true,
    });
    watch.assertClean("audience hygiene board");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const anonymous = await apiJson("/api/v1/restaurant/promotions/audience?audience=all_customers");
  assert(anonymous.response.status === 401, `Anonymous audience hygiene should be blocked, got ${anonymous.response.status}.`);

  const cookie = await portalLogin();
  const contacts = await seedAudienceHygieneContacts();

  const allAudience = await adminJson("/api/v1/restaurant/promotions/audience?audience=all_customers&limit=12", cookie);
  assert(allAudience.response.ok, `All audience hygiene failed: ${JSON.stringify(allAudience.data)}`);
  assert(allAudience.data.total_contacts >= 3, "All audience hygiene did not include seeded contacts.");
  assert(allAudience.data.opted_out_count >= 1, "All audience hygiene did not count opted-out contacts.");
  assert(allAudience.data.channels.email.ready_count >= 1, "All audience hygiene did not count email-ready contacts.");
  assert(allAudience.data.channels.email.missing_count >= 1, "All audience hygiene did not count missing email contacts.");
  assert(["whatsapp", "sms", "email"].includes(allAudience.data.recommended_channel), "All audience hygiene did not recommend a channel.");
  assert(
    allAudience.data.customers.some((contact) => contact.phone === contacts.optedOut.phone),
    "All audience sample did not include the seeded opted-out contact."
  );

  const optInAudience = await adminJson("/api/v1/restaurant/promotions/audience?audience=marketing_opt_in&limit=12", cookie);
  assert(optInAudience.response.ok, `Opt-in audience hygiene failed: ${JSON.stringify(optInAudience.data)}`);
  assert(optInAudience.data.opted_in_count >= 2, "Opt-in audience did not include seeded opted-in contacts.");
  assert(optInAudience.data.channels.email.missing_count >= 1, "Opt-in audience did not count the seeded email gap.");
  assert(optInAudience.data.channels.whatsapp.ready_count >= 2, "Opt-in audience did not count phone-ready contacts.");
  assert(
    optInAudience.data.customers.some((contact) => contact.phone === contacts.missingEmail.phone),
    "Opt-in audience sample did not include the seeded missing-email contact."
  );

  await screenshotAudienceHygiene(contacts);
  console.log(`Audience hygiene board proof passed for ${contacts.emailReady.phone}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
