export const ADMIN_COOKIE = "pb_admin_session";
export const CUSTOMER_COOKIE = "pb_customer_session";

export type SessionRole = "admin" | "customer";

export type SessionPayload = {
  role: SessionRole;
  subject: string;
  displayName?: string | null;
  phone?: string | null;
  email?: string | null;
  exp: number;
};

const ADMIN_SESSION_SECONDS = 60 * 60 * 8;
const CUSTOMER_SESSION_SECONDS = 60 * 60 * 24 * 30;

function getSessionSecret() {
  return (
    process.env.PIZZA_BLITZ_SESSION_SECRET ||
    process.env.PIZZA_BLITZ_ADMIN_PASSWORD ||
    "pizza-blitz-local-session-secret"
  );
}

function base64UrlEncode(value: string | ArrayBuffer) {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function signPayload(payloadPart: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadPart)
  );
  return base64UrlEncode(signature);
}

export function maxAgeForRole(role: SessionRole) {
  return role === "admin" ? ADMIN_SESSION_SECONDS : CUSTOMER_SESSION_SECONDS;
}

export async function createSessionToken(
  payload: Omit<SessionPayload, "exp">,
  maxAgeSeconds = maxAgeForRole(payload.role)
) {
  const sessionPayload: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + maxAgeSeconds,
  };
  const payloadPart = base64UrlEncode(JSON.stringify(sessionPayload));
  const signaturePart = await signPayload(payloadPart);
  return `${payloadPart}.${signaturePart}`;
}

export async function verifySessionToken(
  token: string | undefined,
  expectedRole?: SessionRole
) {
  if (!token) return null;
  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart) return null;

  const expectedSignature = await signPayload(payloadPart);
  if (signaturePart !== expectedSignature) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(payloadPart)) as SessionPayload;
    if (expectedRole && payload.role !== expectedRole) return null;
    if (!payload.subject || !payload.role || payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
