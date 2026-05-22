"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  CheckCircle2,
  Clock3,
  CreditCard,
  FileText,
  Flame,
  Loader2,
  ReceiptText,
  RefreshCw,
  TimerReset,
  Truck,
  Utensils,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const ORDERS_API = getApiUrl("/api/v1/restaurant/orders");

type OrderItem = {
  name: string;
  quantity: number;
  price: number;
};

type Order = {
  id: number;
  order_type: string;
  table_number?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  items: OrderItem[];
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  payment_status: string;
  payment_method?: string | null;
  payment_provider?: string | null;
  payment_reference?: string | null;
  status: string;
  notes?: string | null;
  created_at?: string | null;
  closed_at?: string | null;
};

const filters = [
  { id: "active", label: "Active" },
  { id: "open", label: "New" },
  { id: "preparing", label: "Preparing" },
  { id: "ready", label: "Ready" },
  { id: "payment_due", label: "Payment Due" },
  { id: "closed", label: "Closed" },
];

function money(value: number) {
  return `Rs ${Math.round(Number(value || 0)).toLocaleString()}`;
}

function ageLabel(createdAt?: string | null) {
  if (!createdAt) return "Just now";
  const minutes = Math.max(
    Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000),
    0
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${remainder}m`;
}

function statusClass(status: string) {
  if (status === "ready") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "preparing") return "bg-sky-50 text-sky-700 border-sky-200";
  if (status === "closed") return "bg-slate-100 text-slate-600 border-slate-200";
  return "bg-orange-50 text-orange-700 border-orange-200";
}

function paymentClass(status: string) {
  if (status === "paid") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "awaiting_payment") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-zinc-100 text-zinc-700 border-zinc-200";
}

export default function OperationsPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState("active");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const activeOrders = orders.filter((order) => order.status !== "closed");
  const paymentDueOrders = activeOrders.filter(
    (order) =>
      (order.payment_method || "").toLowerCase() === "prepaid" &&
      order.payment_status !== "paid"
  );

  const stats = useMemo(() => {
    const ready = activeOrders.filter((order) => order.status === "ready").length;
    const preparing = activeOrders.filter((order) => order.status === "preparing").length;
    const fresh = activeOrders.filter((order) => order.status === "open").length;
    const activeValue = activeOrders.reduce(
      (sum, order) => sum + Number(order.total_amount || 0),
      0
    );
    return { ready, preparing, fresh, activeValue };
  }, [activeOrders]);

  const visibleOrders = useMemo(() => {
    if (filter === "active") return activeOrders;
    if (filter === "payment_due") return paymentDueOrders;
    return orders.filter((order) => order.status === filter);
  }, [activeOrders, filter, orders, paymentDueOrders]);

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${ORDERS_API}/today`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not load orders.");
      setOrders(data.orders || []);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load orders.");
    } finally {
      setIsLoading(false);
    }
  };

  const updateStatus = async (order: Order, status: "open" | "preparing" | "ready") => {
    setBusyAction(`${order.id}-${status}`);
    try {
      const response = await fetch(`${ORDERS_API}/${order.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not move order.");
      setMessage(`Order #${order.id} moved to ${status}.`);
      await fetchOrders();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not move order.");
    } finally {
      setBusyAction(null);
    }
  };

  const generateInvoice = async (order: Order) => {
    setBusyAction(`${order.id}-invoice`);
    try {
      const params = new URLSearchParams();
      if (order.customer_name) params.set("customer_name", order.customer_name);
      const response = await fetch(`${ORDERS_API}/${order.id}/invoice?${params.toString()}`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not generate invoice.");
      setMessage(`Invoice ${data.invoice_number} generated for order #${order.id}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not generate invoice.");
    } finally {
      setBusyAction(null);
    }
  };

  const closeOrder = async (order: Order) => {
    if (
      (order.payment_method || "").toLowerCase() === "prepaid" &&
      order.payment_status !== "paid"
    ) {
      setMessage(`Order #${order.id} is still awaiting prepaid payment.`);
      return;
    }

    setBusyAction(`${order.id}-close`);
    try {
      const paymentMethod = order.payment_method || "cash";
      const response = await fetch(
        `${ORDERS_API}/${order.id}/close?payment_method=${encodeURIComponent(paymentMethod)}`,
        { method: "PATCH" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not close order.");
      setMessage(`Order #${order.id} closed.`);
      await fetchOrders();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not close order.");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-950">Kitchen Operations</h1>
          <p className="mt-1 text-sm text-gray-500">
            Live order queue for prep, payment checks, invoices, and handoff.
          </p>
        </div>
        <button
          onClick={fetchOrders}
          disabled={isLoading}
          className="flex h-10 items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">New</p>
          <div className="mt-2 flex items-end justify-between">
            <span className="text-2xl font-black text-gray-950">{stats.fresh}</span>
            <Clock3 className="h-5 w-5 text-orange-500" />
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Preparing</p>
          <div className="mt-2 flex items-end justify-between">
            <span className="text-2xl font-black text-gray-950">{stats.preparing}</span>
            <Flame className="h-5 w-5 text-sky-600" />
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Ready</p>
          <div className="mt-2 flex items-end justify-between">
            <span className="text-2xl font-black text-gray-950">{stats.ready}</span>
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Open Value</p>
          <div className="mt-2 flex items-end justify-between">
            <span className="text-2xl font-black text-gray-950">{money(stats.activeValue)}</span>
            <CreditCard className="h-5 w-5 text-violet-600" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
        {filters.map((item) => (
          <button
            key={item.id}
            onClick={() => setFilter(item.id)}
            className={`h-9 rounded-md px-4 text-sm font-semibold transition ${
              filter === item.id
                ? "bg-gray-950 text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {message && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-medium text-orange-800">
          {message}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[1fr_140px_150px_230px] gap-4 border-b border-gray-200 bg-gray-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-gray-500">
            <span>Order</span>
            <span>Payment</span>
            <span>Status</span>
            <span className="text-right">Actions</span>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm font-medium text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading orders
            </div>
          )}

          {!isLoading && !visibleOrders.length && (
            <div className="px-4 py-10 text-center text-sm text-gray-500">
              No orders in this lane.
            </div>
          )}

          {!isLoading &&
            visibleOrders.map((order) => {
              const isPrepaidDue =
                (order.payment_method || "").toLowerCase() === "prepaid" &&
                order.payment_status !== "paid";
              const canClose = order.status !== "closed" && !isPrepaidDue;
              const primaryLocation = order.table_number
                ? `Table ${order.table_number}`
                : order.order_type.replace("-", " ");

              return (
                <div
                  key={order.id}
                  className="grid grid-cols-[1fr_140px_150px_230px] gap-4 border-b border-gray-100 px-4 py-4 last:border-b-0"
                >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-gray-950">#{order.id}</span>
                    <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-bold text-gray-600">
                      {order.table_number ? (
                        <Utensils className="h-3.5 w-3.5" />
                      ) : (
                        <Truck className="h-3.5 w-3.5" />
                      )}
                      {primaryLocation}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500">
                      <TimerReset className="h-3.5 w-3.5" />
                      {ageLabel(order.created_at)}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-sm text-gray-600">
                    {order.items
                      .map((item) => `${item.quantity}x ${item.name}`)
                      .join(" | ")}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                    <span>{order.customer_name || "Walk-in"}</span>
                    {order.customer_phone && <span>{order.customer_phone}</span>}
                    <span className="font-bold text-gray-950">{money(order.total_amount)}</span>
                  </div>
                </div>

                <div className="flex items-start">
                  <span className={`rounded-md border px-2 py-1 text-xs font-bold ${paymentClass(order.payment_status)}`}>
                    {order.payment_status.replace("_", " ")}
                  </span>
                </div>

                <div className="flex items-start">
                  <span className={`rounded-md border px-2 py-1 text-xs font-bold ${statusClass(order.status)}`}>
                    {order.status}
                  </span>
                </div>

                <div className="flex items-start justify-end gap-2">
                  <Link
                    title="Print bill"
                    aria-label={`Print bill for order ${order.id}`}
                    href={`/receipt/${order.id}`}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  >
                    <ReceiptText className="h-4 w-4" />
                  </Link>
                  <button
                    title="Mark preparing"
                    aria-label={`Mark order ${order.id} preparing`}
                    onClick={() => updateStatus(order, "preparing")}
                    disabled={order.status === "closed" || order.status === "preparing"}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyAction === `${order.id}-preparing` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Flame className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    title="Mark ready"
                    aria-label={`Mark order ${order.id} ready`}
                    onClick={() => updateStatus(order, "ready")}
                    disabled={order.status === "closed" || order.status === "ready"}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyAction === `${order.id}-ready` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    title="Generate invoice"
                    aria-label={`Generate invoice for order ${order.id}`}
                    onClick={() => generateInvoice(order)}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  >
                    {busyAction === `${order.id}-invoice` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    title={isPrepaidDue ? "Payment pending" : "Close order"}
                    aria-label={`Close order ${order.id}`}
                    onClick={() => closeOrder(order)}
                    disabled={!canClose}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-900 bg-gray-950 text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    {busyAction === `${order.id}-close` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                  </button>
                </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
