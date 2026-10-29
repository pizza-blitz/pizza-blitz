"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  IndianRupee,
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
  Save,
  ShieldCheck,
  TrendingDown,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const STATS_API = getApiUrl("/api/v1/restaurant/stats/dashboard-stats?period=30days");
const TREND_API = getApiUrl("/api/v1/restaurant/stats/insights/profit-trend?months=6");
const EXPENSES_API = getApiUrl("/api/v1/restaurant/expenses/expenses");
const CATEGORIES_API = getApiUrl("/api/v1/restaurant/expenses/categories");
const AUDIT_API = getApiUrl("/api/v1/restaurant/expenses/audit-command");
const STORES_API = getApiUrl("/api/v1/restaurant/stores/");

type ExpenseCategory = {
  id: number;
  name: string;
  is_active: boolean;
};

type ExpenseRow = {
  id: number;
  store_id?: number;
  date: string;
  category_id: number;
  category?: string;
  amount: number;
  description?: string | null;
  receipt_photo_url?: string | null;
};

type StoreOption = {
  id: number;
  name: string;
  code: string;
};

type ExpenseApprovalQueueItem = ExpenseRow & {
  severity: "warn" | "fail";
  approval_status: string;
  reasons: string[];
  next_action: string;
};

type ExpenseStats = {
  total_sales: number;
  total_expense: number;
  total_profit: number;
  avg_daily_sale: number;
  sales_growth: number;
};

type TrendRow = {
  month: string;
  total_sale: number;
  total_expense: number;
  profit: number;
  margin_percent: number;
};

type AuditCheck = {
  key: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
};

type AuditCategory = {
  category_id: number;
  category: string;
  amount: number;
  count: number;
  share_percent: number;
};

type DailyRisk = {
  date: string;
  sales: number;
  expenses: number;
  profit: number;
  expense_ratio: number;
  severity: "warn" | "fail";
  reason: string;
};

type ExpenseAuditCommand = {
  period: {
    start_date: string;
    end_date: string;
    days: number;
  };
  overall: "pass" | "warn" | "fail";
  readiness_score: number;
  summary: {
    total_sales: number;
    sales_expenses: number;
    ledger_total: number;
    profit: number;
    expense_ratio: number;
    margin_percent: number;
    ledger_variance: number;
    ledger_variance_percent: number;
    expense_count: number;
    category_count: number;
    risk_day_count: number;
    approval_queue_count: number;
    missing_receipt_count: number;
    high_value_receipt_gap_count: number;
    duplicate_candidate_count: number;
  };
  checks: AuditCheck[];
  category_breakdown: AuditCategory[];
  daily_risks: DailyRisk[];
  approval_queue: ExpenseApprovalQueueItem[];
  top_expenses: ExpenseRow[];
  next_actions: string[];
};

