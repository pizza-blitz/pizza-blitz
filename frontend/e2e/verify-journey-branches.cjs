/* Multi-path journey proof: branch on order value, follow stop path, show builder. */
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

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const token = await fetch(`${apiURL}/api/v1/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  }).then((response) => response.json());
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token.access_token}`,
  };
  const journeyName = `Branch proof ${Date.now()}`;
  const created = await fetch(`${apiURL}/api/v1/restaurant/journeys`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: journeyName,
      description: "High-value orders get a different path.",
      trigger: "order_completed",
      status: "active",
      steps: [
        { type: "delay", hours: 0 },
        {
          type: "branch",
          field: "order_total",
          operator: ">=",
          value: 100,
          true_step: 2,
          false_step: 4,
        },
        { type: "send", channel: "whatsapp", body: "High value thank you" },
        { type: "stop" },
        { type: "send", channel: "whatsapp", body: "Small order thank you" },
        { type: "stop" },
      ],
    }),
  });
  const journeyBody = await created.json();
  assert(created.ok, `Journey create failed: ${JSON.stringify(journeyBody)}`);
  const journeyId = journeyBody.journey.id;

  const order = await fetch(`${apiURL}/api/v1/restaurant/orders/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Branch Proof Guest",
      customer_phone: `9194${Date.now().toString().slice(-8)}`,
      payment_method: "cash",
      items: [{ name: "Branch Proof Pizza", quantity: 1, price: 250 }],
    }),
  }).then((response) => response.json());
  const orderId = order.order_id;
  await fetch(`${apiURL}/api/v1/restaurant/orders/${orderId}/status`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "ready" }),
  });
  await fetch(`${apiURL}/api/v1/restaurant/orders/${orderId}/close`, {
    method: "PATCH",
    headers,
  });
  const run = await fetch(`${apiURL}/api/v1/restaurant/journeys/run-due`, {
    method: "POST",
    headers,
  });
  assert(run.ok, `Journey runner failed: ${await run.text()}`);

  const detail = await fetch(
    `${apiURL}/api/v1/restaurant/journeys/${journeyId}`,
    { headers }
  ).then((response) => response.json());
  const enrollment = detail.journey.recent_enrollments.find(
    (row) => row.trigger_ref === `order:${orderId}:order_completed`
  );
  assert(enrollment, "Branch journey did not enroll the order.");
  assert(
    enrollment.events.some(
      (event) => event.step_type === "branch" && event.status === "passed"
    ),
    "Branch event was not recorded."
  );
  assert(
    enrollment.events.some((event) => event.step_type === "stop"),
    "Stop path was not honored."
  );
  const send = enrollment.events.find((event) => event.step_type === "send");
  assert(send && send.step_index === 2, "High-value path did not send from step 3.");

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));

  const browser = await chromium.launch({ headless: true });
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
    await page.goto(`${baseURL}/journeys`, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="journeys-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    const card = page.getByTestId(`journey-${journeyId}`);
    await card.waitFor({ timeout: 30000 });
    const text = await card.innerText();
    assert(text.includes("If total >="), "Branch builder summary missing.");
    assert(text.includes("Stop path"), "Stop step missing from builder.");
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactsDir, "visible-journey-branches.png"),
      fullPage: false,
    });

    console.log("Branch journey proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
