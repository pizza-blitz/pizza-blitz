"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Search,
  TrendingUp,
  Truck,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getApiUrl } from "@/lib/api";

const API_BASE = getApiUrl("/api/v1/restaurant/vendors");

async function fetchJson(url: string) {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}.`);
  }
  return response.json();
}

function arrayRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

type PriceAlert = {
  item_name: string;
  vendor_name: string;
  prev_price: number;
  price_per_unit: number;
  pct_increase: number;
};

type PriceHistory = {
  id: number;
  vendor_name: string;
  item_name: string;
  recorded_date: string;
  price_per_unit: number;
  unit: string;
  notes?: string;
};

type CheapestVendor = {
  vendor_name: string;
  price_per_unit: number;
  unit: string;
};

type VendorStatus = {
  type: "success" | "error" | "loading";
  text: string;
};

export default function VendorPricePage() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [history, setHistory] = useState<PriceHistory[]>([]);
  const [recentPrices, setRecentPrices] = useState<PriceHistory[]>([]);
  const [itemSearch, setItemSearch] = useState("Tomato Sauce");
  const [cheapest, setCheapest] = useState<CheapestVendor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [message, setMessage] = useState<VendorStatus | null>(null);

  useEffect(() => {
    refreshDashboard();
  }, []);

  const trendData = useMemo(() => {
    return [...history]
      .reverse()
      .map((row) => ({
        ...row,
        label: row.recorded_date ? new Date(row.recorded_date).toLocaleDateString() : "",
      }));
  }, [history]);

  const refreshDashboard = async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      const [alertsData, recentData] = await Promise.all([
        fetchJson(`${API_BASE}/prices/alerts/increases`),
        fetchJson(`${API_BASE}/prices/recent?limit=12`),
      ]);
      const alertRows = arrayRows<PriceAlert>(alertsData);
      const recentRows = arrayRows<PriceHistory>(recentData);
      setAlerts(alertRows);
      setRecentPrices(recentRows);
      const defaultItem = recentRows[0]?.item_name || itemSearch;
      if (defaultItem !== itemSearch) setItemSearch(defaultItem);
      await loadItemData(defaultItem);
    } catch (error) {
      setMessage({ type: "error", text: "Could not load vendor intelligence." });
    } finally {
      setIsLoading(false);
    }
  };

  const loadItemData = async (name: string) => {
    if (!name.trim()) return;
    const encodedName = encodeURIComponent(name.trim());
    setIsAnalyzing(true);
    setMessage({ type: "loading", text: `Analyzing ${name.trim()} vendor prices...` });
    try {
      const [historyData, cheapestData] = await Promise.all([
        fetchJson(`${API_BASE}/prices/history/${encodedName}`),
        fetchJson(`${API_BASE}/intelligence/cheapest/${encodedName}`),
      ]);
      const historyRows = arrayRows<PriceHistory>(historyData);
      const cheapestRows = arrayRows<CheapestVendor>(cheapestData);
      setHistory(historyRows);
      setCheapest(cheapestRows);
      setMessage({
        type: "success",
        text: `Vendor comparison loaded for ${name.trim()}: ${historyRows.length} price point${historyRows.length === 1 ? "" : "s"} and ${cheapestRows.length} vendor option${cheapestRows.length === 1 ? "" : "s"}.`,
      });
    } catch {
      setHistory([]);
      setCheapest([]);
      setMessage({ type: "error", text: "Could not load vendor comparison." });
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Vendor Price Intelligence</h1>
          <p className="mt-1 text-gray-500">Supplier rates learned from purchase orders and manual price logs.</p>
        </div>
        <div className="flex min-w-full gap-3 sm:min-w-0">
          <div className="relative min-w-0 flex-1 sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              aria-label="Vendor item search"
              value={itemSearch}
              onChange={(event) => setItemSearch(event.target.value)}
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm font-semibold outline-none focus:border-orange-500"
              placeholder="Search item"
            />
          </div>
          <button
            type="button"
            onClick={() => loadItemData(itemSearch)}
            disabled={isLoading || isAnalyzing}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold text-white hover:bg-orange-700 disabled:cursor-wait disabled:opacity-60"
          >
            {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isAnalyzing ? "Analyzing" : "Analyze"}
          </button>
        </div>
      </div>

      {message && (
        <div
          role={message.type === "error" ? "alert" : "status"}
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${
            message.type === "success"
              ? "border-green-200 bg-green-50 text-green-800"
              : message.type === "error"
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-orange-200 bg-orange-50 text-orange-800"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : message.type === "loading" ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex min-h-[320px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            <div className="space-y-6 xl:col-span-4">
              <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-gray-500">
                  <Truck className="h-4 w-4 text-orange-500" /> Recent Supplier Prices
                </h3>
                <div className="space-y-3">
                  {recentPrices.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-200 p-5 text-center text-sm font-semibold text-gray-400">
                      No supplier prices logged yet.
                    </div>
                  ) : (
                    recentPrices.map((price) => (
                      <button
                        key={price.id}
                        type="button"
                        onClick={() => {
                          setItemSearch(price.item_name);
                          loadItemData(price.item_name);
                        }}
                        className="w-full rounded-lg border border-gray-100 bg-gray-50 p-3 text-left hover:border-orange-200 hover:bg-orange-50"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-gray-900">{price.item_name}</p>
                            <p className="truncate text-xs text-gray-500">{price.vendor_name}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-black text-gray-900">Rs. {price.price_per_unit}</p>
                            <p className="text-xs font-semibold text-gray-400">per {price.unit}</p>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-gray-500">
                  <AlertTriangle className="h-4 w-4 text-red-500" /> Price Spike Alerts
                </h3>
                <div className="space-y-3">
                  {alerts.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-200 p-5 text-center text-sm font-semibold text-gray-400">
                      No price spikes above 5%.
                    </div>
                  ) : (
                    alerts.slice(0, 6).map((alert, index) => (
                      <div key={`${alert.item_name}-${index}`} className="rounded-lg border border-red-100 bg-red-50 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-gray-900">{alert.item_name}</p>
                            <p className="text-xs text-gray-500">{alert.vendor_name}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-black text-red-600">+{alert.pct_increase.toFixed(1)}%</p>
                            <p className="text-xs text-gray-500">Rs. {alert.prev_price} to {alert.price_per_unit}</p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-6 xl:col-span-8">
              <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900">
                      <TrendingUp className="h-5 w-5 text-blue-500" /> {itemSearch} Price Trend
                    </h3>
                    <p className="text-sm text-gray-500">{history.length} logged price point{history.length === 1 ? "" : "s"}</p>
                  </div>
                </div>
                <div className="h-[360px] w-full">
                  {trendData.length === 0 ? (
                    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-gray-200 text-sm font-semibold text-gray-400">
                      No price history for this item yet.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 900, height: 360 }}>
                      <LineChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} tickLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                        <Tooltip
                          contentStyle={{
                            borderRadius: "12px",
                            border: "1px solid #e5e7eb",
                            boxShadow: "0 16px 40px -20px rgb(0 0 0 / 0.35)",
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="price_per_unit"
                          stroke="#2563EB"
                          strokeWidth={4}
                          dot={{ r: 5, fill: "#2563EB", strokeWidth: 0 }}
                          activeDot={{ r: 7 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                <h3 className="mb-4 text-sm font-black uppercase tracking-wide text-gray-500">Vendor Comparison</h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {cheapest.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-200 p-5 text-center text-sm font-semibold text-gray-400 md:col-span-2">
                      No vendor comparison for this item yet.
                    </div>
                  ) : (
                    cheapest.map((vendor, index) => (
                      <div
                        key={`${vendor.vendor_name}-${index}`}
                        className={`rounded-lg border p-4 ${
                          index === 0
                            ? "border-green-200 bg-green-50"
                            : "border-gray-100 bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-bold text-gray-900">{vendor.vendor_name}</p>
                            {index === 0 && <p className="text-xs font-bold uppercase text-green-700">Best current price</p>}
                          </div>
                          <p className="text-lg font-black text-gray-900">Rs. {vendor.price_per_unit}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
