"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChefHat,
  Clock,
  Flame,
  Loader2,
  Maximize,
  MonitorPlay,
  RefreshCw,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const KDS_API = getApiUrl("/api/v1/restaurant/orders/kds");

type KdsOption = {
  group_name?: string;
  option_name?: string;
  price_delta?: number;
};

type KdsLine = {
  line_id: string;
  line_index: number;
  station_key: string;
  station_label: string;
  name: string;
  quantity: number;
  selected_options: KdsOption[];
  status: "open" | "preparing" | "ready" | string;
  priority: "rush" | "watch" | "new" | "cooking" | "ready" | string;
  sla_minutes: number;
};

type KdsOrder = {
  id: number;
  status: string;
  order_type: string;
  fulfillment_type?: string | null;
  table_number?: string | null;
  customer_name?: string | null;
  payment_status?: string | null;
  created_at?: string | null;
  age_minutes: number;
  age_seconds: number;
  scheduled_for?: string | null;
  scheduled_label?: string | null;
  due_in_minutes?: number | null;
  line_count: number;
  item_quantity: number;
  priority: string;
  station_keys: string[];
  lines: KdsLine[];
};

type KdsStation = { key: string; label: string; sla_minutes: number };

type KdsBoard = {
  orders: KdsOrder[];
  stations: KdsStation[];
  server_time: string;
  prep_sla_minutes: number;
  metrics: {
    active_orders: number;
    overdue_orders: number;
    ready_orders: number;
    pending_lines: number;
    preparing_lines: number;
    ready_lines: number;
    rush_lines: number;
    oldest_age_minutes: number;
  };
};

