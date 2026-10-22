"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Award,
  CheckCircle2,
  Clock,
  History,
  MapPin,
  Mail,
  Phone,
  ReceiptText,
  Search,
  ShoppingBag,
  Star,
  TrendingUp,
  User,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";
import SavedAddresses from "@/components/account/SavedAddresses";
import LoyaltyCard from "@/components/account/LoyaltyCard";

const HISTORY_API = getApiUrl("/api/v1/restaurant/orders/customer-history");
const CUSTOMER_STORAGE_KEY = "pizza_blitz_customer";
const REORDER_STORAGE_KEY = "pizza_blitz_reorder";

type Order = {
  id: number;
  date?: string | null;
  order_type: string;
  fulfillment_type?: string | null;
  delivery_address?: string | null;
  delivery_zone?: string | null;
  delivery_fee?: number;
  items: {
    name: string;
    quantity: number;
    price: number;
    selected_options?: { option_name: string; price_delta: number }[];
  }[];
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  payment_status: string;
  payment_method?: string | null;
  status: string;
  notes?: string | null;
  created_at?: string | null;
};

type ReorderItem = {
  name?: string | null;
  quantity?: number;
  selected_options?: { option_name: string; price_delta: number }[];
};

type LoyaltySummary = {
  tier: string;
  next_tier: string;
  tier_progress_percent: number;
  orders_to_next_tier: number;
  average_order_value: number;
  total_discount: number;
  days_since_last_order?: number | null;
  cadence: string;
  favorite_items: { name: string; quantity: number; spend: number }[];
  recommended_reorder: ReorderItem[];
};

type CustomerHistory = {
  customer: {
    name?: string | null;
    phone: string;
    email?: string | null;
    opt_in_marketing?: boolean;
    total_orders: number;
    total_spend: number;
    last_order_at?: string | null;
  };
  delivery_profile?: DeliveryProfile | null;
  loyalty_summary?: LoyaltySummary;
  orders: Order[];
};

type DeliveryProfile = {
  source_order_id?: number | null;
  address: string;
  zone?: string | null;
  delivery_fee?: number;
  eta_window?: string | null;
  last_used_at?: string | null;
};

type ProfileDraft = {
  name: string;
  email: string;
  opt_in_marketing: boolean;
};

