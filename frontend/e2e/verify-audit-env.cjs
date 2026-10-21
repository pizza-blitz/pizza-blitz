const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
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
