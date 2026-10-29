"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPin, Phone, Radio, RefreshCw } from "lucide-react";
import { getApiUrl } from "@/lib/api";
import type { DispatchRider } from "./dispatch-live-map-inner";

const QUEUE_API = getApiUrl("/api/v1/restaurant/delivery/queue");
const REFRESH_MS = 15000;
const STALE_AFTER_MS = 3 * 60 * 1000;

const DispatchMapInner = dynamic(() => import("./dispatch-live-map-inner"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full animate-pulse place-items-center bg-slate-100 text-xs font-black uppercase tracking-widest text-slate-400">
      Loading rider map
    </div>
  ),
});

type QueueAssignment = {
  order_id?: number;
  assigned_to?: string | null;
  status: string;
  rider_phone?: string | null;
  location?: { lat: number; lng: number; updated_at?: string | null } | null;
};

type QueueOrder = {
  id: number;
  assignment?: QueueAssignment | null;
};

type QueueResponse = {
  orders?: QueueOrder[];
};

function fixDate(value?: string | null): Date | null {
  if (!value) return null;
  // The API sends naive UTC timestamps; without the suffix a browser would
  // read them as local time and a fresh fix would look hours old.
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function ageLabel(fix: Date | null, now: number) {
  if (!fix) return "No fix time";
  const seconds = Math.max(0, Math.round((now - fix.getTime()) / 1000));
  if (seconds < 45) return "Fix just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Fix ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `Fix ${hours} h ${minutes % 60} min ago`;
}

function clockLabel(fix: Date | null) {
  return fix
    ? fix.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
}

export default function DispatchLiveMap() {
  const [orders, setOrders] = useState<QueueOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch(QUEUE_API, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        setError("Rider positions could not be loaded.");
        return;
      }
      const data = (await response.json()) as QueueResponse;
      setOrders(data.orders || []);
      setError(null);
      setRefreshedAt(new Date());
    } catch {
      setError("Rider positions could not be loaded.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const now = refreshedAt?.getTime() ?? Date.now();
  const riders = useMemo<DispatchRider[]>(() => {
    const active = (orders || []).filter((order) => {
      const assignment = order.assignment;
      return (
        assignment &&
        ["assigned", "out_for_delivery"].includes(assignment.status) &&
        assignment.location &&
        typeof assignment.location.lat === "number" &&
        typeof assignment.location.lng === "number"
      );
    });
    return active
      .map((order) => {
        const assignment = order.assignment as QueueAssignment;
        const fix = fixDate(assignment.location?.updated_at);
        return {
          orderId: order.id,
          name: assignment.assigned_to || "Rider",
          status: assignment.status,
          phone: assignment.rider_phone || null,
          lat: Number(assignment.location?.lat),
          lng: Number(assignment.location?.lng),
          updatedLabel: `${ageLabel(fix, now)}${
            clockLabel(fix) ? ` · ${clockLabel(fix)}` : ""
          }`,
          stale: fix ? now - fix.getTime() > STALE_AFTER_MS : false,
        };
      })
      .sort((left, right) => {
        const leftOut = left.status === "out_for_delivery" ? 0 : 1;
        const rightOut = right.status === "out_for_delivery" ? 0 : 1;
        return leftOut - rightOut || left.orderId - right.orderId;
      });
  }, [orders, now]);

  const onRoad = riders.filter((rider) => rider.status === "out_for_delivery").length;

  return (
    <div
      data-testid="dispatch-live-map"
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-700">
              Live rider map
            </h3>
            <span
              data-testid="dispatch-live-rider-count"
              className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-black text-emerald-700"
            >
              {riders.length} sharing · {onRoad} on road
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold text-gray-500">
            GPS from each rider app, refreshed every 15 seconds. No map key required.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {refreshedAt && (
            <span className="text-xs font-bold text-slate-500">
              Updated {refreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={refreshing}
            data-testid="dispatch-live-refresh"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
          {error} The board keeps retrying every 15 seconds.
        </p>
      )}

      {!riders.length ? (
        <div
          data-testid="dispatch-live-map-empty"
          className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center"
        >
          <Radio className="mx-auto h-6 w-6 text-slate-400" />
          <p className="mt-2 text-sm font-black text-slate-700">
            No rider is sharing a location yet.
          </p>
          <p className="mx-auto mt-1 max-w-xl text-xs font-semibold text-slate-500">
            Ask the rider to open their rider link and tap <b>Share once</b> or{" "}
            <b>Go live</b>. Their position appears here while the order is assigned or
            out for delivery.
          </p>
        </div>
      ) : (
        <div className="mt-3 grid gap-3 xl:grid-cols-[1.55fr_1fr]">
          <div
            data-testid="dispatch-live-map-canvas"
            aria-label="Live positions of riders on active deliveries"
            className="relative h-[320px] overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-inner"
          >
            <DispatchMapInner riders={riders} />
          </div>
          <ul
            data-testid="dispatch-rider-list"
            className="max-h-[320px] space-y-2 overflow-y-auto pr-1"
          >
            {riders.map((rider) => (
              <li
                key={rider.orderId}
                data-testid="dispatch-rider-row"
                data-order-id={rider.orderId}
                className="rounded-lg border border-slate-200 bg-slate-50 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-black text-slate-950">
                    #{rider.orderId} · {rider.name}
                  </p>
                  <span
                    className={`rounded-md px-2 py-1 text-[10px] font-black uppercase ${
                      rider.status === "out_for_delivery"
                        ? "bg-orange-100 text-orange-700"
                        : "bg-sky-100 text-sky-700"
                    }`}
                  >
                    {rider.status.replace(/_/g, " ")}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <p
                    className={`flex items-center gap-1 text-xs font-bold ${
                      rider.stale ? "text-amber-700" : "text-emerald-700"
                    }`}
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    {rider.updatedLabel}
                    {rider.stale ? " · check rider" : ""}
                  </p>
                  {rider.phone && (
                    <a
                      href={`tel:${rider.phone}`}
                      className="inline-flex items-center gap-1 rounded-md bg-slate-950 px-2 py-1 text-[10px] font-black uppercase text-white"
                    >
                      <Phone className="h-3 w-3" /> Call rider
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
