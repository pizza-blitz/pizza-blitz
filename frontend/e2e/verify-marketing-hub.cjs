/* Marketing Hub proof: schedule an Instagram reel -> calendar shows the creative. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://localhost:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";
const artifactsDir = path.join(__dirname, "artifacts");
const title = `Proof reel ${Date.now()}`;
const today = new Date();
const schedule = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}T12:00`;

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
  const headers = { Authorization: `Bearer ${adminToken.access_token}` };

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
    await page.goto(`${baseURL}/marketing`, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-testid="marketing-hub-page"][data-hydrated="true"]')
      .waitFor({ timeout: 30000 });

    await page.getByText("Schedule content", { exact: true }).click();
    await page.getByTestId("marketing-title").fill(title);
    await page.getByTestId("marketing-message").fill(
      "A behind-the-scenes reel of the pizza line at full speed."
    );
    await page.getByTestId("marketing-media-type").selectOption("reel");
    await page
      .getByTestId("marketing-video-url")
      .fill("https://cdn.example.com/pizza-blitz-reel.mp4");
    await page.getByTestId("marketing-schedule").fill(schedule);
    await page.getByTestId("marketing-create").click();
    await page.getByText(`Scheduled ${title}`, { exact: false }).waitFor({
      timeout: 20000,
    });

    const posts = await fetch(`${apiURL}/api/v1/restaurant/social/posts?limit=20`, {
      headers,
    }).then((response) => response.json());
    const post = posts.find((row) => row.title === title);
    assert(post, "Scheduled reel post was not created.");
    assert(post.media_type === "reel", "Post media type was not reel.");
    assert(
      post.video_url === "https://cdn.example.com/pizza-blitz-reel.mp4",
      "Reel video URL missing."
    );

    const calendar = await fetch(
      `${apiURL}/api/v1/restaurant/marketing/calendar?year=${today.getFullYear()}&month=${today.getMonth() + 1}`,
      { headers }
    ).then((response) => response.json());
    const calendarItem = calendar.items.find(
      (row) => row.id === `social-${post.id}`
    );
    assert(calendarItem, "Reel did not appear in the marketing calendar.");
    assert(calendarItem.media_type === "reel", "Calendar item media type mismatch.");

    await page.getByText(title, { exact: false }).first().waitFor({ timeout: 20000 });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-marketing-hub.png"),
      fullPage: false,
    });

    console.log("Marketing Hub proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
