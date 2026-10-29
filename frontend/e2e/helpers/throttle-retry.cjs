/*
 * Preload for the live audit.
 *
 * The live audit runs 60-plus proofs against one backend from one client
 * address inside a few minutes, and sign-in is deliberately throttled per
 * client per minute. A suite that reaches the throttle is behaving like a very
 * busy restaurant, so this preload treats a 429 on the sign-in routes the way
 * a patient client would: wait for the window the server names, then retry.
 *
 * Only sign-in routes are retried. Every other request passes through
 * untouched, so a 429 anywhere else still fails its proof loudly. The
 * role-gates proof is skipped because it asserts the throttle itself.
 */

const { setTimeout: delay } = require("node:timers/promises");

const PATCHED = Symbol.for("pizza-blitz.throttle-retry");
const LOGIN_ROUTES = [
  "/api/v1/auth/admin/login",
  "/api/v1/auth/staff/login",
  "/api/admin-session",
];
const MAX_ATTEMPTS = 6;
// The limiter is a sliding window: Retry-After frees exactly one slot, and a
// page request can take it first. One extra second keeps the retry from racing
// the window boundary.
const RETRY_MARGIN_SECONDS = 1;

function entryFile() {
  return (process.argv[1] || "").replace(/\\/g, "/");
}

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input.url === "string") return input.url;
  return "";
}

function isLoginRequest(input) {
  const url = requestUrl(input);
  return Boolean(url) && LOGIN_ROUTES.some((route) => url.includes(route));
}

function install() {
  if (typeof globalThis.fetch !== "function" || globalThis.fetch[PATCHED]) return;
  const originalFetch = globalThis.fetch;

  const fetchWithThrottleRetry = async function fetchWithThrottleRetry(
    input,
    init
  ) {
    let response = await originalFetch(input, init);
    for (
      let attempt = 2;
      response.status === 429 && isLoginRequest(input) && attempt <= MAX_ATTEMPTS;
      attempt += 1
    ) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitSeconds =
        (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 5) +
        RETRY_MARGIN_SECONDS;
      console.warn(
        `Sign-in throttled; waiting ${waitSeconds}s before retry ${attempt} of ${MAX_ATTEMPTS}.`
      );
      await response.text().catch(() => "");
      await delay(waitSeconds * 1000);
      response = await originalFetch(input, init);
    }
    return response;
  };
  fetchWithThrottleRetry[PATCHED] = true;
  globalThis.fetch = fetchWithThrottleRetry;
}

if (!entryFile().endsWith("/verify-role-gates.cjs")) {
  install();
}
