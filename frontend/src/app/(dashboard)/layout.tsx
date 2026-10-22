import { cookies } from "next/headers";
import PortalShell from "@/components/layout/PortalShell";
import {
  ADMIN_COOKIE,
  STAFF_COOKIE,
  type SessionRole,
  verifySessionToken,
} from "@/lib/session";

async function currentPortalRole(): Promise<SessionRole> {
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

  return "admin";
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await currentPortalRole();

  return <PortalShell role={role}>{children}</PortalShell>;
}
