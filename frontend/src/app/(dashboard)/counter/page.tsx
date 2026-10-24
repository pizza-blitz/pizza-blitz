"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CreditCard,
  Minus,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  ShoppingBag,
  X,
  Zap,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const MENU_API = getApiUrl("/api/v1/restaurant/menu/menu-with-customizations");
const QUICK_BUILDS_API = getApiUrl("/api/v1/restaurant/menu/customizations/quick-builds");
const ORDERS_API = getApiUrl("/api/v1/restaurant/orders/");
const BILLING_API = getApiUrl("/api/v1/restaurant/billing-settings/public");

type CustomizationOption = {
  id: number;
  name: string;
  price_delta: number;
  is_default: boolean;
};

type CustomizationGroup = {
  id: number;
  name: string;
  selection_type: "single" | "multiple";
  min_select: number;
  max_select: number;
  options: CustomizationOption[];
};

type SelectedOption = {
  group_id: number;
  group_name: string;
  option_id: number;
  option_name: string;
  price_delta: number;
};

type MenuItem = {
  id: number;
  name: string;
  category: string;
  selling_price: number;
  is_available: boolean;
  customization_groups?: CustomizationGroup[];
};

type QuickBuild = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  item: {
    id: number;
    name: string;
    category: string;
    base_price: number;
  };
  base_price: number;
  customization_total: number;
  unit_price: number;
  selected_options: SelectedOption[];
  operator_steps: string[];
};

type CartLine = {
  cart_key: string;
  menu_item_id: number;
  name: string;
  category: string;
  quantity: number;
  price: number;
  base_price: number;
  customization_total: number;
  selected_options: SelectedOption[];
};

type CreatedOrder = {
  order_id: number;
  total: number;
  tax: number;
  subtotal: number;
};

const emptyCustomer = {
  customer_name: "",
  customer_phone: "",
};

const paymentMethods = ["cash", "upi", "card", "mixed"];

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function optionSummary(option: SelectedOption) {
  const delta = Number(option.price_delta || 0);
  return `${option.group_name}: ${option.option_name}${delta > 0 ? ` +Rs ${delta}` : ""}`;
}

function defaultSelectedOptions(item: MenuItem): SelectedOption[] {
  const selected: SelectedOption[] = [];
  (item.customization_groups || []).forEach((group) => {
    const options =
      group.selection_type === "single"
        ? [group.options.find((option) => option.is_default) || group.options[0]].filter(Boolean)
        : group.options
            .filter((option) => option.is_default)
            .slice(0, group.max_select || group.options.length);

    options.forEach((option) => {
      if (!option) return;
      if (group.name === "Combo" && option.name === "No Combo") return;
      selected.push({
        group_id: group.id,
        group_name: group.name,
        option_id: option.id,
        option_name: option.name,
        price_delta: Number(option.price_delta || 0),
      });
    });
  });
  return selected;
}

function cartKeyFor(menuItemId: number, selectedOptions: SelectedOption[]) {
  return `${menuItemId}:${selectedOptions
    .map((option) => option.option_id)
    .sort((a, b) => a - b)
    .join("-")}`;
}

