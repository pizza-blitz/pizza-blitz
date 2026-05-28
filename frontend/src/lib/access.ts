import type { SessionRole } from "@/lib/session";

export const staffRoutePrefixes = ["/orders", "/operations", "/receipt", "/kitchen-ticket"];

export const adminOnlyRoutePrefixes = [
  "/dashboard",
  "/roadmap",
  "/ceo",
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
  "/communications",
  "/promotions",
  "/social",
  "/ads",
  "/ops",
  "/vendors",
  "/waste",
  "/expenses",
  "/ai-insights",
  "/purchase-orders",
  "/settings",
];

export const adminRoutePrefixes = [
  ...adminOnlyRoutePrefixes,
  ...staffRoutePrefixes,
];

export function isPathIn(pathname: string, routes: string[]) {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function canAccessPath(role: SessionRole, pathname: string) {
  if (role === "admin") {
    return isPathIn(pathname, adminRoutePrefixes);
  }
  if (role === "staff") {
    return isPathIn(pathname, staffRoutePrefixes);
  }
  return false;
}
