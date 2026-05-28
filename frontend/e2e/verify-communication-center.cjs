const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
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

function cookieHeaderFromSetCookie(setCookie) {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie || ""];
  return values
    .flatMap((value) => value.split(/,(?=\s*pb_[^=]+=)/))
    .map((value) => value.split(";")[0].trim())
    .filter((value) => value.startsWith("pb_"))
    .join("; ");
}

async function portalLogin() {
  const response = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  const data = await response.json().catch(() => ({}));
  assert(response.ok, `Admin portal login failed: ${JSON.stringify(data)}`);
  const cookie = cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
  assert(cookie.includes("pb_admin_session="), "Admin login did not return an admin session cookie.");
  return cookie;
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

async function adminText(endpoint, cookie, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      Cookie: cookie,
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const text = await response.text();
  return { response, text };
}

async function waitForDryRunProof(campaignId, cookie, previousDryRunCount = 0) {
  const startedAt = Date.now();
  let latest = null;
  while (Date.now() - startedAt < 90000) {
    const result = await adminJson(`/api/v1/restaurant/promotions/${campaignId}/deliveries`, cookie);
    assert(result.response.ok, `Could not fetch dry-run proof: ${JSON.stringify(result.data)}`);
    latest = result.data;
    if (result.data.dry_run_count > previousDryRunCount) return result.data;
    await sleep(1500);
  }
  throw new Error(`Communication center dry-run action did not record new dry-run deliveries: ${JSON.stringify(latest)}`);
}

async function waitForCustomerDryRun(campaignId, cookie, customerEmail, knownDeliveryIds = new Set()) {
  const startedAt = Date.now();
  let latest = null;
  while (Date.now() - startedAt < 90000) {
    const result = await adminJson(`/api/v1/restaurant/promotions/${campaignId}/deliveries?limit=200`, cookie);
    assert(result.response.ok, `Could not fetch customer dry-run proof: ${JSON.stringify(result.data)}`);
    latest = result.data;
    const delivery = (result.data.deliveries || []).find(
      (row) =>
        row.status === "dry_run" &&
        row.dry_run === true &&
        row.customer?.email === customerEmail &&
        !knownDeliveryIds.has(row.id)
    );
    if (delivery) return delivery;
    await sleep(1500);
  }
  throw new Error(`Recovery retry did not record a dry-run for ${customerEmail}: ${JSON.stringify(latest)}`);
}

async function seedCommunicationProof(cookie) {
  const suffix = Date.now().toString().slice(-8);
  const contactPhone = `82${suffix}`;
  const contactEmail = `comms-${suffix}@example.com`;
  const missingPhone = `81${suffix}`;
  const repairedEmail = `comms-fixed-${suffix}@example.com`;

  const order = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: `Comms Proof ${suffix}`,
      customer_phone: contactPhone,
      customer_email: contactEmail,
      opt_in_marketing: true,
      payment_method: "cash",
      notes: "Communication center proof contact",
      items: [{ name: "Comms Proof Pizza", quantity: 1, price: 299 }],
    }),
  });
  assert(order.response.ok, `Could not seed communication contact: ${JSON.stringify(order.data)}`);

  const missingOrder = await apiJson("/api/v1/restaurant/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: `Comms Missing Email ${suffix}`,
      customer_phone: missingPhone,
      customer_email: null,
      opt_in_marketing: true,
      payment_method: "cash",
      notes: "Communication center cleanup proof contact",
      items: [{ name: "Comms Cleanup Pizza", quantity: 1, price: 249 }],
    }),
  });
  assert(missingOrder.response.ok, `Could not seed communication cleanup contact: ${JSON.stringify(missingOrder.data)}`);

  const missingLookup = await adminJson(`/api/v1/restaurant/customers/?q=${missingPhone}`, cookie);
  assert(missingLookup.response.ok, `Could not look up cleanup contact: ${JSON.stringify(missingLookup.data)}`);
  const missingCustomer = missingLookup.data.find((customer) => customer.phone === missingPhone);
  assert(missingCustomer?.id, `Could not find cleanup contact ${missingPhone}.`);

  const today = new Date();
  const endDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const code = `COM${suffix.slice(-5)}`;
  const name = `Communication Center Proof ${suffix}`;
  const campaign = await adminJson("/api/v1/restaurant/promotions/", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      code,
      start_date: today.toISOString().slice(0, 10),
      end_date: endDate.toISOString().slice(0, 10),
      description: "E2E communication center proof",
      discount_type: "percentage",
      discount_value: 10,
      audience: "marketing_opt_in",
      channel: "email",
      status: "active",
      message_template: "Hi {name}, Pizza Blitz has {offer}. Use {code}. Order here: {order_link}",
    }),
  });
  assert(campaign.response.ok, `Could not create communication campaign: ${JSON.stringify(campaign.data)}`);
  const campaignId = campaign.data.promotion.id;

  return {
    campaignId,
    name,
    code,
    contactPhone,
    contactEmail,
    missingPhone,
    missingCustomerId: missingCustomer.id,
    repairedEmail,
  };
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

