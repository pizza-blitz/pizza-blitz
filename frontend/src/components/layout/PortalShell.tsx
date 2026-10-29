"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { SessionRole } from "@/lib/session";
import {
  activeNavItem,
  navGroupsForRole,
  quickNavItems,
  type PortalNavGroup,
  type PortalNavItem,
} from "@/lib/portal-navigation";
import { getApiUrl } from "@/lib/api";
import {
  portalIcon,
  type CompanyNavigation,
  type WorkHome,
} from "@/lib/company";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LogOut,
  Menu,
  MoreHorizontal,
  Search,
  ShieldCheck,
  Store,
  UserCog,
  X,
} from "lucide-react";

function roleLabel(role: SessionRole) {
  if (role === "admin") return "Admin";
  if (role === "staff") return "Counter staff";
  return "Customer";
}

function navLinkClasses(active: boolean, collapsed = false) {
  const base =
    "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors";
  const state = active
    ? "bg-[#17130f] text-white shadow-sm"
    : "text-gray-700 hover:bg-orange-50 hover:text-orange-800";
  return `${base} ${state} ${collapsed ? "justify-center px-2" : ""}`;
}

export default function PortalShell({
  role,
  children,
}: {
  role: SessionRole;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [navigation, setNavigation] = useState<CompanyNavigation | null>(null);
  const [workBadge, setWorkBadge] = useState(0);

  const staticGroups = useMemo(() => navGroupsForRole(role), [role]);
  const groups = useMemo<PortalNavGroup[]>(() => {
    const addBadge = (items: PortalNavItem[]) =>
      items.map((item) =>
        item.href === "/work" && workBadge > 0
          ? { ...item, badge: workBadge }
          : item
      );
    if (role === "staff" && navigation?.groups?.length) {
      return navigation.groups.map((group) => ({
        title: group.title,
        items: addBadge(
          group.items.map((item) => ({
            name: item.name,
            href: item.href,
            icon: portalIcon(item.icon),
            description: item.description || item.department_name,
          }))
        ),
      }));
    }
    if (role === "admin" && navigation?.departments?.length) {
      const directory: PortalNavGroup = {
        title: "Department workspaces",
        items: navigation.departments.map((department) => ({
          name: department.name,
          href: `/departments/${department.key}`,
          icon: portalIcon(department.icon),
          description: department.is_head
            ? "Department workspace · you lead this team"
            : "KPIs, work queue, team and modules",
        })),
      };
      return [
        directory,
        ...staticGroups.map((group) => ({
          ...group,
          items: addBadge(group.items),
        })),
      ];
    }
    return staticGroups.map((group) => ({
      ...group,
      items: addBadge(group.items),
    }));
  }, [role, navigation, staticGroups, workBadge]);
  const items = useMemo(
    () => groups.flatMap((group) => group.items),
    [groups]
  );
  const current = activeNavItem(pathname, items);
  const quick = useMemo(() => quickNavItems(role), [role]);
  const activeDepartmentKey =
    pathname.match(/^\/departments\/([^/]+)/)?.[1] ?? "";
  const departmentChoices = navigation?.departments ?? [];

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            item.name.toLowerCase().includes(needle) ||
            item.description.toLowerCase().includes(needle) ||
            item.href.includes(needle)
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, query]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(
          getApiUrl("/api/v1/restaurant/departments/navigation"),
          { credentials: "include", cache: "no-store" }
        );
        if (response.ok) {
          const data = (await response.json()) as CompanyNavigation;
          if (!cancelled) setNavigation(data);
        }
      } catch {
        // Static navigation stays as the fallback.
      }
      try {
        const response = await fetch(getApiUrl("/api/v1/restaurant/work"), {
          credentials: "include",
          cache: "no-store",
        });
        if (response.ok) {
          const data = (await response.json()) as WorkHome;
          if (!cancelled) {
            setWorkBadge(
              (data.counts?.work_items || 0) + (data.counts?.approvals || 0)
            );
          }
        }
      } catch {
        // Badge is optional.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [role, pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen]);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem("pb_portal_sidebar_collapsed") === "1");
    } catch {
      // Private mode without storage: keep the expanded sidebar.
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem("pb_portal_sidebar_collapsed", next ? "1" : "0");
      } catch {
        // Ignore storage failures.
      }
      return next;
    });
  };

  return (
    <div
      data-testid="portal-shell"
      data-hydrated={hydrated ? "true" : "false"}
      className="min-h-screen bg-[#f6f5f3] text-gray-900 md:flex md:h-screen md:overflow-hidden"
    >
      {/* Desktop sidebar */}
      <aside
        data-testid="portal-sidebar"
        data-hydrated={hydrated ? "true" : "false"}
        className={`hidden shrink-0 flex-col border-r border-gray-200 bg-white transition-[width] duration-200 md:flex ${
          collapsed ? "w-[76px]" : "w-72"
        }`}
      >
        <div className={`flex items-center gap-3 border-b border-gray-100 px-4 py-4 ${collapsed ? "justify-center px-2" : ""}`}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-600 text-sm font-black text-white">
            PB
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-base font-black tracking-tight text-gray-950">Pizza Blitz</p>
              <p className="truncate text-[11px] font-semibold text-gray-400">Restaurant portal</p>
            </div>
          )}
        </div>

        {!collapsed && (
          <div className="px-3 pb-1 pt-3">
            <label htmlFor="portal-nav-search" className="sr-only">
              Search navigation
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                id="portal-nav-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search pages"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm font-medium outline-none focus:border-orange-400 focus:bg-white"
              />
            </div>
          </div>
        )}

        {!collapsed && departmentChoices.length > 0 && (
          <div className="px-3 pb-1 pt-2">
            <label htmlFor="portal-department-switcher" className="sr-only">
              Jump to department
            </label>
            <select
              id="portal-department-switcher"
              value={
                departmentChoices.some(
                  (department) => department.key === activeDepartmentKey
                )
                  ? activeDepartmentKey
                  : ""
              }
              onChange={(event) =>
                router.push(
                  event.target.value
                    ? `/departments/${event.target.value}`
                    : "/departments"
                )
              }
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 outline-none focus:border-orange-400"
            >
              <option value="">Jump to department...</option>
              {departmentChoices.map((department) => (
                <option key={department.key} value={department.key}>
                  {department.name}
                  {department.is_head ? " · lead" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <nav
          aria-label="Portal"
          className="flex-1 space-y-4 overflow-y-auto px-2 py-3 [scrollbar-width:thin]"
        >
          {filteredGroups.map((group) => (
            <div key={group.title}>
              {!collapsed && (
                <p className="px-3 pb-1 text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
                  {group.title}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = current?.href === item.href;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={
                        collapsed
                          ? `${item.name}${item.badge ? ` (${item.badge})` : ""}`
                          : undefined
                      }
                      aria-current={active ? "page" : undefined}
                      className={navLinkClasses(active, collapsed)}
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      {!collapsed && <span className="truncate">{item.name}</span>}
                      {!collapsed && item.badge ? (
                        <span className="ml-auto rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-black leading-none text-white">
                          {item.badge > 99 ? "99+" : item.badge}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
          {!filteredGroups.length && (
            <p className="px-3 py-6 text-sm font-semibold text-gray-400">No page matches “{query}”.</p>
          )}
        </nav>

        <div className="border-t border-gray-100 p-2">
          <Link
            href="/"
            target="_blank"
            rel="noreferrer"
            title={collapsed ? "View storefront" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 hover:text-gray-950 ${collapsed ? "justify-center px-2" : ""}`}
          >
            <Store className="h-[18px] w-[18px] shrink-0" />
            {!collapsed && (
              <>
                <span className="truncate">View storefront</span>
                <ExternalLink className="ml-auto h-3.5 w-3.5 text-gray-400" />
              </>
            )}
          </Link>
          <div className={`mt-1 flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 ${collapsed ? "justify-center px-2" : ""}`}>
            {role === "admin" ? (
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <UserCog className="h-4 w-4 shrink-0 text-orange-600" />
            )}
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-xs font-black text-gray-800">{roleLabel(role)}</p>
                <p className="truncate text-[10px] font-semibold text-gray-400">Signed in</p>
              </div>
            )}
          </div>
          <div className={`mt-1 flex items-center gap-1 ${collapsed ? "flex-col" : ""}`}>
            <Link
              href="/logout"
              prefetch={false}
              className={`flex flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 ${collapsed ? "justify-center px-2" : ""}`}
            >
              <LogOut className="h-[18px] w-[18px] shrink-0" />
              {!collapsed && <span>Logout</span>}
            </Link>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header */}
        <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur md:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label="Open navigation"
                aria-expanded={drawerOpen}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-gray-200 text-gray-700"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <p className="truncate text-base font-black leading-tight text-gray-950">
                  {current?.name || "Pizza Blitz"}
                </p>
                <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">
                  {roleLabel(role)} · Restaurant portal
                </p>
              </div>
            </div>
            <Link
              href="/logout"
              prefetch={false}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-50 text-red-600"
              aria-label="Logout"
            >
              <LogOut className="h-4 w-4" />
            </Link>
          </div>
        </header>

        {/* Desktop topbar */}
        <div className="hidden items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-3 md:flex">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
              Pizza Blitz portal
            </p>
            <p className="truncate text-lg font-black tracking-tight text-gray-950">
              {current?.name || "Dashboard"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/order"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:border-orange-300 hover:text-orange-700"
            >
              <Store className="h-3.5 w-3.5" /> New order page
            </Link>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-emerald-700">
              <ShieldCheck className="h-3.5 w-3.5" /> {roleLabel(role)}
            </span>
          </div>
        </div>

        <main className="min-w-0 flex-1 px-4 pb-28 pt-4 md:overflow-y-auto md:px-8 md:pb-10 md:pt-6">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        data-testid="mobile-portal-nav"
        aria-label="Quick navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <div className="flex items-stretch justify-around">
          {quick.map((item: PortalNavItem) => {
            const active = current?.href === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-1 flex-col items-center gap-1 px-2 py-2.5 text-[10px] font-bold ${
                  active ? "text-red-700" : "text-gray-500"
                }`}
              >
                <span
                  className={`grid h-8 w-10 place-items-center rounded-lg ${
                    active ? "bg-red-50" : ""
                  }`}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="max-w-full truncate">{item.shortName || item.name.split(" ")[0]}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="More navigation"
            className="flex flex-1 flex-col items-center gap-1 px-2 py-2.5 text-[10px] font-bold text-gray-500"
          >
            <span className="grid h-8 w-10 place-items-center rounded-lg">
              <MoreHorizontal className="h-[18px] w-[18px]" />
            </span>
            <span>More</span>
          </button>
        </div>
      </nav>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/45 backdrop-blur-sm"
          />
          <div
            data-testid="portal-drawer"
            className="absolute inset-y-0 left-0 flex w-[88%] max-w-sm flex-col bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-4">
              <div>
                <p className="text-lg font-black tracking-tight text-gray-950">Pizza Blitz</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">
                  {roleLabel(role)} portal
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="grid h-10 w-10 place-items-center rounded-xl border border-gray-200 text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-4 pt-3">
              <label htmlFor="mobile-nav-search" className="sr-only">
                Search navigation
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  id="mobile-nav-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search pages"
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm font-medium outline-none focus:border-orange-400 focus:bg-white"
                />
              </div>
              {departmentChoices.length > 0 && (
                <select
                  aria-label="Jump to department"
                  value={
                    departmentChoices.some(
                      (department) => department.key === activeDepartmentKey
                    )
                      ? activeDepartmentKey
                      : ""
                  }
                  onChange={(event) =>
                    router.push(
                      event.target.value
                        ? `/departments/${event.target.value}`
                        : "/departments"
                    )
                  }
                  className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-xs font-bold text-gray-700"
                >
                  <option value="">Jump to department...</option>
                  {departmentChoices.map((department) => (
                    <option key={department.key} value={department.key}>
                      {department.name}
                      {department.is_head ? " · lead" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <nav aria-label="Portal" className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
              {filteredGroups.map((group) => (
                <div key={group.title}>
                  <p className="px-3 pb-1 text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
                    {group.title}
                  </p>
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const active = current?.href === item.href;
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={navLinkClasses(active)}
                        >
                          <Icon className="h-[18px] w-[18px] shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate">{item.name}</span>
                              {item.badge ? (
                                <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-black leading-none text-white">
                                  {item.badge > 99 ? "99+" : item.badge}
                                </span>
                              ) : null}
                            </span>
                            <span
                              className={`block truncate text-[10px] font-medium ${
                                active ? "text-white/70" : "text-gray-400"
                              }`}
                            >
                              {item.description}
                            </span>
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
              {!filteredGroups.length && (
                <p className="px-3 py-6 text-sm font-semibold text-gray-400">
                  No page matches “{query}”.
                </p>
              )}
            </nav>
            <div className="border-t border-gray-100 p-3">
              <Link
                href="/"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-gray-700"
              >
                <Store className="h-[18px] w-[18px]" /> View storefront
              </Link>
              <Link
                href="/logout"
                prefetch={false}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-red-700"
              >
                <LogOut className="h-[18px] w-[18px]" /> Logout
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
