/* Social approval proof: pending post -> admin review -> approved -> dry run. */
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

  const token = await fetch(`${apiURL}/api/v1/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword }),
  }).then((response) => response.json());
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token.access_token}`,
  };
  const created = await fetch(`${apiURL}/api/v1/restaurant/social/posts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: `Approval proof ${Date.now()}`,
      message: "A scheduled reel announcement that needs brand approval.",
      image_url: "https://example.com/pizza-approval.jpg",
      media_type: "image",
      platforms: ["instagram"],
      status: "ready",
      scheduled_at: new Date(Date.now() - 60_000).toISOString(),
      requires_approval: true,
    }),
  });
  const createdBody = await created.json();
  assert(created.ok, `Social post create failed: ${JSON.stringify(createdBody)}`);
  const post = createdBody.post;
  assert(post.approval_status === "pending", "Post was not created as pending.");

  const blocked = await fetch(
    `${apiURL}/api/v1/restaurant/social/posts/${post.id}/publish`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ dry_run: false }),
    }
  );
  assert(blocked.status === 409, `Expected publish block, received ${blocked.status}.`);

  const portalLogin = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
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
    await page.goto(`${baseURL}/social?post=${post.id}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("heading", { name: "Social Publishing" }).waitFor({
      timeout: 30000,
    });
    await page.getByTestId("social-approve").waitFor({ timeout: 30000 });
    page.once("dialog", (dialog) =>
      void dialog.accept("Approved for the weekend reel campaign.")
    );
    await page.getByTestId("social-approve").click();
    await page.getByText("Post approved for publishing", { exact: false }).waitFor({
      timeout: 30000,
    });

    const approved = await fetch(
      `${apiURL}/api/v1/restaurant/social/posts?limit=50`,
      { headers }
    ).then((response) => response.json());
    const row = approved.find((item) => item.id === post.id);
    assert(row.approval_status === "approved", "Approval status did not persist.");
    assert(row.approved_by, "Approver was not recorded.");

    await page.getByRole("button", { name: "Dry Run" }).click();
    await page.getByText("Dry run checked", { exact: false }).waitFor({
      timeout: 30000,
    });
    await page.screenshot({
      path: path.join(artifactsDir, "visible-social-approvals.png"),
      fullPage: false,
    });

    console.log("Social approval proof passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
