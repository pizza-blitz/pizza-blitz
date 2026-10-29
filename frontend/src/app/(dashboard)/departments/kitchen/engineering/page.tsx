"use client";

import { useEffect, useState } from "react";
import { Info, RefreshCw } from "lucide-react";
import { getApiUrl } from "@/lib/api";
import {
  DepartmentToolShell,
  EmptyState,
  ErrorNote,
  LoadingRow,
  Panel,
  StatCard,
  formatMoney,
  inputClass,
  labelClass,
  secondaryButtonClass,
} from "@/components/department-tools";

type StoreRow = { id: number; name: string };

type MenuEngineeringItem = {
  menu_item_id: number;
  name: string;
  category: string;
  units: number;
  revenue: number;
  cost: number;
  margin: number;
  margin_per_unit: number;
  margin_pct: number;
  popularity_share: number;
  classification: string;
  action: string;
};

type MenuEngineeringCategory = {
  category: string;
  item_count: number;
  units: number;
  revenue: number;
  margin: number;
  margin_pct: number;
};

type MenuEngineeringSummary = {
  days: number;
  store_id?: number | null;
  orders_counted: number;
  items_sold: number;
  revenue: number;
  cost: number;
  margin: number;
  margin_pct: number;
  stars: number;
  plough_horses: number;
  puzzles: number;
  dogs: number;
  median_units: number;
  median_margin: number;
  basis: string;
};

type MenuEngineeringResponse = {
  items: MenuEngineeringItem[];
  categories: MenuEngineeringCategory[];
  summary: MenuEngineeringSummary;
};

const DAY_OPTIONS = [7, 30, 90, 365];

const CLASSIFICATIONS = [
  {
    key: "stars",
    label: "Stars",
    description: "High popularity · high margin",
    action: "Feature these first and protect availability.",
    border: "border-emerald-200 bg-emerald-50/60",
    badge: "bg-emerald-100 text-emerald-800",
    dot: "bg-emerald-500",
  },
  {
    key: "plough_horses",
    label: "Plough horses",
    description: "High popularity · low margin",
    action: "Reprice or re-cost, but keep them visible.",
    border: "border-blue-200 bg-blue-50/60",
    badge: "bg-blue-100 text-blue-800",
    dot: "bg-blue-500",
  },
  {
    key: "puzzles",
    label: "Puzzles",
    description: "Low popularity · high margin",
    action: "Reposition, describe and upsell them.",
    border: "border-amber-200 bg-amber-50/60",
    badge: "bg-amber-100 text-amber-800",
    dot: "bg-amber-500",
  },
  {
    key: "dogs",
    label: "Dogs",
    description: "Low popularity · low margin",
    action: "Rework the recipe or remove from the menu.",
    border: "border-red-200 bg-red-50/60",
    badge: "bg-red-100 text-red-800",
    dot: "bg-red-500",
  },
] as const;

type ClassificationKey = (typeof CLASSIFICATIONS)[number]["key"];

