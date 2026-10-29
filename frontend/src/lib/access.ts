import type { SessionRole } from "@/lib/session";

/**
 * Routes a staff account can open. Department and work pages are shared, but
 * the API still enforces department membership and scoped permissions.
 */
export const staffRoutePrefixes = [
  "/counter",
  "/orders",
  "/operations",
  "/kds",
  "/receipt",
  "/kitchen-ticket",
  "/support-inbox",
  "/departments",
  "/work",
];

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
  "/marketing",
  "/messaging",
  "/feedback",
  "/journeys",
  "/ops",
  "/vendors",
  "/waste",
  "/expenses",
  "/finance",
  "/ai-insights",
  "/purchase-orders",
  "/settings",
];

export const adminRoutePrefixes = [
  ...adminOnlyRoutePrefixes,
  ...staffRoutePrefixes,
];

/** Every page that belongs to the signed-in portal, including shared ones. */
export const portalRoutePrefixes = Array.from(
  new Set([...adminOnlyRoutePrefixes, ...staffRoutePrefixes])
);

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
