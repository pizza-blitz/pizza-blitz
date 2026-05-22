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
} from "@/lib/session";

export const dynamic = "force-dynamic";

function formatDuration(seconds: number) {
  const hours = Math.round(seconds / 3600);
  if (hours < 24) return `${hours} hours`;
  return `${Math.round(hours / 24)} days`;
}

export async function GET() {
  const adminId = process.env.PIZZA_BLITZ_ADMIN_ID || "admin";
  const adminPassword = process.env.PIZZA_BLITZ_ADMIN_PASSWORD || "admin123";
  const staffId = process.env.PIZZA_BLITZ_STAFF_ID || "staff";
  const staffPassword = process.env.PIZZA_BLITZ_STAFF_PASSWORD || "staff123";
  const sessionSecret = process.env.PIZZA_BLITZ_SESSION_SECRET;

  const adminPasswordHardened = adminPassword !== "admin123";
  const staffPasswordHardened = staffPassword !== "staff123";
  const sessionSecretHardened = Boolean(sessionSecret);

  return NextResponse.json({
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
    hardening: [
      {
        name: "Admin ID",
        status: adminId === "admin" ? "Default" : "Configured",
        detail:
          adminId === "admin"
            ? "Local admin ID is still the default value."
            : "Admin ID is configured from environment.",
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
        status: staffId === "staff" ? "Default" : "Configured",
        detail:
          staffId === "staff"
            ? "Local staff ID is still the default value."
            : "Staff ID is configured from environment.",
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
    ],
  });
}
