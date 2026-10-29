/*
 * Customer memory proof: a signed-in guest tells Blaze an allergy, a brand-new
 * browser session signs back in with the same phone, and Blaze recites it
 * without being told again. The same proved session also unlocks the guest's
 * live order: Blaze names it in the greeting, answers "where is my order?"
 * with the real kitchen state and ETA, and its Track action opens that exact
 * order. "Repeat my usual" rebuilds that order in the concierge cart at live
 * prices, without retyping an item. The saved allergy is shown again on
 * checkout, placed onto the order record the kitchen reads, and Forget removes
 * the stored memory row.
 *
 * This is the browser-level half of `backend/tests/test_customer_memory.py` and
 * `backend/tests/test_assistant.py`: the API tests prove the rules, this proof
 * exercises the real cookie path through the Next proxy and the visible
 * "Remembered from last visit" strip.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
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

function createBrowserWatch(page) {
  const issues = [];
  page.on("pageerror", (error) => issues.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico|images\.unsplash\.com/i.test(text)) return;
    // Next logs this when a link prefetch is cancelled by a real navigation and
    // then falls back to a normal page load. The page still renders; the route
    // itself is exercised by the navigation link-health proof.
    if (/Failed to fetch RSC payload .* Falling back to browser navigation/i.test(text)) return;
    issues.push(`console error: ${text}`);
  });
  return {
    assertClean(label) {
      assert(!issues.length, `${label} produced browser issues:\n${issues.join("\n")}`);
    },
  };
}

async function signIn(context, phone, label) {
  const page = await context.newPage();
  await page.goto(`${baseURL}/account/login`, { waitUntil: "domcontentloaded" });
  await page
    .locator('[data-testid="customer-login"][data-hydrated="true"]')
    .waitFor({ timeout: 20000 });

  await page.getByLabel("Phone number").fill(phone);
  await page.getByRole("button", { name: "Send verification code" }).click();
  const debug = page.getByTestId("customer-otp-debug");
  await debug.waitFor({ timeout: 20000 });
  const debugText = (await debug.innerText()).trim();
  const codeMatch = debugText.match(/\d{6}/);
  assert(codeMatch, `${label}: no 6-digit development code in "${debugText}".`);

  await page.getByLabel("Verification code").fill(codeMatch[0]);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await page.waitForURL("**/account", { timeout: 25000 });
  await page.getByRole("heading", { name: "My Orders" }).waitFor({ timeout: 20000 });
  // Let Next finish link prefetches before navigating again; a cancelled
  // prefetch is logged by the framework as a network error and would be
  // mistaken for an application failure.
  await page.waitForLoadState("networkidle").catch(() => undefined);

  const cookies = await context.cookies();
  assert(
    cookies.some((cookie) => cookie.name === "pb_customer_session"),
    `${label}: customer session cookie was not set.`
  );
  return page;
}

