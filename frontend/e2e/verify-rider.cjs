/* Rider proof: rider link -> dispatch -> GPS -> live refresh -> proof -> delivery tracking. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
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
  const adminToken = login.data.access_token;
  const phone = `94${String(Date.now()).slice(-8)}`;

  const created = await api(adminToken, "/api/v1/restaurant/orders/", {
    method: "POST",
    body: JSON.stringify({
      order_type: "delivery",
      customer_name: "Rider Proof Guest",
      customer_phone: phone,
      delivery_address: "12 Park Street",
      payment_method: "cash",
      items: [{ name: "Garlic Bread", quantity: 1, price: 119 }],
    }),
  });
  assert(created.response.ok, `Delivery order failed: ${JSON.stringify(created.data)}`);
  const orderId = created.data.order_id;

  const assigned = await api(
    adminToken,
    `/api/v1/restaurant/delivery/orders/${orderId}/assignment`,
    {
      method: "PATCH",
      body: JSON.stringify({ status: "assigned", assigned_to: "Ravi Proof" }),
    }
  );
  assert(assigned.response.ok, `Assign failed: ${JSON.stringify(assigned.data)}`);

  const link = await api(
    adminToken,
    `/api/v1/restaurant/delivery/orders/${orderId}/rider-link`
  );
  assert(link.response.ok, `Rider link failed: ${JSON.stringify(link.data)}`);
  assert(link.data.rider_path, "Rider path missing.");

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 430, height: 932 },
      geolocation: { latitude: 12.9716, longitude: 77.5946 },
      permissions: ["geolocation"],
    });
    const page = await context.newPage();
    await page.goto(`${baseURL}${link.data.rider_path}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("rider-page").waitFor({ timeout: 20000 });

    // The rider publishes a call-back number for this delivery only.
    await page.getByTestId("rider-phone").fill("+91 98123 45799");
    await page.getByTestId("rider-phone-save").click();
    await page.getByText(/Call-back number saved/).waitFor({ timeout: 15000 });

    await page.getByTestId("rider-start").click();
    await page.getByTestId("rider-deliver").waitFor({ state: "detached" }).catch(() => {});
    await page.getByTestId("rider-proof-reference").waitFor({ timeout: 20000 });

    await page.getByTestId("rider-location").click();
    await page
      .getByText(/Updated \d{2}:\d{2}/)
      .first()
      .waitFor({ timeout: 15000 });

    // Automatic streaming while the delivery is live.
    await page.getByTestId("rider-auto-location").click();
    await page.getByTestId("rider-live-badge").waitFor({ timeout: 15000 });

    // A customer sees the rider map and can call while the handoff is active.
    const customer = await context.newPage();
    await customer.goto(`${baseURL}/track?order=${orderId}&phone=${phone}`, {
      waitUntil: "networkidle",
    });
    await customer.getByTestId("track-live-map").waitFor({ timeout: 20000 });
    await customer
      .locator(".blaze-rider-marker")
      .first()
      .waitFor({ timeout: 20000 });
    const callRider = customer.getByTestId("track-call-rider");
    await callRider.waitFor({ timeout: 20000 });
    const callHref = await callRider.getAttribute("href");
    assert(
      callHref === "tel:919812345799",
      `Call rider href was ${callHref || "missing"}.`
    );
    const mapLink = customer.getByRole("link", { name: /Open in maps/i });
    await mapLink.waitFor({ timeout: 20000 });
    const firstFix = await mapLink.getAttribute("href");
    assert(
      firstFix && firstFix.includes("12.9716") && firstFix.includes("77.5946"),
      `The customer map did not start at the rider's first fix: ${firstFix || "missing"}.`
    );
    // The guest also gets a live arrival countdown, not just a map.
    const etaPill = customer.getByTestId("track-eta-countdown");
    await etaPill.waitFor({ timeout: 20000 });
    const etaText = ((await etaPill.textContent()) || "").replace(/\s+/g, " ").trim();
    assert(
      /Arriving in ~\d+ min.*Due by/i.test(etaText),
      `The customer countdown read "${etaText}".`
    );

    // A second GPS fix must reach the page the customer already has open,
    // through the 15-second live poll, not only on a reload. Stop automatic
    // streaming first so the manual fix is the last write.
    await page.getByTestId("rider-auto-location").click();
    await page.getByTestId("rider-live-badge").waitFor({ state: "hidden", timeout: 10000 });
    await context.setGeolocation({ latitude: 12.9845, longitude: 77.6089 });
    await page.getByTestId("rider-location").click();
    await page
      .getByText("Live location shared with the store and customer.")
      .waitFor({ timeout: 15000 });
    await customer.waitForFunction(
      (previous) => {
        const link = Array.from(document.querySelectorAll("a")).find((anchor) =>
          /Open in maps/i.test(anchor.textContent || "")
        );
        return Boolean(link && link.getAttribute("href") !== previous);
      },
      firstFix,
      { timeout: 30000 }
    );
    const secondFix = await mapLink.getAttribute("href");
    assert(
      secondFix && secondFix.includes("12.9845") && secondFix.includes("77.6089"),
      `The open tracking page kept the old rider fix: ${secondFix || "missing"}.`
    );
    await customer.screenshot({
      path: path.join(artifactsDir, "visible-rider-live-refresh.png"),
      fullPage: false,
    });
    await customer.close();

    // Dispatch sees every rider with a live fix on one operations map.
    const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
    });
    assert(portalLogin.ok, `Portal login failed: ${await portalLogin.text()}`);
    const portalCookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));
    const deskContext = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    });
    await deskContext.addCookies(
      portalCookie
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
    const desk = await deskContext.newPage();
    await desk.goto(`${baseURL}/operations`, { waitUntil: "domcontentloaded" });
    const liveMap = desk.getByTestId("dispatch-live-map");
    await liveMap.waitFor({ timeout: 60000 });
    await desk
      .locator(".dispatch-rider-marker")
      .first()
      .waitFor({ timeout: 30000 });
    const dispatchRow = desk.locator(
      `[data-testid="dispatch-rider-row"][data-order-id="${orderId}"]`
    );
    await dispatchRow.waitFor({ timeout: 30000 });
    const dispatchText = await dispatchRow.innerText();
    assert(
      /Ravi Proof/i.test(dispatchText),
      `Dispatch row read "${dispatchText}".`
    );
    const dispatchCall = await dispatchRow
      .locator('a[href^="tel:"]')
      .getAttribute("href");
    assert(
      dispatchCall === "tel:919812345799",
      `Dispatch call link was ${dispatchCall || "missing"}.`
    );
    await liveMap.scrollIntoViewIfNeeded();
    await desk.screenshot({
      path: path.join(artifactsDir, "visible-dispatch-map.png"),
      fullPage: false,
    });
    await deskContext.close();

    await page.getByTestId("rider-proof-reference").fill("POD-PROOF-1");
    await page.getByLabel("Proof notes").fill("Handed to customer");
    await page.getByTestId("rider-proof-submit").click();
    await page.getByTestId("rider-deliver").waitFor({ timeout: 15000 });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-rider-app.png"),
      fullPage: false,
    });

    await page.getByTestId("rider-deliver").click();
    await page.getByText("Delivered", { exact: true }).first().waitFor({ timeout: 20000 });

    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(`${baseURL}/track?order=${orderId}&phone=${phone}`, {
      waitUntil: "networkidle",
    });
    const riderCard = page.getByTestId("track-rider");
    await riderCard.waitFor({ timeout: 20000 });
    const riderText = (await riderCard.innerText()).toLowerCase();
    assert(riderText.includes("delivered"), `Tracking rider read "${riderText}".`);
    assert(riderText.includes("proof captured"), "Tracking did not show proof.");
    assert(
      (await page.getByTestId("track-call-rider").count()) === 0,
      "The rider's personal number stayed visible after delivery."
    );
    assert(
      (await page.getByTestId("track-eta-countdown").count()) === 0,
      "A delivered order still shows an arrival countdown."
    );
    await riderCard.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(artifactsDir, "visible-rider-tracking.png"),
      fullPage: false,
    });

    console.log("Rider proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
