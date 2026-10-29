/* Blaze concierge proof: 3D avatar, voice-ready chat, and real cart hand-off. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
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
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`${label} did not become ready at ${url}: ${lastError}`);
}

function watch(page, label) {
  const issues = [];
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico|images\.unsplash\.com/i.test(text)) return;
    issues.push(`console error: ${text}`);
  });
  return () => assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
}

async function openConcierge(page) {
  const launcher = page.getByRole("button", {
    name: /Open Blaze, the AI ordering concierge/i,
  });
  await launcher.waitFor({ state: "visible", timeout: 20000 });
  await launcher.click();
  const dialog = page.getByRole("dialog", { name: /Blaze, the Pizza Blitz ordering concierge/i });
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  const greeting = dialog.getByText(/Hey, I'm Blaze|Pizza Blitz concierge/i).first();
  await greeting.waitFor({ state: "visible", timeout: 20000 });
  return dialog;
}

async function run() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(`${baseURL}/order`, "order page");
  const browser = await chromium.launch();
  try {
    // A landing visitor is greeted by Blaze without hunting for the dock.
    const landing = await browser.newPage({ viewport: { width: 1440, height: 980 } });
    const assertLandingClean = watch(landing, "landing invite");
    await landing.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
    const invite = landing.getByTestId("blaze-invite");
    await invite.waitFor({ state: "visible", timeout: 15000 });
    await landing.waitForTimeout(500);
    await landing.screenshot({
      path: path.join(artifactsDir, "blaze-landing-invite.png"),
      fullPage: false,
    });
    const inviteText = await invite.innerText();
    assert(/Blaze/i.test(inviteText), "The landing greeting did not introduce Blaze.");
    await invite
      .getByRole("button", { name: /Chat with Blaze about your order/i })
      .click();
    const inviteDialog = landing.getByRole("dialog", {
      name: /Blaze, the Pizza Blitz ordering concierge/i,
    });
    await inviteDialog.waitFor({ state: "visible", timeout: 10000 });
    await landing.keyboard.press("Escape");
    await inviteDialog
      .waitFor({ state: "hidden", timeout: 10000 })
      .catch(() => undefined);

    // Once the greeting has been opened or dismissed it must stay gone for
    // this browser session, even after a reload.
    await landing.reload({ waitUntil: "domcontentloaded" });
    await landing.waitForTimeout(5200);
    assert(
      (await landing.getByTestId("blaze-invite").count()) === 0,
      "The Blaze greeting returned after it had been opened."
    );
    assertLandingClean();
    await landing.close();

    const mobileLanding = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const assertMobileLandingClean = watch(mobileLanding, "mobile landing invite");
    await mobileLanding.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
    await mobileLanding.getByTestId("blaze-invite").waitFor({ state: "visible", timeout: 15000 });
    await mobileLanding.waitForTimeout(400);
    await mobileLanding.screenshot({
      path: path.join(artifactsDir, "blaze-landing-invite-mobile.png"),
      fullPage: false,
    });
    assertMobileLandingClean();
    await mobileLanding.close();

    const desktop = await browser.newPage({ viewport: { width: 1440, height: 980 } });
    const assertDesktopClean = watch(desktop, "desktop concierge");
    await desktop.goto(`${baseURL}/order`, { waitUntil: "domcontentloaded" });
    await desktop.waitForTimeout(1800);
    const dialog = await openConcierge(desktop);

    const canvas = dialog.locator("canvas");
    await canvas.first().waitFor({ state: "visible", timeout: 10000 });
    await desktop.waitForTimeout(1200);
    await desktop.screenshot({
      path: path.join(artifactsDir, "blaze-concierge-desktop.png"),
      fullPage: false,
    });

    const input = dialog.getByLabel("Message Blaze");
    await input.fill("two margherita pizzas and garlic bread");
    await input.press("Enter");
    await dialog.getByText(/Added 2 . Margherita Pizza/i).waitFor({
      state: "visible",
      timeout: 20000,
    });

    const cartBar = dialog.getByRole("button", { name: /3 items/i }).first();
    await cartBar.waitFor({ state: "visible", timeout: 8000 });
    await desktop.waitForTimeout(400);
    await desktop.screenshot({
      path: path.join(artifactsDir, "blaze-order-built.png"),
      fullPage: false,
    });

    await dialog.getByRole("button", { name: /^Checkout$/i }).last().click();
    await dialog.waitFor({ state: "hidden", timeout: 8000 });
    await desktop.waitForTimeout(900);
    const orderText = await desktop.locator("main").innerText();
    assert(/Margherita Pizza/i.test(orderText), "Blaze did not hand the cart to /order.");
    assert(/Garlic Bread/i.test(orderText), "Garlic Bread was missing from the handed-off cart.");
    await desktop.screenshot({
      path: path.join(artifactsDir, "blaze-cart-handoff.png"),
      fullPage: false,
    });
    assertDesktopClean();
    await desktop.close();

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const assertMobileClean = watch(mobile, "mobile concierge");
    await mobile.goto(`${baseURL}/order`, { waitUntil: "domcontentloaded" });
    await mobile.waitForTimeout(1400);
    const mobileDialog = await openConcierge(mobile);
    await mobile.waitForTimeout(900);
    await mobile.screenshot({
      path: path.join(artifactsDir, "blaze-concierge-mobile.png"),
      fullPage: false,
    });
    assertMobileClean();
    await mobile.close();

    console.log("PASS: Blaze concierge opened, answered, built a cart, and handed it to checkout.");
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
