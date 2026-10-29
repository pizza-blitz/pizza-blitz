import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import PortalShell from "@/components/layout/PortalShell";
import {
  ADMIN_COOKIE,
  STAFF_COOKIE,
  type SessionRole,
  verifySessionToken,
} from "@/lib/session";

async function currentPortalRole(): Promise<SessionRole | null> {
  const cookieStore = cookies();
  const adminSession = await verifySessionToken(
    cookieStore.get(ADMIN_COOKIE)?.value,
    "admin"
  );
  if (adminSession) return "admin";

  const staffSession = await verifySessionToken(
    cookieStore.get(STAFF_COOKIE)?.value,
    "staff"
  );
  if (staffSession) return "staff";

  return null;
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await currentPortalRole();
  if (!role) {
    redirect("/login");
  }

  return <PortalShell role={role}>{children}</PortalShell>;
}
