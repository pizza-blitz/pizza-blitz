const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";

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

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function main() {
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");

  const suffix = Date.now().toString().slice(-8);
  const phone = `93${suffix}`;
  const orderResult = await jsonFetch(`${apiURL}/api/v1/restaurant/orders/`, {
    method: "POST",
    body: JSON.stringify({
      order_type: "pickup",
      customer_name: "Payment Trust Boundary Proof",
      customer_phone: phone,
      payment_method: "prepaid",
      items: [
        {
          name: `Trust Boundary Pizza ${suffix}`,
          quantity: 1,
          price: 199,
        },
      ],
      notes: `Payment trust boundary proof ${suffix}`,
    }),
  });
  assert(orderResult.response.ok, `Could not create prepaid proof order: ${JSON.stringify(orderResult.data)}`);
  const orderId = Number(orderResult.data.order_id);
  assert(orderId > 0, "Proof order id was not positive.");

  const sessionResult = await jsonFetch(`${apiURL}/api/v1/restaurant/orders/${orderId}/payment-session`, {
    method: "POST",
    body: JSON.stringify({
      return_url: `${baseURL}/track?order=${orderId}&phone=${phone}`,
    }),
  });
  assert(sessionResult.response.ok, `Could not create payment session: ${JSON.stringify(sessionResult.data)}`);
  assert(
    sessionResult.data.payment_session?.provider,
    `Payment session did not include a provider: ${JSON.stringify(sessionResult.data)}`
  );

  const publicConfirm = await jsonFetch(`${apiURL}/api/v1/restaurant/orders/${orderId}/payment-confirmation`, {
    method: "POST",
    body: JSON.stringify({
      payment_provider: "manual",
      payment_reference: `PUBLIC-${suffix}`,
      paid_amount: orderResult.data.total,
    }),
  });
  assert(
    publicConfirm.response.status === 401 || publicConfirm.response.status === 403,
    `Public order payment confirmation should be blocked, got ${publicConfirm.response.status}: ${JSON.stringify(publicConfirm.data)}`
  );

  const publicTrackConfirm = await jsonFetch(`${apiURL}/api/v1/restaurant/orders/track/${orderId}/payment-confirmation`, {
    method: "POST",
    body: JSON.stringify({
      phone,
      payment_provider: "manual",
      payment_reference: `TRACK-${suffix}`,
      paid_amount: orderResult.data.total,
    }),
  });
  assert(
    publicTrackConfirm.response.status === 401 || publicTrackConfirm.response.status === 403,
    `Public tracking payment confirmation should be blocked, got ${publicTrackConfirm.response.status}: ${JSON.stringify(publicTrackConfirm.data)}`
  );

  const cookie = await portalLogin();
  const adminConfirm = await jsonFetch(`${apiURL}/api/v1/restaurant/orders/${orderId}/payment-confirmation`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({
      payment_provider: "manual",
      payment_reference: `ADMIN-${suffix}`,
      paid_amount: orderResult.data.total,
    }),
  });
  assert(adminConfirm.response.ok, `Admin payment confirmation failed: ${JSON.stringify(adminConfirm.data)}`);
  assert(adminConfirm.data.payment_status === "paid", `Expected admin-confirmed order to be paid: ${JSON.stringify(adminConfirm.data)}`);

  console.log(`Public payment trust boundary proof passed for order #${orderId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
