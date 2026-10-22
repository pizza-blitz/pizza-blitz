/* Store profile proof: admin edit -> public profile -> pause blocks ordering -> restore. */
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

function cookieHeaderFromSetCookie(setCookie) {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie || ""];
  return values
    .flatMap((value) => value.split(/,(?=\s*pb_[^=]+=)/))
    .map((value) => value.split(";")[0].trim())
    .filter((value) => value.startsWith("pb_"))
    .join("; ");
}

async function adminJson(token, endpoint, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function publicProfile() {
  const response = await fetch(`${apiURL}/api/v1/restaurant/storefront/profile`, {
    cache: "no-store",
  });
  return { response, data: await response.json().catch(() => ({})) };
}

function restorePayload(original) {
  return {
    name: original.name,
    tagline: original.tagline,
    phone: original.phone,
    email: original.email,
    address_line: original.address_line,
    map_url: original.map_url,
    instagram_url: original.instagram_url,
    opening_hours: original.opening_hours,
    online_ordering_paused: original.online_ordering_paused,
    pause_message: original.pause_message,
    prep_time_minutes: original.prep_time_minutes,
  };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const login = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(login.ok, `Admin login failed: ${await login.text()}`);
  const cookie = cookieHeaderFromSetCookie(login.headers.get("set-cookie"));
  assert(cookie.includes("pb_admin_session="), "Admin login did not return a session cookie.");

  const apiLogin = await fetch(`${apiURL}/api/v1/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  });
  if (!apiLogin.ok) {
    throw new Error(`Admin API login failed: ${await apiLogin.text()}`);
  }
  const token = (await apiLogin.json()).access_token;
  assert(token, "Admin API login did not return an access token.");

  const originalResponse = await adminJson(token, "/api/v1/restaurant/ops/store-profile");
  assert(originalResponse.response.ok, `Could not read store profile: ${JSON.stringify(originalResponse.data)}`);
  const original = restorePayload(originalResponse.data);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const cookiePairs = cookie
    .split(/;\s*/)
    .filter(Boolean)
    .map((pair) => {
      const [name, ...rest] = pair.split("=");
      return name && rest.length
        ? { name, value: rest.join("="), url: baseURL, httpOnly: true, sameSite: "Lax" }
        : null;
    })
    .filter(Boolean);
  assert(cookiePairs.length > 0, "Admin login returned no usable cookies.");
  await context.addCookies(cookiePairs);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(`${baseURL}/settings/store`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("store-profile-save").waitFor({ timeout: 20000 });
    await page.getByLabel("Store name").waitFor({ timeout: 15000 });

    const proofPhone = "+91 90000 12345";
    const proofAddress = "22 Proof Street, Bengaluru";
    await page.getByLabel("Store name").fill("Pizza Blitz Proof Kitchen");
    await page.getByLabel("Store tagline").fill("Proofed in a Blitz.");
    await page.getByLabel("Store phone").fill(proofPhone);
    await page.getByLabel("Store address").fill(proofAddress);
    await page.getByRole("button", { name: "Custom hours" }).click();
    await page.getByLabel("Monday opening time").fill("09:30");
    await page.getByLabel("Monday closing time").fill("22:30");
    await page.getByTestId("store-profile-save").click();
    await page
      .getByTestId("store-profile-message")
      .getByText("Store profile saved", { exact: false })
      .waitFor({ timeout: 15000 });

    const afterSave = await publicProfile();
    assert(afterSave.response.ok, "Public profile did not respond after save.");
    assert(
      afterSave.data.profile.name === "Pizza Blitz Proof Kitchen",
      `Public profile name was ${afterSave.data.profile.name}.`
    );
    assert(afterSave.data.profile.phone === proofPhone, "Public profile did not use the saved phone.");
    assert(afterSave.data.profile.address_line === proofAddress, "Public profile did not use the saved address.");
    assert(
      afterSave.data.profile.opening_hours?.mon?.open === "09:30",
      "Public profile did not use the saved Monday hours."
    );
    await page.screenshot({
      path: path.join(artifactsDir, "visible-store-profile.png"),
      fullPage: true,
    });

    await page.getByLabel("Pause online ordering").check();
    await page.getByLabel("Pause message").fill("Back at 6 PM after oven service.");
    await page.getByTestId("store-profile-save").click();
    await page
      .getByTestId("store-profile-message")
      .getByText("Store profile saved", { exact: false })
      .waitFor({ timeout: 15000 });

    const paused = await publicProfile();
    assert(paused.data.status.state === "paused", `Expected paused status, got ${paused.data.status.state}.`);
    assert(paused.data.status.accepting_orders === false, "Paused store still accepts orders.");

    const readiness = await fetch(`${apiURL}/api/v1/restaurant/orders/checkout-readiness`, {
      cache: "no-store",
    }).then((response) => response.json());
    assert(readiness.accepting_orders === false, "Checkout readiness stayed open while paused.");

    await page.goto(`${baseURL}/order`, { waitUntil: "domcontentloaded" });
    await page.getByText("Ordering paused", { exact: false }).first().waitFor({ timeout: 20000 });

    await page.screenshot({
      path: path.join(artifactsDir, "visible-store-profile-paused.png"),
      fullPage: false,
    });
    assert(!pageErrors.length, `Store profile page threw: ${pageErrors.join("; ")}`);
    console.log("Store profile proof passed.");
  } finally {
    const restore = await adminJson(token, "/api/v1/restaurant/ops/store-profile", {
      method: "PUT",
      body: JSON.stringify(original),
    });
    if (!restore.response.ok) {
      console.warn(`Could not restore store profile: ${JSON.stringify(restore.data)}`);
    }
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