export default function QuickCounterPage() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [quickBuilds, setQuickBuilds] = useState<QuickBuild[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState(emptyCustomer);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [discount, setDiscount] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null);
  const [billing, setBilling] = useState({ tax_rate: 5, tax_label: "GST" });

  useEffect(() => {
    fetchCounterData();
  }, []);

  const fetchCounterData = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [menuResponse, quickBuildResponse, billingResponse] = await Promise.all([
        fetch(MENU_API),
        fetch(QUICK_BUILDS_API),
        fetch(BILLING_API),
      ]);
      const menuData = await menuResponse.json();
      const quickBuildData = await quickBuildResponse.json().catch(() => ({}));
      const billingData = await billingResponse.json().catch(() => ({}));
      if (billingData?.settings) setBilling(billingData.settings);
      setMenu(Array.isArray(menuData) ? menuData.filter((item) => item.is_available) : []);
      setQuickBuilds(Array.isArray(quickBuildData.builds) ? quickBuildData.builds : []);
    } catch {
      setMessage("Counter menu is not available right now.");
    } finally {
      setLoading(false);
    }
  };

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(menu.map((item) => item.category).filter(Boolean))).sort()],
    [menu]
  );

  const filteredMenu = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return menu
      .filter((item) => category === "All" || item.category === category)
      .filter(
        (item) =>
          !normalizedQuery ||
          item.name.toLowerCase().includes(normalizedQuery) ||
          item.category.toLowerCase().includes(normalizedQuery)
      )
      .slice(0, 36);
  }, [category, menu, query]);

  const subtotal = roundMoney(
    cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0)
  );
  const safeDiscount = roundMoney(Math.min(Math.max(Number(discount || 0), 0), subtotal));
  const taxableSubtotal = roundMoney(Math.max(subtotal - safeDiscount, 0));
  const tax = roundMoney(taxableSubtotal * (billing.tax_rate / 100));
  const total = roundMoney(taxableSubtotal + tax);
  const itemCount = cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  const addCartLine = (line: Omit<CartLine, "quantity">) => {
    setCreatedOrder(null);
    setMessage("");
    setCart((current) => {
      const existing = current.find((item) => item.cart_key === line.cart_key);
      if (existing) {
        return current.map((item) =>
          item.cart_key === line.cart_key ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...current, { ...line, quantity: 1 }];
    });
  };

  const addMenuItem = (item: MenuItem) => {
    const selectedOptions = defaultSelectedOptions(item);
    const customizationTotal = roundMoney(
      selectedOptions.reduce((sum, option) => sum + Number(option.price_delta || 0), 0)
    );
    addCartLine({
      cart_key: cartKeyFor(item.id, selectedOptions),
      menu_item_id: item.id,
      name: item.name,
      category: item.category,
      price: roundMoney(Number(item.selling_price || 0) + customizationTotal),
      base_price: Number(item.selling_price || 0),
      customization_total: customizationTotal,
      selected_options: selectedOptions,
    });
  };

  const addQuickBuild = (build: QuickBuild) => {
    addCartLine({
      cart_key: cartKeyFor(build.item.id, build.selected_options || []),
      menu_item_id: build.item.id,
      name: build.item.name,
      category: build.item.category,
      price: Number(build.unit_price || 0),
      base_price: Number(build.base_price || build.item.base_price || 0),
      customization_total: Number(build.customization_total || 0),
      selected_options: build.selected_options || [],
    });
  };

  const updateQuantity = (cartKey: string, delta: number) => {
    setCreatedOrder(null);
    setCart((current) =>
      current
        .map((item) =>
          item.cart_key === cartKey ? { ...item, quantity: item.quantity + delta } : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const clearCart = () => {
    setCart([]);
    setDiscount(0);
    setCreatedOrder(null);
    setMessage("");
  };

  const createOrder = async () => {
    if (!cart.length || saving) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(ORDERS_API, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_type: "takeaway",
          customer_name: customer.customer_name.trim() || "Walk-in Customer",
          customer_phone: customer.customer_phone.trim() || null,
          items: cart.map((item) => ({
            menu_item_id: item.menu_item_id,
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            base_price: item.base_price,
            customization_total: item.customization_total,
            selected_options: item.selected_options,
          })),
          discount_amount: safeDiscount,
          payment_method: paymentMethod,
          notes: "Quick counter order",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.detail || "Order could not be sent.");
        return;
      }
      setCreatedOrder({
        order_id: data.order_id,
        subtotal: Number(data.subtotal || subtotal),
        tax: Number(data.tax || tax),
        total: Number(data.total || total),
      });
      setMessage(`Order #${data.order_id} sent to kitchen.`);
      setCart([]);
      setDiscount(0);
      setCustomer(emptyCustomer);
    } catch {
      setMessage("Order could not be sent.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0b0b0c] p-4 text-white md:p-6">
      <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-300">Counter</p>
          <h1 className="mt-2 text-2xl font-black md:text-3xl">Quick Counter</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Metric label="Items" value={`${itemCount}`} />
          <Metric label="Bill" value={`Rs ${Math.round(total).toLocaleString()}`} />
          <Metric label="Payment" value={paymentMethod.toUpperCase()} />
          <Link
            href="/orders"
            className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-4 py-3 text-sm font-black text-gray-200 hover:border-orange-400"
          >
            Full POS
          </Link>
        </div>
      </div>

      {message && (
        <div
          data-testid="quick-counter-message"
          className="mb-5 rounded-md border border-orange-500/20 bg-orange-500/10 px-4 py-3 text-sm font-bold text-orange-100"
        >
          {message}
        </div>
      )}

      {createdOrder && (
        <div
          data-testid="quick-counter-created-order"
          className="mb-5 flex flex-col gap-3 rounded-md border border-green-500/20 bg-green-500/10 p-4 md:flex-row md:items-center md:justify-between"
        >
          <div>
            <p className="text-sm font-black text-green-200">Order #{createdOrder.order_id}</p>
            <p className="mt-1 text-xs font-semibold text-green-100/80">
              Total Rs {Math.round(createdOrder.total).toLocaleString()}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/receipt/${createdOrder.order_id}`} className="rounded-md bg-green-500 px-3 py-2 text-xs font-black text-black">
              Receipt
            </Link>
            <Link href={`/kitchen-ticket/${createdOrder.order_id}`} className="rounded-md border border-green-400/30 px-3 py-2 text-xs font-black text-green-100">
              KOT
            </Link>
          </div>
        </div>
      )}

      <section data-testid="quick-counter-page" className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="min-w-0">
          <div data-testid="quick-counter-speed-rail" className="mb-5 rounded-md border border-white/10 bg-[#121214] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-orange-300" />
                <h2 className="font-black">One Tap Builds</h2>
              </div>
              <button
                type="button"
                onClick={fetchCounterData}
                className="grid h-9 w-9 place-items-center rounded-md border border-white/10 text-gray-300 hover:border-orange-400"
                title="Refresh counter menu"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {quickBuilds.slice(0, 6).map((build) => (
                <button
                  key={build.id}
                  data-testid={`quick-counter-build-${build.id}`}
                  type="button"
                  onClick={() => addQuickBuild(build)}
                  className="rounded-md border border-orange-500/20 bg-orange-500/10 p-3 text-left hover:border-orange-400"
                >
                  <p className="font-black text-orange-100">{build.name}</p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-orange-100/70">
                    Rs {Math.round(build.unit_price).toLocaleString()} | {build.operator_steps.slice(0, 2).join(" | ")}
                  </p>
                </button>
              ))}
              {!quickBuilds.length && menu.slice(0, 6).map((item) => (
                <button
                  key={`fallback-${item.id}`}
                  data-testid={`quick-counter-fallback-${item.id}`}
                  type="button"
                  onClick={() => addMenuItem(item)}
                  className="rounded-md border border-white/10 bg-white/5 p-3 text-left hover:border-orange-400"
                >
                  <p className="font-black">{item.name}</p>
                  <p className="mt-1 text-xs font-semibold text-gray-500">
                    Rs {Math.round(item.selling_price).toLocaleString()}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto]">
            <label className="flex items-center gap-3 rounded-md border border-white/10 bg-[#121214] px-3 py-3">
              <Search className="h-4 w-4 text-gray-500" />
              <input
                data-testid="quick-counter-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search pizza, sides, drinks"
                className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-gray-600"
              />
            </label>
            <div className="flex gap-2 overflow-x-auto pb-1 md:max-w-[560px]">
              {categories.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCategory(item)}
                  className={`shrink-0 rounded-md border px-3 py-2 text-xs font-black ${
                    category === item
                      ? "border-orange-400 bg-orange-500 text-white"
                      : "border-white/10 bg-[#121214] text-gray-300"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {filteredMenu.map((item) => {
              const selectedOptions = defaultSelectedOptions(item);
              const customizationTotal = selectedOptions.reduce(
                (sum, option) => sum + Number(option.price_delta || 0),
                0
              );
              const price = roundMoney(Number(item.selling_price || 0) + customizationTotal);
              return (
                <article
                  key={item.id}
                  data-testid={`quick-counter-menu-item-${item.id}`}
                  className="rounded-md border border-white/10 bg-[#121214] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-black">{item.name}</p>
                      <p className="mt-1 text-xs font-semibold text-gray-500">
                        {item.category} | Rs {Math.round(price).toLocaleString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Add ${item.name}`}
                      onClick={() => addMenuItem(item)}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-orange-500 text-white hover:bg-orange-600"
                    >
                      <Plus className="h-5 w-5" />
                    </button>
                  </div>
                  {!!selectedOptions.length && (
                    <p className="mt-3 text-xs font-semibold leading-5 text-orange-100/70">
                      {selectedOptions.slice(0, 3).map(optionSummary).join(" | ")}
                    </p>
                  )}
                </article>
              );
            })}
            {!filteredMenu.length && (
              <div className="rounded-md border border-dashed border-white/10 p-6 text-center text-sm font-bold text-gray-500">
                No counter item found.
              </div>
            )}
          </div>
        </div>

        <aside data-testid="quick-counter-bill" className="h-fit rounded-md border border-white/10 bg-[#121214] p-4 xl:sticky xl:top-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-orange-300" />
              <h2 className="font-black">Current Bill</h2>
            </div>
            {!!cart.length && (
              <button
                type="button"
                onClick={clearCart}
                className="grid h-9 w-9 place-items-center rounded-md border border-white/10 text-gray-300 hover:border-red-400 hover:text-red-300"
                title="Clear bill"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="mb-4 max-h-[340px] space-y-3 overflow-y-auto pr-1">
            {cart.map((item) => (
              <div key={item.cart_key} className="rounded-md border border-white/10 bg-black/25 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-black">{item.name}</p>
                    <p className="mt-1 text-xs font-semibold text-gray-500">
                      Rs {Math.round(item.price).toLocaleString()} each
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 rounded-md border border-white/10 bg-black/30 p-1">
                    <button
                      type="button"
                      onClick={() => updateQuantity(item.cart_key, -1)}
                      className="grid h-8 w-8 place-items-center rounded-md text-gray-300 hover:bg-white/10"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-7 text-center text-sm font-black">{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => updateQuantity(item.cart_key, 1)}
                      className="grid h-8 w-8 place-items-center rounded-md bg-orange-500 text-white hover:bg-orange-600"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {!!item.selected_options.length && (
                  <p className="mt-2 text-xs font-semibold leading-5 text-orange-100/70">
                    {item.selected_options.map(optionSummary).join(" | ")}
                  </p>
                )}
              </div>
            ))}
            {!cart.length && (
              <div className="rounded-md border border-dashed border-white/10 p-5 text-center text-sm font-semibold text-gray-500">
                Tap an item to start the bill.
              </div>
            )}
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2">
            <input
              value={customer.customer_name}
              onChange={(event) => setCustomer({ ...customer, customer_name: event.target.value })}
              placeholder="Customer"
              className="rounded-md border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold outline-none focus:border-orange-400"
            />
            <input
              value={customer.customer_phone}
              onChange={(event) => setCustomer({ ...customer, customer_phone: event.target.value })}
              placeholder="Phone"
              className="rounded-md border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold outline-none focus:border-orange-400"
            />
          </div>

          <div className="mb-4">
            <p className="mb-2 text-[11px] font-black uppercase tracking-widest text-gray-500">Payment</p>
            <div className="grid grid-cols-4 gap-2">
              {paymentMethods.map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setPaymentMethod(method)}
                  className={`rounded-md border px-2 py-2 text-xs font-black uppercase ${
                    paymentMethod === method
                      ? "border-orange-400 bg-orange-500 text-white"
                      : "border-white/10 bg-black/25 text-gray-300"
                  }`}
                >
                  {method}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <input
              type="number"
              min="0"
              value={discount}
              onChange={(event) => setDiscount(Number(event.target.value) || 0)}
              placeholder="Discount"
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold outline-none focus:border-orange-400"
            />
          </div>

          <div className="space-y-2 border-y border-white/10 py-4 text-sm font-semibold text-gray-400">
            <PriceRow label="Subtotal" value={subtotal} />
            <PriceRow label="Discount" value={safeDiscount} />
            <PriceRow label={`${billing.tax_label} ${billing.tax_rate}%`} value={tax} />
            <div className="flex items-center justify-between pt-2 text-xl font-black text-white">
              <span>Total</span>
              <span>Rs {Math.round(total).toLocaleString()}</span>
            </div>
          </div>

          <button
            data-testid="quick-counter-send-order"
            type="button"
            onClick={createOrder}
            disabled={!cart.length || saving}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-orange-500 px-4 py-4 text-base font-black text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <RefreshCw className="h-5 w-5 animate-spin" />
            ) : paymentMethod === "cash" ? (
              <ReceiptText className="h-5 w-5" />
            ) : (
              <CreditCard className="h-5 w-5" />
            )}
            {saving ? "Sending" : "Send To Kitchen"}
          </button>

          <Link
            href="/operations"
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-white/10 px-4 py-3 text-sm font-black text-gray-200 hover:border-orange-400"
          >
            <Send className="h-4 w-4" />
            Kitchen Board
          </Link>
        </aside>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/5 px-4 py-2">
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-black">{value}</p>
    </div>
  );
}

function PriceRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span>Rs {Math.round(value).toLocaleString()}</span>
    </div>
  );
}
