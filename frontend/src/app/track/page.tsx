"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  Clock,
  CreditCard,
  Loader2,
  Phone,
  ReceiptText,
  Search,
  ShoppingBag,
  Utensils,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const TRACK_API = getApiUrl("/api/v1/restaurant/orders/track");

type TrackingStep = {
  key: string;
  label: string;
  complete: boolean;
};

type TrackedOrder = {
  id: number;
  order_type: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  items: {
    name: string;
    quantity: number;
    price: number;
    selected_options?: { option_name: string; price_delta: number }[];
  }[];
  total_amount: number;
  payment_status: string;
  payment_method?: string | null;
  status: string;
  eta_window: string;
  next_action: string;
  tracking_steps: TrackingStep[];
  created_at?: string | null;
};

export default function TrackOrderPage() {
  const [orderId, setOrderId] = useState("");
  const [phone, setPhone] = useState("");
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderParam = params.get("order") || "";
    const phoneParam = params.get("phone") || "";
    if (orderParam) setOrderId(orderParam);
    if (phoneParam) setPhone(phoneParam);
    if (orderParam && phoneParam) {
      lookupOrder(orderParam, phoneParam);
    }
  }, []);

  const placedAt = useMemo(() => {
    if (!order?.created_at) return "";
    return new Date(order.created_at).toLocaleString();
  }, [order?.created_at]);

  const lookupOrder = async (nextOrderId = orderId, nextPhone = phone) => {
    const trimmedOrderId = nextOrderId.trim();
    const trimmedPhone = nextPhone.trim();
    if (!trimmedOrderId || !trimmedPhone) {
      setMessage("Order ID and phone are required.");
      return;
    }

    setIsLoading(true);
    setMessage("");
    setOrder(null);
    const response = await fetch(
      `${TRACK_API}/${encodeURIComponent(trimmedOrderId)}?phone=${encodeURIComponent(trimmedPhone)}`,
      { cache: "no-store" }
    );
    const data = await response.json();
    setIsLoading(false);

    if (!response.ok) {
      setMessage(data.detail || "Order could not be found.");
      return;
    }
    setOrder(data);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    lookupOrder();
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-red-700">Pizza Blitz</p>
            <h1 className="text-2xl font-black">Track Order</h1>
          </div>
          <div className="flex gap-3">
            <Link
              href="/order"
              className="flex items-center gap-2 rounded-md bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800"
            >
              <ShoppingBag className="h-4 w-4" /> Order Food
            </Link>
            <Link
              href="/account"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:border-red-600 hover:text-red-700"
            >
              My Orders
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        <section className="grid overflow-hidden rounded-lg border border-slate-200 bg-white md:grid-cols-12">
          <div className="p-6 md:col-span-7">
            <p className="mb-2 text-sm font-bold text-red-700">Live status</p>
            <h2 className="text-3xl font-black">Order #{order?.id || orderId || "--"}</h2>
            <form onSubmit={handleSubmit} className="mt-6 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <label className="flex items-center gap-3 rounded-md border border-slate-300 bg-white px-3 py-3 focus-within:border-red-600">
                <ReceiptText className="h-4 w-4 text-slate-400" />
                <input
                  value={orderId}
                  onChange={(event) => setOrderId(event.target.value)}
                  placeholder="Order ID"
                  inputMode="numeric"
                  className="w-full outline-none"
                />
              </label>
              <label className="flex items-center gap-3 rounded-md border border-slate-300 bg-white px-3 py-3 focus-within:border-red-600">
                <Phone className="h-4 w-4 text-slate-400" />
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="Phone number"
                  className="w-full outline-none"
                />
              </label>
              <button className="flex items-center justify-center gap-2 rounded-md bg-slate-950 px-5 py-3 font-bold text-white hover:bg-red-700">
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Track
              </button>
            </form>
          </div>
          <img
            src="https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=900&q=80"
            alt="Fresh pizza on table"
            className="hidden h-64 w-full object-cover md:col-span-5 md:block md:h-full"
          />
        </section>

        {message && (
          <div className="mt-6 rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
            {message}
          </div>
        )}

        {order && (
          <div className="mt-6 grid gap-6 lg:grid-cols-12">
            <section className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-8">
              <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-red-700">{order.order_type}</p>
                  <h3 className="mt-1 text-2xl font-black">{order.next_action}</h3>
                  {placedAt && (
                    <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                      <Clock className="h-4 w-4" /> {placedAt}
                    </p>
                  )}
                </div>
                <div className="rounded-md bg-slate-950 px-4 py-3 text-right text-white">
                  <p className="text-xs font-bold uppercase text-slate-300">ETA</p>
                  <p className="text-xl font-black">{order.eta_window}</p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-5">
                {order.tracking_steps.map((step) => (
                  <div
                    key={step.key}
                    className={`rounded-md border p-3 ${
                      step.complete
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-slate-50 text-slate-500"
                    }`}
                  >
                    <div
                      className={`mb-3 flex h-8 w-8 items-center justify-center rounded-full ${
                        step.complete ? "bg-emerald-600 text-white" : "bg-white text-slate-400"
                      }`}
                    >
                      <Check className="h-4 w-4" />
                    </div>
                    <p className="text-sm font-black">{step.label}</p>
                  </div>
                ))}
              </div>
            </section>

            <aside className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-4">
              <h3 className="mb-4 flex items-center gap-2 text-lg font-black">
                <Utensils className="h-5 w-5 text-red-700" /> Order Details
              </h3>
              <div className="divide-y divide-slate-100 border-y border-slate-100">
                {order.items.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="flex justify-between py-3 text-sm">
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
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <Detail label="Total" value={`Rs ${Number(order.total_amount || 0).toLocaleString()}`} />
                <Detail label="Status" value={order.status} />
                <Detail label="Payment" value={order.payment_method || "Pending"} />
                <Detail label="Paid" value={order.payment_status} />
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-md bg-slate-50 px-3 py-3 text-sm font-bold text-slate-700">
                <CreditCard className="h-4 w-4 text-red-700" />
                {order.payment_status.replace("_", " ")}
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <p className="text-xs font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 break-words font-bold capitalize">{value}</p>
    </div>
  );
}
