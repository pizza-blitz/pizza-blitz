const fs = require("fs");
const path = require("path");

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3011";
const apiURL =
  process.env.E2E_API_URL || (baseURL.includes("vercel.app") ? `${baseURL}/server` : "http://127.0.0.1:8010");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isProductionTarget(url) {
  return /^https:\/\/.+vercel\.app\b/i.test(url) || /^https:\/\/pizza-blitz\.vercel\.app\b/i.test(url);
}

async function fetchWithTimeout(url, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    assert(
      response.ok || response.status === 401 || response.status === 403,
      `${label} responded with ${response.status} ${response.statusText}.`
    );
    return response.status;
  } catch (error) {
    const reason = error?.name === "AbortError" ? "request timed out" : error.message;
    throw new Error(`${label} is not reachable at ${url}: ${reason}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPageText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    assert(response.ok, `${url} responded with ${response.status} ${response.statusText}.`);
    return await response.text();
  } catch (error) {
    const reason = error?.name === "AbortError" ? "request timed out" : error.message;
    throw new Error(`Could not read ${url}: ${reason}`);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * A browser proof is worthless if the port is actually served by an older
 * `next start` that was never stopped. Local runs compare the served page with
 * the build id on disk so a stale server fails loudly instead of passing.
 */
async function assertServingCurrentBuild() {
  const buildIdPath = path.join(__dirname, "..", ".next", "BUILD_ID");
  if (!fs.existsSync(buildIdPath)) return; // dev server or no local build
  const localBuildId = fs.readFileSync(buildIdPath, "utf8").trim();
  if (!localBuildId) return;
  const html = await fetchPageText(baseURL);
  if (html.includes("/_next/webpack-hmr")) {
    console.warn(
      "Audit preflight: target is a Next dev server, skipping the production build-id check."
    );
    return;
  }
  assert(
    html.includes(localBuildId),
    `${baseURL} is serving a stale build. The page does not contain the current ` +
      `BUILD_ID (${localBuildId}). Stop every process on this port ` +
      `(netstat -ano | findstr :3011), run \`npm run build\`, then \`npm start\` again.`
  );
  console.log(`Audit preflight: ${baseURL} serves build ${localBuildId}.`);
}

/**
 * `verify:messaging-inbox` posts to the inbound webhook, and that route answers
 * 503 while the backend has no `MESSAGING_WEBHOOK_TOKEN` and 401 when it does.
 * Probing the token check up front turns a failure that otherwise appears 20
 * minutes into the live audit into a two second message with the fix.
 */
async function assertMessagingWebhookReady() {
  const url = `${apiURL}/api/v1/restaurant/messaging/webhook/whatsapp?token=preflight-probe`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let status = 0;
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    status = response.status;
  } catch (error) {
    const reason = error?.name === "AbortError" ? "request timed out" : error.message;
    throw new Error(`Could not probe the messaging webhook at ${url}: ${reason}`);
  } finally {
    clearTimeout(timeout);
  }
  assert(
    status !== 503,
    "Audit preflight failed: the backend has no MESSAGING_WEBHOOK_TOKEN, so " +
      "verify:messaging-inbox cannot post an inbound message. Restart the backend with the " +
      "token the proof sends, for example " +
      "`$env:MESSAGING_WEBHOOK_TOKEN = \"messaging-proof-token\"` for a local run, or set " +
      "E2E_MESSAGING_TOKEN to the deployed token."
  );
  if (status === 401) {
    console.log("Audit preflight: messaging webhook is configured.");
    return;
  }
  console.warn(
    `Audit preflight warning: messaging webhook probe answered ${status}, which was not expected.`
  );
}

async function main() {
  const productionTarget = isProductionTarget(baseURL);
  const missing = [];

  if (productionTarget && !process.env.E2E_ADMIN_ID) missing.push("E2E_ADMIN_ID");
  if (productionTarget && !process.env.E2E_ADMIN_PASSWORD) missing.push("E2E_ADMIN_PASSWORD");

  assert(
    missing.length === 0,
    `Production audit environment is missing ${missing.join(
      ", "
    )}. Set these privately before running verify:audit or verify:quality against production.`
  );

  await fetchWithTimeout(baseURL, "Frontend audit target");
  await fetchWithTimeout(`${apiURL}/api/v1/restaurant/ops/readiness`, "Restaurant API audit target");

  if (!productionTarget) await assertServingCurrentBuild();
  await assertMessagingWebhookReady();

  if (productionTarget && process.env.E2E_ENABLE_STAFF_CREDENTIAL_WRITE !== "1") {
    console.warn(
      "Audit preflight warning: E2E_ENABLE_STAFF_CREDENTIAL_WRITE is not 1, so managed staff credential write proof will be skipped."
    );
  }

  console.log(`Audit preflight passed for ${baseURL} with API ${apiURL}.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
