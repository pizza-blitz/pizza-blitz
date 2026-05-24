import { NextResponse, type NextRequest } from "next/server";
import {
  adminOnlyRoutePrefixes,
  isPathIn,
  staffRoutePrefixes,
} from "@/lib/access";
import {
  ADMIN_COOKIE,
  CUSTOMER_COOKIE,
  STAFF_COOKIE,
  verifySessionToken,
} from "@/lib/session";

function redirectWithClearedCookie(
  request: NextRequest,
  pathname: string,
  cookieNames: string | string[],
  nextPath?: string
) {
  const url = new URL(pathname, request.url);
  if (nextPath) {
    url.searchParams.set("next", nextPath);
  }
  const response = NextResponse.redirect(url);
  const names = Array.isArray(cookieNames) ? cookieNames : [cookieNames];
  names.forEach((cookieName) => {
    response.cookies.set({
      name: cookieName,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
  });
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const adminSession = await verifySessionToken(
    request.cookies.get(ADMIN_COOKIE)?.value,
    "admin"
  );
  const staffSession = await verifySessionToken(
    request.cookies.get(STAFF_COOKIE)?.value,
    "staff"
  );
  const customerSession = await verifySessionToken(
    request.cookies.get(CUSTOMER_COOKIE)?.value,
    "customer"
  );

  if (pathname === "/login" && adminSession) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (pathname === "/login" && staffSession) {
    return NextResponse.redirect(new URL("/orders", request.url));
  }

  if (pathname === "/account/login" && customerSession) {
    return NextResponse.redirect(new URL("/account", request.url));
  }

  if (pathname.startsWith("/receipt/") && request.nextUrl.searchParams.get("phone")) {
    return NextResponse.next();
  }

  if (isPathIn(pathname, adminOnlyRoutePrefixes)) {
    if (adminSession) {
      return NextResponse.next();
    }
    if (staffSession) {
      return NextResponse.redirect(new URL("/orders", request.url));
    }
    return redirectWithClearedCookie(
      request,
      "/login",
      [ADMIN_COOKIE, STAFF_COOKIE],
      pathname
    );
  }

  if (isPathIn(pathname, staffRoutePrefixes) && !adminSession && !staffSession) {
    return redirectWithClearedCookie(
      request,
      "/login",
      [ADMIN_COOKIE, STAFF_COOKIE],
      pathname
    );
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
