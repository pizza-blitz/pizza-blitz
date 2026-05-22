import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_COOKIE,
  CUSTOMER_COOKIE,
  verifySessionToken,
} from "@/lib/session";

const adminRoutes = [
  "/dashboard",
  "/ceo",
  "/orders",
  "/operations",
  "/shifts",
  "/daily",
  "/sales",
  "/reports",
  "/receipt",
  "/invoices",
  "/breakeven",
  "/menu",
  "/inventory",
  "/recipes",
  "/customers",
  "/promotions",
  "/vendors",
  "/waste",
  "/expenses",
  "/ai-insights",
  "/purchase-orders",
  "/settings",
];

function isPathIn(pathname: string, routes: string[]) {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function redirectWithClearedCookie(
  request: NextRequest,
  pathname: string,
  cookieName: string,
  nextPath?: string
) {
  const url = new URL(pathname, request.url);
  if (nextPath) {
    url.searchParams.set("next", nextPath);
  }
  const response = NextResponse.redirect(url);
  response.cookies.set({
    name: cookieName,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const adminSession = await verifySessionToken(
    request.cookies.get(ADMIN_COOKIE)?.value,
    "admin"
  );
  const customerSession = await verifySessionToken(
    request.cookies.get(CUSTOMER_COOKIE)?.value,
    "customer"
  );

  if (pathname === "/login" && adminSession) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (pathname === "/account/login" && customerSession) {
    return NextResponse.redirect(new URL("/account", request.url));
  }

  if (isPathIn(pathname, adminRoutes) && !adminSession) {
    return redirectWithClearedCookie(request, "/login", ADMIN_COOKIE, pathname);
  }

  if ((pathname === "/account" || pathname.startsWith("/account/")) && pathname !== "/account/login") {
    if (!customerSession) {
      return redirectWithClearedCookie(
        request,
        "/account/login",
        CUSTOMER_COOKIE,
        pathname
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