function errorDetail(payload: unknown, fallback: string) {
  if (typeof payload === "object" && payload !== null) {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return fallback;
}

function parseStores(payload: unknown): StoreRow[] {
  let entries: unknown[] = [];
  if (Array.isArray(payload)) {
    entries = payload;
  } else if (typeof payload === "object" && payload !== null) {
    const record = payload as { items?: unknown; stores?: unknown };
    if (Array.isArray(record.items)) entries = record.items;
    else if (Array.isArray(record.stores)) entries = record.stores;
  }
  return entries.filter((entry): entry is StoreRow => {
    if (typeof entry !== "object" || entry === null) return false;
    const row = entry as { id?: unknown; name?: unknown };
    return typeof row.id === "number" && typeof row.name === "string";
  });
}

function normalizeClassification(value: string): ClassificationKey | null {
  const key = value.toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (key === "star" || key === "stars") return "stars";
  if (key === "plough_horse" || key === "plough_horses" || key === "ploughhorse") {
    return "plough_horses";
  }
  if (key === "puzzle" || key === "puzzles") return "puzzles";
  if (key === "dog" || key === "dogs") return "dogs";
  return null;
}

function formatPercent(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  return `${amount.toLocaleString("en-IN", {
    maximumFractionDigits: 1,
    minimumFractionDigits: amount % 1 ? 1 : 0,
  })}%`;
}

export default function MenuEngineeringPage() {
  const [days, setDays] = useState(30);
  const [storeId, setStoreId] = useState("");
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [data, setData] = useState<MenuEngineeringResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (storeId) params.set("store_id", storeId);
      const response = await fetch(
        getApiUrl(
          `/api/v1/restaurant/company/kitchen/menu-engineering?${params.toString()}`
        ),
        { credentials: "include", cache: "no-store" }
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(errorDetail(payload, "Menu engineering failed to load."));
      }
      setData(payload as MenuEngineeringResponse);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Menu engineering failed to load."
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Reload when either filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, storeId]);

  useEffect(() => {
    const loadStores = async () => {
      try {
        const response = await fetch(getApiUrl("/api/v1/restaurant/stores/"), {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload: unknown = await response.json();
        setStores(parseStores(payload));
      } catch {
        // Store options are optional; the report still runs across all stores.
        setStores([]);
      }
    };
    void loadStores();
  }, []);

  const summary = data?.summary ?? null;
  const items = data?.items ?? [];
  const categories = data?.categories ?? [];
  const itemsByRevenue = [...items].sort((left, right) => right.revenue - left.revenue);
  const counts: Record<ClassificationKey, number> = {
    stars: summary?.stars ?? 0,
    plough_horses: summary?.plough_horses ?? 0,
    puzzles: summary?.puzzles ?? 0,
    dogs: summary?.dogs ?? 0,
  };

  return (
    <DepartmentToolShell
      departmentKey="kitchen"
      departmentLabel="Kitchen"
      title="Menu engineering"
      subtitle="Read menu performance by popularity and margin, then act on each quadrant with real sales and cost data."
    >
      <div data-testid="menu-engineering-page" className="space-y-5">
        <ErrorNote message={error} />

        <Panel
          title="Report range"
          description="Popularity and margin thresholds are recalculated for the selected store and window."
          actions={
            <button
              type="button"
              onClick={() => void load()}
              disabled={isLoading}
              className={`inline-flex items-center gap-1.5 ${secondaryButtonClass}`}
            >
              <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          }
        >
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className={labelClass}>Window</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {DAY_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setDays(option)}
                    className={`rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-widest ${
                      days === option
                        ? "border-gray-950 bg-gray-950 text-white"
                        : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    {option} days
                  </button>
                ))}
              </div>
            </div>
            <label className={`min-w-[200px] ${labelClass}`}>
              Store
              <select
                aria-label="Filter menu engineering by store"
                value={storeId}
                onChange={(event) => setStoreId(event.target.value)}
                className={`mt-1 ${inputClass}`}
              >
                <option value="">All stores</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Panel>

        {isLoading && !data ? (
          <LoadingRow label="Loading menu engineering..." />
        ) : data && summary ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Revenue"
                value={formatMoney(summary.revenue)}
                hint={`${summary.orders_counted.toLocaleString("en-IN")} orders counted`}
              />
              <StatCard
                label="Gross margin"
                value={formatMoney(summary.margin)}
                hint={`${formatPercent(summary.margin_pct)} margin`}
                tone="good"
              />
              <StatCard
                label="Items sold"
                value={summary.items_sold.toLocaleString("en-IN")}
                hint={`${items.length} menu items classified`}
              />
              <StatCard
                label="Stars"
                value={summary.stars}
                hint={`Top quadrant · median ${summary.median_units.toLocaleString(
                  "en-IN"
                )} units`}
                tone="info"
              />
            </section>

            {items.length === 0 ? (
              <EmptyState
                title="No sales in this range"
                body="Try a wider window or another store. Classification needs at least a few sold items to be meaningful."
              />
            ) : (
              <>
                <section className="grid gap-3 md:grid-cols-2">
                  {CLASSIFICATIONS.map((entry) => {
                    const topItems = itemsByRevenue
                      .filter(
                        (item) =>
                          normalizeClassification(item.classification) === entry.key
                      )
                      .slice(0, 4);
                    return (
                      <div
                        key={entry.key}
                        data-testid={`classification-card-${entry.key}`}
                        className={`rounded-2xl border p-4 ${entry.border}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-500">
                              <span className={`h-2 w-2 rounded-full ${entry.dot}`} />
                              {entry.label}
                            </p>
                            <p className="mt-1 text-3xl font-black text-gray-950">
                              {counts[entry.key]}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${entry.badge}`}
                          >
                            {entry.description}
                          </span>
                        </div>
                        <p className="mt-2 text-xs font-semibold text-gray-600">
                          {entry.action}
                        </p>
                        <div className="mt-3 border-t border-black/5 pt-2">
                          <p className={labelClass}>Top sellers</p>
                          {topItems.length === 0 ? (
                            <p className="mt-1 text-[11px] font-semibold text-gray-400">
                              No items in this quadrant.
                            </p>
                          ) : (
                            <ul className="mt-1 space-y-1">
                              {topItems.map((item) => (
                                <li
                                  key={item.menu_item_id}
                                  className="flex items-center justify-between gap-3 text-xs font-semibold text-gray-700"
                                >
                                  <span className="truncate">{item.name}</span>
                                  <span className="shrink-0 text-[10px] text-gray-500">
                                    {formatMoney(item.revenue)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </section>

                <Panel
                  title="Item performance"
                  description="Sorted by revenue. Classification uses the median units and median margin for this selection."
                >
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left">
                      <thead>
                        <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                          <th className="px-2 py-2">Item</th>
                          <th className="px-2 py-2">Units</th>
                          <th className="px-2 py-2">Revenue</th>
                          <th className="px-2 py-2">Margin</th>
                          <th className="px-2 py-2">Margin %</th>
                          <th className="px-2 py-2">Popularity</th>
                          <th className="px-2 py-2">Class</th>
                          <th className="px-2 py-2">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itemsByRevenue.map((item) => {
                          const classified = normalizeClassification(item.classification);
                          const meta = CLASSIFICATIONS.find(
                            (entry) => entry.key === classified
                          );
                          return (
                            <tr
                              key={item.menu_item_id}
                              data-testid={`menu-engineering-row-${item.menu_item_id}`}
                              className="border-b border-gray-50 align-top text-sm"
                            >
                              <td className="px-2 py-3">
                                <p className="font-black text-gray-900">{item.name}</p>
                                <p className="text-[10px] font-semibold text-gray-400">
                                  {item.category}
                                </p>
                              </td>
                              <td className="px-2 py-3 font-semibold text-gray-600">
                                {item.units.toLocaleString("en-IN")}
                              </td>
                              <td className="px-2 py-3 font-black text-gray-900">
                                {formatMoney(item.revenue)}
                              </td>
                              <td className="px-2 py-3 font-semibold text-gray-600">
                                {formatMoney(item.margin)}
                              </td>
                              <td className="px-2 py-3 font-semibold text-gray-600">
                                {formatPercent(item.margin_pct)}
                              </td>
                              <td className="px-2 py-3 font-semibold text-gray-600">
                                {formatPercent(item.popularity_share)}
                              </td>
                              <td className="px-2 py-3">
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                                    meta?.badge ?? "bg-gray-100 text-gray-600"
                                  }`}
                                >
                                  {meta?.label ?? item.classification}
                                </span>
                              </td>
                              <td className="max-w-[260px] px-2 py-3 text-xs font-semibold text-gray-500">
                                {item.action || "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Panel>

                <Panel
                  title="Category summary"
                  description="Where the revenue and margin are concentrated."
                >
                  {categories.length === 0 ? (
                    <EmptyState
                      title="No category roll-up"
                      body="Category totals appear once the selected range has sales."
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left">
                        <thead>
                          <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                            <th className="px-2 py-2">Category</th>
                            <th className="px-2 py-2">Items</th>
                            <th className="px-2 py-2">Units</th>
                            <th className="px-2 py-2">Revenue</th>
                            <th className="px-2 py-2">Margin</th>
                            <th className="px-2 py-2">Margin %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {categories.map((category) => (
                            <tr
                              key={category.category}
                              className="border-b border-gray-50 text-sm"
                            >
                              <td className="px-2 py-2 font-black text-gray-900">
                                {category.category}
                              </td>
                              <td className="px-2 py-2 font-semibold text-gray-600">
                                {category.item_count}
                              </td>
                              <td className="px-2 py-2 font-semibold text-gray-600">
                                {category.units.toLocaleString("en-IN")}
                              </td>
                              <td className="px-2 py-2 font-black text-gray-900">
                                {formatMoney(category.revenue)}
                              </td>
                              <td className="px-2 py-2 font-semibold text-gray-600">
                                {formatMoney(category.margin)}
                              </td>
                              <td className="px-2 py-2 font-semibold text-gray-600">
                                {formatPercent(category.margin_pct)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
              </>
            )}

            <div className="flex items-start gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] font-semibold text-gray-500">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                <span className="font-black text-gray-700">Basis:</span>{" "}
                {summary.basis || "Median units and median margin split the menu."} Median
                units {summary.median_units.toLocaleString("en-IN")} · median margin{" "}
                {formatMoney(summary.median_margin)}. Days: {summary.days}.
              </p>
            </div>
          </>
        ) : (
          <EmptyState
            title="Menu engineering unavailable"
            body="The report could not be loaded. Check the filters and try again."
          />
        )}
      </div>
    </DepartmentToolShell>
  );
}
