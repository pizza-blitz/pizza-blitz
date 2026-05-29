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
  return (setCookie || "")
    .split(/,(?=\s*pb_[^=]+=)/)
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

async function adminJson(endpoint, cookie) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    headers: { Cookie: cookie },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  assert(response.ok, `${endpoint} failed: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");
  const cookie = await portalLogin();

  const activation = await adminJson("/api/v1/restaurant/orders/payments/gateway-activation", cookie);
  const directBank = (activation.providers || []).find((provider) => provider.provider === "direct_bank");
  assert(directBank, "Payment gateway activation did not include direct_bank provider.");
  assert(directBank.label === "Direct Bank / UPI", `Unexpected direct bank label: ${directBank.label}`);
  assert(
    ["blocked", "proof_needed", "live_ready"].includes(directBank.activation_status),
    `Unexpected direct bank activation status: ${directBank.activation_status}`
  );
  assert(
    directBank.steps.some((step) => /Credential environment/i.test(step.name)),
    "Direct bank readiness did not include credential environment step."
  );

  const readiness = await adminJson("/api/v1/restaurant/ops/readiness", cookie);
  assert(
    readiness.payment_providers?.some((provider) => provider.provider === "direct_bank"),
    "Ops readiness did not include direct_bank in the payment provider inventory."
  );

  console.log(`Direct bank provider readiness proof passed with status ${directBank.activation_status}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
