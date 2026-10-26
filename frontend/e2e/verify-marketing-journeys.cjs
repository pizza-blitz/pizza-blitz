/* Journey proof: active journey -> completed order trigger -> runner -> UI history. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://localhost:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");
const journeyName = `Proof post-order journey ${Date.now()}`;
const phone = `9194${Date.now().toString().slice(-8)}`;

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

  const adminToken = await fetch(`${apiURL}/api/v1/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  }).then((response) => response.json());
  const apiHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${adminToken.access_token}`,
  };

  const journeyResponse = await fetch(`${apiURL}/api/v1/restaurant/journeys`, {
    method: "POST",
    headers: apiHeaders,
    body: JSON.stringify({
      name: journeyName,
      description: "Proof sequence triggered by a completed order.",
      trigger: "order_completed",
      status: "active",
      max_sends_per_customer: 5,
      frequency_window_hours: 24,
      steps: [
        { type: "delay", hours: 0 },
        {
          type: "condition",
          field: "order_total",
          operator: ">=",
          value: 100,
        },
        {
          type: "send",
          channel: "whatsapp",
          variant: "A",
          body: "Variant A: thanks for your order! Tell us how it went.",
        },
        {
          type: "send",
          channel: "whatsapp",
          variant: "B",
          body: "Variant B: thanks for your order! Tell us how it went.",
        },
      ],
    }),
  });
  const journeyData = await journeyResponse.json();
  assert(journeyResponse.ok, `Journey create failed: ${JSON.stringify(journeyData)}`);
  const journeyId = journeyData.journey.id;

  const orderResponse = await fetch(`${apiURL}/api/v1/restaurant/orders/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "takeaway",
      customer_name: "Journey Proof Guest",
      customer_phone: phone,
      payment_method: "cash",
      items: [{ name: "Garlic Bread", quantity: 1, price: 119 }],
    }),
  });
  const order = await orderResponse.json();
  assert(orderResponse.ok, `Order create failed: ${JSON.stringify(order)}`);
  const orderId = order.order_id;

  const ready = await fetch(`${apiURL}/api/v1/restaurant/orders/${orderId}/status`, {
    method: "PATCH",
    headers: apiHeaders,
    body: JSON.stringify({ status: "ready" }),
  });
  assert(ready.ok, `Order ready failed: ${await ready.text()}`);
  const closed = await fetch(`${apiURL}/api/v1/restaurant/orders/${orderId}/close`, {
    method: "PATCH",
    headers: apiHeaders,
  });
  assert(closed.ok, `Order close failed: ${await closed.text()}`);

  const run = await fetch(`${apiURL}/api/v1/restaurant/journeys/run-due`, {
    method: "POST",
    headers: apiHeaders,
  });
  const runData = await run.json();
  assert(run.ok, `Journey run failed: ${JSON.stringify(runData)}`);

  const journey = await fetch(`${apiURL}/api/v1/restaurant/journeys/${journeyId}`, {
    headers: apiHeaders,
  }).then((response) => response.json());
  const enrollment = journey.journey.recent_enrollments.find(
    (row) => row.trigger_ref === `order:${orderId}:order_completed`
  );
  assert(enrollment, "Order completion did not enroll the journey.");
  assert(enrollment.status === "completed", `Enrollment status was ${enrollment.status}.`);
  assert(
    enrollment.events.some((event) => event.step_type === "delay"),
    "Delay step was not recorded."
  );
  assert(
    enrollment.events.some(
      (event) => event.step_type === "condition" && event.status === "passed"
    ),
    "Condition step was not passed."
  );
  assert(
    enrollment.events.some((event) => event.step_type === "send"),
    "Send step was not recorded."
  );
  assert(
    journey.journey.attributed_revenue > 0,
    "Journey revenue attribution is empty."
  );

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(portalLogin.ok, "Portal login failed.");
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
    await card.waitFor({ timeout: 20000 });
    assert((await card.innerText()).includes(journeyName), "Journey name missing from UI.");
    const attribution = page.getByTestId(`journey-attribution-${journeyId}`);
    await attribution.waitFor({ timeout: 20000 });
    assert(
      (await attribution.innerText()).toLowerCase().includes("sends"),
      "Journey attribution line missing."
    );
    await card.getByText("View runs", { exact: true }).click();
    const enrollmentCard = page.getByTestId(`journey-enrollment-${enrollment.id}`);
    await enrollmentCard.waitFor({ timeout: 20000 });
    const enrollmentText = await enrollmentCard.innerText();
    const pageText = await page.getByTestId("journeys-page").innerText();
    assert(enrollmentText.includes("completed"), "Enrollment status missing from UI.");
    assert(enrollmentText.toLowerCase().includes("send"), "Send step missing from enrollment history.");
    assert(
      enrollmentText.toLowerCase().includes("condition"),
      "Condition step missing from enrollment history."
    );
    assert(
      pageText.toLowerCase().includes("attributed"),
      "Journey revenue attribution missing from UI."
    );
    assert(
      pageText.toLowerCase().includes("variant"),
      "A/B variant results missing from UI."
    );
    assert(
      pageText.toLowerCase().includes("cap 5/24h"),
      "Frequency cap badge missing from UI."
    );
    await page.screenshot({
      path: path.join(artifactsDir, "visible-journeys.png"),
      fullPage: false,
    });

    console.log("Marketing journeys proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
