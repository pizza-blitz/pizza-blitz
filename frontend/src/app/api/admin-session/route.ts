import { NextResponse } from "next/server";

const ADMIN_COOKIE = "pb_admin_session";
const SESSION_SECONDS = 60 * 60 * 8;

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const id = String(payload.id || "").trim();
  const password = String(payload.password || "").trim();

  const configuredId = process.env.PIZZA_BLITZ_ADMIN_ID;
  const configuredPassword = process.env.PIZZA_BLITZ_ADMIN_PASSWORD;
  const hasConfiguredCredentials = Boolean(configuredId && configuredPassword);
  const credentialsValid = hasConfiguredCredentials
    ? id === configuredId && password === configuredPassword
    : Boolean(id && password);

  if (!credentialsValid) {
    return NextResponse.json(
      { detail: "Invalid admin credentials." },
      { status: 401 }
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ADMIN_COOKIE,
    value: "local-admin",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return response;
}
