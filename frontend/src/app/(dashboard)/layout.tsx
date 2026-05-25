import Link from "next/link";
import { cookies } from "next/headers";
import Sidebar from "@/components/layout/Sidebar";
import MobilePortalNav from "@/components/layout/MobilePortalNav";
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

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 md:flex-row">
      <header className="border-b bg-white shadow-sm md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-lg font-black text-orange-600">Pizza Blitz</p>
            <p className="text-xs font-semibold text-gray-400">Restaurant Portal</p>
          </div>
          <Link
            href="/logout"
            prefetch={false}
            className="rounded-md bg-red-50 px-3 py-2 text-sm font-bold text-red-600"
          >
            Logout
          </Link>
        </div>
        <MobilePortalNav role={role} />
      </header>
      <Sidebar role={role} />
      <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-8">
        {children}
      </main>
    </div>
  );
}