export default function CustomerAccountPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>({
    name: "",
    email: "",
    opt_in_marketing: true,
  });
  const [profileMessage, setProfileMessage] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const lookupOrdersByPhone = async (lookupPhone: string) => {
    const normalizedPhone = lookupPhone.trim();
    if (!normalizedPhone) return;

    setIsLoading(true);
    setMessage("");
    setHistory(null);

    const response = await fetch(`${HISTORY_API}/${encodeURIComponent(normalizedPhone)}`, {
      credentials: "include",
    });
    const data = await response.json();
    setIsLoading(false);

    if (!response.ok) {
      setMessage(data.detail || "Could not find orders for this phone number.");
      return;
    }
    persistCustomer(data.customer);
    setProfileDraft({
      name: data.customer.name || "",
      email: data.customer.email || "",
      opt_in_marketing: data.customer.opt_in_marketing ?? true,
    });
    setHistory(data);
  };

  const persistCustomer = (customer: CustomerHistory["customer"]) => {
    window.localStorage.setItem(
      CUSTOMER_STORAGE_KEY,
      JSON.stringify({
        name: customer.name || "",
        phone: customer.phone,
        email: customer.email || "",
        opt_in_marketing: customer.opt_in_marketing ?? true,
      })
    );
  };

  useEffect(() => {
    fetch("/api/customer-session")
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.session?.phone) {
          router.replace("/account/login");
          return;
        }
        setPhone(data.session.phone);
        lookupOrdersByPhone(data.session.phone);
      })
      .catch(() => router.replace("/account/login"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lookupOrders = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    lookupOrdersByPhone(phone);
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!history) return;
    setIsSavingProfile(true);
    setProfileMessage("");

    const response = await fetch("/api/customer-profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: profileDraft.name.trim(),
        email: profileDraft.email.trim(),
        opt_in_marketing: profileDraft.opt_in_marketing,
      }),
    });
    const data = await response.json().catch(() => ({}));
    setIsSavingProfile(false);

    if (!response.ok) {
      setProfileMessage(data.detail || "Could not save customer preferences.");
      return;
    }

    const nextCustomer = {
      ...history.customer,
      ...data.customer,
      phone: data.customer.phone || history.customer.phone,
      total_orders: history.customer.total_orders,
      total_spend: history.customer.total_spend,
      last_order_at: history.customer.last_order_at,
    };
    persistCustomer(nextCustomer);
    setHistory({ ...history, customer: nextCustomer });
    setProfileDraft({
      name: nextCustomer.name || "",
      email: nextCustomer.email || "",
      opt_in_marketing: nextCustomer.opt_in_marketing ?? true,
    });
    setProfileMessage("Profile and consent preferences saved.");
  };

  const saveReorderDraft = (
    items: ReorderItem[],
    sourceOrderId?: number,
    deliveryProfile?: DeliveryProfile | null
  ) => {
    if (!history) return;
    window.localStorage.setItem(
      REORDER_STORAGE_KEY,
      JSON.stringify({
        customer: {
          name: history.customer.name || "",
          phone: history.customer.phone,
          email: history.customer.email || "",
          opt_in_marketing: history.customer.opt_in_marketing ?? true,
        },
        items: items.map((item) => ({
          name: item.name,
          quantity: item.quantity || 1,
          selected_options: item.selected_options || [],
        })),
        fulfillment: deliveryProfile
          ? {
              order_type: "delivery",
              delivery_address: deliveryProfile.address,
              delivery_zone: deliveryProfile.zone || "",
            }
          : undefined,
        source_order_id: sourceOrderId,
      })
    );
    router.push("/order");
  };

  const reorder = (order: Order) => {
    const deliveryProfile =
      order.delivery_address
        ? {
            source_order_id: order.id,
            address: order.delivery_address,
            zone: order.delivery_zone || "",
            delivery_fee: order.delivery_fee || 0,
            eta_window: undefined,
            last_used_at: order.created_at || null,
          }
        : null;
    saveReorderDraft(order.items, order.id, deliveryProfile);
  };

  const reorderRecommended = () => {
    if (!history?.loyalty_summary?.recommended_reorder?.length) return;
    saveReorderDraft(history.loyalty_summary.recommended_reorder, undefined, history.delivery_profile);
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-red-700">Pizza Blitz</p>
            <h1 className="text-2xl font-black">My Orders</h1>
          </div>
          <div className="flex gap-3">
            <Link
              href="/track"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:border-red-600 hover:text-red-700"
            >
              Track Order
            </Link>
            <Link
              href="/order"
              className="flex items-center gap-2 rounded-md bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800"
            >
              <ShoppingBag className="h-4 w-4" /> Order Food
            </Link>
            <Link
              href="/login"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:border-red-600 hover:text-red-700"
            >
              Admin Portal
            </Link>
            <Link
              href="/logout?role=customer"
              prefetch={false}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:border-red-600 hover:text-red-700"
            >
              Sign Out
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        <section className="mb-6 grid overflow-hidden rounded-lg border border-slate-200 bg-white md:grid-cols-12">
          <div className="p-6 md:col-span-7">
            <p className="mb-2 text-sm font-bold text-red-700">Customer account</p>
            <h2 className="text-3xl font-black">Track your recent Pizza Blitz orders.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              You are signed in with the phone number used during checkout. Refresh your
              saved orders, track status, and repeat previous items.
            </p>
            <form onSubmit={lookupOrders} className="mt-6 flex max-w-xl gap-2">
              <label className="flex flex-1 items-center gap-3 rounded-md border border-slate-300 bg-white px-3 py-3 focus-within:border-red-600">
                <Phone className="h-4 w-4 text-slate-400" />
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="Phone number"
                  readOnly
                  required
                  className="w-full outline-none"
                />
              </label>
              <button className="flex items-center gap-2 rounded-md bg-slate-950 px-5 py-3 font-bold text-white hover:bg-red-700">
                <Search className="h-4 w-4" /> {isLoading ? "Checking" : "Refresh"}
              </button>
            </form>
          </div>
          <img
            src="https://images.unsplash.com/photo-1571997478779-2adcbbe9ab2f?auto=format&fit=crop&w=900&q=80"
            alt="Pizza order boxes"
            className="h-64 w-full object-cover md:col-span-5 md:h-full"
          />
        </section>

        {message && (
          <div className="mb-6 rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
            {message}
          </div>
        )}

        <div className="mb-6">
          <LoyaltyCard />
        </div>

        <div className="mb-6">
          <SavedAddresses />
        </div>

        {history && (
          <>
            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-5">
              <Metric icon={User} label="Customer" value={history.customer.name || "Pizza Guest"} />
              <Metric icon={Phone} label="Phone" value={history.customer.phone} />
              <Metric icon={Mail} label="Email" value={history.customer.email || "Not saved"} />
              <Metric icon={History} label="Orders" value={history.customer.total_orders} />
              <Metric
                icon={ReceiptText}
                label="Total Spend"
                value={`Rs ${Math.round(history.customer.total_spend || 0).toLocaleString()}`}
              />
            </div>

            {history.delivery_profile && (
              <section
                data-testid="customer-delivery-profile"
                className="mb-6 rounded-lg border border-emerald-100 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-emerald-700">
                      Saved Delivery Profile
                    </p>
                    <h2 className="mt-1 flex items-start gap-2 text-2xl font-black">
                      <MapPin className="mt-1 h-5 w-5 shrink-0 text-emerald-700" />
                      {history.delivery_profile.address}
                    </h2>
                    <p className="mt-2 text-sm font-semibold text-slate-600">
                      {history.delivery_profile.zone || "Delivery zone saved"} | Rs {Math.round(history.delivery_profile.delivery_fee || 0)} fee | {history.delivery_profile.eta_window || "ETA from checkout"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      saveReorderDraft(
                        history.loyalty_summary?.recommended_reorder?.length
                          ? history.loyalty_summary.recommended_reorder
                          : history.orders[0]?.items || [],
                        history.delivery_profile?.source_order_id || undefined,
                        history.delivery_profile
                      )
                    }
                    disabled={
                      !history.loyalty_summary?.recommended_reorder?.length &&
                      !history.orders[0]?.items?.length
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-3 text-sm font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    <ShoppingBag className="h-4 w-4" /> Order To This Address
                  </button>
                </div>
              </section>
            )}

            {history.loyalty_summary && (
              <section className="mb-6 rounded-lg border border-red-100 bg-white p-5 shadow-sm">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-red-700">Loyalty Snapshot</p>
                    <h2 className="mt-1 text-2xl font-black">{history.loyalty_summary.tier}</h2>
                    <p className="mt-2 text-sm font-semibold text-slate-600">{history.loyalty_summary.cadence}</p>
                  </div>
                  <button
                    type="button"
                    onClick={reorderRecommended}
                    disabled={!history.loyalty_summary.recommended_reorder.length}
                    className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-4 py-3 text-sm font-black text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    <ShoppingBag className="h-4 w-4" /> Recommended Reorder
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                  <div className="rounded-lg bg-slate-50 p-4 lg:col-span-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Award className="h-5 w-5 text-red-700" />
                      <p className="font-black">Tier Progress</p>
                    </div>
                    <div className="h-3 rounded-full bg-white">
                      <div
                        className="h-3 rounded-full bg-red-700"
                        style={{ width: `${Math.min(100, Math.max(0, history.loyalty_summary.tier_progress_percent || 0))}%` }}
                      />
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-600">
                      {history.loyalty_summary.orders_to_next_tier
                        ? `${history.loyalty_summary.orders_to_next_tier} orders to ${history.loyalty_summary.next_tier}`
                        : history.loyalty_summary.next_tier}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:col-span-8">
                    <MiniMetric
                      icon={TrendingUp}
                      label="Average Order"
                      value={`Rs ${Math.round(history.loyalty_summary.average_order_value || 0).toLocaleString()}`}
                    />
                    <MiniMetric
                      icon={ReceiptText}
                      label="Savings"
                      value={`Rs ${Math.round(history.loyalty_summary.total_discount || 0).toLocaleString()}`}
                    />
                    <MiniMetric
                      icon={Clock}
                      label="Last Order"
                      value={
                        history.loyalty_summary.days_since_last_order === null || history.loyalty_summary.days_since_last_order === undefined
                          ? "No orders"
                          : `${history.loyalty_summary.days_since_last_order} days`
                      }
                    />
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border border-slate-100 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Star className="h-4 w-4 text-red-700" />
                      <h3 className="font-black">Favorite Items</h3>
                    </div>
                    <div className="space-y-2">
                      {history.loyalty_summary.favorite_items.length ? (
                        history.loyalty_summary.favorite_items.map((item) => (
                          <div key={item.name} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
                            <span className="font-bold">{item.name}</span>
                            <span className="text-slate-500">{item.quantity} ordered</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm font-semibold text-slate-500">Favorites appear after more orders.</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-100 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <ShoppingBag className="h-4 w-4 text-red-700" />
                      <h3 className="font-black">Recommended Basket</h3>
                    </div>
                    <div className="space-y-2">
                      {history.loyalty_summary.recommended_reorder.length ? (
                        history.loyalty_summary.recommended_reorder.map((item, index) => (
                          <div key={`${item.name}-${index}`} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
                            <span className="font-bold">{item.quantity || 1} x {item.name}</span>
                            <span className="text-slate-500">Ready</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm font-semibold text-slate-500">Recommended basket appears after the first order.</p>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            )}

            <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-red-700">Customer Lifecycle Command</p>
                  <h2 className="mt-1 text-2xl font-black">Profile, orders, contact and consent</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Customer account data now has a visible lifecycle: saved identity, order history, reachable channels and marketing consent.
                  </p>
                </div>
                <span className="inline-flex w-fit items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs font-black uppercase text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Account Active
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <MiniMetric
                  icon={User}
                  label="Profile"
                  value={history.customer.name ? "Named" : "Name missing"}
                />
                <MiniMetric
                  icon={History}
                  label="Order History"
                  value={`${history.orders.length} visible`}
                />
                <MiniMetric
                  icon={Mail}
                  label="Email"
                  value={history.customer.email ? "Ready" : "Missing"}
                />
                <MiniMetric
                  icon={Phone}
                  label="Consent"
                  value={history.customer.opt_in_marketing ? "Enabled" : "Disabled"}
                />
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-12">
                <form onSubmit={saveProfile} className="rounded-lg border border-slate-100 p-4 lg:col-span-7">
                  <h3 className="font-black">Profile & Contact Preferences</h3>
                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-black uppercase tracking-widest text-slate-500">Name</span>
                      <input
                        value={profileDraft.name}
                        onChange={(event) => setProfileDraft((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Customer name"
                        className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3 text-sm outline-none focus:border-red-600"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-black uppercase tracking-widest text-slate-500">Email</span>
                      <input
                        type="email"
                        value={profileDraft.email}
                        onChange={(event) => setProfileDraft((current) => ({ ...current, email: event.target.value }))}
                        placeholder="Email for receipts and offers"
                        className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3 text-sm outline-none focus:border-red-600"
                      />
                    </label>
                  </div>
                  <label className="mt-4 flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                    <input
                      type="checkbox"
                      checked={profileDraft.opt_in_marketing}
                      onChange={(event) =>
                        setProfileDraft((current) => ({
                          ...current,
                          opt_in_marketing: event.target.checked,
                        }))
                      }
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-red-700"
                    />
                    <span>
                      <span className="block font-bold text-slate-900">Allow Pizza Blitz offers and updates</span>
                      <span className="mt-1 block text-sm leading-5 text-slate-600">
                        Consent controls promotional WhatsApp, SMS and email audiences while receipts and order updates stay available.
                      </span>
                    </span>
                  </label>
                  {profileMessage && (
                    <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                      {profileMessage}
                    </div>
                  )}
                  <button
                    disabled={isSavingProfile}
                    className="mt-4 rounded-md bg-slate-950 px-5 py-3 text-sm font-black text-white hover:bg-red-700 disabled:bg-slate-300"
                  >
                    {isSavingProfile ? "Saving" : "Save Profile"}
                  </button>
                </form>

                <div className="rounded-lg border border-slate-100 p-4 lg:col-span-5">
                  <h3 className="font-black">Consent Ledger</h3>
                  <div className="mt-4 space-y-3">
                    <PreferenceRow
                      label="Phone order updates"
                      value="Always on"
                      detail={history.customer.phone}
                    />
                    <PreferenceRow
                      label="Email receipts"
                      value={history.customer.email ? "Ready" : "Missing"}
                      detail={history.customer.email || "Add email to activate"}
                    />
                    <PreferenceRow
                      label="Promotional audiences"
                      value={history.customer.opt_in_marketing ? "Allowed" : "Suppressed"}
                      detail={
                        history.customer.opt_in_marketing
                          ? "Eligible for offers and loyalty campaigns"
                          : "Excluded from promotional sends"
                      }
                    />
                  </div>
                </div>
              </div>
            </section>

            <div className="space-y-4">
              {history.orders.map((order) => (
                <article key={order.id} className="rounded-lg border border-slate-200 bg-white p-5">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-red-700">Order #{order.id}</p>
                      <h3 className="mt-1 text-xl font-black">
                        {order.order_type} | Rs {Number(order.total_amount || 0).toLocaleString()}
                      </h3>
                      <p className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                        <Clock className="h-4 w-4" />
                        {order.created_at ? new Date(order.created_at).toLocaleString() : order.date}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase text-slate-600">
                      {order.status}
                    </span>
                  </div>
                  <Link
                    href={`/track?order=${order.id}&phone=${encodeURIComponent(history.customer.phone)}`}
                    className="mb-4 inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:border-red-600 hover:text-red-700"
                  >
                    Track live status <ArrowRight className="h-4 w-4" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => reorder(order)}
                    className="mb-4 ml-2 inline-flex items-center gap-2 rounded-md bg-red-700 px-3 py-2 text-sm font-bold text-white hover:bg-red-800"
                  >
                    <ShoppingBag className="h-4 w-4" /> Order again
                  </button>
                  <div className="divide-y divide-slate-100 border-y border-slate-100">
                    {order.items.map((item, index) => (
                      <div key={`${order.id}-${item.name}-${index}`} className="flex justify-between py-3 text-sm">
                        <span className="font-semibold">
                          {item.quantity} x {item.name}
                          {!!item.selected_options?.length && (
                            <span className="mt-1 block text-xs text-slate-500">
                              {item.selected_options
                                .map((option) => option.option_name)
                                .join(", ")}
                            </span>
                          )}
                        </span>
                        <span>Rs {Number(item.price * item.quantity).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                    <Detail label="Discount" value={`Rs ${order.discount_amount || 0}`} />
                    <Detail label="Tax" value={`Rs ${order.tax_amount || 0}`} />
                    <Detail label="Payment" value={order.payment_method || "Pending"} />
                    <Detail label="Payment Status" value={order.payment_status} />
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <Icon className="mb-3 h-5 w-5 text-red-700" />
      <p className="text-xs font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-2 break-words text-xl font-black">{value}</p>
    </div>
  );
}

function MiniMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-slate-50 p-4">
      <Icon className="mb-3 h-5 w-5 text-red-700" />
      <p className="text-xs font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-black">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <p className="text-xs font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 font-bold">{value}</p>
    </div>
  );
}

function PreferenceRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold text-slate-900">{label}</p>
        <span className="rounded-md bg-white px-2 py-1 text-xs font-black uppercase text-slate-600">
          {value}
        </span>
      </div>
      <p className="mt-1 text-sm leading-5 text-slate-600">{detail}</p>
    </div>
  );
}
