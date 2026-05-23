const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
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

async function seedConsentContacts() {
  const suffix = Date.now().toString().slice(-8);
  const contacts = {
    optedIn: {
      phone: `98${suffix}01`,
      name: `Consent Ready ${suffix}`,
      email: `consent-ready-${suffix}@example.com`,
      opt_in_marketing: true,
    },
    optedOut: {
      phone: `98${suffix}02`,
      name: `Consent Blocked ${suffix}`,
      email: `consent-blocked-${suffix}@example.com`,
      opt_in_marketing: false,
    },
  };

  for (const contact of Object.values(contacts)) {
    const order = await apiJson("/api/v1/restaurant/orders/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_type: "takeaway",
        customer_name: contact.name,
        customer_phone: contact.phone,
        customer_email: contact.email,
        opt_in_marketing: contact.opt_in_marketing,
        payment_method: "cash",
        notes: "Campaign consent suppression E2E proof",
        items: [{ name: "Consent Proof Pizza", quantity: 1, price: 299 }],
      }),
    });
    assert(order.response.ok, `Could not seed consent contact: ${JSON.stringify(order.data)}`);
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
    issues,
    assertClean(label) {
      assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
    },
  };
}

async function screenshotConsentSuppression(campaignName, blockedName) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await fetch(`${baseURL}/api/admin-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
    });
    assert(login.ok, `Admin browser login failed: ${await login.text()}`);
    const cookieHeader = cookieHeaderFromSetCookie(login.headers.get("set-cookie"));
    const adminCookie = cookieHeader
      .split("; ")
      .map((cookie) => cookie.split("="))
      .find(([name]) => name === "pb_admin_session");
    assert(adminCookie, "Admin browser login did not return pb_admin_session.");
    await context.addCookies([
      {
        name: adminCookie[0],
        value: adminCookie.slice(1).join("="),
        domain: new URL(baseURL).hostname,
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    const response = await page.goto(`${baseURL}/promotions`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Promotions page returned HTTP ${response?.status() || "no response"}.`);
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await page.getByText("Provider Send Console", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText("Campaign List", { exact: false }).waitFor({ timeout: 15000 });
    try {
      await Promise.all([
        page.waitForResponse(
          (apiResponse) => {
            const url = new URL(apiResponse.url());
            return (
              url.pathname === "/api/v1/restaurant/promotions/" &&
              apiResponse.request().method() === "GET" &&
              apiResponse.ok()
            );
          },
          { timeout: 20000 }
        ),
        page.getByRole("button", { name: /^Refresh$/ }).click(),
      ]);
    } catch (error) {
      const bodyText = await page.locator("body").innerText().catch(() => "");
      throw new Error(
        `Refresh did not load promotions. Browser issues: ${watch.issues.join(" | ") || "none"}. Page text sample: ${bodyText.slice(
          0,
          1200
        )}`
      );
    }
    const campaignButton = page.getByText(campaignName, { exact: false }).first();
    try {
      await campaignButton.waitFor({ timeout: 15000 });
    } catch (error) {
      const bodyText = await page.locator("body").innerText().catch(() => "");
      const apiProbe = await page.evaluate(async () => {
        try {
          const response = await fetch("http://127.0.0.1:8010/api/v1/restaurant/promotions/", {
            credentials: "include",
          });
          const text = await response.text();
          return { status: response.status, ok: response.ok, text: text.slice(0, 500) };
        } catch (fetchError) {
          return { error: fetchError instanceof Error ? fetchError.message : String(fetchError) };
        }
      });
      throw new Error(
        `Campaign ${campaignName} was not visible. API probe: ${JSON.stringify(
          apiProbe
        )}. Page text sample: ${bodyText.slice(0, 1200)}`
      );
    }
    await campaignButton.click();
    await page.getByText("Recent Delivery Attempts", { exact: false }).waitFor({ timeout: 15000 });
    await page.getByText(blockedName, { exact: false }).first().waitFor({ timeout: 15000 });
    await page.getByText("Marketing consent not granted", { exact: false }).first().waitFor({ timeout: 15000 });
    await page.getByText("Ask the customer to opt in before sending promotional messages.", { exact: false }).first().waitFor({ timeout: 15000 });

    const health = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        textLength: text.trim().length,
        hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
        hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert(health.textLength > 300, "Consent suppression view rendered too little content.");
    assert(!health.hasOverlay, "Consent suppression view rendered a Next.js error overlay.");
    assert(!health.hasFrameworkError, "Consent suppression view rendered framework error text.");
    assert(health.bodyOverflow <= 8, `Consent suppression view has body-level horizontal overflow of ${health.bodyOverflow}px.`);

    await page.screenshot({
      path: path.join(artifactsDir, "visible-campaign-consent-suppression.png"),
      fullPage: true,
    });
    watch.assertClean("campaign consent suppression");
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const anonymousSend = await apiJson("/api/v1/restaurant/promotions/1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true, limit: 1 }),
  });
  assert(anonymousSend.response.status === 401, `Anonymous send should be blocked, got ${anonymousSend.response.status}.`);

  const contacts = await seedConsentContacts();
  const cookie = await portalLogin();
  const today = new Date();
  const endDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const suffix = Date.now().toString().slice(-8);
  const campaignName = `Consent Suppression Proof ${suffix}`;

  const promotion = await adminJson("/api/v1/restaurant/promotions/", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: campaignName,
      code: `SAFE${suffix.slice(-6)}`,
      start_date: today.toISOString().slice(0, 10),
      end_date: endDate.toISOString().slice(0, 10),
      description: "E2E opt-out suppression proof",
      discount_type: "percentage",
      discount_value: 15,
      audience: "all_customers",
      channel: "email",
      status: "active",
      message_template: "Hi {name}, Pizza Blitz has {offer}. Use {code}.",
    }),
  });
  assert(promotion.response.ok, `Could not create suppression campaign: ${JSON.stringify(promotion.data)}`);
  const promotionId = promotion.data.promotion.id;

  const dispatch = await adminJson(`/api/v1/restaurant/promotions/${promotionId}/dispatch?limit=8`, cookie);
  assert(dispatch.response.ok, `Suppression dispatch failed: ${JSON.stringify(dispatch.data)}`);
  const readyContact = dispatch.data.contacts.find((row) => row.phone === contacts.optedIn.phone);
  const blockedContact = dispatch.data.contacts.find((row) => row.phone === contacts.optedOut.phone);
  assert(readyContact?.send_ready === true, "Opted-in contact was not send-ready.");
  assert(blockedContact?.send_ready === false, "Opted-out contact was incorrectly send-ready.");
  assert(blockedContact?.suppressed === true, "Opted-out contact was not marked suppressed.");
  assert(blockedContact?.missing_reason === "Marketing consent not granted", "Opted-out contact did not show the consent block reason.");
  assert(dispatch.data.send_ready_count < dispatch.data.contacts.length, "Dispatch did not subtract suppressed contacts from ready count.");

  const dryRun = await adminJson(`/api/v1/restaurant/promotions/${promotionId}/send`, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dry_run: true, limit: 8 }),
  });
  assert(dryRun.response.ok, `Suppression dry run failed: ${JSON.stringify(dryRun.data)}`);
  const readyDelivery = dryRun.data.deliveries.find((row) => row.customer?.phone === contacts.optedIn.phone);
  const blockedDelivery = dryRun.data.deliveries.find((row) => row.customer?.phone === contacts.optedOut.phone);
  assert(readyDelivery?.status === "dry_run", "Opted-in contact did not receive a dry-run delivery.");
  assert(blockedDelivery?.status === "skipped", "Opted-out contact was not skipped.");
  assert(blockedDelivery?.error === "Marketing consent not granted", "Opted-out delivery did not keep the consent block reason.");
  assert(blockedDelivery?.recovery_action.includes("opt in"), "Opted-out delivery did not show consent recovery guidance.");

  const audience = await adminJson("/api/v1/restaurant/promotions/audience?audience=all_customers&limit=8", cookie);
  assert(audience.response.ok, `Audience hygiene failed: ${JSON.stringify(audience.data)}`);
  assert(audience.data.channels.email.suppressed_count >= 1, "Audience hygiene did not count suppressed email contacts.");
  assert(audience.data.channels.email.ready_count < audience.data.total_contacts, "Audience hygiene treated all contacts as email ready.");

  await screenshotConsentSuppression(campaignName, contacts.optedOut.name);
  console.log(`Campaign consent suppression proof passed for promotion #${promotionId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
