/* Menu media proof: upload -> served -> admin thumbnail -> customer menu image. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3dWQAAAABJRU5ErkJggg==",
  "base64"
);

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

async function api(token, endpoint, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
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

  const login = await fetch(`${apiURL}/api/v1/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  });
  if (!login.ok) throw new Error(`Admin API login failed: ${await login.text()}`);
  const token = (await login.json()).access_token;

  const menu = await api(null, "/api/v1/restaurant/menu/menu");
  assert(menu.response.ok, "Could not read the menu.");
  const item = menu.data.find((row) => row.name === "Garlic Bread");
  assert(item, "Garlic Bread is missing from the seeded menu.");

  const form = new FormData();
  form.append("file", new Blob([PNG_BYTES], { type: "image/png" }), "proof-menu.png");
  form.append("alt", "Proof garlic bread image");
  const uploaded = await api(token, `/api/v1/restaurant/menu/menu/${item.id}/image`, {
    method: "POST",
    body: form,
  });
  assert(uploaded.response.ok, `Upload failed: ${JSON.stringify(uploaded.data)}`);
  const imageUrl = uploaded.data.image_url;
  assert(imageUrl && imageUrl.startsWith("/media/menu/"), `Unexpected image URL: ${imageUrl}`);
  assert(uploaded.data.image_alt === "Proof garlic bread image", "Alt text was not saved.");

  const served = await fetch(`${baseURL}${imageUrl}`, { cache: "no-store" });
  assert(served.ok, `Media rewrite returned ${served.status}.`);
  assert(
    (served.headers.get("content-type") || "").startsWith("image/png"),
    `Media content type was ${served.headers.get("content-type")}.`
  );

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(portalLogin.ok, `Portal login failed: ${await portalLogin.text()}`);
  const cookie = (
    portalLogin.headers.getSetCookie?.() ||
    [portalLogin.headers.get("set-cookie") || ""]
  )
    .flatMap((value) => value.split(/,(?=\s*pb_[^=]+=)/))
    .map((value) => value.split(";")[0].trim())
    .filter((value) => value.startsWith("pb_"))
    .join("; ");

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies(
      cookie
        .split(/;\s*/)
        .filter(Boolean)
        .map((pair) => {
          const [name, ...rest] = pair.split("=");
          return { name, value: rest.join("="), url: baseURL, httpOnly: true, sameSite: "Lax" };
        })
    );

    const adminMenu = await context.newPage();
    await adminMenu.goto(`${baseURL}/menu`, { waitUntil: "networkidle" });
    await adminMenu
      .locator(`img[src*="${imageUrl}"]`)
      .first()
      .waitFor({ timeout: 20000 });
    await adminMenu.getByTestId(`menu-image-button-${item.id}`).click();
    await adminMenu.getByTestId("menu-image-modal").waitFor({ timeout: 10000 });
    await adminMenu.screenshot({
      path: path.join(artifactsDir, "visible-menu-media-admin.png"),
      fullPage: false,
    });
    await adminMenu.getByRole("button", { name: "Close image dialog" }).click();

    const customer = await context.newPage();
    await customer.goto(`${baseURL}/order`, { waitUntil: "networkidle" });
    await customer
      .locator(`img[src*="${imageUrl}"]`)
      .first()
      .waitFor({ timeout: 20000 });
    await customer.getByText("Garlic Bread", { exact: false }).first().scrollIntoViewIfNeeded();
    await customer.screenshot({
      path: path.join(artifactsDir, "visible-menu-media-customer.png"),
      fullPage: false,
    });

    const stored = await api(null, "/api/v1/restaurant/menu/menu");
    const storedItem = stored.data.find((row) => row.id === item.id);
    assert(storedItem.image_url === imageUrl, "Menu payload did not keep the image URL.");
    assert(storedItem.image_alt === "Proof garlic bread image", "Menu payload lost the alt text.");

    console.log("Menu media proof passed.");
  } finally {
    await browser.close();
    await api(token, `/api/v1/restaurant/menu/menu/${item.id}/image`, { method: "DELETE" });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