async function assertHealthyPage(page, label) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => undefined);
  const health = await page.evaluate(() => {
    const text = document.body.innerText || "";
    return {
      textLength: text.trim().length,
      hasOverlay: Boolean(document.querySelector("[data-nextjs-dialog], [data-nextjs-dialog-overlay], nextjs-portal")),
      hasFrameworkError: /Unhandled Runtime Error|Build Error|Application error|Hydration failed/i.test(text),
      bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  assert(health.textLength > 800, `${label} rendered too little content.`);
  assert(!health.hasOverlay, `${label} has a Next.js error overlay.`);
  assert(!health.hasFrameworkError, `${label} rendered framework error text.`);
  assert(health.bodyOverflow <= 8, `${label} has body-level horizontal overflow of ${health.bodyOverflow}px.`);
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const adminCookie = await portalLogin();
  const dispatchControl = await adminJson("/api/v1/restaurant/promotions/providers/dispatch-control", adminCookie);
  assert(dispatchControl.response.ok, `Could not load provider activation control: ${JSON.stringify(dispatchControl.data)}`);
  for (const channel of ["whatsapp", "sms", "email"]) {
    const channelControl = dispatchControl.data.channels.find((item) => item.channel === channel);
    assert(channelControl, `Provider activation control missed ${channel}.`);
    assert(
      Array.isArray(channelControl.activation_checklist) && channelControl.activation_checklist.length >= 5,
      `${channel} activation checklist was missing required checks.`
    );
    const labels = channelControl.activation_checklist.map((item) => item.label).join(" | ");
    assert(/Global send switch/i.test(labels), `${channel} activation checklist missed global send switch.`);
    assert(/Provider credentials/i.test(labels), `${channel} activation checklist missed provider credentials.`);
    assert(/Dry-run proof/i.test(labels), `${channel} activation checklist missed dry-run proof.`);
  }
  const providerSetupExpectations = {
    whatsapp: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_TEMPLATE_NAME", "CAMPAIGN_SEND_ENABLED=true"],
    sms: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID", "CAMPAIGN_SEND_ENABLED=true"],
    email: ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "CAMPAIGN_SEND_ENABLED=true"],
  };
  for (const [channel, expectedSettings] of Object.entries(providerSetupExpectations)) {
    const channelControl = dispatchControl.data.channels.find((item) => item.channel === channel);
    assert(channelControl, `Provider activation control missed ${channel} channel.`);
    assert(
      Array.isArray(channelControl.provider_status?.setup_steps) &&
        channelControl.provider_status.setup_steps.length >= expectedSettings.length,
      `${channel} provider setup steps were missing from provider status.`
    );
    const setupText = channelControl.provider_status.setup_steps
      .map((item) => `${item.label} ${item.required_setting} ${item.action}`)
      .join(" | ");
    for (const expectedSetting of expectedSettings) {
      assert(
        setupText.includes(expectedSetting),
        `${channel} setup steps missed ${expectedSetting}.`
      );
    }
  }
  const proof = await seedCommunicationProof(adminCookie);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();
  const watch = createBrowserWatch(page);

  try {
    const login = await context.request.post(`${baseURL}/api/admin-session`, {
      data: { id: adminId, password: adminPassword, role: "admin" },
    });
    assert(login.ok(), `Admin browser login failed: ${await login.text()}`);

    const response = await page.goto(`${baseURL}/communications`, { waitUntil: "domcontentloaded" });
    assert(response && response.ok(), `Communications page returned HTTP ${response?.status() || "no response"}.`);
    await page.getByRole("heading", { name: "Messaging command board" }).waitFor({ timeout: 20000 });
    await page.getByTestId("communications-metrics").waitFor({ timeout: 20000 });
    await page.getByTestId("communications-provider-status").waitFor({ timeout: 20000 });
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid="communications-channel-whatsapp"], [data-testid="communications-channel-sms"], [data-testid="communications-channel-email"]').length === 3,
      null,
      { timeout: 60000 }
    );
    for (const channel of ["whatsapp", "sms", "email"]) {
      await page.getByTestId(`communications-activation-checklist-${channel}`).waitFor({ timeout: 20000 });
      const checklistText = await page.getByTestId(`communications-activation-checklist-${channel}`).innerText();
      assert(/Activation Checklist/i.test(checklistText), `${channel} activation checklist title missing.`);
      assert(/Global send switch/i.test(checklistText), `${channel} activation checklist missed global send switch.`);
      assert(/Provider credentials/i.test(checklistText), `${channel} activation checklist missed provider credentials.`);
      assert(/Dry-run proof/i.test(checklistText), `${channel} activation checklist missed dry-run proof.`);
    }
    await page.getByTestId("whatsapp-provider-activation").waitFor({ timeout: 20000 });
    const whatsappActivationText = await page.getByTestId("whatsapp-provider-activation").innerText();
    assert(/Meta WhatsApp activation/i.test(whatsappActivationText), "WhatsApp activation panel missed Meta WhatsApp activation title.");
    assert(/WHATSAPP_ACCESS_TOKEN/i.test(whatsappActivationText), "WhatsApp activation panel missed WHATSAPP_ACCESS_TOKEN.");
    assert(/WHATSAPP_PHONE_NUMBER_ID/i.test(whatsappActivationText), "WhatsApp activation panel missed WHATSAPP_PHONE_NUMBER_ID.");
    assert(/WHATSAPP_TEMPLATE_NAME/i.test(whatsappActivationText), "WhatsApp activation panel missed WHATSAPP_TEMPLATE_NAME.");
    assert(/CAMPAIGN_SEND_ENABLED=true/i.test(whatsappActivationText), "WhatsApp activation panel missed CAMPAIGN_SEND_ENABLED=true.");
    await page.getByTestId("sms-provider-activation").waitFor({ timeout: 20000 });
    const smsActivationText = await page.getByTestId("sms-provider-activation").innerText();
    assert(/Twilio activation/i.test(smsActivationText), "SMS activation panel missed Twilio activation title.");
    assert(/TWILIO_ACCOUNT_SID/i.test(smsActivationText), "SMS activation panel missed TWILIO_ACCOUNT_SID.");
    assert(/TWILIO_AUTH_TOKEN/i.test(smsActivationText), "SMS activation panel missed TWILIO_AUTH_TOKEN.");
    assert(/TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID/i.test(smsActivationText), "SMS activation panel missed Twilio sender identity.");
    assert(/CAMPAIGN_SEND_ENABLED=true/i.test(smsActivationText), "SMS activation panel missed CAMPAIGN_SEND_ENABLED=true.");
    await page.getByTestId("email-provider-activation").waitFor({ timeout: 20000 });
    const emailActivationText = await page.getByTestId("email-provider-activation").innerText();
    assert(/Resend activation/i.test(emailActivationText), "Email activation panel missed Resend activation title.");
    assert(/RESEND_API_KEY/i.test(emailActivationText), "Email activation panel missed RESEND_API_KEY.");
    assert(/RESEND_FROM_EMAIL/i.test(emailActivationText), "Email activation panel missed RESEND_FROM_EMAIL.");
    assert(/CAMPAIGN_SEND_ENABLED=true/i.test(emailActivationText), "Email activation panel missed CAMPAIGN_SEND_ENABLED=true.");
    const safeProviderTests = [
      { testId: "whatsapp-provider-activation", recipient: "9876543210" },
      { testId: "sms-provider-activation", recipient: "9876543210" },
      { testId: "email-provider-activation", recipient: "operator@example.com" },
    ];
    for (const safeTest of safeProviderTests) {
      await page.getByTestId(`${safeTest.testId}-safe-test`).waitFor({ timeout: 20000 });
      await page.getByTestId(`${safeTest.testId}-test-recipient`).fill(safeTest.recipient);
      await page.getByTestId(`${safeTest.testId}-run-test`).click();
      await page.getByTestId(`${safeTest.testId}-test-result`).waitFor({ timeout: 20000 });
      await page.waitForFunction(
        (testId) =>
          /Dry-run test generated/i.test(
            document.querySelector(`[data-testid="${testId}-test-result"]`)?.textContent || ""
          ),
        safeTest.testId,
        { timeout: 30000 }
      );
      const safeTestResult = await page.getByTestId(`${safeTest.testId}-test-result`).innerText();
      assert(/Dry-run test generated/i.test(safeTestResult), `${safeTest.testId} did not show dry-run generation.`);
      assert(/No live send queued: Confirmed/i.test(safeTestResult), `${safeTest.testId} did not confirm no live send was queued.`);
    }
    const providerAudit = await adminJson("/api/v1/restaurant/promotions/providers/dispatch-control", adminCookie);
    assert(providerAudit.response.ok, `Could not reload provider audit: ${JSON.stringify(providerAudit.data)}`);
    const recentProviderTests = providerAudit.data.recent_provider_tests || [];
    for (const channel of ["whatsapp", "sms", "email"]) {
      assert(
        recentProviderTests.some((test) => test.channel === channel && test.live_send_blocked === true && test.queued === false),
        `Provider audit did not persist a safe ${channel} test.`
      );
    }
    const providerAuditCsv = await adminText("/api/v1/restaurant/promotions/providers/test-runs/export.csv", adminCookie);
    assert(providerAuditCsv.response.ok, `Could not export provider audit CSV: ${providerAuditCsv.text}`);
    assert(providerAuditCsv.text.includes("id,test_id,generated_at,channel"), "Provider audit CSV header missing expected columns.");
    for (const channel of ["whatsapp", "sms", "email"]) {
      assert(providerAuditCsv.text.includes(channel), `Provider audit CSV missed ${channel}.`);
    }
    await page.getByTestId("communications-provider-test-audit").waitFor({ timeout: 20000 });
    await page.waitForFunction(
      () => /No live send/i.test(document.querySelector('[data-testid="communications-provider-test-audit"]')?.textContent || ""),
      null,
      { timeout: 30000 }
    );
    const exportHref = await page.getByTestId("communications-provider-test-export").getAttribute("href");
    assert(
      exportHref && /providers\/test-runs\/export\.csv/.test(exportHref),
      "Provider audit export link missing CSV endpoint."
    );
    const providerAuditText = await page.getByTestId("communications-provider-test-audit").innerText();
    assert(/Safe test timeline/i.test(providerAuditText), "Provider test audit timeline title missing.");
    assert(/No live send/i.test(providerAuditText), "Provider test audit timeline did not show no-live-send proof.");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Messaging command board" }).waitFor({ timeout: 20000 });
    for (const safeTest of safeProviderTests) {
      await page.getByTestId(`${safeTest.testId}-test-result`).waitFor({ timeout: 30000 });
      const persistedAuditText = await page.getByTestId(`${safeTest.testId}-test-result`).innerText();
      assert(/Latest safe test audit/i.test(persistedAuditText), `${safeTest.testId} did not reload persisted safe test audit.`);
      assert(/No live send queued: Confirmed/i.test(persistedAuditText), `${safeTest.testId} persisted audit did not confirm no live send.`);
    }
    await page.getByTestId("communications-provider-test-audit").waitFor({ timeout: 30000 });
    const reloadedProviderAuditText = await page.getByTestId("communications-provider-test-audit").innerText();
    for (const label of ["Whatsapp", "Sms", "Email"]) {
      assert(
        reloadedProviderAuditText.includes(`${label} safe test`),
        `Provider test audit timeline did not reload ${label} safe test.`
      );
    }
    await page.getByTestId("communications-send-queue").waitFor({ timeout: 20000 });
    await page.getByTestId("communications-segments").waitFor({ timeout: 20000 });
    await page.getByTestId("communications-next-action").waitFor({ timeout: 20000 });
    await page.getByTestId("communications-performance").waitFor({ timeout: 20000 });
    await page.getByTestId("communications-recent-events").waitFor({ timeout: 20000 });
    await page.getByTestId("communications-delivery-recovery").waitFor({ timeout: 20000 });
    const deliveryRecoveryText = await page.getByTestId("communications-delivery-recovery").innerText();
    assert(/Delivery recovery/i.test(deliveryRecoveryText), "Delivery recovery panel title missing.");
    assert(/Failed/i.test(deliveryRecoveryText), "Delivery recovery panel missed failed count.");
    assert(/Skipped/i.test(deliveryRecoveryText), "Delivery recovery panel missed skipped count.");
    const recoveryExportHref = await page.getByTestId("communications-delivery-recovery-export").getAttribute("href");
    assert(
      recoveryExportHref && /providers\/delivery-events\/export\.csv\?status=needs_attention/.test(recoveryExportHref),
      "Delivery recovery export link missing needs-attention filter."
    );
    const missingDestinationExportHref = await page.getByTestId("communications-missing-destination-export").getAttribute("href");
    assert(
      missingDestinationExportHref && /reason=missing_destination/.test(missingDestinationExportHref),
      "Delivery recovery panel missed contact-gap export."
    );
    const providerIssuesExportHref = await page.getByTestId("communications-provider-issues-export").getAttribute("href");
    assert(
      providerIssuesExportHref && /reason=provider/.test(providerIssuesExportHref),
      "Delivery recovery panel missed provider-issue export."
    );

    const bodyText = await page.locator("body").innerText();
    assert(/reachable/i.test(bodyText), "Communications metrics did not include reachable contact status.");
    assert(/ready to send/i.test(bodyText), "Communications metrics did not include send queue status.");
    assert(/provider readiness/i.test(bodyText), "Communications page missed provider readiness section.");
    assert(bodyText.includes(proof.name), `Communications page did not surface seeded campaign ${proof.name}.`);

    await page.getByTestId(`communications-live-gate-${proof.campaignId}`).waitFor({ timeout: 60000 });
    await page
      .getByTestId(`communications-live-gate-status-${proof.campaignId}`)
      .getByText(/Live Send Locked|Live Ready/i)
      .waitFor({ timeout: 10000 });
    const dryRunGateBefore = await page
      .getByTestId(`communications-live-gate-check-${proof.campaignId}-dry-run-proof`)
      .innerText();
    assert(/missing/i.test(dryRunGateBefore), `Dry-run gate should start missing: ${dryRunGateBefore}`);
    const seededRecovery = await adminJson(`/api/v1/restaurant/promotions/${proof.campaignId}/send`, adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dry_run: true,
        limit: 50,
      }),
    });
    assert(seededRecovery.response.ok, `Could not seed skipped recovery delivery: ${JSON.stringify(seededRecovery.data)}`);
    assert(
      seededRecovery.data.skipped_count > 0,
      `Seeded campaign did not create a skipped delivery for recovery: ${JSON.stringify(seededRecovery.data)}`
    );
    await page.getByTestId("communications-refresh").click();
    await page.getByTestId(`communications-retry-recovery-${proof.campaignId}`).waitFor({ timeout: 90000 });
    await page.waitForFunction(
      (campaignId) => {
        const button = document.querySelector(`[data-testid="communications-retry-recovery-${campaignId}"]`);
        return button && !(button instanceof HTMLButtonElement && button.disabled);
      },
      proof.campaignId,
      { timeout: 90000 }
    );

    await page.getByTestId(`communications-review-contacts-${proof.campaignId}`).waitFor({ timeout: 60000 });
    await page.getByTestId(`communications-review-contacts-${proof.campaignId}`).click();
    await page.getByTestId("communications-cleanup-review").waitFor({ timeout: 30000 });
    await page.getByTestId(`communications-cleanup-contact-${proof.missingCustomerId}`).waitFor({ timeout: 30000 });
    const cleanupBefore = await page.getByTestId(`communications-cleanup-contact-${proof.missingCustomerId}`).innerText();
    assert(/missing email/i.test(cleanupBefore), `Cleanup review did not show missing email blocker: ${cleanupBefore}`);
    await page.getByTestId(`communications-cleanup-email-${proof.missingCustomerId}`).fill(proof.repairedEmail);
    await page.getByTestId(`communications-save-cleanup-${proof.missingCustomerId}`).click();
    let repairedLookup = null;
    let repairedCustomer = null;
    const cleanupStartedAt = Date.now();
    while (Date.now() - cleanupStartedAt < 45000) {
      repairedLookup = await adminJson(`/api/v1/restaurant/customers/?q=${proof.missingPhone}`, adminCookie);
      assert(repairedLookup.response.ok, `Could not recheck cleanup contact: ${JSON.stringify(repairedLookup.data)}`);
      repairedCustomer = repairedLookup.data.find((customer) => customer.phone === proof.missingPhone);
      if (repairedCustomer?.email === proof.repairedEmail) break;
      await sleep(1500);
    }
    assert(
      repairedCustomer?.email === proof.repairedEmail,
      `Cleanup email was not saved. Expected ${proof.repairedEmail}, got ${repairedCustomer?.email}.`
    );
    await page.getByTestId(`communications-cleanup-contact-${proof.missingCustomerId}`).getByText("Ready").waitFor({ timeout: 30000 });
    await page.getByTestId(`communications-retry-recovery-${proof.campaignId}`).waitFor({ timeout: 30000 });
    const beforeRecoveryRetry = await adminJson(`/api/v1/restaurant/promotions/${proof.campaignId}/deliveries?limit=200`, adminCookie);
    assert(beforeRecoveryRetry.response.ok, `Could not precheck recovery retry proof: ${JSON.stringify(beforeRecoveryRetry.data)}`);
    const knownRecoveryDeliveryIds = new Set(
      (beforeRecoveryRetry.data.deliveries || [])
        .filter((row) => row.status === "dry_run" && row.customer?.email === proof.repairedEmail)
        .map((row) => row.id)
    );
    await page.getByTestId(`communications-retry-recovery-${proof.campaignId}`).click();
    const recoveryRetryDelivery = await waitForCustomerDryRun(
      proof.campaignId,
      adminCookie,
      proof.repairedEmail,
      knownRecoveryDeliveryIds
    );
    assert(
      recoveryRetryDelivery.customer?.email === proof.repairedEmail,
      "Recovery retry did not record a new dry-run for the repaired customer."
    );

    await page.getByTestId(`communications-run-dry-run-${proof.campaignId}`).waitFor({ timeout: 60000 });
    const beforeDryRun = await adminJson(`/api/v1/restaurant/promotions/${proof.campaignId}/deliveries`, adminCookie);
    assert(beforeDryRun.response.ok, `Could not precheck dry-run proof: ${JSON.stringify(beforeDryRun.data)}`);
    await page.getByTestId(`communications-run-dry-run-${proof.campaignId}`).click();
    const dryRunResult = await waitForDryRunProof(proof.campaignId, adminCookie, beforeDryRun.data.dry_run_count);
    assert(
      dryRunResult.dry_run_count > beforeDryRun.data.dry_run_count,
      "Communication center dry-run action did not record new dry-run deliveries."
    );
    await page.getByTestId("communications-refresh").click();
    await page
      .getByTestId(`communications-live-gate-check-${proof.campaignId}-dry-run-proof`)
      .getByText(/passed/i)
      .waitFor({ timeout: 30000 });
    const liveGateAfter = await page.getByTestId(`communications-live-gate-${proof.campaignId}`).innerText();
    assert(/Live Ready|Live Send Locked/i.test(liveGateAfter), `Live gate did not show a final state: ${liveGateAfter}`);
    assert(/Provider configured/i.test(liveGateAfter), `Live gate did not include provider configuration check: ${liveGateAfter}`);
    await page.getByTestId("communications-recent-events").getByText(/dry run/i).first().waitFor({ timeout: 30000 });
    const deliveryEventsCsv = await adminText("/api/v1/restaurant/promotions/providers/delivery-events/export.csv", adminCookie);
    assert(deliveryEventsCsv.response.ok, `Could not export delivery events CSV: ${deliveryEventsCsv.text}`);
    assert(
      deliveryEventsCsv.text.includes("id,promotion_id,promotion,code,attempted_at,channel"),
      "Delivery events CSV header missing expected columns."
    );
    assert(deliveryEventsCsv.text.includes(proof.name), `Delivery events CSV missed seeded campaign ${proof.name}.`);
    assert(deliveryEventsCsv.text.includes("dry_run"), "Delivery events CSV missed dry-run proof rows.");
    const deliveryEventsExportHref = await page.getByTestId("communications-delivery-events-export").getAttribute("href");
    assert(
      deliveryEventsExportHref && /providers\/delivery-events\/export\.csv/.test(deliveryEventsExportHref),
      "Delivery events export link missing CSV endpoint."
    );
    const deliveryRecoveryCsv = await adminText(
      "/api/v1/restaurant/promotions/providers/delivery-events/export.csv?status=needs_attention",
      adminCookie
    );
    assert(deliveryRecoveryCsv.response.ok, `Could not export recovery delivery CSV: ${deliveryRecoveryCsv.text}`);
    assert(
      deliveryRecoveryCsv.text.includes("id,promotion_id,promotion,code,attempted_at,channel"),
      "Recovery delivery CSV header missing expected columns."
    );

    await page.screenshot({
      path: path.join(artifactsDir, "visible-communication-center.png"),
      fullPage: true,
    });

    watch.assertClean("communication center proof");
  } finally {
    await browser.close();
  }

  console.log(`Communication center proof passed for campaign #${proof.campaignId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
