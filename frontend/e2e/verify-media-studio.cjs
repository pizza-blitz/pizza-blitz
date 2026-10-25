/* Media Studio proof: upload once, pick in the menu image dialog, persist URL. */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://localhost:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");
const PIZZA = fs.readFileSync(path.join(__dirname, "fixtures", "pizza-proof.jpg"));

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
  assert(portalLogin.ok, `Portal login failed: ${await portalLogin.text()}`);
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
    await page.goto(`${baseURL}/settings/media`, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="media-library-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });
    const storageBadge = page.getByTestId("media-storage-status");
    await storageBadge.waitFor({ timeout: 20000 });
    assert(
      (await storageBadge.innerText()).toLowerCase().includes("local disk"),
      "Media storage badge did not report local mode."
    );

    const uploadResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/restaurant/media/assets") &&
        response.request().method() === "POST" &&
        response.status() === 201,
      { timeout: 20000 }
    );
    await page.locator('input[type="file"]').setInputFiles({
      name: "proof-pizza.jpg",
      mimeType: "image/jpeg",
      buffer: PIZZA,
    });
    const upload = await uploadResponse;
    const uploaded = await upload.json();
    const asset = uploaded.asset;
    assert(asset && asset.url.includes("/media/library/"), "Uploaded asset URL missing.");

    const card = page.getByTestId(`media-library-asset-${asset.id}`);
    await card.waitFor({ timeout: 20000 });

    const videoPath = path.join(os.tmpdir(), `pizza-reel-${Date.now()}.mp4`);
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=#e64a19:s=360x640:d=2",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=stereo",
        "-shortest",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        videoPath,
      ],
      { stdio: "ignore" }
    );
    const videoResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/restaurant/media/assets") &&
        response.request().method() === "POST" &&
        response.status() === 201,
      { timeout: 60000 }
    );
    await page.locator('input[type="file"]').setInputFiles(videoPath);
    const videoUpload = await videoResponse;
    const videoAsset = (await videoUpload.json()).asset;
    assert(videoAsset.media_type === "video", "Video asset was not stored as video.");
    assert(videoAsset.poster_url, "Video poster was not generated.");
    assert(videoAsset.duration_seconds > 0, "Video duration was not probed.");
    const videoCard = page.getByTestId(`media-library-asset-${videoAsset.id}`);
    await videoCard.waitFor({ timeout: 30000 });
    assert(
      (await videoCard.innerText()).toLowerCase().includes("reel"),
      "Video reel badge missing."
    );
    fs.unlinkSync(videoPath);

    await page.screenshot({
      path: path.join(artifactsDir, "visible-media-studio.png"),
      fullPage: false,
    });

    await page.goto(`${baseURL}/menu`, { waitUntil: "domcontentloaded" });
    const imageButton = page.locator('[data-testid^="menu-image-button-"]').first();
    await imageButton.waitFor({ timeout: 30000 });
    await imageButton.click();
    await page.getByTestId("menu-image-modal").waitFor({ timeout: 15000 });
    await page.getByTestId("menu-image-library-open").click();
    await page.getByTestId("menu-image-library-dialog").waitFor({ timeout: 15000 });
    await page.getByTestId(`media-asset-${asset.id}`).click();

    await page.getByText("Image updated for", { exact: false }).waitFor({ timeout: 20000 });
    await page.getByLabel("Close image dialog").click();

    const tokenResponse = await fetch(`${apiURL}/api/v1/auth/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: adminId, password: adminPassword }),
    });
    const tokenData = await tokenResponse.json();
    const menuResponse = await fetch(`${apiURL}/api/v1/restaurant/menu/menu`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const menu = await menuResponse.json();
    assert(
      menu.some((item) => item.image_url === asset.url),
      "Library image was not attached to a menu item."
    );

    const cleanup = await fetch(`${apiURL}/api/v1/restaurant/media/assets/${asset.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    assert(cleanup.status === 409, "In-use asset should not be deletable.");

    console.log("Media Studio proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