async function openConcierge(page) {
  await page.goto(`${baseURL}/order`, { waitUntil: "domcontentloaded" });
  const launcher = page.getByRole("button", {
    name: /Open Blaze, the AI ordering concierge/i,
  });
  await launcher.waitFor({ state: "visible", timeout: 20000 });
  await launcher.click();
  const dialog = page.getByRole("dialog", { name: /Blaze, the Pizza Blitz ordering concierge/i });
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  const greeting = dialog.getByText(/Hey, I'm Blaze|Pizza Blitz concierge/i).first();
  await greeting.waitFor({ state: "visible", timeout: 25000 });
  return dialog;
}

async function readMemory(page, label) {
  const payload = await page.evaluate(async () => {
    const response = await fetch("/api/concierge", { cache: "no-store" });
    return { status: response.status, body: await response.json().catch(() => null) };
  });
  assert(
    payload.status === 200 && payload.body,
    `${label}: /api/concierge returned ${payload.status}.`
  );
  return payload.body;
}

async function createPickupOrder(phone) {
  const menuResponse = await fetch(`${apiURL}/api/v1/restaurant/menu/menu-with-customizations`, {
    cache: "no-store",
  });
  const menu = await menuResponse.json();
  assert(menuResponse.ok, `Could not fetch the menu: ${JSON.stringify(menu)}`);
  const item = menu
    .filter((menuItem) => menuItem.is_available)
    .sort((left, right) => Number(left.selling_price || 0) - Number(right.selling_price || 0))[0];
  assert(item, "No available menu item was found for the order-status proof.");

  const response = await fetch(`${apiURL}/api/v1/restaurant/orders/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_type: "pickup",
      customer_name: "Memory Proof Guest",
      customer_phone: phone,
      payment_method: "cash",
      items: [
        {
          menu_item_id: item.id,
          name: item.name,
          quantity: 1,
          price: Number(item.selling_price || 0),
        },
      ],
    }),
  });
  const data = await response.json().catch(() => ({}));
  assert(response.ok, `Could not create the proof order: ${JSON.stringify(data)}`);
  assert(data.order_id, "The proof order response did not include order_id.");
  return { orderId: data.order_id, itemName: item.name };
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  await waitForHttp(baseURL, "frontend");
  await waitForHttp(`${apiURL}/health`, "restaurant API");

  const phone = `93${String(Date.now()).slice(-8)}`;
  const browser = await chromium.launch({ headless: true });

  try {
    /* Visit one: sign in, tell Blaze about an allergy, see it stored. */
    const firstContext = await browser.newContext({ viewport: { width: 1440, height: 980 } });
    const firstPage = await signIn(firstContext, phone, "first visit");
    const firstWatch = createBrowserWatch(firstPage);
    const firstDialog = await openConcierge(firstPage);

    const firstInput = firstDialog.getByLabel("Message Blaze");
    await firstInput.fill("I'm allergic to peanuts");
    await firstInput.press("Enter");
    await firstDialog
      .getByText(/I saved your allergies for next time/i)
      .waitFor({ state: "visible", timeout: 25000 });
    await firstDialog
      .getByText(/Remembered from last visit:/i)
      .waitFor({ state: "visible", timeout: 10000 });
    await firstDialog.getByText(/avoid peanuts/i).first().waitFor({ state: "visible", timeout: 10000 });

    const saved = await readMemory(firstPage, "after saving");
    assert(saved.linked === true, "The concierge did not recognise the signed-in guest.");
    const savedAllergies = (saved.memory && saved.memory.allergies) || [];
    assert(
      savedAllergies.some((item) => /peanut/i.test(item)),
      `Stored allergies did not include peanuts: ${JSON.stringify(savedAllergies)}`
    );
    await firstPage.screenshot({
      path: path.join(artifactsDir, "customer-memory-saved.png"),
      fullPage: false,
    });
    firstWatch.assertClean("memory save flow");
    await firstContext.close();

    /* Visit two: a brand-new browser, same phone. Blaze must recall it alone. */
    const secondContext = await browser.newContext({ viewport: { width: 1440, height: 980 } });
    const secondPage = await signIn(secondContext, phone, "second visit");
    const secondWatch = createBrowserWatch(secondPage);

    // A live order placed with the same phone rides along with the verified
    // session: Blaze should know about it without being told the order id.
    const { orderId: liveOrderId, itemName: liveItemName } = await createPickupOrder(phone);

    // The greeting reaches the guest before any chat is opened: the landing
    // page itself says welcome back and names the allergy.
    await secondPage.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
    const invite = secondPage.getByTestId("blaze-invite");
    await invite.waitFor({ state: "visible", timeout: 15000 });
    await invite.getByText(/Welcome back/i).waitFor({ timeout: 15000 });
    await invite.getByText(/I remember: no peanuts/i).waitFor({ timeout: 15000 });
    await secondPage.screenshot({
      path: path.join(artifactsDir, "customer-memory-landing-invite.png"),
      fullPage: false,
    });

    const secondDialog = await openConcierge(secondPage);

    await secondDialog
      .getByText(/I remember you avoid:.*peanuts/i)
      .waitFor({ state: "visible", timeout: 25000 });
    const panel = secondDialog.getByText(/Remembered from last visit:/i);
    await panel.waitFor({ state: "visible", timeout: 10000 });
    await secondDialog.getByText(/avoid peanuts/i).first().waitFor({ state: "visible", timeout: 10000 });

    const recalled = await readMemory(secondPage, "after signing back in");
    assert(recalled.linked === true, "Second visit was not recognised as the same guest.");
    assert(
      ((recalled.memory && recalled.memory.allergies) || []).some((item) => /peanut/i.test(item)),
      "Second visit did not return the saved allergy."
    );
    await secondPage.screenshot({
      path: path.join(artifactsDir, "customer-memory-recall.png"),
      fullPage: false,
    });

    /* Order status: the same proof that unlocks memory also unlocks the live
       order, so the guest never retypes an order id and phone number. */
    await secondDialog
      .getByText(new RegExp(`Order #${liveOrderId}`))
      .first()
      .waitFor({ state: "visible", timeout: 25000 });

    const orderInput = secondDialog.getByLabel("Message Blaze");
    await orderInput.fill("Where is my order?");
    await orderInput.press("Enter");
    // "Start a new order" is only suggested by the tracking reply, so its
    // appearance proves the answer has rendered (the greeting does not offer it).
    await secondDialog
      .getByRole("button", { name: "Start a new order" })
      .waitFor({ state: "visible", timeout: 25000 });
    const statusLines = secondDialog.getByText(new RegExp(`Order #${liveOrderId}:`));
    assert(
      (await statusLines.count()) >= 2,
      "The tracking reply did not add a second order-status message."
    );
    const statusBubble = statusLines.last();
    const statusText = ((await statusBubble.textContent()) || "").replace(/\s+/g, " ").trim();
    assert(
      /Kitchen|prepar/i.test(statusText),
      `The order-status reply did not name the kitchen state: "${statusText}".`
    );
    assert(
      /ETA 20-25 min/i.test(statusText),
      `The order-status reply did not carry an ETA: "${statusText}".`
    );
    await secondPage.screenshot({
      path: path.join(artifactsDir, "customer-memory-order-status.png"),
      fullPage: false,
    });

    // After the tracking reply, the only "Track my order" control left is the
    // action chip it carries; the greeting's quick reply has been replaced.
    const trackAction = secondDialog.getByRole("button", { name: "Track my order" });
    await trackAction.waitFor({ state: "visible", timeout: 10000 });
    assert((await trackAction.count()) === 1, "Expected exactly one Track my order action.");
    await trackAction.click();
    await secondPage.waitForURL(
      new RegExp(`/track\\?order=${liveOrderId}&phone=${phone}`),
      { timeout: 20000 }
    );
    await secondPage
      .getByRole("heading", { name: `Order #${liveOrderId}` })
      .waitFor({ timeout: 25000 });
    const liveCountdown = secondPage.getByTestId("track-eta-countdown");
    await liveCountdown.waitFor({ timeout: 25000 });
    const countdownText = ((await liveCountdown.textContent()) || "").replace(/\s+/g, " ").trim();
    assert(
      /Ready in ~\d+ min/i.test(countdownText),
      `The linked tracking page did not load the live order: "${countdownText}".`
    );
    await secondPage.screenshot({
      path: path.join(artifactsDir, "customer-memory-order-track.png"),
      fullPage: false,
    });

    /* Repeat: the same proof rebuilds the guest's own last order at live
       prices, so a returning guest never retypes the items. */
    const forgetDialog = await openConcierge(secondPage);
    const forgetPanel = forgetDialog.getByText(/Remembered from last visit:/i);
    await forgetPanel.waitFor({ state: "visible", timeout: 15000 });

    const repeatInput = forgetDialog.getByLabel("Message Blaze");
    await repeatInput.fill("Repeat my usual");
    await repeatInput.press("Enter");
    const repeatReply = forgetDialog
      .getByText(new RegExp(`Repeating Order #${liveOrderId}`))
      .last();
    await repeatReply.waitFor({ state: "visible", timeout: 25000 });
    const repeatText = ((await repeatReply.textContent()) || "").replace(/\s+/g, " ").trim();
    assert(
      repeatText.includes(liveItemName),
      `The repeat reply did not name the ordered item "${liveItemName}": "${repeatText}".`
    );
    assert(
      /Your cart is Rs/i.test(repeatText),
      `The repeat reply did not price the rebuilt cart: "${repeatText}".`
    );
    // The footer is rendered from the server-priced cart, so one item there
    // proves the reply actually changed the cart and did not just echo words.
    await forgetDialog.getByText(/1 item · ₹/).waitFor({ state: "visible", timeout: 15000 });
    await repeatReply.scrollIntoViewIfNeeded();
    await secondPage.screenshot({
      path: path.join(artifactsDir, "customer-memory-repeat-order.png"),
      fullPage: false,
    });

    /* Checkout: the saved allergy follows the guest out of the chat and sits in
       front of them before they pay, so it is not just a chat memory. */
    await secondPage.goto(`${baseURL}/order`, { waitUntil: "domcontentloaded" });
    const allergyReminder = secondPage.getByTestId("checkout-allergy-memory");
    await allergyReminder.waitFor({ state: "visible", timeout: 20000 });
    const reminderText = ((await allergyReminder.textContent()) || "").replace(/\s+/g, " ").trim();
    assert(
      /allergic to peanuts/i.test(reminderText),
      `Checkout did not repeat the saved allergy: "${reminderText}".`
    );
    await allergyReminder.scrollIntoViewIfNeeded();
    await secondPage.screenshot({
      path: path.join(artifactsDir, "checkout-allergy-memory.png"),
      fullPage: false,
    });

    /* Payoff: place that order and read it back from the API. The saved allergy
       must be stored on the order record, which is what the KDS card and the
       printed kitchen ticket read — the kitchen hears it without the guest
       retyping it. */
    await secondPage.getByLabel("Full name").fill("Memory Proof Guest");
    await secondPage.getByTestId("customer-place-order").click();
    const confirmation = secondPage.getByTestId("order-confirmation");
    await confirmation.waitFor({ state: "visible", timeout: 30000 });
    const confirmationText = ((await confirmation.textContent()) || "").replace(/\s+/g, " ").trim();
    const createdMatch = confirmationText.match(/Order #(\d+)/);
    assert(createdMatch, `Checkout confirmation did not name the order: "${confirmationText}".`);
    const createdOrderId = Number(createdMatch[1]);
    const trackedResponse = await fetch(
      `${apiURL}/api/v1/restaurant/orders/track/${createdOrderId}?phone=${phone}`,
      { cache: "no-store" }
    );
    const trackedOrder = await trackedResponse.json().catch(() => ({}));
    assert(
      trackedResponse.ok,
      `The placed order could not be read back: ${JSON.stringify(trackedOrder)}`
    );
    assert(
      /Allergy:\s*peanuts/i.test(trackedOrder.notes || ""),
      `The placed order did not carry the saved allergy: "${trackedOrder.notes}".`
    );
    await secondPage.screenshot({
      path: path.join(artifactsDir, "checkout-allergy-order-placed.png"),
      fullPage: false,
    });

    /* Forget: the guest stays signed in, the stored row is deleted. */
    const forgetDialogAgain = await openConcierge(secondPage);
    const forgetPanelAgain = forgetDialogAgain.getByText(/Remembered from last visit:/i);
    await forgetPanelAgain.waitFor({ state: "visible", timeout: 15000 });
    await forgetDialogAgain.getByRole("button", { name: "Forget" }).click();
    await forgetDialogAgain
      .getByText(/I've forgotten what I had saved about you/i)
      .waitFor({ state: "visible", timeout: 15000 });
    await forgetPanelAgain.waitFor({ state: "hidden", timeout: 10000 });

    const forgotten = await readMemory(secondPage, "after forgetting");
    const remaining = (forgotten.memory && forgotten.memory.allergies) || [];
    assert(
      !remaining.some((item) => /peanut/i.test(item)),
      `Forget left the allergy behind: ${JSON.stringify(remaining)}`
    );
    await secondPage.screenshot({
      path: path.join(artifactsDir, "customer-memory-forgotten.png"),
      fullPage: false,
    });
    secondWatch.assertClean("memory recall and forget flow");
    await secondContext.close();

    console.log(
      `Customer memory proof passed for ${phone}: saved, recalled in a fresh session, live order #${liveOrderId} named, tracked and repeated, reminded at checkout and placed with the allergy on the order (#${createdOrderId}), forgotten.`
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
