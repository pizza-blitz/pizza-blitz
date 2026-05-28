"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Clock,
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

  const fulfillment = useMemo(
    () => titleCase(order?.fulfillment_type || order?.order_type),
    [order?.fulfillment_type, order?.order_type]
  );
  const totalItems = useMemo(
    () => order?.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || 0,
    [order?.items]
  );

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

        {message && (
          <div className="mb-4 rounded-md border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-100 print:hidden">
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
              Prepare accurately. Mark ready in Operations when complete.
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
