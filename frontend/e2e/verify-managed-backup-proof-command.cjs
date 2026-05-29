const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3011";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:8010";
const adminId = process.env.E2E_ADMIN_ID || "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "admin123";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, label) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < 30000) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok || response.status === 401 || response.status === 403) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(750);
  }
  throw new Error(`${label} did not become ready at ${url}: ${lastError}`);
}

function cookieHeaderFromSetCookie(setCookie) {
  return (setCookie || "")
    .split(/,(?=\s*pb_[^=]+=)/)
    .map((value) => value.split(";")[0].trim())
    .filter((value) => value.startsWith("pb_"))
    .join("; ");
}

async function portalLogin() {
  const response = await fetch(`${baseURL}/api/admin-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: adminId, password: adminPassword, role: "admin" }),
  });
  const data = await response.json().catch(() => ({}));
  assert(response.ok, `Admin portal login failed: ${JSON.stringify(data)}`);
  const cookie = cookieHeaderFromSetCookie(response.headers.get("set-cookie"));
  assert(cookie.includes("pb_admin_session="), "Admin login did not return an admin session cookie.");
  return cookie;
}

async function main() {
  await waitForHttp(`${apiURL}/health`, "restaurant API");
  await waitForHttp(baseURL, "frontend");
  const cookie = await portalLogin();

  const readinessResponse = await fetch(`${apiURL}/api/v1/restaurant/ops/readiness`, {
    headers: { Cookie: cookie },
    cache: "no-store",
  });
  const readiness = await readinessResponse.json().catch(() => ({}));
  assert(readinessResponse.ok, `Readiness failed: ${JSON.stringify(readiness)}`);
  assert(readiness.restore_rehearsal, "Readiness did not include restore rehearsal status.");
  assert(readiness.production_database_plan?.backup_restore_drill?.some((step) => step.key === "restore_rehearsal"), "Production database plan did not include restore rehearsal step.");

  const invalidProof = await fetch(`${apiURL}/api/v1/restaurant/ops/backups/proof`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      proof_type: "managed_snapshot",
      reference: "bad",
      notes: "This invalid proof must not be recorded.",
    }),
  });
  assert(
    invalidProof.status === 422,
    `Invalid managed backup proof should be rejected, got ${invalidProof.status}.`
  );

  console.log(`Managed backup proof command passed with restore status ${readiness.restore_rehearsal.status}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
