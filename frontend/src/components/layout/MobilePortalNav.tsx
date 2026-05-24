"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SessionRole } from "@/lib/session";
import { portalNavItemsForRole } from "./Sidebar";

export default function MobilePortalNav({ role }: { role: SessionRole }) {
  const pathname = usePathname();
  const navItems = portalNavItemsForRole(role);

  return (
    <nav data-testid="mobile-portal-nav" className="relative border-t border-gray-100 bg-white md:hidden">
      <div className="flex snap-x gap-2 overflow-x-auto px-3 py-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(`${item.href}/`));

          return (
            <Link
              key={item.name}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`inline-flex h-10 shrink-0 snap-start items-center gap-2 rounded-md border px-3 text-sm font-bold transition-colors ${
                isActive
                  ? "border-gray-950 bg-gray-950 text-white shadow-sm"
                  : "border-gray-200 bg-white text-gray-700 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="max-w-28 truncate">{item.name}</span>
            </Link>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent" />
    </nav>
  );
}
