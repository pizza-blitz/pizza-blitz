"use client";
import React, { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, Calendar, Filter, Download, ArrowUpRight, ArrowDownRight, Loader2, Award } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getApiUrl } from '@/lib/api';

export default function SalesHistory() {
  const [salesData, setSalesData] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // New Month/Year Filter State
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [salesRes, statsRes] = await Promise.all([
        fetch(getApiUrl('/api/v1/restaurant/sales/')).then(r => r.json()),
        fetch(getApiUrl('/api/v1/restaurant/stats/dashboard-stats?period=30days')).then(r => r.json())
      ]);
      setSalesData(Array.isArray(salesRes) ? salesRes : []);
      setSummary(statsRes.metrics);
    } catch (error) {
      console.error("Failed to fetch sales history", error);
    } finally {
      setIsLoading(false);
    }
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
            <ResponsiveContainer width="100%" height="100%">
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
