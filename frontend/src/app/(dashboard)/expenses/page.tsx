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
  Calendar,
  IndianRupee,
  Loader2,
  Plus,
  Receipt,
  Save,
  TrendingDown,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type ExpenseCategory = {
  id: number;
  name: string;
  is_active: boolean;
};

type ExpenseRow = {
  id: number;
  date: string;
  category_id: number;
  amount: number;
  description?: string;
};

const categoryColors = [
  "#EA580C",
  "#2563EB",
  "#10B981",
  "#9333EA",
  "#DC2626",
  "#0F766E",
  "#CA8A04",
  "#64748B",
];

export default function ExpenseTracker() {
  const [expenseStats, setExpenseStats] = useState<any>(null);
  const [trends, setTrends] = useState<any[]>([]);
  const [detailedExpenses, setDetailedExpenses] = useState<ExpenseRow[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    category_id: "",
    amount: "",
    description: "",
  });

  useEffect(() => {
    fetchExpenseData();
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

  const fetchExpenseData = async () => {
    setIsLoading(true);
    try {
      const [statsRes, trendRes, expenseRes, categoryRes] = await Promise.all([
        fetch(getApiUrl("/api/v1/restaurant/stats/dashboard-stats?period=30days")).then((r) => r.json()),
        fetch(getApiUrl("/api/v1/restaurant/stats/insights/profit-trend?months=6")).then((r) => r.json()),
        fetch(getApiUrl("/api/v1/restaurant/expenses/expenses")).then((r) => r.json()),
        fetch(getApiUrl("/api/v1/restaurant/expenses/categories")).then((r) => r.json()),
      ]);

      setExpenseStats(statsRes.metrics);
      setTrends(trendRes.trend || []);
      setDetailedExpenses(expenseRes || []);
      setCategories(categoryRes || []);
      if (!form.category_id && categoryRes?.length) {
        setForm((current) => ({ ...current, category_id: String(categoryRes[0].id) }));
      }
    } catch (error) {
      console.error("Failed to fetch expense data", error);
      setMessage("Could not load expense data.");
    } finally {
      setIsLoading(false);
    }
  };

  const submitExpense = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(getApiUrl("/api/v1/restaurant/expenses/expenses"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: `${form.date}T12:00:00`,
          category_id: Number(form.category_id),
          amount: Number(form.amount),
          description: form.description,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not save expense.");

      setMessage(`Logged expense of Rs. ${Number(data.amount || 0).toLocaleString()}.`);
      setForm((current) => ({ ...current, amount: "", description: "" }));
      setShowForm(false);
      await fetchExpenseData();
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
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black text-gray-900 uppercase tracking-tighter">Cost Intelligence</h1>
          <p className="mt-1 font-medium text-gray-500">Track supplier bills, manual expenses, and cost allocation.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((current) => !current)}
          className="flex items-center rounded-xl bg-black px-6 py-3 text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-orange-100 transition-colors hover:bg-orange-600"
        >
          <Plus className="mr-2 h-4 w-4" />
          Log Expense
        </button>
      </div>

      {message && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-800">
          {message}
        </div>
      )}

      {showForm && (
        <form onSubmit={submitExpense} className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <label className="space-y-2">
              <span className="text-xs font-bold uppercase text-gray-400">Date</span>
              <input
                type="date"
                value={form.date}
                onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 font-semibold outline-none focus:border-orange-500"
                required
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-bold uppercase text-gray-400">Category</span>
              <select
                value={form.category_id}
                onChange={(event) => setForm((current) => ({ ...current, category_id: event.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 font-semibold outline-none focus:border-orange-500"
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
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 font-semibold outline-none focus:border-orange-500"
                placeholder="0"
                required
              />
            </label>
            <label className="space-y-2 lg:col-span-2">
              <span className="text-xs font-bold uppercase text-gray-400">Description</span>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 font-semibold outline-none focus:border-orange-500"
                  placeholder="What was this for?"
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center rounded-lg bg-orange-600 px-4 py-2 font-bold text-white hover:bg-orange-700 disabled:opacity-60"
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
          <p className="text-xs font-black uppercase tracking-widest text-gray-400">Loading cost data...</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm lg:col-span-2">
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
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#9ca3af", fontWeight: "bold" }} tickFormatter={(v) => `Rs. ${v / 1000}k`} />
                    <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 16px 40px -20px rgb(0 0 0 / 0.35)" }} />
                    <Area type="monotone" dataKey="total_sale" stroke="#EA580C" strokeWidth={4} fill="url(#colorRev)" />
                    <Area type="monotone" dataKey="total_expense" stroke="#EF4444" strokeWidth={4} fill="none" strokeDasharray="10 10" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
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
                      <Tooltip formatter={(value) => `Rs. ${Number(value).toLocaleString()}`} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm font-semibold text-gray-400">No expenses yet.</div>
                )}
              </div>
              <div className="mt-6 space-y-3">
                {categoryTotals.slice(0, 5).map((category) => (
                  <div key={category.id} className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                    <div className="flex items-center">
                      <span className="mr-3 h-3 w-3 rounded-full" style={{ backgroundColor: category.color }} />
                      <span className="text-xs font-black uppercase text-gray-500">{category.name}</span>
                    </div>
                    <span className="text-sm font-black text-gray-900">Rs. {Math.round(category.value).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-xl bg-red-600 p-6 text-white shadow-xl shadow-red-100">
              <TrendingDown className="mb-4 h-7 w-7 opacity-80" />
              <p className="mb-1 text-xs font-black uppercase tracking-widest text-red-100">Monthly Burn</p>
              <h4 className="text-3xl font-black">Rs. {Number(expenseStats?.total_expense || 0).toLocaleString()}</h4>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
              <IndianRupee className="mb-4 h-7 w-7 text-orange-600" />
              <p className="mb-1 text-xs font-black uppercase tracking-widest text-gray-400">Expense Ledger</p>
              <h4 className="text-3xl font-black text-gray-900">Rs. {ledgerTotal.toLocaleString()}</h4>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
              <Calendar className="mb-4 h-7 w-7 text-green-600" />
              <p className="mb-1 text-xs font-black uppercase tracking-widest text-gray-400">Profit Efficiency</p>
              <h4 className="text-3xl font-black text-gray-900">{marginPercent}%</h4>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
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
                        <td className="px-6 py-4 text-right text-sm font-black text-red-500">Rs. {Number(expense.amount || 0).toLocaleString()}</td>
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
