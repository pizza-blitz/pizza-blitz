import Link from "next/link";
import { 
  LayoutDashboard, Package, Receipt, ShoppingCart, 
  BarChart3, Settings, PlusCircle, Utensils, 
  Sparkles, DollarSign, Trash2, Crown, 
  Activity, FileText, Target, ClipboardList, Users 
} from "lucide-react";

export default function Sidebar() {
  const navItems = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "CEO Command", href: "/ceo", icon: Crown },
    { name: "POS (Orders)", href: "/orders", icon: ShoppingCart },
    { name: "Shift Log", href: "/shifts", icon: Activity },
    { name: "Daily Entry", href: "/daily", icon: PlusCircle },
    { name: "Sales History", href: "/sales", icon: DollarSign },
    { name: "Reports", href: "/reports", icon: BarChart3 },
    { name: "Invoices", href: "/invoices", icon: FileText },
    { name: "Breakeven", href: "/breakeven", icon: Target },
    { name: "Menu Intelligence", href: "/menu", icon: Utensils },
    { name: "Inventory", href: "/inventory", icon: Package },
    { name: "Recipes", href: "/recipes", icon: ClipboardList },
    { name: "Vendors", href: "/vendors", icon: Users },
    { name: "Waste Log", href: "/waste", icon: Trash2 },
    { name: "Expenses", href: "/expenses", icon: Receipt },
    { name: "AI Insights", href: "/ai-insights", icon: Sparkles },
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  return (
    <div className="w-64 bg-white border-r h-screen shadow-sm flex flex-col">
      <div className="p-6 border-b">
        <h1 className="text-2xl font-bold text-orange-600">Pizza Blitz</h1>
      </div>
      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              className="flex items-center space-x-3 px-4 py-3 text-gray-700 rounded-lg hover:bg-orange-50 hover:text-orange-600 transition-colors"
            >
              <Icon className="w-5 h-5" />
              <span className="font-medium">{item.name}</span>
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t">
        <Link href="/login" className="flex items-center justify-center w-full px-4 py-2 text-sm text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">
          Logout
        </Link>
      </div>
    </div>
  );
}
