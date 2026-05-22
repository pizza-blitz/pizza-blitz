"use client";
import React, { useState, useEffect } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Calendar, Download, Share2, IndianRupee, TrendingUp, TrendingDown, FileText, Loader2 } from 'lucide-react';
import { getApiUrl } from '@/lib/api';

const Award = ({className}: {className?: string}) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/></svg>
);

export default function Reports() {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [period, setPeriod] = useState("30days");

  useEffect(() => {
    fetchReports();
  }, [period]);

  const fetchReports = async () => {
    setIsLoading(true);
    try {
      const comparisonPeriod = period === "lifetime" ? "1year" : period;
      const [statsRes, salesRes, forecastRes, trendRes, comparisonRes] = await Promise.all([
        fetch(getApiUrl(`/api/v1/restaurant/stats/dashboard-stats?period=${period}`)).then(r => r.json()),
        fetch(getApiUrl('/api/v1/restaurant/sales/')).then(r => r.json()),
        fetch(getApiUrl('/api/v1/restaurant/stats/insights/monthly-forecast')).then(r => r.json()),
        fetch(getApiUrl('/api/v1/restaurant/stats/insights/profit-trend?months=12')).then(r => r.json()),
        fetch(getApiUrl(`/api/v1/restaurant/stats/compare/performance-dashboard?period=${comparisonPeriod}`)).then(r => r.json())
      ]);
      
      setData({
        summary: statsRes.metrics,
        records: salesRes.reverse().slice(0, 10),
        forecast: forecastRes,
        trends: trendRes.trend,
        comparison: comparisonRes
      });
    } catch (err) { 
      console.error(err); 
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = () => {
    window.location.href = getApiUrl('/api/v1/restaurant/sales/export/csv');
  };

  const formatComparisonValue = (key: string, value: number) => {
    const nextValue = Number(value || 0);
    if (key === "margin") return `${nextValue.toFixed(1)}%`;
    return `Rs ${nextValue.toLocaleString()}`;
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-black uppercase leading-tight tracking-tight text-gray-900 sm:text-3xl lg:text-4xl">Financial Audit Logs</h1>
          <p className="mt-1 text-sm font-medium text-gray-500 sm:text-base">Verified historical performance reports for stakeholder review.</p>
        </div>
        <div className="flex w-full gap-3 overflow-x-auto pb-1 sm:w-auto">
          <button onClick={handleExport} className="flex shrink-0 items-center rounded-xl border-2 border-gray-100 bg-white px-4 py-3 text-xs font-black uppercase tracking-widest text-gray-900 shadow-sm transition-all hover:bg-gray-50 sm:px-6">
            <Download className="w-4 h-4 mr-2" /> Data Export
          </button>
          <button className="flex shrink-0 items-center rounded-xl bg-green-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white shadow-xl shadow-green-100 transition-all hover:bg-green-700 sm:px-6">
            <Share2 className="w-4 h-4 mr-2" /> Share Report
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-[2rem] border border-gray-100 bg-white p-5 shadow-sm sm:p-8 xl:flex-row xl:items-center xl:justify-between">
        <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:max-w-full sm:items-center sm:overflow-x-auto sm:pb-1 xl:w-auto">
           {['7days', '30days', '90days', '1year', 'lifetime'].map(p => (
             <button 
               key={p}
               onClick={() => setPeriod(p)}
               className={`shrink-0 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest transition-all last:col-span-2 sm:px-5 ${period === p ? 'bg-black text-white' : 'bg-gray-50 text-gray-400 hover:text-gray-600'}`}
             >
               {p === '7days' ? '1 Week' : p === '30days' ? '1 Month' : p === '90days' ? '1 Quarter' : p === '1year' ? '1 Year' : 'All Time'}
             </button>
           ))}
        </div>
        <div className="flex w-full items-center justify-center rounded-xl bg-gray-50 px-4 py-2 text-xs font-black uppercase tracking-widest text-gray-400 sm:w-auto">
           <Calendar className="w-3 h-3 mr-2" />
           Audit Window: {period.toUpperCase()}
        </div>
      </div>

      {isLoading ? (
        <div className="py-20 text-center flex flex-col items-center">
          <Loader2 className="w-12 h-12 animate-spin text-orange-500 mb-4" />
          <p className="text-gray-400 font-black uppercase tracking-widest text-xs">Compiling Ledger Data...</p>
        </div>
      ) : (
        <>
          {data?.comparison && (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_0.65fr]">
              <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Comparison Dashboard</p>
                    <h2 className="mt-1 text-xl font-black text-gray-950">Current vs Previous vs Last Year</h2>
                  </div>
                  <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-black text-gray-500">
                    <BarChart3 className="h-4 w-4 text-orange-600" />
                    {data.comparison.period.current_start} to {data.comparison.period.current_end}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-5">
                  {data.comparison.summary_cards.map((card: any) => {
                    const positive = card.yoy_change_percent >= 0;
                    const DirectionIcon = positive ? ArrowUpRight : ArrowDownRight;
                    return (
                      <div key={card.key} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{card.label}</p>
                        <p className="mt-2 whitespace-nowrap text-lg font-black text-gray-950 xl:text-xl">{formatComparisonValue(card.key, card.current)}</p>
                        <div className="mt-3 grid gap-1 text-[11px] font-bold text-gray-500">
                          <div className="flex items-center justify-between">
                            <span>Previous</span>
                            <span>{formatComparisonValue(card.key, card.previous)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Last year</span>
                            <span>{formatComparisonValue(card.key, card.last_year)}</span>
                          </div>
                        </div>
                        <div className={`mt-3 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-black ${positive ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                          <DirectionIcon className="h-3.5 w-3.5" />
                          {card.yoy_change_percent > 0 ? "+" : ""}{card.yoy_change_percent}% YoY
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-5 overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full min-w-[720px] text-left">
                    <thead className="bg-gray-950 text-white">
                      <tr>
                        <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">Day</th>
                        <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Current</th>
                        <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Previous</th>
                        <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Last Year</th>
                        <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Profit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {data.comparison.daily_comparison.slice(-7).map((row: any) => (
                        <tr key={row.date} className="hover:bg-orange-50/50">
                          <td className="px-4 py-3">
                            <p className="text-sm font-black text-gray-900">{row.label}</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{row.weekday}</p>
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-black text-gray-900">Rs {Number(row.current_sale || 0).toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-gray-500">Rs {Number(row.previous_sale || 0).toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-gray-500">Rs {Number(row.last_year_sale || 0).toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-sm font-black text-green-700">Rs {Number(row.current_profit || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <aside className="space-y-4">
                <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Best Day</p>
                  <h3 className="mt-2 text-2xl font-black text-gray-950">{data.comparison.best_day?.label || "No data"}</h3>
                  <p className="mt-1 text-sm font-bold text-gray-500">{data.comparison.best_day?.weekday || "Awaiting sales entries"}</p>
                  <div className="mt-4 rounded-lg bg-green-50 p-4 text-green-800">
                    <p className="text-[10px] font-black uppercase tracking-widest">Revenue</p>
                    <p className="mt-1 text-xl font-black">Rs {Number(data.comparison.best_day?.current_sale || 0).toLocaleString()}</p>
                  </div>
                </div>

                <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-700" />
                    <h3 className="text-sm font-black uppercase tracking-widest text-amber-900">Signals</h3>
                  </div>
                  <div className="mt-4 space-y-3">
                    {data.comparison.risk_flags.map((flag: string) => (
                      <p key={flag} className="rounded-md bg-white px-3 py-2 text-sm font-bold text-amber-900">
                        {flag}
                      </p>
                    ))}
                  </div>
                </div>
              </aside>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-50 border-t-8 border-t-orange-500 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
                <TrendingUp className="w-32 h-32" />
              </div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Aggregate Revenue</p>
              <div className="text-4xl font-black text-gray-900 tracking-tighter flex items-center">
                <IndianRupee className="w-8 h-8 mr-1" />{data?.summary.total_sales.toLocaleString()}
              </div>
              <div className="mt-4 pt-4 border-t border-gray-50 text-xs text-green-600 font-black uppercase flex items-center">
                <TrendingUp className="w-3 h-3 mr-1" /> Velocity: <IndianRupee className="w-3 h-3 mx-1" />{Math.round(data?.summary.avg_daily_sale).toLocaleString()}/day
              </div>
            </div>

            <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-50 border-t-8 border-t-red-500 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
                <TrendingDown className="w-32 h-32" />
              </div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Daily Burn Rate</p>
              <div className="text-xl font-black tracking-tight mb-4"><IndianRupee className="w-5 h-5 inline mr-1" />{data?.summary?.daily_velocity?.toLocaleString() || '0'} / DAY</div>
              
              <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100 mt-2">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Efficiency Index</p>
                <div className="text-xl font-black tracking-tight">
                  OVERHEAD: {data?.summary?.total_sales > 0 ? ((data.summary.total_expense / data.summary.total_sales) * 100).toFixed(1) : '0.0'}% YIELD COST
                </div>
              </div>
            </div>

            <div className="bg-black p-8 rounded-[2.5rem] shadow-2xl shadow-indigo-100 border-t-8 border-t-indigo-500 relative overflow-hidden group text-white">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                <Award className="w-32 h-32" />
              </div>
              <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2 ml-1">Retained Net Profit</p>
              <div className="text-4xl font-black text-white tracking-tighter flex items-center">
                <IndianRupee className="w-8 h-8 mr-1" />{data?.summary.total_profit.toLocaleString()}
              </div>
              <div className="mt-4 pt-4 border-t border-white/10 text-xs text-indigo-400 font-black uppercase tracking-widest">
                Growth Index: {data?.summary.sales_growth}%
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-orange-600 p-10 rounded-[2.5rem] text-white shadow-xl shadow-orange-100 relative overflow-hidden group">
               <div className="absolute -right-4 -bottom-4 opacity-10 group-hover:scale-110 transition-all duration-700">
                  <TrendingUp className="w-32 h-32" />
               </div>
               <h4 className="text-xs font-black uppercase tracking-[0.2em] mb-4 opacity-60">Sync Forecast: {data?.forecast?.month || 'No Data'}</h4>
               <div className="flex items-end justify-between">
                  <div>
                     <p className="text-[10px] font-bold uppercase mb-1">Projected Revenue</p>
                     <p className="text-4xl font-black tracking-tighter"><IndianRupee className="w-8 h-8 inline mr-1" />{data?.forecast?.projected_total?.toLocaleString() || '0'}</p>
                  </div>
                  <div className="text-right">
                     <p className="text-[10px] font-bold uppercase mb-1">VS Last Year</p>
                     <p className={`text-2xl font-black ${data?.forecast?.change_percent >= 0 ? 'text-green-300' : 'text-red-300'}`}>
                        {data?.forecast?.change_percent > 0 ? '+' : ''}{data?.forecast?.change_percent || '0'}%
                     </p>
                  </div>
               </div>
               <div className="mt-6 pt-6 border-t border-white/10 flex items-center space-x-4">
                  <div className="flex flex-col">
                     <span className="text-[8px] font-black uppercase opacity-60">Daily Velocity</span>
                     <span className="text-sm font-bold"><IndianRupee className="w-3 h-3 inline mr-1" />{data?.forecast?.daily_average?.toLocaleString() || '0'}</span>
                  </div>
                  <div className="flex flex-col">
                     <span className="text-[8px] font-black uppercase opacity-60">Last Year Actual</span>
                     <span className="text-sm font-bold"><IndianRupee className="w-3 h-3 inline mr-1" />{data?.forecast?.last_year_actual?.toLocaleString() || '0'}</span>
                  </div>
               </div>
            </div>

            <div className="bg-white p-10 rounded-[2.5rem] border-2 border-gray-100 flex flex-col justify-center">
               <div className="flex items-center space-x-3 mb-4">
                  <div className="bg-indigo-600 p-2 rounded-xl text-white"><FileText className="w-4 h-4" /></div>
                  <h4 className="font-black text-gray-900 uppercase tracking-widest text-xs">Reporting Context</h4>
               </div>
               <p className="text-xs font-bold text-gray-500 leading-relaxed italic">
                 "Our monthly forecast indicates a significant {data?.forecast?.change_percent >= 0 ? 'surplus' : 'deficit'} compared to the previous year. Strategic price adjustments in late 2025 have stabilized margins across all core categories."
               </p>
            </div>
          </div>

          <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-10 border-b border-gray-100 flex justify-between items-center bg-gray-900 text-white">
              <h3 className="text-2xl font-black uppercase tracking-tighter flex items-center italic">
                <TrendingUp className="w-6 h-6 mr-3 text-orange-500" />
                12-Month Profit Trend
              </h3>
              <p className="text-xs font-black uppercase tracking-widest opacity-60">Year-over-Year Performance Map</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50/50">
                    <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Fiscal Month</th>
                    <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] text-right">Gross Sales</th>
                    <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] text-right">Expenses</th>
                    <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] text-right">Net Profit</th>
                    <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] text-center">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data?.trends?.length === 0 ? (
                    <tr><td colSpan={5} className="py-20 text-center text-gray-400 font-bold uppercase tracking-widest">No historical trend data available.</td></tr>
                  ) : (
                    data?.trends.map((t: any, i: number) => (
                      <tr key={i} className="hover:bg-gray-50 transition-colors">
                        <td className="px-10 py-6 font-black text-gray-900 tracking-tight lowercase">{t.month}</td>
                        <td className="px-10 py-6 text-right font-black text-gray-700"><IndianRupee className="w-4 h-4 inline mr-1" />{t.total_sale.toLocaleString()}</td>
                        <td className="px-10 py-6 text-right font-bold text-red-500"><IndianRupee className="w-4 h-4 inline mr-1" />{t.total_expense.toLocaleString()}</td>
                        <td className="px-10 py-6 text-right font-black text-green-600"><IndianRupee className="w-4 h-4 inline mr-1" />{t.profit.toLocaleString()}</td>
                        <td className="px-10 py-6 text-center">
                          <span className={`px-4 py-2 rounded-2xl text-[10px] font-black tracking-widest uppercase ${t.margin_percent >= 25 ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'}`}>
                            {t.margin_percent}%
                          </span>
                        </td>
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