const categoryColors = [
  "#EA580C",
  "#2563EB",
  "#10B981",
  "#7C3AED",
  "#DC2626",
  "#0F766E",
  "#CA8A04",
  "#64748B",
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function money(value: number | string | undefined | null) {
  return `Rs. ${Math.round(Number(value || 0)).toLocaleString()}`;
}

function statusClass(status: string) {
  if (status === "pass") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "fail") return "border-red-200 bg-red-50 text-red-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, credentials: "include", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export default function ExpenseTracker() {
  const [expenseStats, setExpenseStats] = useState<ExpenseStats | null>(null);
  const [trends, setTrends] = useState<TrendRow[]>([]);
  const [detailedExpenses, setDetailedExpenses] = useState<ExpenseRow[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [audit, setAudit] = useState<ExpenseAuditCommand | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    date: todayIso(),
    store_id: "",
    category_id: "",
    amount: "",
    description: "",
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchExpenseData(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categoryById = useMemo(() => {
    return categories.reduce<Record<number, ExpenseCategory>>((acc, category) => {
      acc[category.id] = category;
      return acc;
    }, {});
  }, [categories]);

  const categoryTotals = useMemo(() => {
    const totals = new Map<number, number>();
    detailedExpenses.forEach((expense) => {
      totals.set(
        expense.category_id,
        (totals.get(expense.category_id) || 0) + Number(expense.amount || 0)
      );
    });

    return Array.from(totals.entries())
      .map(([categoryId, value], index) => ({
        id: categoryId,
        name: categoryById[categoryId]?.name || `Category ${categoryId}`,
        value,
        color: categoryColors[index % categoryColors.length],
      }))
      .sort((a, b) => b.value - a.value);
  }, [categoryById, detailedExpenses]);

  const ledgerTotal = useMemo(
    () => detailedExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
    [detailedExpenses]
  );

  const fetchExpenseData = async (signal?: AbortSignal) => {
    setIsLoading(true);
    try {
      const [statsRes, trendRes, expenseRes, categoryRes, auditRes, storeRes] = await Promise.all([
        readJson<{ metrics: ExpenseStats }>(STATS_API, signal),
        readJson<{ trend: TrendRow[] }>(TREND_API, signal),
        readJson<ExpenseRow[]>(EXPENSES_API, signal),
        readJson<ExpenseCategory[]>(CATEGORIES_API, signal),
        readJson<ExpenseAuditCommand>(AUDIT_API, signal),
        readJson<{ stores: StoreOption[] }>(STORES_API, signal).catch(() => ({
          stores: [],
        })),
      ]);

      if (signal?.aborted) return;
      setExpenseStats(statsRes.metrics);
      setTrends(trendRes.trend || []);
      setDetailedExpenses(expenseRes || []);
      setCategories(categoryRes || []);
      setStores(storeRes.stores || []);
      setAudit(auditRes);
      if (!form.category_id && categoryRes?.length) {
        setForm((current) => ({ ...current, category_id: String(categoryRes[0].id) }));
      }
      if (!form.store_id && storeRes.stores?.length) {
        setForm((current) => ({ ...current, store_id: String(storeRes.stores[0].id) }));
      }
    } catch (error) {
      if (signal?.aborted) return;
      console.warn("Expense data is temporarily unavailable", error);
      setMessage("Could not load expense audit data.");
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  };

  const submitExpense = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(EXPENSES_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          date: `${form.date}T12:00:00`,
          store_id: form.store_id ? Number(form.store_id) : undefined,
          category_id: Number(form.category_id),
          amount: Number(form.amount),
          description: form.description,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not save expense.");

      setForm((current) => ({ ...current, amount: "", description: "" }));
      setShowForm(false);
      await fetchExpenseData();
      setMessage(`Logged expense of ${money(data.amount)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save expense.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const marginPercent = expenseStats?.total_sales
    ? ((expenseStats.total_profit / expenseStats.total_sales) * 100).toFixed(1)
    : "0.0";

  return (
    <div className="space-y-7 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-orange-600">Owner Audit</p>
          <h1 className="mt-1 text-4xl font-black uppercase tracking-tighter text-gray-950">Cost Intelligence</h1>
          <p className="mt-1 font-medium text-gray-500">Track supplier bills, manual expenses, category exposure and daily cost risk.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => fetchExpenseData()}
            className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-black uppercase tracking-wide text-gray-700 shadow-sm hover:border-orange-300"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </button>
          <button
            data-testid="expense-log-toggle"
            type="button"
            onClick={() => setShowForm((current) => !current)}
            className="inline-flex items-center rounded-lg bg-black px-5 py-3 text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-orange-100 transition-colors hover:bg-orange-600"
          >
            <Plus className="mr-2 h-4 w-4" />
            Log Expense
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-800">
          {message}
        </div>
      )}

      {showForm && (
        <form onSubmit={submitExpense} className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
            <label className="space-y-2">
              <span className="text-xs font-bold uppercase text-gray-400">Date</span>
              <input
                type="date"
                value={form.date}
                onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
                className="w-full rounded-md border border-gray-200 px-3 py-2 font-semibold outline-none focus:border-orange-500"
                required
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-bold uppercase text-gray-400">Outlet</span>
              <select
                data-testid="expense-store-select"
                value={form.store_id}
                onChange={(event) => setForm((current) => ({ ...current, store_id: event.target.value }))}
                className="w-full rounded-md border border-gray-200 px-3 py-2 font-semibold outline-none focus:border-orange-500"
              >
                {stores.length ? (
                  stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name} · {store.code}
                    </option>
                  ))
                ) : (
                  <option value="">Main outlet</option>
                )}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-xs font-bold uppercase text-gray-400">Category</span>
              <select
                data-testid="expense-category-select"
                value={form.category_id}
                onChange={(event) => setForm((current) => ({ ...current, category_id: event.target.value }))}
                className="w-full rounded-md border border-gray-200 px-3 py-2 font-semibold outline-none focus:border-orange-500"
                required
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-xs font-bold uppercase text-gray-400">Amount</span>
              <input
                data-testid="expense-amount-input"
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                className="w-full rounded-md border border-gray-200 px-3 py-2 font-semibold outline-none focus:border-orange-500"
                placeholder="0"
                required
              />
            </label>
            <label className="space-y-2 lg:col-span-2">
              <span className="text-xs font-bold uppercase text-gray-400">Description</span>
              <div className="flex gap-3">
                <input
                  data-testid="expense-description-input"
                  type="text"
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  className="min-w-0 flex-1 rounded-md border border-gray-200 px-3 py-2 font-semibold outline-none focus:border-orange-500"
                  placeholder="What was this for?"
                />
                <button
                  data-testid="expense-save"
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center rounded-md bg-orange-600 px-4 py-2 font-bold text-white hover:bg-orange-700 disabled:opacity-60"
                >
                  {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save
                </button>
              </div>
            </label>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="py-20 text-center">
          <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-orange-500" />
          <p className="text-xs font-black uppercase tracking-widest text-gray-400">Loading cost audit...</p>
        </div>
      ) : (
        <>
          <section data-testid="expense-audit-command" className="grid grid-cols-1 gap-4 xl:grid-cols-4">
            <div className={`rounded-lg border p-5 ${statusClass(audit?.overall || "warn")}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-black uppercase">Audit Score</span>
                <ShieldCheck className="h-5 w-5" />
              </div>
              <p data-testid="expense-audit-readiness-score" className="mt-4 text-4xl font-black">
                {audit?.readiness_score ?? 0}%
              </p>
              <p className="mt-2 text-xs font-bold uppercase tracking-[0.18em] opacity-80">
                {audit?.overall || "loading"} cost control
              </p>
            </div>
            <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between text-gray-500">
                <span className="text-sm font-black uppercase">Expense Ratio</span>
                <TrendingDown className="h-5 w-5 text-red-500" />
              </div>
              <p className="mt-4 text-4xl font-black text-gray-950">{audit?.summary.expense_ratio ?? 0}%</p>
              <p className="mt-2 text-sm font-semibold text-gray-500">Margin {audit?.summary.margin_percent ?? 0}%</p>
            </div>
            <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between text-gray-500">
                <span className="text-sm font-black uppercase">Ledger Variance</span>
                <ClipboardCheck className="h-5 w-5 text-blue-600" />
              </div>
              <p data-testid="expense-ledger-variance" className="mt-4 text-3xl font-black text-gray-950">
                {money(audit?.summary.ledger_variance)}
              </p>
              <p className="mt-2 text-sm font-semibold text-gray-500">{audit?.summary.ledger_variance_percent ?? 0}% variance</p>
            </div>
            <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between text-gray-500">
                <span className="text-sm font-black uppercase">Risk Days</span>
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </div>
              <p data-testid="expense-risk-days" className="mt-4 text-4xl font-black text-gray-950">
                {audit?.summary.risk_day_count ?? 0}
              </p>
              <p className="mt-2 text-sm font-semibold text-gray-500">Last {audit?.period.days ?? 30} days</p>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black uppercase text-gray-950">Audit Checks</h2>
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-400">What needs owner attention</p>
                </div>
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </div>
              <div data-testid="expense-audit-checks" className="grid gap-3 md:grid-cols-2">
                {(audit?.checks || []).map((check) => (
                  <div key={check.key} className={`rounded-md border p-4 ${statusClass(check.status)}`}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-black">{check.label}</p>
                      <span className="rounded-md bg-white/70 px-2 py-1 text-xs font-black uppercase">{check.status}</span>
                    </div>
                    <p className="mt-2 text-sm font-medium opacity-80">{check.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black uppercase text-gray-950">Daily Risk Queue</h2>
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-400">High burn or missing cost days</p>
                </div>
                <AlertTriangle className="h-6 w-6 text-amber-500" />
              </div>
              <div className="max-h-[280px] space-y-3 overflow-y-auto pr-1">
                {(audit?.daily_risks || []).map((risk) => (
                  <div key={`${risk.date}-${risk.reason}`} className={`rounded-md border p-4 ${statusClass(risk.severity)}`}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-black">{new Date(risk.date).toLocaleDateString()}</p>
                      <span className="text-sm font-black">{risk.expense_ratio}%</span>
                    </div>
                    <p className="mt-1 text-sm font-medium opacity-80">{risk.reason}</p>
                  </div>
                ))}
                {audit && audit.daily_risks.length === 0 ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
                    No cost risk days in the selected period.
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section
            data-testid="expense-approval-queue"
            className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm"
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black uppercase text-gray-950">Owner Approval Queue</h2>
                <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
                  Missing receipts, high-value proof gaps and duplicate-looking expenses
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-amber-50 px-3 py-2">
                  <p className="text-lg font-black text-amber-800">
                    {audit?.summary.missing_receipt_count ?? 0}
                  </p>
                  <p className="text-[10px] font-black uppercase text-amber-700">Receipt Gaps</p>
                </div>
                <div className="rounded-md bg-red-50 px-3 py-2">
                  <p className="text-lg font-black text-red-800">
                    {audit?.summary.high_value_receipt_gap_count ?? 0}
                  </p>
                  <p className="text-[10px] font-black uppercase text-red-700">High Value</p>
                </div>
                <div className="rounded-md bg-slate-100 px-3 py-2">
                  <p className="text-lg font-black text-slate-900">
                    {audit?.summary.duplicate_candidate_count ?? 0}
                  </p>
                  <p className="text-[10px] font-black uppercase text-slate-600">Duplicates</p>
                </div>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {(audit?.approval_queue || []).map((item) => (
                <article
                  key={`approval-${item.id}`}
                  data-testid={`expense-approval-item-${item.id}`}
                  className={`rounded-md border p-4 ${statusClass(item.severity)}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black text-gray-950">{money(item.amount)}</p>
                      <p className="mt-1 text-xs font-bold uppercase opacity-70">
                        {item.category || categoryById[item.category_id]?.name || `Category ${item.category_id}`}
                      </p>
                    </div>
                    <span className="rounded-md bg-white/70 px-2 py-1 text-xs font-black uppercase">
                      {item.approval_status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm font-semibold opacity-90">
                    {item.description || "No description"}
                  </p>
                  <div className="mt-3 space-y-1">
                    {item.reasons.map((reason) => (
                      <p key={`${item.id}-${reason}`} className="text-xs font-bold opacity-80">
                        {reason}
                      </p>
                    ))}
                  </div>
                  <p className="mt-3 rounded-md bg-white/70 px-3 py-2 text-xs font-bold opacity-80">
                    {item.next_action}
                  </p>
                </article>
              ))}
              {audit && audit.approval_queue.length === 0 ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
                  No receipt or approval gaps in the selected period.
                </div>
              ) : null}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="rounded-lg border border-gray-100 bg-white p-6 shadow-sm lg:col-span-2">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-black uppercase tracking-tight text-gray-900">Burn Velocity</h3>
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Revenue vs operating cost</p>
                </div>
                <div className="flex items-center gap-5">
                  <div className="flex items-center text-xs font-bold uppercase text-gray-400"><span className="mr-2 h-3 w-3 rounded-full bg-orange-500" /> Sales</div>
                  <div className="flex items-center text-xs font-bold uppercase text-gray-400"><span className="mr-2 h-3 w-3 rounded-full bg-red-500" /> Expenses</div>
                </div>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: 320 }}>
                  <AreaChart data={trends}>
                    <defs>
                      <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#EA580C" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#EA580C" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f8fafc" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#9ca3af", fontWeight: "bold" }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#9ca3af", fontWeight: "bold" }} tickFormatter={(v) => `Rs. ${Number(v) / 1000}k`} />
                    <Tooltip contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 16px 40px -20px rgb(0 0 0 / 0.35)" }} />
                    <Area type="monotone" dataKey="total_sale" stroke="#EA580C" strokeWidth={4} fill="url(#colorRev)" />
                    <Area type="monotone" dataKey="total_expense" stroke="#EF4444" strokeWidth={4} fill="none" strokeDasharray="10 10" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-lg border border-gray-100 bg-white p-6 shadow-sm">
              <h3 className="mb-6 text-xs font-black uppercase tracking-[0.2em] text-gray-400">Allocation Map</h3>
              <div className="h-56">
                {categoryTotals.length ? (
                  <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 420, height: 224 }}>
                    <PieChart>
                      <Pie data={categoryTotals} innerRadius={64} outerRadius={88} paddingAngle={5} dataKey="value">
                        {categoryTotals.map((entry) => (
                          <Cell key={entry.id} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => money(Number(value))} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm font-semibold text-gray-400">No expenses yet.</div>
                )}
              </div>
              <div data-testid="expense-category-breakdown" className="mt-6 space-y-3">
                {(audit?.category_breakdown || categoryTotals.slice(0, 5)).slice(0, 5).map((category, index) => {
                  const name = "category" in category ? category.category : category.name;
                  const value = "amount" in category ? category.amount : category.value;
                  const id = "category_id" in category ? category.category_id : category.id;
                  return (
                    <div key={`${id}-${name}`} className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
                      <div className="flex items-center">
                        <span className="mr-3 h-3 w-3 rounded-full" style={{ backgroundColor: categoryColors[index % categoryColors.length] }} />
                        <span className="text-xs font-black uppercase text-gray-500">{name}</span>
                      </div>
                      <span className="text-sm font-black text-gray-900">{money(value)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-lg bg-red-600 p-6 text-white shadow-xl shadow-red-100">
              <TrendingDown className="mb-4 h-7 w-7 opacity-80" />
              <p className="mb-1 text-xs font-black uppercase tracking-widest text-red-100">Monthly Burn</p>
              <h4 className="text-3xl font-black">{money(expenseStats?.total_expense)}</h4>
            </div>
            <div className="rounded-lg border border-gray-100 bg-white p-6 shadow-sm">
              <IndianRupee className="mb-4 h-7 w-7 text-orange-600" />
              <p className="mb-1 text-xs font-black uppercase tracking-widest text-gray-400">Expense Ledger</p>
              <h4 className="text-3xl font-black text-gray-900">{money(ledgerTotal)}</h4>
            </div>
            <div className="rounded-lg border border-gray-100 bg-white p-6 shadow-sm">
              <Calendar className="mb-4 h-7 w-7 text-green-600" />
              <p className="mb-1 text-xs font-black uppercase tracking-widest text-gray-400">Profit Efficiency</p>
              <h4 className="text-3xl font-black text-gray-900">{marginPercent}%</h4>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-6">
              <div>
                <h3 className="text-xl font-black uppercase tracking-tight text-gray-900">Expenditure Ledger</h3>
                <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Supplier bills and manual expenses</p>
              </div>
              <Receipt className="h-6 w-6 text-orange-600" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-gray-400">Date</th>
                    <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-gray-400">Category</th>
                    <th className="px-6 py-4 text-right text-xs font-black uppercase tracking-widest text-gray-400">Amount</th>
                    <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-gray-400">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {detailedExpenses.length === 0 ? (
                    <tr><td colSpan={4} className="py-16 text-center text-sm font-bold uppercase tracking-widest text-gray-400">No detailed records found.</td></tr>
                  ) : (
                    detailedExpenses.map((expense) => (
                      <tr key={expense.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm font-bold text-gray-900">{new Date(expense.date).toLocaleDateString()}</td>
                        <td className="px-6 py-4 text-sm">
                          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-black uppercase text-gray-600">
                            {categoryById[expense.category_id]?.name || `Category ${expense.category_id}`}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right text-sm font-black text-red-500">{money(expense.amount)}</td>
                        <td className="px-6 py-4 text-sm italic text-gray-500">{expense.description || "No description"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
