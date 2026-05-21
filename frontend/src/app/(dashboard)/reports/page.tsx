"use client";
import React, { useState, useEffect } from 'react';
import { Calendar, Download, Share2, Filter, IndianRupee, TrendingUp, TrendingDown, FileText, Loader2 } from 'lucide-react';
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
      const [statsRes, salesRes, forecastRes, trendRes] = await Promise.all([
        fetch(getApiUrl(`/api/v1/restaurant/stats/dashboard-stats?period=${period}`)).then(r => r.json()),
        fetch(getApiUrl('/api/v1/restaurant/sales/')).then(r => r.json()),
        fetch(getApiUrl('/api/v1/restaurant/stats/insights/monthly-forecast')).then(r => r.json()),
        fetch(getApiUrl('/api/v1/restaurant/stats/insights/profit-trend?months=12')).then(r => r.json())
      ]);
      
      setData({
        summary: statsRes.metrics,
        records: salesRes.reverse().slice(0, 10),
        forecast: forecastRes,
        trends: trendRes.trend
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

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-black text-gray-900 uppercase tracking-tighter">Financial Audit Logs</h1>
          <p className="text-gray-500 mt-1 font-medium">Verified historical performance reports for stake-holder review.</p>
        </div>
        <div className="flex space-x-4">
          <button onClick={handleExport} className="bg-white border-2 border-gray-100 text-gray-900 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center hover:bg-gray-50 transition-all shadow-sm">
            <Download className="w-4 h-4 mr-2" /> Data Export
          </button>
          <button className="bg-green-600 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center shadow-xl shadow-green-100 hover:bg-green-700 transition-all">
            <Share2 className="w-4 h-4 mr-2" /> Share Report
          </button>
        </div>
      </div>

      <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100 flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center space-x-4">
           {['7days', '30days', '90days', '1year', 'lifetime'].map(p => (
             <button 
               key={p}
               onClick={() => setPeriod(p)}
               className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${period === p ? 'bg-black text-white' : 'bg-gray-50 text-gray-400 hover:text-gray-600'}`}
             >
               {p === '7days' ? '1 Week' : p === '30days' ? '1 Month' : p === '90days' ? '1 Quarter' : p === '1year' ? '1 Year' : 'All Time'}
             </button>
           ))}
        </div>
        <div className="flex items-center text-xs font-black text-gray-400 uppercase tracking-widest bg-gray-50 px-4 py-2 rounded-xl">
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

