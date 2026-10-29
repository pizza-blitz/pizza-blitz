"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CircleDollarSign,
  Loader2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type PnlSummary = {
  revenue: number;
  ledger_expense: number;
  cogs: number;
  gross_profit: number;
  gross_margin_percent: number;
  opex: number;
  waste: number;
  untracked_cost: number;
  total_cost: number;
  net_profit: number;
  net_margin_percent: number;
  expense_ratio_percent: number;
  pos_revenue: number;
  pos_orders: number;
  ledger_variance: number;
  days_with_sales: number;
  revenue_per_day: number;
  expense_count: number;
};

type StorePnl = PnlSummary & {
  store_id: number;
  store_name: string;
  store_code: string;
  is_active: boolean;
};

type TrendRow = {
  date: string;
  revenue: number;
  cogs: number;
  opex: number;
  waste: number;
  untracked_cost: number;
  total_cost: number;
  net_profit: number;
};

type CategoryRow = {
  category: string;
  amount: number;
  count: number;
  share_percent: number;
  kind: "cogs" | "opex";
};

type PnlFlag = {
  severity: "fail" | "warn" | string;
  label: string;
  detail: string;
};

type PnlResponse = {
  start_date: string;
  end_date: string;
  store_id: number | null;
  currency: string;
  summary: PnlSummary;
  stores: StorePnl[];
  daily_trend: TrendRow[];
  expense_categories: CategoryRow[];
  flags: PnlFlag[];
};

type StoreOption = {
  id: number;
  name: string;
  code: string;
  is_active: boolean;
};

function businessToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isoDaysAgo(days: number) {
  const date = new Date(`${businessToday()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function money(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

function compactMoney(value: number) {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 100000) {
    return `Rs ${(amount / 100000).toFixed(1)}L`;
  }
  if (Math.abs(amount) >= 1000) {
    return `Rs ${(amount / 1000).toFixed(1)}k`;
  }
  return money(amount);
}

function marginTone(value: number) {
  if (value < 0) return "text-red-700";
  if (value < 10) return "text-amber-700";
  return "text-emerald-700";
}

export default function OutletPnlPage() {
  const [data, setData] = useState<PnlResponse | null>(null);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [startDate, setStartDate] = useState(isoDaysAgo(29));
  const [endDate, setEndDate] = useState(isoDaysAgo(0));
  const [storeId, setStoreId] = useState("all");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  const loadStores = useCallback(async () => {
    try {
      const response = await fetch(getApiUrl("/api/v1/restaurant/stores/"), {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = await response.json();
      setStores(payload.stores || []);
    } catch {
      // The outlet filter is optional; the P&L still loads consolidated.
    }
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        start_date: startDate,
        end_date: endDate,
      });
      if (storeId !== "all") params.set("store_id", storeId);
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/finance/outlet-pnl?${params.toString()}`),
        { credentials: "include", cache: "no-store" }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || "Outlet P&L could not be loaded.");
      }
      setData(payload);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Outlet P&L could not be loaded."
      );
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate, storeId]);

  useEffect(() => {
    setHydrated(true);
    void loadStores();
  }, [loadStores]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = data?.summary;
  const trend = data?.daily_trend || [];
  const activeTrend = trend.filter(
    (row) => row.revenue > 0 || row.total_cost > 0
  );
  const maxRevenue = Math.max(1, ...trend.map((row) => row.revenue));
  const categories = data?.expense_categories || [];
  const maxCategory = Math.max(1, ...categories.map((row) => row.amount));

  return (
    <div
      data-testid="finance-pnl-page"
      data-hydrated={hydrated ? "true" : "false"}
      className="space-y-6 animate-in fade-in duration-300"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
            <BarChart3 className="h-4 w-4" /> Finance
          </p>
          <h1 className="mt-1 text-3xl font-black text-gray-950">
            Outlet P&amp;L
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Per-outlet revenue, cost of goods, operating cost, waste and net
            margin, reconciled against the POS billed total.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-700">
          <CircleDollarSign className="h-4 w-4" /> Ledger basis
        </span>
      </div>

      {message && (
        <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {message}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-100 bg-white p-4">
        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
          From
          <input
            type="date"
            aria-label="P&L start date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
          />
        </label>
        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
          To
          <input
            type="date"
            aria-label="P&L end date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
          />
        </label>
        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
          Outlet
          <select
            data-testid="finance-store-select"
            aria-label="Outlet filter"
            value={storeId}
            onChange={(event) => setStoreId(event.target.value)}
            className="mt-1 block min-w-[180px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900"
          >
            <option value="all">All outlets</option>
            {stores.map((store) => (
              <option key={store.id} value={String(store.id)}>
                {store.name}
                {store.is_active ? "" : " (paused)"}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          data-testid="finance-pnl-apply"
          onClick={() => void load()}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-orange-600 px-4 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-700"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Apply
        </button>
        <p className="ml-auto self-center text-[11px] font-semibold text-gray-400">
          {summary?.days_with_sales || 0} ledger day(s) ·{" "}
          {summary?.expense_count || 0} itemised expense(s)
        </p>
      </div>

      {summary?.revenue === 0 && summary?.pos_revenue === 0 && !isLoading && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          No sales or POS revenue is recorded for this range. Adjust the dates or
          record a daily entry.
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
            <Wallet className="h-4 w-4 text-orange-600" /> Ledger revenue
          </p>
          <p
            data-testid="finance-revenue"
            className="mt-1 text-2xl font-black text-gray-950"
          >
            {money(summary?.revenue || 0)}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-gray-500">
            POS billed {money(summary?.pos_revenue || 0)} · gap{" "}
            <span
              className={
                Math.abs(summary?.ledger_variance || 0) > 1000
                  ? "text-amber-700"
                  : "text-gray-600"
              }
            >
              {money(summary?.ledger_variance || 0)}
            </span>
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
            <TrendingUp className="h-4 w-4 text-emerald-600" /> Gross profit
          </p>
          <p className="mt-1 text-2xl font-black text-gray-950">
            {money(summary?.gross_profit || 0)}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-gray-500">
            COGS {money(summary?.cogs || 0)} · margin{" "}
            {summary?.gross_margin_percent || 0}%
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
            {Number(summary?.net_profit || 0) < 0 ? (
              <TrendingDown className="h-4 w-4 text-red-600" />
            ) : (
              <TrendingUp className="h-4 w-4 text-emerald-600" />
            )}
            Net profit
          </p>
          <p
            data-testid="finance-net-profit"
            className={`mt-1 text-2xl font-black ${marginTone(
              summary?.net_margin_percent || 0
            )}`}
          >
            {money(summary?.net_profit || 0)}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-gray-500">
            Total cost {money(summary?.total_cost || 0)} · margin{" "}
            {summary?.net_margin_percent || 0}%
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
            <Building2 className="h-4 w-4 text-orange-600" /> Cost ratio
          </p>
          <p className="mt-1 text-2xl font-black text-gray-950">
            {summary?.expense_ratio_percent || 0}%
          </p>
          <p className="mt-1 text-[11px] font-semibold text-gray-500">
            Opex {money(summary?.opex || 0)} · waste{" "}
            {money(summary?.waste || 0)}
            {(summary?.untracked_cost || 0) > 0
              ? ` · untracked ${money(summary?.untracked_cost || 0)}`
              : ""}
          </p>
        </div>
      </section>

      {(data?.flags || []).length > 0 && (
        <section className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {(data?.flags || []).map((flag) => (
            <div
              key={`${flag.severity}-${flag.label}`}
              className={`rounded-xl border px-4 py-3 ${
                flag.severity === "fail"
                  ? "border-red-100 bg-red-50 text-red-900"
                  : "border-amber-100 bg-amber-50 text-amber-900"
              }`}
            >
              <p className="text-[10px] font-black uppercase tracking-widest">
                {flag.severity === "fail" ? "Action needed" : "Review"} ·{" "}
                {flag.label}
              </p>
              <p className="mt-1 text-xs font-semibold">{flag.detail}</p>
            </div>
          ))}
        </section>
      )}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
              <Building2 className="h-4 w-4 text-orange-600" /> Outlet P&amp;L
            </p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
              {data?.start_date} → {data?.end_date}
            </p>
          </div>
          <div
            data-testid="finance-store-table"
            className="mt-3 overflow-x-auto"
          >
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-500">
                <tr>
                  <th className="px-3 py-2">Outlet</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Revenue</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">COGS</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Opex</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Waste</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Net profit</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(data?.stores || []).length ? (
                  data?.stores.map((row) => (
                    <tr key={row.store_id}>
                      <td className="px-3 py-2">
                        <p className="font-black text-gray-900">
                          {row.store_name}
                        </p>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                          {row.store_code}
                          {row.is_active ? "" : " · paused"}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-bold">
                        {money(row.revenue)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-bold">
                        {money(row.cogs)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-bold">
                        {money(row.opex)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-bold">
                        {money(row.waste)}
                      </td>
                      <td
                        className={`whitespace-nowrap px-3 py-2 text-right font-black ${marginTone(
                          row.net_margin_percent
                        )}`}
                      >
                        {money(row.net_profit)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-black">
                        {row.net_margin_percent}%
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-6 text-center font-bold text-gray-400"
                    >
                      No outlets match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {summary && (
            <div className="mt-3 grid gap-2 rounded-lg bg-gray-50 px-3 py-2 text-[11px] font-semibold text-gray-600 sm:grid-cols-3">
              <p>
                POS orders:{" "}
                <span className="font-black text-gray-900">
                  {summary.pos_orders}
                </span>
              </p>
              <p>
                Avg revenue/day:{" "}
                <span className="font-black text-gray-900">
                  {money(summary.revenue_per_day)}
                </span>
              </p>
              <p>
                Ledger expense:{" "}
                <span className="font-black text-gray-900">
                  {money(summary.ledger_expense)}
                </span>
              </p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
            <Wallet className="h-4 w-4 text-orange-600" /> Cost mix
          </p>
          <p className="mt-1 text-[11px] font-semibold text-gray-400">
            Share of itemised expenses
          </p>
          <div className="mt-4 space-y-3">
            {categories.length ? (
              categories.slice(0, 8).map((row) => (
                <div key={row.category}>
                  <div className="flex items-center justify-between gap-2 text-xs font-bold text-gray-700">
                    <span className="truncate">{row.category}</span>
                    <span className="shrink-0 text-gray-900">
                      {money(row.amount)}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${
                        row.kind === "cogs" ? "bg-orange-500" : "bg-slate-400"
                      }`}
                      style={{
                        width: `${Math.max(
                          2,
                          (row.amount / maxCategory) * 100
                        )}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                    {row.kind === "cogs" ? "COGS" : "Opex"} ·{" "}
                    {row.share_percent}% · {row.count} entr
                    {row.count === 1 ? "y" : "ies"}
                  </p>
                </div>
              ))
            ) : (
              <p className="rounded-lg bg-gray-50 px-3 py-6 text-center text-xs font-bold text-gray-400">
                No itemised expenses in this range.
              </p>
            )}
          </div>
          {(summary?.untracked_cost || 0) > 0 && (
            <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900">
              {money(summary?.untracked_cost || 0)} of daily-ledger cost has no
              itemised expense. Add the missing bills so the cost split stays
              audit-ready.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-gray-100 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
            <BarChart3 className="h-4 w-4 text-orange-600" /> Daily revenue vs
            net profit
          </p>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
            {activeTrend.length} active day(s)
          </p>
        </div>
        <div className="mt-3 max-h-[380px] space-y-2 overflow-y-auto pr-1">
          {activeTrend.length ? (
            activeTrend.map((row) => (
              <div
                key={row.date}
                className="grid grid-cols-[84px_minmax(0,1fr)_110px] items-center gap-3 text-xs"
              >
                <span className="font-bold text-gray-500">
                  {row.date.slice(5)}
                </span>
                <div className="relative h-5 overflow-hidden rounded-md bg-gray-50">
                  <div
                    className="h-full rounded-md bg-orange-200"
                    style={{
                      width: `${Math.max(
                        1,
                        (row.revenue / maxRevenue) * 100
                      )}%`,
                    }}
                  />
                  {row.net_profit > 0 && (
                    <div
                      className="absolute inset-y-0 left-0 rounded-md bg-emerald-400/80"
                      style={{
                        width: `${Math.max(
                          1,
                          (row.net_profit / maxRevenue) * 100
                        )}%`,
                      }}
                    />
                  )}
                </div>
                <span
                  className={`text-right font-black ${marginTone(
                    row.revenue > 0 ? (row.net_profit / row.revenue) * 100 : 0
                  )}`}
                >
                  {compactMoney(row.net_profit)}
                </span>
              </div>
            ))
          ) : (
            <p className="rounded-lg bg-gray-50 px-3 py-8 text-center text-xs font-bold text-gray-400">
              No daily activity in this range.
            </p>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-gray-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-orange-200" /> Revenue
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" /> Net profit
          </span>
        </div>
      </section>
    </div>
  );
}
