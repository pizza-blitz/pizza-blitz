import type { ComponentType } from "react";
import type { SessionRole } from "@/lib/session";
import {
  Activity,
  BarChart3,
  Building2,
  CalendarDays,
  ClipboardList,
  Crown,
  DollarSign,
  FileText,
  Flame,
  Image,
  LayoutDashboard,
  Landmark,
  Megaphone,
  MessageCircle,
  MessageSquareHeart,
  MonitorPlay,
  Package,
  PlusCircle,
  Receipt,
  ScanLine,
  Settings,
  Share2,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Store,
  Target,
  Trash2,
  Truck,
  Users,
  Utensils,
  Zap,
} from "lucide-react";

export type PortalNavItem = {
  name: string;
  shortName?: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
  allowedRoles?: SessionRole[];
};

export type PortalNavGroup = {
  title: string;
  items: PortalNavItem[];
};

const adminOnly: SessionRole[] = ["admin"];
const floorRoles: SessionRole[] = ["admin", "staff"];

export const portalNavGroups: PortalNavGroup[] = [
  {
    title: "Overview",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, description: "KPIs, alerts and today's pulse", allowedRoles: adminOnly },
      { name: "Reports", href: "/reports", icon: BarChart3, description: "Comparisons, audit logs and exports", allowedRoles: adminOnly },
      { name: "CEO Command", href: "/ceo", icon: Crown, description: "Weekly owner summary and health score", allowedRoles: adminOnly },
      { name: "Roadmap", href: "/roadmap", icon: CalendarDays, description: "Readiness, proofs and launch board", allowedRoles: adminOnly },
      { name: "Departments", href: "/departments", icon: Building2, description: "Business units, modules and teams", allowedRoles: floorRoles },
    ],
  },
  {
    title: "Service floor",
    items: [
      { name: "Quick Counter", shortName: "Counter", href: "/counter", icon: Zap, description: "One-tap walk-in and takeaway orders", allowedRoles: floorRoles },
      { name: "POS (Orders)", shortName: "Orders", href: "/orders", icon: ShoppingCart, description: "Create, pay, close and void orders", allowedRoles: floorRoles },
      { name: "Kitchen Ops", shortName: "Kitchen", href: "/operations", icon: Flame, description: "Station board, dispatch and handoff", allowedRoles: floorRoles },
      { name: "KDS Board", shortName: "KDS", href: "/kds", icon: MonitorPlay, description: "Full-screen kitchen display with timers", allowedRoles: floorRoles },
      { name: "Shift Log", href: "/shifts", icon: Activity, description: "Attendance, handover and payroll preview", allowedRoles: adminOnly },
    ],
  },
  {
    title: "Menu & stock",
    items: [
      { name: "Menu Intelligence", href: "/menu", icon: Utensils, description: "Items, modifiers, combos and margins", allowedRoles: adminOnly },
      { name: "Media Studio", href: "/settings/media", icon: Image, description: "Shared images for menu, social, ads and landing", allowedRoles: adminOnly },
      { name: "Landing page", href: "/settings/content", icon: Sparkles, description: "Hero, story and category content for the storefront", allowedRoles: adminOnly },
      { name: "Recipes", href: "/recipes", icon: ClipboardList, description: "Ingredients, cost and prep forecast", allowedRoles: adminOnly },
      { name: "Inventory", href: "/inventory", icon: Package, description: "Stock, movements and low-stock queue", allowedRoles: adminOnly },
      { name: "Inventory Scan", href: "/inventory/scan", icon: ScanLine, description: "Scan invoices into stock items", allowedRoles: adminOnly },
      { name: "Purchase Orders", href: "/purchase-orders", icon: Truck, description: "Supplier drafts, send and receive", allowedRoles: adminOnly },
      { name: "Vendors", href: "/vendors", icon: Users, description: "Pricing history, alerts and cheapest vendor", allowedRoles: adminOnly },
      { name: "Waste Log", href: "/waste", icon: Trash2, description: "Record and analyse kitchen waste", allowedRoles: adminOnly },
    ],
  },
  {
    title: "Customers & growth",
    items: [
      { name: "Customers", href: "/customers", icon: Users, description: "Profiles, consent and retention", allowedRoles: adminOnly },
  { name: "Feedback & NPS", href: "/feedback", icon: MessageSquareHeart, description: "Ratings, NPS and guest comments", allowedRoles: adminOnly },
      { name: "Comms Center", href: "/communications", icon: MessageCircle, description: "WhatsApp, SMS and email campaigns", allowedRoles: adminOnly },
      { name: "Promotions", href: "/promotions", icon: Megaphone, description: "Coupons, flash sales and scheduling", allowedRoles: adminOnly },
      { name: "Social Publishing", href: "/social", icon: Share2, description: "Post to Instagram and Facebook", allowedRoles: adminOnly },
      { name: "Ad Campaigns", href: "/ads", icon: Target, description: "Budgets, launch, pacing and ROI", allowedRoles: adminOnly },
    ],
  },
  {
    title: "Finance",
    items: [
      { name: "Accounting & GST", href: "/accounting", icon: Landmark, description: "GST summary and Tally-ready CSV", allowedRoles: adminOnly },
      { name: "Sales History", href: "/sales", icon: DollarSign, description: "Daily ledger and reconciliation", allowedRoles: adminOnly },
      { name: "Daily Entry", href: "/daily", icon: PlusCircle, description: "Log sales, cash and expenses", allowedRoles: adminOnly },
      { name: "Invoices", href: "/invoices", icon: FileText, description: "Paid invoices and receipts", allowedRoles: adminOnly },
      { name: "Breakeven", href: "/breakeven", icon: Target, description: "Fixed costs and daily target", allowedRoles: adminOnly },
      { name: "Expenses", href: "/expenses", icon: Receipt, description: "Categories, approvals and audit", allowedRoles: adminOnly },
    ],
  },
  {
    title: "System",
    items: [
      { name: "Production Ops", href: "/ops", icon: ShieldCheck, description: "Readiness, backups and launch checks", allowedRoles: adminOnly },
      { name: "AI Insights", href: "/ai-insights", icon: Sparkles, description: "Gemini summary and directives", allowedRoles: adminOnly },
      { name: "Store Profile", href: "/settings/store", icon: Store, description: "Identity, hours and online ordering", allowedRoles: adminOnly },
      { name: "Settings", href: "/settings", icon: Settings, description: "Store, payments, staff and imports", allowedRoles: adminOnly },
    ],
  },
];

export function navGroupsForRole(role: SessionRole): PortalNavGroup[] {
  return portalNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => (item.allowedRoles || adminOnly).includes(role)),
    }))
    .filter((group) => group.items.length > 0);
}

export function navItemsForRole(role: SessionRole): PortalNavItem[] {
  return navGroupsForRole(role).flatMap((group) => group.items);
}

export function activeNavItem(pathname: string, items: PortalNavItem[]): PortalNavItem | null {
  let best: PortalNavItem | null = null;
  for (const item of items) {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (!best || item.href.length > best.href.length)) {
      best = item;
    }
  }
  return best;
}

const quickHrefs = ["/dashboard", "/orders", "/operations", "/counter"];

export function quickNavItems(role: SessionRole): PortalNavItem[] {
  const items = navItemsForRole(role);
  return quickHrefs
    .map((href) => items.find((item) => item.href === href))
    .filter((item): item is PortalNavItem => Boolean(item));
}