function elapsedSeconds(order: KdsOrder) {
  if (!order.created_at) return order.age_seconds || order.age_minutes * 60;
  const created = new Date(`${order.created_at}Z`).getTime();
  if (Number.isNaN(created)) return order.age_seconds || 0;
  return Math.max(Math.floor((Date.now() - created) / 1000), 0);
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function stationTone(key: string) {
  if (key === "oven") return "border-orange-400/30 bg-orange-500/10 text-orange-200";
  if (key === "fryer") return "border-amber-400/30 bg-amber-500/10 text-amber-200";
  if (key === "cold") return "border-sky-400/30 bg-sky-500/10 text-sky-200";
  return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
}

export default function KdsPage() {
  const [board, setBoard] = useState<KdsBoard | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [stationFilter, setStationFilter] = useState("all");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const knownIds = useRef<Set<number>>(new Set());
  const firstLoad = useRef(true);

  const playChime = useCallback(() => {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.08, context.currentTime);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.18);
    } catch {
      // Sound is a nicety; ignore browser audio restrictions.
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch(KDS_API, { cache: "no-store", credentials: "include" });
      const data = (await response.json().catch(() => ({}))) as KdsBoard & { detail?: string };
      if (!response.ok) throw new Error(data.detail || "Could not load the kitchen board.");
      const ids = new Set<number>((data.orders || []).map((order) => order.id));
      if (!firstLoad.current && soundEnabled) {
        const hasNewOrder = Array.from(ids).some((id) => !knownIds.current.has(id));
        if (hasNewOrder) playChime();
      }
      knownIds.current = ids;
      firstLoad.current = false;
      setBoard(data);
      setLastRefresh(new Date());
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load the kitchen board.");
    } finally {
      setIsLoading(false);
    }
  }, [playChime, soundEnabled]);

  useEffect(() => {
    void load();
    const refreshTimer = window.setInterval(() => {
      void load();
    }, 8000);
    return () => window.clearInterval(refreshTimer);
  }, [load]);

  useEffect(() => {
    const clockTimer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(clockTimer);
  }, []);

  const updateLine = async (
    orderId: number,
    line: KdsLine,
    status: "open" | "preparing" | "ready"
  ) => {
    setBusyKey(`line-${line.line_id}`);
    try {
      const response = await fetch(
        getApiUrl(
          `/api/v1/restaurant/orders/${orderId}/items/${line.line_index}/status`
        ),
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Could not update the item.");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not update the item.");
    } finally {
      setBusyKey(null);
    }
  };

  const updateOrder = async (orderId: number, status: "preparing" | "ready") => {
    setBusyKey(`order-${orderId}`);
    try {
      const response = await fetch(getApiUrl(`/api/v1/restaurant/orders/${orderId}/status`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Could not update the order.");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not update the order.");
    } finally {
      setBusyKey(null);
    }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (next) playChime();
  };

  const orders = (board?.orders || []).filter(
    (order) => stationFilter === "all" || order.station_keys.includes(stationFilter)
  );
  const columns = [
    { key: "open", title: "Incoming", tone: "text-sky-300", orders: orders.filter((order) => order.status === "open") },
    {
      key: "preparing",
      title: "Preparing",
      tone: "text-orange-300",
      orders: orders.filter((order) => order.status === "preparing"),
    },
    {
      key: "ready",
      title: "Ready for handoff",
      tone: "text-emerald-300",
      orders: orders.filter((order) => order.status === "ready"),
    },
  ];

  return (
    <main className="min-h-screen bg-[#0a0a0c] text-white">
      <header className="border-b border-white/10 bg-black/60 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500 text-black">
              <ChefHat className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-300">
                Pizza Blitz
              </p>
              <h1 className="text-xl font-black tracking-tight">Kitchen Display</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              suppressHydrationWarning
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm font-black tabular-nums"
            >
              <Clock className="h-4 w-4 text-gray-400" />
              {clock.toLocaleTimeString("en-IN", { hour12: false })}
            </span>
            <span
              data-testid="kds-connection"
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-black ${
                error
                  ? "border-red-400/30 bg-red-500/10 text-red-200"
                  : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
              }`}
            >
              {error ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
              {error ? "Reconnecting" : "Live"}
            </span>
            <button
              type="button"
              onClick={() => void load()}
              aria-label="Refresh kitchen board"
              className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 text-gray-300 hover:bg-white/5"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={toggleSound}
              aria-label={soundEnabled ? "Mute new order sound" : "Enable new order sound"}
              className={`grid h-10 w-10 place-items-center rounded-lg border ${
                soundEnabled
                  ? "border-orange-400/40 bg-orange-500/20 text-orange-200"
                  : "border-white/10 text-gray-400 hover:bg-white/5"
              }`}
            >
              {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label="Toggle fullscreen"
              className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 text-gray-300 hover:bg-white/5"
            >
              <Maximize className="h-4 w-4" />
            </button>
            <Link
              href="/operations"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-black text-gray-300 hover:bg-white/5"
            >
              <MonitorPlay className="h-4 w-4" /> Station board
            </Link>
          </div>
        </div>

        <div className="mx-auto mt-3 flex max-w-[1800px] flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setStationFilter("all")}
            className={`rounded-lg border px-3 py-2 text-xs font-black uppercase tracking-widest ${
              stationFilter === "all"
                ? "border-orange-400 bg-orange-500 text-black"
                : "border-white/10 text-gray-300 hover:bg-white/5"
            }`}
          >
            All stations
          </button>
          {(board?.stations || []).map((station) => (
            <button
              key={station.key}
              type="button"
              onClick={() => setStationFilter(station.key)}
              className={`rounded-lg border px-3 py-2 text-xs font-black uppercase tracking-widest ${
                stationFilter === station.key
                  ? "border-orange-400 bg-orange-500 text-black"
                  : "border-white/10 text-gray-300 hover:bg-white/5"
              }`}
            >
              {station.label}
            </button>
          ))}
          <span className="ml-auto text-[10px] font-bold uppercase tracking-widest text-gray-500">
            Auto-refresh 8s
            {lastRefresh ? ` · ${lastRefresh.toLocaleTimeString("en-IN")}` : ""}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-[1800px] px-4 py-4">
        {error && (
          <div className="mb-4 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-100">
            {error}
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {[
            { label: "Active orders", value: board?.metrics.active_orders ?? 0, tone: "text-white" },
            {
              label: "Overdue",
              value: board?.metrics.overdue_orders ?? 0,
              tone: "text-red-300",
            },
            { label: "Ready", value: board?.metrics.ready_orders ?? 0, tone: "text-emerald-300" },
            { label: "Pending lines", value: board?.metrics.pending_lines ?? 0, tone: "text-sky-300" },
            { label: "Cooking lines", value: board?.metrics.preparing_lines ?? 0, tone: "text-orange-300" },
            { label: "Rush lines", value: board?.metrics.rush_lines ?? 0, tone: "text-amber-300" },
          ].map((metric) => (
            <div
              key={metric.label}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
            >
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">
                {metric.label}
              </p>
              <p className={`mt-1 text-2xl font-black ${metric.tone}`}>{metric.value}</p>
            </div>
          ))}
        </div>

        {isLoading && !board ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-white/10 py-16 text-sm font-bold text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading kitchen board...
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {columns.map((column) => (
              <section
                key={column.key}
                data-testid={`kds-column-${column.key}`}
                className="min-h-[60vh] rounded-2xl border border-white/10 bg-white/[0.02] p-3"
              >
                <div className="mb-3 flex items-center justify-between px-1">
                  <h2 className={`text-sm font-black uppercase tracking-widest ${column.tone}`}>
                    {column.title}
                  </h2>
                  <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs font-black text-gray-300">
                    {column.orders.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {column.orders.map((order) => {
                    const seconds = elapsedSeconds(order);
                    const overdue = seconds > (board?.prep_sla_minutes || 20) * 60 && order.status !== "ready";
                    const visibleLines =
                      stationFilter === "all"
                        ? order.lines
                        : order.lines.filter((line) => line.station_key === stationFilter);
                    return (
                      <article
                        key={order.id}
                        data-testid={`kds-order-${order.id}`}
                        className={`rounded-xl border bg-[#141416] p-3 shadow-lg ${
                          overdue ? "border-red-500/50" : "border-white/10"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-lg font-black">#{order.id}</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                              {order.fulfillment_type || order.order_type}
                              {order.table_number ? ` · Table ${order.table_number}` : ""}
                              {order.customer_name ? ` · ${order.customer_name}` : ""}
                            </p>
                          </div>
                          <span
                            data-testid={`kds-timer-${order.id}`}
                            className={`rounded-lg px-2.5 py-1 text-sm font-black tabular-nums ${
                              overdue
                                ? "bg-red-500/20 text-red-200"
                                : order.status === "ready"
                                  ? "bg-emerald-500/20 text-emerald-200"
                                  : "bg-white/10 text-gray-200"
                            }`}
                          >
                            {formatElapsed(seconds)}
                          </span>
                        </div>

                        {order.scheduled_label && (
                          <p className="mt-2 inline-flex rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-[10px] font-black text-amber-200">
                            Scheduled · {order.scheduled_label}
                            {typeof order.due_in_minutes === "number"
                              ? order.due_in_minutes >= 0
                                ? ` · in ${order.due_in_minutes}m`
                                : ` · ${Math.abs(order.due_in_minutes)}m late`
                              : ""}
                          </p>
                        )}

                        <div className="mt-3 space-y-2">
                          {visibleLines.map((line) => {
                            const lineBusy = busyKey === `line-${line.line_id}`;
                            return (
                              <div
                                key={line.line_id}
                                data-testid={`kds-line-${line.line_id}`}
                                className={`rounded-lg border px-3 py-2 ${stationTone(line.station_key)}`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-sm font-black leading-tight">
                                      {line.quantity} × {line.name}
                                    </p>
                                    {line.selected_options.length > 0 && (
                                      <p className="mt-0.5 text-[10px] font-semibold opacity-80">
                                        {line.selected_options
                                          .map((option) =>
                                            [option.group_name, option.option_name]
                                              .filter(Boolean)
                                              .join(": ")
                                          )
                                          .join(" | ")}
                                      </p>
                                    )}
                                    <p className="mt-1 text-[9px] font-black uppercase tracking-widest opacity-70">
                                      {line.station_label} · {line.status}
                                    </p>
                                  </div>
                                  <div className="flex shrink-0 flex-col gap-1">
                                    <button
                                      type="button"
                                      data-testid={`kds-bump-${line.line_id}`}
                                      onClick={() =>
                                        void updateLine(
                                          order.id,
                                          line,
                                          line.status === "ready" ? "preparing" : "ready"
                                        )
                                      }
                                      disabled={lineBusy}
                                      className={`rounded-md px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest ${
                                        line.status === "ready"
                                          ? "bg-white/10 text-gray-300 hover:bg-white/20"
                                          : "bg-emerald-500 text-black hover:bg-emerald-400"
                                      } disabled:opacity-40`}
                                    >
                                      {lineBusy ? "..." : line.status === "ready" ? "Recall" : "Bump"}
                                    </button>
                                    {line.status === "open" && (
                                      <button
                                        type="button"
                                        data-testid={`kds-start-${line.line_id}`}
                                        onClick={() => void updateLine(order.id, line, "preparing")}
                                        disabled={lineBusy}
                                        className="rounded-md bg-orange-500 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-black hover:bg-orange-400 disabled:opacity-40"
                                      >
                                        Start
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                          {order.status === "open" && (
                            <button
                              type="button"
                              data-testid={`kds-order-action-${order.id}`}
                              onClick={() => void updateOrder(order.id, "preparing")}
                              disabled={busyKey === `order-${order.id}`}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-orange-500 py-2 text-xs font-black uppercase tracking-widest text-black hover:bg-orange-400 disabled:opacity-40"
                            >
                              <Flame className="h-4 w-4" /> Start
                            </button>
                          )}
                          {order.status === "preparing" && (
                            <button
                              type="button"
                              data-testid={`kds-order-action-${order.id}`}
                              onClick={() => void updateOrder(order.id, "ready")}
                              disabled={busyKey === `order-${order.id}`}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-500 py-2 text-xs font-black uppercase tracking-widest text-black hover:bg-emerald-400 disabled:opacity-40"
                            >
                              <CheckCircle2 className="h-4 w-4" /> Mark ready
                            </button>
                          )}
                          {order.status === "ready" && (
                            <button
                              type="button"
                              data-testid={`kds-order-action-${order.id}`}
                              onClick={() => void updateOrder(order.id, "preparing")}
                              disabled={busyKey === `order-${order.id}`}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/10 py-2 text-xs font-black uppercase tracking-widest text-gray-200 hover:bg-white/20 disabled:opacity-40"
                            >
                              <AlertTriangle className="h-4 w-4" /> Recall
                            </button>
                          )}
                          <span className="rounded-lg bg-white/5 px-2.5 py-2 text-[10px] font-black text-gray-400">
                            {order.item_quantity} items
                          </span>
                        </div>
                      </article>
                    );
                  })}
                  {!column.orders.length && (
                    <p className="rounded-xl border border-dashed border-white/10 px-4 py-10 text-center text-xs font-bold uppercase tracking-widest text-gray-600">
                      No tickets
                    </p>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
