import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  STAFF_COOKIE,
  createSessionToken,
  maxAgeForRole,
} from "@/lib/session";

type PortalLoginRole = "admin" | "staff";

function credentialsForRole(role: PortalLoginRole) {
  if (role === "staff") {
    return {
      id: process.env.PIZZA_BLITZ_STAFF_ID || "staff",
      password: process.env.PIZZA_BLITZ_STAFF_PASSWORD || "staff123",
      displayName: "Counter Staff",
      subjectPrefix: "staff",
      cookie: STAFF_COOKIE,
      clearCookie: ADMIN_COOKIE,
    };
  }
  return {
    id: process.env.PIZZA_BLITZ_ADMIN_ID || "admin",
    password: process.env.PIZZA_BLITZ_ADMIN_PASSWORD || "admin123",
    displayName: "Restaurant Admin",
    subjectPrefix: "admin",
    cookie: ADMIN_COOKIE,
    clearCookie: STAFF_COOKIE,
  };
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const role: PortalLoginRole = payload.role === "staff" ? "staff" : "admin";
  const credentials = credentialsForRole(role);
  const id = String(payload.id || "").trim();
  const password = String(payload.password || "");

  if (id !== credentials.id || password !== credentials.password) {
    return NextResponse.json(
      { detail: `Invalid ${role} credentials.` },
      { status: 401 }
    );
  }

  const maxAge = maxAgeForRole(role);
  const token = await createSessionToken(
    {
      role,
      subject: `${credentials.subjectPrefix}:${id}`,
      displayName: credentials.displayName,
    },
    maxAge
  );
  const response = NextResponse.json({
    ok: true,
    role,
    displayName: credentials.displayName,
    startPath: role === "staff" ? "/orders" : "/dashboard",
  });
  response.cookies.set({
    name: credentials.cookie,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  response.cookies.set({
    name: credentials.clearCookie,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
