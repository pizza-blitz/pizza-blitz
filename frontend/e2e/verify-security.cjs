/* Security proof: enable 2FA, re-login with TOTP, disable, and permissions UI. */
const crypto = require("crypto");
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

function cookieHeaderFromSetCookie(setCookie) {
  if (!setCookie) return "";
  return setCookie
    .split(/,(?=[^;]+=)/)
    .map((part) => part.split(";")[0].trim())
    .join("; ");
}

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(input).toUpperCase().replace(/=+$/, "");
  let bits = "";
  for (const character of clean) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 secret.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 1000 / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(value % 1000000).padStart(6, "0");
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

async function adminLogin() {
  const response = await fetch(`${apiURL}/api/v1/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function disableTwoFactorViaApi(secret) {
  const login = await adminLogin();
  if (!login.data.two_factor_required) return;
  const verified = await fetch(`${apiURL}/api/v1/auth/2fa/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challenge_token: login.data.challenge_token,
      code: totp(secret),
    }),
  });
  const session = await verified.json().catch(() => ({}));
  if (!verified.ok) return;
  await fetch(`${apiURL}/api/v1/auth/2fa/disable`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code: totp(secret) }),
  });
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  let secret = null;
  try {
    const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
    });
    assert(portalLogin.ok, "Portal login failed.");
    const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
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
      await page.goto(`${baseURL}/settings/security`, { waitUntil: "domcontentloaded" });
      await page
        .locator('[data-testid="security-page"][data-hydrated="true"]')
        .waitFor({ timeout: 30000 });
      await page.getByTestId("security-2fa-status").waitFor({ timeout: 30000 });

      await page.getByTestId("security-2fa-start").click();
      const secretNode = page.getByTestId("security-2fa-secret");
      await secretNode.waitFor({ timeout: 15000 });
      secret = (await secretNode.innerText()).trim();
      assert(secret.length >= 16, "Authenticator secret was not shown.");

      await page.getByTestId("security-2fa-code").fill(totp(secret));
      await page.getByTestId("security-2fa-confirm").click();
      await page.getByTestId("security-recovery-codes").waitFor({ timeout: 20000 });
      const recoveryText = await page.getByTestId("security-recovery-codes").innerText();
      assert(/save these recovery codes/i.test(recoveryText), "Recovery codes were not shown.");

      const permissionToggle = page.getByTestId("staff-permission-reports.view");
      if (await permissionToggle.count()) {
        await permissionToggle.check();
        await page.getByTestId("save-permissions").click();
        await page.getByText("Staff permissions saved.").waitFor({ timeout: 15000 });
        await permissionToggle.uncheck();
        await page.getByTestId("save-permissions").click();
      }

      await page.getByTestId("security-2fa-status").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(artifactsDir, "visible-security-2fa.png"),
        fullPage: false,
      });

      // Clear the portal cookie and prove the login now asks for a TOTP code.
      await context.clearCookies();
      await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" });
      await page
        .locator('[data-testid="portal-login"][data-hydrated="true"]')
        .waitFor({ timeout: 20000 });
      await page.getByPlaceholder("Enter admin ID").fill(adminId);
      await page.getByPlaceholder("Enter password").fill(adminPassword);
      await page.getByRole("button", { name: /Sign In to Portal/i }).click();
      const otpInput = page.getByTestId("portal-2fa-code");
      await otpInput.waitFor({ timeout: 20000 });
      await page.screenshot({
        path: path.join(artifactsDir, "visible-security-login-2fa.png"),
        fullPage: false,
      });
      await otpInput.fill(totp(secret));
      await page.getByRole("button", { name: /Verify code/i }).click();
      await page.waitForURL("**/dashboard", { timeout: 30000 });

      await page.goto(`${baseURL}/settings/security`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("security-disable-code").waitFor({ timeout: 20000 });
      await page.getByTestId("security-disable-code").fill(totp(secret));
      await page.getByTestId("security-disable").click();
      await page.getByText("Two-factor authentication is off.").waitFor({ timeout: 20000 });
      secret = null;

      const status = await adminLogin();
      assert(!status.data.two_factor_required, "2FA was still required after disable.");
      assert(status.data.access_token, "Normal login did not resume.");

      console.log("Security proof passed.");
    } finally {
      await browser.close();
    }
  } finally {
    if (secret) {
      await disableTwoFactorViaApi(secret).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
