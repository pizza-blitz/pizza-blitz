import { NextResponse } from "next/server";
import {
  adminOnlyRoutePrefixes,
  staffRoutePrefixes,
} from "@/lib/access";
import {
  ADMIN_COOKIE,
  CUSTOMER_COOKIE,
  STAFF_COOKIE,
  maxAgeForRole,
  verifySessionToken,
} from "@/lib/session";

export const dynamic = "force-dynamic";

function formatDuration(seconds: number) {
  const hours = Math.round(seconds / 3600);
  if (hours < 24) return `${hours} hours`;
  return `${Math.round(hours / 24)} days`;
}

function cookieValue(request: Request, name: string) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
}

export async function GET(request: Request) {
  const adminSession = await verifySessionToken(
    cookieValue(request, ADMIN_COOKIE),
    "admin"
  );
  if (!adminSession) {
    const staffSession = await verifySessionToken(
      cookieValue(request, STAFF_COOKIE),
      "staff"
    );
    return NextResponse.json(
      {
        detail: staffSession
          ? "Admin session is required for the security overview."
          : "Admin session is required.",
      },
      { status: staffSession ? 403 : 401 }
    );
  }

  const adminId = process.env.PIZZA_BLITZ_ADMIN_ID || "admin";
  const adminPassword = process.env.PIZZA_BLITZ_ADMIN_PASSWORD || "admin123";
  const staffId = process.env.PIZZA_BLITZ_STAFF_ID || "staff";
  const staffPassword = process.env.PIZZA_BLITZ_STAFF_PASSWORD || "staff123";
  const sessionSecret = process.env.PIZZA_BLITZ_SESSION_SECRET;

  const adminPasswordHardened = adminPassword !== "admin123";
  const staffPasswordHardened = staffPassword !== "staff123";
  const sessionSecretHardened = Boolean(sessionSecret);
  const adminIdConfigured = adminId !== "admin";
  const staffIdConfigured = staffId !== "staff";
  const routeMatrix = [
    {
      area: "Owner command",
      routeGroup: "/dashboard, /reports, /settings",
      publicAccess: "Login required",
      customerAccess: "Blocked",
      staffAccess: "Redirected to /orders",
      adminAccess: "Allowed",
    },
    {
      area: "Counter POS",
      routeGroup: "/orders, /operations, /receipt",
      publicAccess: "Login required",
      customerAccess: "Blocked",
      staffAccess: "Allowed",
      adminAccess: "Allowed",
    },
    {
      area: "Customer account",
      routeGroup: "/account",
      publicAccess: "Phone login required",
      customerAccess: "Allowed",
      staffAccess: "Blocked",
      adminAccess: "Not used",
    },
    {
      area: "Public ordering",
      routeGroup: "/, /order, /track",
      publicAccess: "Allowed",
      customerAccess: "Allowed",
      staffAccess: "Allowed",
      adminAccess: "Allowed",
    },
  ];
  const hardening = [
    {
      name: "Admin ID",
      status: adminIdConfigured ? "Configured" : "Default",
      detail:
        adminIdConfigured
          ? "Admin ID is configured from environment."
          : "Local admin ID is still the default value.",
    },
    {
      name: "Admin Password",
      status: adminPasswordHardened ? "Configured" : "Default",
      detail: adminPasswordHardened
        ? "Admin password is no longer the local default."
        : "Replace the default admin password before real staff use.",
    },
    {
      name: "Staff ID",
      status: staffIdConfigured ? "Configured" : "Default",
      detail:
        staffIdConfigured
          ? "Staff ID is configured from environment."
          : "Local staff ID is still the default value.",
    },
    {
      name: "Staff Password",
      status: staffPasswordHardened ? "Configured" : "Default",
      detail: staffPasswordHardened
        ? "Staff password is no longer the local default."
        : "Replace the default staff password before counter use.",
    },
    {
      name: "Session Signing",
      status: sessionSecretHardened ? "Configured" : "Fallback",
      detail: sessionSecretHardened
        ? "Session signing secret is configured separately."
        : "Session signing falls back to admin password/local secret.",
    },
    {
      name: "Role Split",
      status: "Configured",
      detail: "Counter staff uses a separate session and can access only POS, kitchen ops, and receipt routes.",
    },
    {
      name: "Backend API Role Gates",
      status: "Configured",
      detail: "Operations readiness, backups, order status, invoices, delivery assignment, employee attendance/payroll, and delivery-zone edits now require signed admin or staff sessions.",
    },
    {
      name: "Manual Payment Webhook",
      status: "Configured",
      detail: "Manual paid-webhook testing requires an admin or staff session; signed gateway webhooks remain provider-facing.",
    },
  ];
  const actionStatuses = new Set(["Default", "Fallback", "Planned"]);
  const hardeningActionCount = hardening.filter((item) =>
    actionStatuses.has(item.status)
  ).length;
  const hardeningReadyCount = hardening.length - hardeningActionCount;

  return NextResponse.json({
    summary: {
      launchStatus:
        hardeningActionCount === 0
          ? "Ready for controlled staff use"
          : `${hardeningActionCount} security action${hardeningActionCount === 1 ? "" : "s"} remaining`,
      launchTone: hardeningActionCount === 0 ? "Ready" : "Action needed",
      adminConfigured: adminIdConfigured && adminPasswordHardened,
      staffConfigured: staffIdConfigured && staffPasswordHardened,
      sessionSecretConfigured: sessionSecretHardened,
      hardeningReadyCount,
      hardeningTotalCount: hardening.length,
      adminRouteCount: adminOnlyRoutePrefixes.length,
      staffRouteCount: staffRoutePrefixes.length,
      customerRouteCount: 1,
      publicRouteCount: 3,
      roleCount: 4,
    },
    routeMatrix,
    roles: [
      {
        role: "Owner / Admin",
        access: "Full portal, reports, settings, POS, campaigns, ops readiness",
        entry: "/login",
        protection: "Required admin session cookie",
      },
      {
        role: "Counter Staff",
        access: "Order entry, kitchen flow, delivery handoff, receipt workflow",
        entry: "/login",
        protection: "Required staff or admin session cookie",
      },
      {
        role: "Customer",
        access: "Saved account, checkout history, order tracking",
        entry: "/account/login",
        protection: "Required customer session cookie",
      },
      {
        role: "Public Visitor",
        access: "Website, menu browsing, cart, checkout start",
        entry: "/",
        protection: "Public routes only",
      },
    ],
    sessions: [
      {
        name: "Admin Portal",
        cookie: ADMIN_COOKIE,
        duration: formatDuration(maxAgeForRole("admin")),
        protectedRoutes: adminOnlyRoutePrefixes.length + staffRoutePrefixes.length,
        status: adminPasswordHardened ? "Ready" : "Action needed",
      },
      {
        name: "Counter Staff",
        cookie: STAFF_COOKIE,
        duration: formatDuration(maxAgeForRole("staff")),
        protectedRoutes: staffRoutePrefixes.length,
        status: staffPasswordHardened ? "Ready" : "Action needed",
      },
      {
        name: "Customer Account",
        cookie: CUSTOMER_COOKIE,
        duration: formatDuration(maxAgeForRole("customer")),
        protectedRoutes: 1,
        status: "Ready",
      },
    ],
    gateChecks: [
      {
        name: "Security overview API",
        status: "Admin only",
        proof: "/api/security-overview",
        detail: "Anonymous users receive 401 and staff users receive 403 before any role matrix is returned.",
      },
      {
        name: "Admin-only routes",
        status: "Enforced",
        proof: `${adminOnlyRoutePrefixes.length} route groups`,
        detail: "Dashboard, roadmap, reports, customers, marketing, production ops and settings require an admin session.",
      },
      {
        name: "Counter staff routes",
        status: "Restricted",
        proof: `${staffRoutePrefixes.length} route groups`,
        detail: "Counter staff can use orders, kitchen operations and receipts, then gets redirected away from owner/admin areas.",
      },
      {
        name: "Customer account routes",
        status: "Session required",
        proof: "/account",
        detail: "Customers must sign in with their order phone before viewing saved profile and order history.",
      },
    ],
    recoveryControls: [
      {
        name: "Admin recovery",
        status: "Runbook ready",
        detail: "Reset admin ID/password through environment variables and rotate the session secret to invalidate old cookies.",
      },
      {
        name: "Staff recovery",
        status: "Runbook ready",
        detail: "Counter staff can be locked out by changing staff credentials while owner/admin access remains separate.",
      },
      {
        name: "Customer recovery",
        status: "Phone based",
        detail: "Customer account access is recovered through the checkout phone until OTP/email verification is connected.",
      },
    ],
    auditControls: [
      {
        name: "Session inventory",
        status: "Visible",
        detail: "Settings shows cookie names, session duration and protected-route counts for each role.",
      },
      {
        name: "Default credential warnings",
        status: "Visible",
        detail: "Default admin/staff IDs, default passwords and fallback signing secret are called out before production use.",
      },
      {
        name: "Role gate proof",
        status: "Automated",
        detail: "Browser/API proof checks anonymous, admin, staff and customer access boundaries.",
      },
      {
        name: "Operational audit trail",
        status: "Visible",
        detail: "Settings shows the latest credential, payment, order, delivery and backup control events for owner review.",
      },
    ],
    hardening,
  });
}
