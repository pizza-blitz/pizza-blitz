import { NextResponse, type NextRequest } from "next/server";

const ADMIN_COOKIE = "pb_admin_session";

const protectedRoutes = [
  "/",
  "/dashboard",
  "/ceo",
  "/orders",
  "/shifts",
  "/daily",
  "/sales",
  "/reports",
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

function isProtectedPath(pathname: string) {
  return protectedRoutes.some((route) => {
    if (route === "/") return pathname === "/";
    return pathname === route || pathname.startsWith(`${route}/`);
  });
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasAdminSession = request.cookies.has(ADMIN_COOKIE);

  if (pathname === "/login" && hasAdminSession) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (isProtectedPath(pathname) && !hasAdminSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
