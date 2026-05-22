import { NextResponse } from "next/server";
import { ADMIN_COOKIE, createSessionToken, maxAgeForRole } from "@/lib/session";

function validAdminCredentials(id: string, password: string) {
  const configuredId = process.env.PIZZA_BLITZ_ADMIN_ID || "admin";
  const configuredPassword = process.env.PIZZA_BLITZ_ADMIN_PASSWORD || "admin123";
  return id === configuredId && password === configuredPassword;
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const id = String(payload.id || "").trim();
  const password = String(payload.password || "");

  if (!validAdminCredentials(id, password)) {
    return NextResponse.json(
      { detail: "Invalid admin credentials." },
      { status: 401 }
    );
  }

  const maxAge = maxAgeForRole("admin");
  const token = await createSessionToken(
    {
      role: "admin",
      subject: `admin:${id}`,
      displayName: "Restaurant Admin",
    },
    maxAge
  );
  const response = NextResponse.json({
    ok: true,
    role: "admin",
    displayName: "Restaurant Admin",
  });
  response.cookies.set({
    name: ADMIN_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  return response;
}
