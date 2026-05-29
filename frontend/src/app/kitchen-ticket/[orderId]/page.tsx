"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
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
  kitchen_station?: string | null;
  kitchen_station_label?: string | null;
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

function fallbackKitchenStation(item: KitchenTicketItem) {
  const name = item.name.toLowerCase();
  if (name.includes("pizza") || name.includes("bread")) {
    return { key: "oven", label: "Oven Station" };
  }
  if (name.includes("fries") || name.includes("wing") || name.includes("starter")) {
    return { key: "fryer", label: "Fryer / Sides" };
  }
  if (name.includes("drink") || name.includes("cola") || name.includes("dessert")) {
    return { key: "cold", label: "Cold / Drinks" };
  }
  return { key: "prep", label: "Prep Station" };
}

function itemStation(item: KitchenTicketItem) {
  const fallback = fallbackKitchenStation(item);
  return {
    key: item.kitchen_station || fallback.key,
    label: item.kitchen_station_label || fallback.label,
  };
}

function stationHref(orderId: string, stationKey: string) {
  if (stationKey === "all") return `/kitchen-ticket/${orderId}`;
  return `/kitchen-ticket/${orderId}?station=${encodeURIComponent(stationKey)}`;
}

export default function KitchenTicketPage() {
  const params = useParams<{ orderId: string }>();
  const searchParams = useSearchParams();
  const orderId = params.orderId;
  const activeStation = searchParams.get("station") || "all";
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
  const stationGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; items: KitchenTicketItem[]; quantity: number }>();
    for (const item of order?.items || []) {
      const station = itemStation(item);
      const current = groups.get(station.key) || {
        key: station.key,
        label: station.label,
        items: [],
        quantity: 0,
      };
      current.items.push(item);
      current.quantity += Number(item.quantity || 0);
      groups.set(station.key, current);
    }
    return Array.from(groups.values());
  }, [order?.items]);
  const visibleStationGroups = useMemo(
    () =>
      activeStation === "all"
        ? stationGroups
        : stationGroups.filter((group) => group.key === activeStation),
    [activeStation, stationGroups]
  );
  const activeStationLabel =
    activeStation === "all"
      ? "All Stations"
      : stationGroups.find((group) => group.key === activeStation)?.label || titleCase(activeStation);
  const visibleItemsTotal = visibleStationGroups.reduce((sum, group) => sum + group.quantity, 0);
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
                  <h1 data-testid="kot-station-title" className="mt-1 text-4xl font-black">
                    {activeStation === "all" ? "KOT" : `${activeStationLabel} KOT`}
                  </h1>
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
              <TicketInfo label="Station View" value={`${activeStationLabel} (${visibleItemsTotal})`} />
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

            <section data-testid="kot-station-board" className="border-b border-zinc-200 py-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-zinc-500">
                    Station Routing
                  </p>
                  <p className="mt-1 text-sm font-bold text-zinc-700">
                    Print the full KOT or isolate only the station lines for the current team.
                  </p>
                </div>
                <Link
                  data-testid="kot-station-filter-all"
                  href={stationHref(orderId, "all")}
                  className={`rounded-md px-3 py-2 text-xs font-black uppercase ${
                    activeStation === "all" ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-700"
                  }`}
                >
                  All Stations
                </Link>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {stationGroups.map((group) => (
                  <Link
                    key={group.key}
                    data-testid={`kot-station-filter-${group.key}`}
                    href={stationHref(orderId, group.key)}
                    className={`rounded-md border p-3 ${
                      activeStation === group.key
                        ? "border-orange-600 bg-orange-50 text-orange-900"
                        : "border-zinc-200 bg-zinc-50 text-zinc-800"
                    }`}
                  >
                    <p className="text-xs font-black uppercase tracking-widest">{group.label}</p>
                    <p className="mt-1 text-2xl font-black">{group.quantity}x</p>
                  </Link>
                ))}
              </div>
            </section>

            <section className="py-5">
              <div className="grid grid-cols-[72px_1fr] gap-3 border-b border-zinc-950 pb-2 text-xs font-black uppercase tracking-widest text-zinc-500">
                <span>Qty</span>
                <span>Kitchen Items</span>
              </div>
              <div className="space-y-5">
                {visibleStationGroups.map((group) => (
                  <div
                    key={group.key}
                    data-testid={`kot-station-section-${group.key}`}
                    className="rounded-md border border-zinc-200"
                  >
                    <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3">
                      <p className="text-xs font-black uppercase tracking-widest text-zinc-600">{group.label}</p>
                      <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-black text-white">
                        {group.quantity}x
                      </span>
                    </div>
                    <div className="divide-y divide-zinc-200 px-4">
                      {group.items.map((item, index) => {
                        const station = itemStation(item);
                        return (
                          <div
                            key={`${group.key}-${item.name}-${index}`}
                            data-testid="kot-item-row"
                            className="grid grid-cols-[72px_1fr] gap-3 py-4"
                          >
                            <span className="text-3xl font-black">{item.quantity}x</span>
                            <div>
                              <div className="flex flex-wrap items-start gap-2">
                                <p className="text-2xl font-black">{item.name}</p>
                                <span className="rounded-full bg-orange-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-orange-700">
                                  {station.label}
                                </span>
                              </div>
                              {!!item.selected_options?.length && (
                                <p className="mt-2 text-sm font-bold leading-6 text-zinc-600">
                                  {item.selected_options.map(optionSummary).join(" | ")}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
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
