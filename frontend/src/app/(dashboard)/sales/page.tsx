"use client";
import React, { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle2, DollarSign, TrendingUp, Calendar, Filter, Download, ArrowUpRight, ArrowDownRight, Loader2, Award } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getApiUrl } from '@/lib/api';

export default function SalesHistory() {
  const [salesData, setSalesData] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [reconciliation, setReconciliation] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReconciliationLoading, setIsReconciliationLoading] = useState(true);
  const [reconciliationError, setReconciliationError] = useState("");
  
  // New Month/Year Filter State
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    setIsReconciliationLoading(true);
    setReconciliationError("");

    const fetchJson = async (endpoint: string, init?: RequestInit) => {
      const response = await fetch(getApiUrl(endpoint), {
        cache: "no-store",
        credentials: "include",
        ...init,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `Request failed: ${endpoint}`);
      return payload;
    };

    const reconciliationController = new AbortController();
    const reconciliationTimer = window.setTimeout(() => reconciliationController.abort(), 75000);
    const reconciliationRequest = fetchJson(
      '/api/v1/restaurant/sales/reconciliation?expected_min_total=3000000&detail=summary&limit=12',
      { signal: reconciliationController.signal }
    )
      .then((reconciliationRes) => {
        setReconciliation(reconciliationRes);
      })
      .catch((error) => {
        console.error("Failed to fetch sales reconciliation", error);
        setReconciliation(null);
        setReconciliationError("Reconciliation needs retry. The sales table is available, but the month repair queue could not load yet.");
      })
      .finally(() => {
        window.clearTimeout(reconciliationTimer);
        setIsReconciliationLoading(false);
      });

    try {
      const [salesRes, statsRes] = await Promise.all([
        fetchJson('/api/v1/restaurant/sales/'),
        fetchJson('/api/v1/restaurant/stats/dashboard-stats?period=30days')
      ]);
      setSalesData(Array.isArray(salesRes) ? salesRes : []);
      setSummary(statsRes.metrics);
    } catch (error) {
      console.error("Failed to fetch sales history", error);
    } finally {
      setIsLoading(false);
    }

    await reconciliationRequest;
  };

  const handleExport = () => {
    window.location.href = getApiUrl('/api/v1/restaurant/sales/export/csv');
  };

  // Filter Logic
  const filteredSales = salesData.filter(sale => {
    const saleDate = new Date(sale.date);
    return saleDate.getFullYear() === selectedYear && saleDate.getMonth() === selectedMonth;
  });

  const years = Array.from(new Set(salesData.map(s => new Date(s.date).getFullYear()))).sort((a, b) => b - a);
  if (years.length === 0) years.push(new Date().getFullYear());

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const selectedMonthKey = `${selectedYear}-${String(selectedMonth + 1).padStart(2, "0")}`;
  const selectedMonthReconciliation = reconciliation?.months?.find((row: any) => row.month === selectedMonthKey);
  const money = (value: number) => `Rs ${Math.round(Number(value || 0)).toLocaleString()}`;
  const reconciliationGap = reconciliation ? Number(reconciliation.gap_to_expected || 0) : 3000000;
  const repairRows = (reconciliation?.repair_queue || []).slice(0, 12);
  const selectRepairMonth = (monthKey: string) => {
    const [year, month] = monthKey.split("-");
    setSelectedYear(Number(year));
    setSelectedMonth(Number(month) - 1);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-gray-900 uppercase">Sales Archive</h1>
          <p className="text-gray-500 mt-1">Deep-dive into chronological revenue streams and cost centers.</p>
        </div>
        <div className="flex items-center space-x-3">
          <div className="flex bg-white border border-gray-100 rounded-2xl p-1 shadow-sm">
            <select 
              value={selectedMonth} 
              onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
              className="bg-transparent text-xs font-black uppercase tracking-widest px-4 py-2 outline-none cursor-pointer hover:text-orange-600 transition-colors"
            >
              {months.map((m, i) => (
                <option key={i} value={i}>{m}</option>
              ))}
            </select>
            <div className="w-px h-4 bg-gray-100 my-auto"></div>
            <select 
              value={selectedYear} 
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              className="bg-transparent text-xs font-black uppercase tracking-widest px-4 py-2 outline-none cursor-pointer hover:text-orange-600 transition-colors"
            >
              {years.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <button onClick={handleExport} className="flex items-center px-6 py-3 bg-orange-600 text-white rounded-2xl font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-100 uppercase text-xs tracking-widest">
            <Download className="w-4 h-4 mr-2" /> Export
          </button>
        </div>
      </div>

      <section data-testid="sales-reconciliation-board" className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-orange-600">Phase 1 Data Accuracy</p>
            <h2 className="mt-1 text-xl font-black text-gray-950">Google Sheet Sales Reconciliation</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500">
              This board checks whether imported sales are complete enough to trust owner reports. The expected
              historical minimum is set to Rs 30,00,000 until the source sheet is fully reconciled.
            </p>
          </div>
          <span className={`inline-flex w-fit items-center gap-2 rounded-md border px-3 py-2 text-xs font-black uppercase ${
            reconciliationGap > 0
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}>
            {reconciliationGap > 0 ? (
              <AlertTriangle className="h-4 w-4" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {reconciliationGap > 0 ? "Needs Import" : "Reconciled"}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-5">
          {[
            ["Imported Total", money(reconciliation?.imported_total || 0)],
            ["Expected Minimum", money(reconciliation?.expected_min_total || 3000000)],
            ["Gap", money(reconciliation?.gap_to_expected || 0)],
            ["Months Imported", reconciliation?.months_imported || 0],
            ["Rows", reconciliation?.record_count || 0],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
              <p className="text-xs font-black uppercase tracking-wide text-gray-400">{label}</p>
              <p className="mt-2 text-xl font-black text-gray-950">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-lg border border-gray-100 p-4">
            <p className="text-xs font-black uppercase tracking-wide text-gray-400">
              Selected Month Check
            </p>
            {selectedMonthReconciliation ? (
              <div className="mt-3 space-y-2 text-sm font-semibold text-gray-600">
                <p className="font-black text-gray-950">{months[selectedMonth]} {selectedYear}</p>
                <p>{money(selectedMonthReconciliation.total_sale)} imported sales</p>
                <p>{selectedMonthReconciliation.days_with_sales}/{selectedMonthReconciliation.expected_days} days imported</p>
                <p className={selectedMonthReconciliation.missing_days ? "text-amber-700" : "text-emerald-700"}>
                  {selectedMonthReconciliation.missing_days
                    ? `${selectedMonthReconciliation.missing_days} days need review`
                    : "Month coverage complete"}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm font-semibold text-amber-700">
                No imported sales found for {months[selectedMonth]} {selectedYear}.
              </p>
            )}
          </div>
          <div className="rounded-lg border border-gray-100 p-4">
            <p className="text-xs font-black uppercase tracking-wide text-gray-400">
              Next Upload Action
            </p>
            <p className="mt-3 text-sm font-semibold leading-6 text-gray-600">
              {reconciliation?.next_action || "Import the public Google Sheet, then re-run month-wise reconciliation."}
            </p>
            <p className="mt-3 text-xs font-bold text-gray-400">
              Last sheet sync: {reconciliation?.last_sheet_sync?.last_synced_at || "No sync recorded yet"}
            </p>
          </div>
        </div>
      </section>

      <section data-testid="sales-repair-queue" className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-orange-600">Month Repair Queue</p>
            <h2 className="mt-1 text-xl font-black text-gray-950">Fix Missing And Zero-Sale Dates First</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500">
              Work this queue from top to bottom. Selecting a month updates the archive filter above, so the source sheet
              and portal month can be checked side by side.
            </p>
          </div>
          <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-black uppercase text-gray-500">
            {isReconciliationLoading
              ? "Loading queue"
              : reconciliationError
                ? "Retry needed"
                : `${reconciliation?.repair_queue_count || 0} months need review`}
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3 font-black">Month</th>
                <th className="px-4 py-3 font-black">Priority</th>
                <th className="px-4 py-3 font-black">Imported Sale</th>
                <th className="px-4 py-3 font-black">Coverage</th>
                <th className="px-4 py-3 font-black">Dates To Check</th>
                <th className="px-4 py-3 font-black text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {isReconciliationLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm font-bold text-gray-400">
                    Loading repair queue...
                  </td>
                </tr>
              ) : reconciliationError ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center">
                    <p className="text-sm font-black text-amber-700">Reconciliation needs retry.</p>
                    <p className="mt-2 text-sm font-semibold text-gray-500">{reconciliationError}</p>
                    <button
                      onClick={fetchData}
                      className="mt-4 rounded-md bg-gray-950 px-4 py-2 text-xs font-black uppercase text-white hover:bg-gray-800"
                    >
                      Retry Queue
                    </button>
                  </td>
                </tr>
              ) : repairRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm font-bold text-emerald-700">
                    All imported months are complete.
                  </td>
                </tr>
              ) : (
                repairRows.map((row: any) => {
                  const datesToCheck = [
                    ...(row.missing_dates || []).slice(0, 4),
                    ...(row.zero_sale_dates || []).slice(0, 3),
                  ];
                  return (
                    <tr key={row.month} className="border-b border-gray-100 align-top last:border-b-0">
                      <td className="px-4 py-4">
                        <p className="font-black text-gray-950">{row.month}</p>
                        <p className="mt-1 text-xs font-semibold text-gray-400">
                          {row.days_with_sales}/{row.expected_days} records
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-black uppercase ${
                          row.repair_priority === "high"
                            ? "border-red-200 bg-red-50 text-red-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}>
                          {row.repair_priority}
                        </span>
                      </td>
                      <td className="px-4 py-4 font-black text-gray-800">{money(row.total_sale)}</td>
                      <td className="px-4 py-4">
                        <p className="font-black text-gray-900">{row.coverage_percent}%</p>
                        <p className="mt-1 text-xs font-semibold text-gray-500">
                          {row.missing_days} missing | {row.zero_sale_days} zero-sale
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {datesToCheck.length ? (
                            datesToCheck.map((item: string) => (
                              <span key={`${row.month}-${item}`} className="rounded-md bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600">
                                {item}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs font-semibold text-gray-400">No date list returned</span>
                          )}
                        </div>
                        <p className="mt-2 text-xs font-semibold leading-5 text-gray-500">
                          {row.repair_action}
                        </p>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <button
                          onClick={() => selectRepairMonth(row.month)}
                          className="rounded-md bg-gray-950 px-3 py-2 text-xs font-black uppercase text-white hover:bg-gray-800"
                        >
                          Review Month
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { title: "Avg. Daily Flow", value: summary ? `₹${Math.round(summary.avg_daily_sale).toLocaleString()}` : "...", trend: null, positive: true, icon: Calendar },
          { title: "Period Profit", value: summary ? `₹${summary.total_profit.toLocaleString()}` : "...", trend: summary ? `${summary.sales_growth}%` : null, positive: summary?.sales_growth >= 0, icon: TrendingUp },
          { title: "Total Scale", value: summary ? `₹${summary.total_sales.toLocaleString()}` : "...", sub: "Gross Revenue (30D)", icon: DollarSign },
        ].map((m, i) => {
          const Icon = m.icon;
          return (
            <div key={i} className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 relative overflow-hidden group">
              <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:scale-110 transition-transform">
                <Icon className="w-20 h-20" />
              </div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">{m.title}</p>
              <div className="flex items-end justify-between mt-2 relative z-10">
                 <h3 className="text-3xl font-black text-gray-900 tracking-tighter">{m.value}</h3>
                 {m.trend && (
                   <div className={`flex items-center text-sm font-black ${m.positive ? 'text-green-600' : 'text-red-600'}`}>
                     {m.positive ? <ArrowUpRight className="w-4 h-4 mr-0.5" /> : <ArrowDownRight className="w-4 h-4 mr-0.5" />}
                     {m.trend}
                   </div>
                 )}
              </div>
              {m.sub && <p className="text-[10px] font-bold text-gray-400 mt-2 uppercase">{m.sub}</p>}
            </div>
          );
        })}
      </div>

      <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
        <h3 className="text-xl font-black text-gray-900 mb-8 uppercase tracking-tighter italic">Recent Velocity</h3>
        <div className="h-72">
          {isLoading ? (
            <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>
          ) : (
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: 288 }}>
              <BarChart data={filteredSales}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 10}} tickFormatter={(val) => new Date(val).toLocaleDateString(undefined, {day: 'numeric', month: 'short'})} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 10}} />
                <Tooltip 
                  cursor={{fill: '#F9FAFB'}}
                  contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)'}} 
                />
                <Bar dataKey="total_sale" fill="#EA580C" radius={[6, 6, 0, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50/50">
            <tr>
              <th className="px-8 py-5 text-xs font-black text-gray-400 uppercase tracking-widest">Date / Lifecycle</th>
              <th className="px-8 py-5 text-xs font-black text-gray-400 uppercase tracking-widest text-right">Revenue</th>
              <th className="px-8 py-5 text-xs font-black text-gray-400 uppercase tracking-widest text-right">Operating Cost</th>
              <th className="px-8 py-5 text-xs font-black text-gray-400 uppercase tracking-widest text-right">Net Yield</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr><td colSpan={4} className="py-20 text-center text-gray-400 font-bold animate-pulse uppercase tracking-[0.2em]">Synchronizing Nodes...</td></tr>
            ) : filteredSales.length === 0 ? (
              <tr><td colSpan={4} className="py-20 text-center text-gray-400 font-bold uppercase tracking-widest py-32 italic">No records found for {months[selectedMonth]} {selectedYear}.</td></tr>
            ) : (
              [...filteredSales].reverse().map((sale, i) => (
                <tr key={i} className="hover:bg-gray-50/80 transition-all cursor-pointer group border-l-4 border-l-transparent hover:border-l-orange-500">
                  <td className="px-8 py-6">
                    <div className="font-black text-gray-900 text-lg tracking-tighter group-hover:text-orange-600 transition-colors">
                      {new Date(sale.date).toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'long', year: 'numeric'})}
                    </div>
                  </td>
                  <td className="px-8 py-6 text-right font-black text-gray-800 tracking-tight">₹{sale.total_sale.toLocaleString()}</td>
                  <td className="px-8 py-6 text-right text-red-500 font-bold tracking-tight">₹{sale.total_expense.toLocaleString()}</td>
                  <td className="px-8 py-6 text-right">
                    <span className="px-4 py-2 bg-green-50 text-green-700 rounded-2xl text-xs font-black tracking-tighter">
                      ₹{sale.profit.toLocaleString()}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
