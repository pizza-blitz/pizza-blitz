function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cookieHeaderFromSetCookie(setCookie) {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie || ""];
  return values
    .flatMap((value) => value.split(/,(?=\s*pb_[^=]+=)/))
    .map((value) => value.split(";")[0].trim())
    .filter((value) => value.startsWith("pb_"))
    .join("; ");
}

async function portalLoginCookie(baseURL, adminId, adminPassword) {
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

async function apiJson(apiURL, endpoint, cookie, options = {}) {
  const response = await fetch(`${apiURL}${endpoint}`, {
    ...options,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function cleanupProofOrder({ apiURL, orderId, cookie, reason, strict = true }) {
  if (!apiURL || !orderId || !cookie) return { skipped: true };

  const result = await apiJson(apiURL, `/api/v1/restaurant/orders/${orderId}/cancel`, cookie, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reason: reason || "E2E proof cleanup after verification",
    }),
  });

  if (result.response.ok) return result.data;

  if (result.response.status === 409 && /closed orders/i.test(result.data.detail || "")) {
    return { skipped: true, detail: result.data.detail };
  }

  const message = `Could not clean proof order #${orderId}: ${JSON.stringify(result.data)}`;
  if (strict) throw new Error(message);
  console.warn(message);
  return { error: message };
}

module.exports = {
  apiJson,
  cleanupProofOrder,
  cookieHeaderFromSetCookie,
  portalLoginCookie,
};
