import Link from "next/link";
import Sidebar, { portalNavItems } from "@/components/layout/Sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
            className="rounded-md bg-red-50 px-3 py-2 text-sm font-bold text-red-600"
          >
            Logout
          </Link>
        </div>
        <nav className="flex gap-2 overflow-x-auto px-3 pb-3">
          {portalNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                href={item.href}
                className="inline-flex shrink-0 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700"
              >
                <Icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </header>
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-8">
        {children}
      </main>
    </div>
  );
}
