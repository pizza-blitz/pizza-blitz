"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Flame,
  Loader2,
  Printer,
  ReceiptText,
  Utensils,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const ORDERS_API = getApiUrl("/api/v1/restaurant/orders");

type KitchenTicketItem = {
  name: string;
  quantity: number;
  selected_options?: {
    group_name?: string;
    option_name: string;
    price_delta?: number;
  }[];
};

type KitchenTicketOrder = {
  id: number;
  order_type: string;
  fulfillment_type?: string | null;
  table_number?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  delivery_address?: string | null;
  delivery_zone?: string | null;
  eta_window?: string | null;
  status: string;
  payment_method?: string | null;
  notes?: string | null;
  created_at?: string | null;
  items: KitchenTicketItem[];
};

function formatDate(value?: string | null) {
  if (!value) return "Time pending";
  return new Date(value).toLocaleString();
}

function titleCase(value?: string | null) {
  if (!value) return "Counter";
  return value
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function optionSummary(option: NonNullable<KitchenTicketItem["selected_options"]>[number]) {
  return `${option.group_name || "Option"}: ${option.option_name}`;
}

export default function KitchenTicketPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = params.orderId;
  const [order, setOrder] = useState<KitchenTicketOrder | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyStatus, setBusyStatus] = useState<"preparing" | "ready" | null>(null);

  const fulfillment = useMemo(
    () => titleCase(order?.fulfillment_type || order?.order_type),
    [order?.fulfillment_type, order?.order_type]
  );
  const totalItems = useMemo(
    () => order?.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || 0,
    [order?.items]
  );
  const status = (order?.status || "").toLowerCase();
  const canStartPreparing = Boolean(order && !["preparing", "ready", "closed", "cancelled"].includes(status));
  const canMarkReady = Boolean(order && !["ready", "closed", "cancelled"].includes(status));

  useEffect(() => {
    fetchOrder();
  }, [orderId]);

  const fetchOrder = async () => {
    setIsLoading(true);
    setMessage("");
    try {
      const response = await fetch(`${ORDERS_API}/${orderId}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not load kitchen ticket.");
      setOrder(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load kitchen ticket.");
    } finally {
      setIsLoading(false);
    }
  };

  const updateKitchenStatus = async (nextStatus: "preparing" | "ready") => {
    if (!order) return;
    setBusyStatus(nextStatus);
    setMessage("");
    try {
      const response = await fetch(`${ORDERS_API}/${order.id}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not update kitchen status.");
      setOrder((current) =>
        current
          ? {
              ...current,
              ...data,
              status: data.status || nextStatus,
            }
          : data
      );
      setMessage(`Order #${order.id} moved to ${titleCase(nextStatus)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update kitchen status.");
    } finally {
      setBusyStatus(null);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-6 text-white print:bg-white print:px-0 print:py-0 print:text-black">
      <div className="mx-auto max-w-4xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex gap-2">
            <Link
              href="/orders"
              className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white hover:bg-white/10"
            >
              <ArrowLeft className="h-4 w-4" /> POS
            </Link>
            <Link
              href={`/receipt/${orderId}`}
              className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white hover:bg-white/10"
            >
              <ReceiptText className="h-4 w-4" /> Bill
            </Link>
          </div>
          <button
            data-testid="kot-print-command"
            onClick={() => window.print()}
            disabled={!order}
            className="flex items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-sm font-black text-white hover:bg-orange-600 disabled:bg-zinc-700"
          >
            <Printer className="h-4 w-4" /> Print KOT
          </button>
        </div>

        {order && (
          <section
            data-testid="kot-status-actions"
            className="mb-5 rounded-lg border border-orange-400/20 bg-orange-500/10 p-4 print:hidden"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-orange-200/80">
                  Kitchen Status
                </p>
                <h2
                  data-testid="kot-status-value"
                  className="mt-1 text-2xl font-black text-white"
                >
                  {titleCase(order.status)}
                </h2>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  data-testid="kot-mark-preparing"
                  type="button"
                  onClick={() => updateKitchenStatus("preparing")}
                  disabled={!canStartPreparing || busyStatus !== null}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-orange-300/30 bg-orange-500 px-4 py-3 text-sm font-black text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-500"
                >
                  {busyStatus === "preparing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flame className="h-4 w-4" />}
                  Start Preparing
                </button>
                <button
                  data-testid="kot-mark-ready"
                  type="button"
                  onClick={() => updateKitchenStatus("ready")}
                  disabled={!canMarkReady || busyStatus !== null}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-500 px-4 py-3 text-sm font-black text-white hover:bg-green-600 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-500"
                >
                  {busyStatus === "ready" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Mark Ready
                </button>
              </div>
            </div>
          </section>
        )}

        {message && (
          <div className="mb-4 rounded-md border border-orange-400/20 bg-orange-500/10 px-4 py-3 text-sm font-semibold text-orange-100 print:hidden">
            {message}
          </div>
        )}

        {isLoading && (
          <div className="rounded-lg border border-white/10 bg-white/5 p-10 text-center text-sm font-semibold text-zinc-300">
            <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
            Loading kitchen ticket
          </div>
        )}

        {!isLoading && order && (
          <main
            data-testid="kot-ticket"
            className="rounded-lg border border-white/10 bg-white p-6 text-zinc-950 shadow-2xl print:rounded-none print:border-0 print:p-0 print:shadow-none"
          >
            <header className="border-b-4 border-zinc-950 pb-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-orange-600">
                    Pizza Blitz Kitchen
                  </p>
                  <h1 className="mt-1 text-4xl font-black">KOT</h1>
                  <p className="mt-2 flex items-center gap-2 text-sm font-bold text-zinc-600">
                    <Clock className="h-4 w-4" /> {formatDate(order.created_at)}
                  </p>
                </div>
                <div className="text-right">
                  <Utensils className="ml-auto h-9 w-9 text-orange-600" />
                  <p className="mt-2 text-sm font-black uppercase text-zinc-500">Order</p>
                  <p data-testid="kot-order-id" className="text-4xl font-black">
                    #{order.id}
                  </p>
                </div>
              </div>
            </header>

            <section className="grid gap-3 border-b border-zinc-200 py-5 sm:grid-cols-4">
              <TicketInfo label="Type" value={fulfillment} />
              <TicketInfo label="Table" value={order.table_number || "Counter"} />
              <TicketInfo label="Status" value={titleCase(order.status)} />
              <TicketInfo label="Items" value={`${totalItems}`} />
              <TicketInfo label="Customer" value={order.customer_name || "Walk-in"} />
              <TicketInfo label="Phone" value={order.customer_phone || "Not provided"} />
              <TicketInfo label="Payment" value={titleCase(order.payment_method)} />
              <TicketInfo label="ETA" value={order.eta_window || "Standard"} />
            </section>

            {order.delivery_address && (
              <section className="border-b border-zinc-200 py-4">
                <p className="text-xs font-black uppercase tracking-widest text-zinc-500">
                  Delivery
                </p>
                <p className="mt-1 text-lg font-black">{order.delivery_zone || "Delivery Zone"}</p>
                <p className="mt-1 text-sm font-semibold text-zinc-700">{order.delivery_address}</p>
              </section>
            )}

            <section className="py-5">
              <div className="grid grid-cols-[72px_1fr] gap-3 border-b border-zinc-950 pb-2 text-xs font-black uppercase tracking-widest text-zinc-500">
                <span>Qty</span>
                <span>Kitchen Items</span>
              </div>
              <div className="divide-y divide-zinc-200">
                {order.items.map((item, index) => (
                  <div
                    key={`${item.name}-${index}`}
                    data-testid="kot-item-row"
                    className="grid grid-cols-[72px_1fr] gap-3 py-4"
                  >
                    <span className="text-3xl font-black">{item.quantity}x</span>
                    <div>
                      <p className="text-2xl font-black">{item.name}</p>
                      {!!item.selected_options?.length && (
                        <p className="mt-2 text-sm font-bold leading-6 text-zinc-600">
                          {item.selected_options.map(optionSummary).join(" | ")}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {order.notes && (
              <section className="rounded-md border-2 border-dashed border-zinc-300 bg-zinc-50 p-4">
                <p className="text-xs font-black uppercase tracking-widest text-zinc-500">Notes</p>
                <p className="mt-1 text-base font-bold">{order.notes}</p>
              </section>
            )}

            <footer className="mt-6 border-t border-zinc-200 pt-4 text-center text-xs font-black uppercase tracking-widest text-zinc-500">
              Prepare accurately. Mark ready before handoff.
            </footer>
          </main>
        )}
      </div>
    </div>
  );
}

function TicketInfo({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="mt-1 break-words text-base font-black text-zinc-950">{value}</p>
    </div>
  );
}
