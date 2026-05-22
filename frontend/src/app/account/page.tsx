"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Clock,
  History,
  Mail,
  Phone,
  ReceiptText,
  Search,
  ShoppingBag,
  User,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const HISTORY_API = getApiUrl("/api/v1/restaurant/orders/customer-history");
const CUSTOMER_STORAGE_KEY = "pizza_blitz_customer";
const REORDER_STORAGE_KEY = "pizza_blitz_reorder";

type Order = {
  id: number;
  date?: string | null;
  order_type: string;
  items: { name: string; quantity: number; price: number }[];
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  payment_status: string;
  payment_method?: string | null;
  status: string;
  notes?: string | null;
  created_at?: string | null;
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
  orders: Order[];
};

export default function CustomerAccountPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const savedCustomer = window.localStorage.getItem(CUSTOMER_STORAGE_KEY);
    if (!savedCustomer) return;

    try {
      const parsed = JSON.parse(savedCustomer);
      setPhone(parsed.phone || "");
    } catch {
      window.localStorage.removeItem(CUSTOMER_STORAGE_KEY);
    }
  }, []);

  const lookupOrders = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setMessage("");
    setHistory(null);

    const response = await fetch(`${HISTORY_API}/${encodeURIComponent(phone.trim())}`);
    const data = await response.json();
    setIsLoading(false);

    if (!response.ok) {
      setMessage(data.detail || "Could not find orders for this phone number.");
      return;
    }
    window.localStorage.setItem(
      CUSTOMER_STORAGE_KEY,
      JSON.stringify({
        name: data.customer.name || "",
        phone: data.customer.phone,
        email: data.customer.email || "",
        opt_in_marketing: data.customer.opt_in_marketing ?? true,
      })
    );
    setHistory(data);
  };

  const reorder = (order: Order) => {
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
        items: order.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
        })),
        source_order_id: order.id,
      })
    );
    router.push("/order");
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
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        <section className="mb-6 grid overflow-hidden rounded-lg border border-slate-200 bg-white md:grid-cols-12">
          <div className="p-6 md:col-span-7">
            <p className="mb-2 text-sm font-bold text-red-700">Customer account</p>
            <h2 className="text-3xl font-black">Track your recent Pizza Blitz orders.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Enter the same phone number used during checkout to see order status, totals,
              and previous items.
            </p>
            <form onSubmit={lookupOrders} className="mt-6 flex max-w-xl gap-2">
              <label className="flex flex-1 items-center gap-3 rounded-md border border-slate-300 bg-white px-3 py-3 focus-within:border-red-600">
                <Phone className="h-4 w-4 text-slate-400" />
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="Phone number"
                  required
                  className="w-full outline-none"
                />
              </label>
              <button className="flex items-center gap-2 rounded-md bg-slate-950 px-5 py-3 font-bold text-white hover:bg-red-700">
                <Search className="h-4 w-4" /> {isLoading ? "Checking" : "Find"}
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
            <div className="mb-6 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
              Offers and updates: {history.customer.opt_in_marketing ? "Enabled" : "Disabled"}
            </div>

            <div className="space-y-4">
              {history.orders.map((order) => (
                <article key={order.id} className="rounded-lg border border-slate-200 bg-white p-5">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-red-700">Order #{order.id}</p>
                      <h3 className="mt-1 text-xl font-black">
                        {order.order_type} · Rs {Number(order.total_amount || 0).toLocaleString()}
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <p className="text-xs font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 font-bold">{value}</p>
    </div>
  );
}
