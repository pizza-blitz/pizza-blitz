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
  const response = internalRedirect(request, pathname, nextPath);
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

function internalRedirect(request: NextRequest, pathname: string, nextPath?: string) {
  const url = new URL(pathname, request.url);
  const host = (
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    ""
  )
    .split(",")[0]
    .trim();
  const protocol = (request.headers.get("x-forwarded-proto") ?? "")
    .split(",")[0]
    .trim()
    .replace(/:$/, "");
  if (host) {
    url.host = host;
  }
  if (protocol) {
    url.protocol = `${protocol}:`;
  }
  if (nextPath) {
    url.searchParams.set("next", nextPath);
  }
  return NextResponse.redirect(url);
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
    return internalRedirect(request, "/dashboard");
  }

  if (pathname === "/login" && staffSession) {
    return internalRedirect(request, "/orders");
  }

  if (pathname === "/account/login" && customerSession) {
    return internalRedirect(request, "/account");
  }

  if (pathname.startsWith("/receipt/") && request.nextUrl.searchParams.get("phone")) {
    return NextResponse.next();
  }

  if (isPathIn(pathname, adminOnlyRoutePrefixes)) {
    if (adminSession) {
      return NextResponse.next();
    }
    if (staffSession) {
      return internalRedirect(request, "/orders");
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
