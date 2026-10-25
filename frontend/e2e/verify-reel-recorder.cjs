/* Reel recorder proof: fake camera -> MediaRecorder -> upload -> transcoded asset. */
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

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  assert(portalLogin.ok, "Portal login failed.");
  const cookie = cookieHeaderFromSetCookie(portalLogin.headers.get("set-cookie"));

  const browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
    });
    await context.addInitScript(() => {
      // CI machines have no camera; provide a deterministic canvas stream so the
      // real MediaRecorder -> upload -> transcode path is exercised.
      const canvas = document.createElement("canvas");
      canvas.width = 360;
      canvas.height = 240;
      const ctx = canvas.getContext("2d");
      let frame = 0;
      window.setInterval(() => {
        if (!ctx) return;
        frame += 1;
        ctx.fillStyle = `hsl(${frame % 360} 70% 45%)`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 28px sans-serif";
        ctx.fillText("Pizza Blitz reel", 36, 130);
      }, 40);
      const stream = canvas.captureStream(25);
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => stream,
      });
    });
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
    await page.goto(`${baseURL}/settings/media`, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="media-library-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });

    await page.getByTestId("media-record-open").click();
    const modal = page.getByTestId("media-record-modal");
    await modal.waitFor({ timeout: 20000 });
    await page.waitForFunction(
      () => {
        const video = document.querySelector(
          '[data-testid="media-record-preview"]'
        );
        return video instanceof HTMLVideoElement && video.readyState >= 2;
      },
      { timeout: 20000 }
    );

    await page.getByTestId("media-record-start").click();
    await page.getByText("Recording", { exact: false }).waitFor({ timeout: 10000 });
    await page.waitForTimeout(2200);
    await page.getByTestId("media-record-stop").click();
    await page.getByTestId("media-record-upload").waitFor({ timeout: 30000 });
    await page.getByTestId("media-record-name").fill("Browser recorded reel");
    await modal.screenshot({
      path: path.join(artifactsDir, "visible-reel-recorder.png"),
    });

    const uploadResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/restaurant/media/assets") &&
        response.request().method() === "POST" &&
        response.status() === 201,
      { timeout: 120000 }
    );
    await page.getByTestId("media-record-upload").click();
    const uploaded = await (await uploadResponse).json();
    const asset = uploaded.asset;
    assert(asset.media_type === "video", "Recorded clip was not stored as video.");
    assert(asset.poster_url, "Recorded clip poster was not generated.");
    assert(asset.duration_seconds > 0, "Recorded clip duration was not probed.");
    await page
      .getByTestId(`media-library-asset-${asset.id}`)
      .waitFor({ timeout: 30000 });
    const pageText = await page.getByTestId("media-library-page").innerText();
    assert(
      pageText.toLowerCase().includes("browser recorded reel"),
      "Recorded reel missing from the library."
    );

    console.log("Reel recorder proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
