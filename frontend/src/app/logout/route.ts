import { NextResponse } from "next/server";
import { ADMIN_COOKIE, CUSTOMER_COOKIE, STAFF_COOKIE } from "@/lib/session";

function expireCookie(response: NextResponse, name: string) {
  response.cookies.set({
    name,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const role = url.searchParams.get("role");
  const redirectTo = role === "customer" ? "/account/login" : "/login";
  const response = NextResponse.redirect(new URL(redirectTo, request.url));
  expireCookie(response, ADMIN_COOKIE);
  expireCookie(response, STAFF_COOKIE);
  expireCookie(response, CUSTOMER_COOKIE);
  return response;
}
