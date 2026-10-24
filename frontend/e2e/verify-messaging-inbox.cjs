/* Messaging inbox proof: inbound webhook -> shared thread -> template creation. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://localhost:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const webhookToken = process.env.E2E_MESSAGING_TOKEN || "messaging-proof-token";
const artifactsDir = path.join(__dirname, "artifacts");
const phone = `9196${Date.now().toString().slice(-8)}`;

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

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const inboundBody = `Webhook proof question ${Date.now()}`;
  const inbound = await fetch(
    `${apiURL}/api/v1/restaurant/messaging/webhook/whatsapp?token=${encodeURIComponent(webhookToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ profile: { name: "Webhook Proof Guest" } }],
                  messages: [
                    {
                      from: phone,
                      id: `wamid.${phone}`,
                      type: "text",
                      text: { body: inboundBody },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    }
  );
  const inboundData = await inbound.json();
  assert(inbound.ok, `Inbound webhook failed: ${JSON.stringify(inboundData)}`);
  const threadId = inboundData.thread_id;
  const inboundMessageId = inboundData.message.id;

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(portalLogin.ok, `Portal login failed: ${await portalLogin.text()}`);
  const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
    await page.goto(`${baseURL}/messaging`, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="messaging-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });

    const row = page.getByTestId(`thread-row-${threadId}`);
    await row.waitFor({ timeout: 20000 });
    await row.click();
    await page.getByTestId(`message-${inboundMessageId}`).waitFor({ timeout: 20000 });
    await page.getByTestId("message-composer").waitFor({ timeout: 15000 });

    const pageText = await page.getByTestId("messaging-page").innerText();
    assert(pageText.includes("Webhook Proof Guest"), "Contact name missing from inbox.");
    assert(pageText.includes("WhatsApp"), "Channel label missing from inbox.");
    await page.screenshot({
      path: path.join(artifactsDir, "visible-messaging-inbox.png"),
      fullPage: false,
    });

    await page.getByRole("button", { name: "Templates", exact: true }).click();
    await page.getByTestId("template-name").fill("Proof order ready message");
    await page.getByTestId("template-body").fill(
      "Your Pizza Blitz order is ready for pickup. Please collect it at the counter."
    );
    await page.getByTestId("template-save").click();
    await page.getByText("Template Proof order ready message saved", { exact: false }).waitFor({
      timeout: 20000,
    });
    assert(
      (await page.getByTestId("messaging-page").innerText()).includes(
        "Proof order ready message"
      ),
      "Saved template missing from the list."
    );

    console.log("Messaging inbox proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
