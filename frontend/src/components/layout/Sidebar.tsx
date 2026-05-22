import Link from "next/link";
import { 
  LayoutDashboard, Package, Receipt, ShoppingCart, 
  BarChart3, Settings, PlusCircle, Utensils, 
  Sparkles, DollarSign, Trash2, Crown, 
  Activity, FileText, Target, ClipboardList, Users, Truck, Megaphone, Flame, Share2, ShieldCheck
} from "lucide-react";

export const portalNavItems = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "CEO Command", href: "/ceo", icon: Crown },
  { name: "POS (Orders)", href: "/orders", icon: ShoppingCart },
  { name: "Kitchen Ops", href: "/operations", icon: Flame },
  { name: "Shift Log", href: "/shifts", icon: Activity },
  { name: "Daily Entry", href: "/daily", icon: PlusCircle },
  { name: "Sales History", href: "/sales", icon: DollarSign },
  { name: "Reports", href: "/reports", icon: BarChart3 },
  { name: "Invoices", href: "/invoices", icon: FileText },
  { name: "Breakeven", href: "/breakeven", icon: Target },
  { name: "Menu Intelligence", href: "/menu", icon: Utensils },
  { name: "Inventory", href: "/inventory", icon: Package },
  { name: "Recipes", href: "/recipes", icon: ClipboardList },
  { name: "Customers", href: "/customers", icon: Users },
  { name: "Promotions", href: "/promotions", icon: Megaphone },
  { name: "Social Publishing", href: "/social", icon: Share2 },
  { name: "Ad Campaigns", href: "/ads", icon: Target },
  { name: "Production Ops", href: "/ops", icon: ShieldCheck },
  { name: "Vendors", href: "/vendors", icon: Truck },
  { name: "Waste Log", href: "/waste", icon: Trash2 },
  { name: "Expenses", href: "/expenses", icon: Receipt },
  { name: "AI Insights", href: "/ai-insights", icon: Sparkles },
  { name: "Settings", href: "/settings", icon: Settings },
];

export default function Sidebar() {
  return (
    <div className="hidden h-screen w-64 shrink-0 flex-col border-r bg-white shadow-sm md:flex">
      <div className="border-b px-5 py-4">
        <h1 className="text-xl font-bold text-orange-600">Pizza Blitz</h1>
        <p className="mt-1 text-xs font-semibold text-gray-400">Restaurant Portal</p>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
        {portalNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              className="flex min-h-10 items-center gap-3 rounded-md px-3 py-2.5 text-sm text-gray-700 transition-colors hover:bg-orange-50 hover:text-orange-600"
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate font-medium">{item.name}</span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-3">
        <Link href="/logout" className="flex w-full items-center justify-center rounded-md bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100">
          Logout
        </Link>
      </div>
    </div>
  );
}
