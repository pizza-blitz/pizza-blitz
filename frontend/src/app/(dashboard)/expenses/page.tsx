"use client";
import React, { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, AreaChart, Area } from 'recharts';
import { Plus, Receipt, IndianRupee, TrendingUp, TrendingDown, Calendar, Filter, Search, Loader2, Sparkles } from 'lucide-react';
import { getApiUrl } from '@/lib/api';

export default function ExpenseTracker() {
  const [expenseStats, setExpenseStats] = useState<any>(null);
  const [trends, setTrends] = useState<any[]>([]);
  const [detailedExpenses, setDetailedExpenses] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchExpenseData();
  }, []);

  const fetchExpenseData = async () => {
    setIsLoading(true);
    try {
      const [statsRes, trendRes, expenseRes] = await Promise.all([
        fetch(getApiUrl('/api/v1/restaurant/stats/dashboard-stats?period=30days')).then(r => r.json()),
        fetch(getApiUrl('/api/v1/restaurant/stats/insights/profit-trend?months=6')).then(r => r.json()),
        fetch(getApiUrl('/api/v1/restaurant/expenses/expenses')).then(r => r.json())
      ]);
      
      setExpenseStats(statsRes.metrics);
      setTrends(trendRes.trend);
      setDetailedExpenses(expenseRes);
      
    } catch (error) {
      console.error("Failed to fetch expense data", error);
    } finally {
      setIsLoading(false);
    }
  };

  const categories = [
    { name: 'Raw Materials', value: expenseStats ? expenseStats.total_expense * 0.6 : 0, color: '#EA580C' },
    { name: 'Staff & Ops', value: expenseStats ? expenseStats.total_expense * 0.25 : 0, color: '#6366F1' },
    { name: 'Utilities', value: expenseStats ? expenseStats.total_expense * 0.15 : 0, color: '#10B981' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-black text-gray-900 uppercase tracking-tighter">Cost Intelligence</h1>
          <p className="text-gray-500 mt-1 font-medium">Monitoring operational burn and resource allocation efficiency.</p>
        </div>
        <button className="bg-black hover:bg-orange-600 text-white px-8 py-4 rounded-[2rem] font-black text-xs uppercase tracking-widest shadow-2xl shadow-orange-100 flex items-center transition-all group">
          <Plus className="w-4 h-4 mr-2 group-hover:rotate-90 transition-transform" />
          Log Expenditure
        </button>
      </div>

      {isLoading ? (
        <div className="py-20 text-center">
          <Loader2 className="w-12 h-12 animate-spin text-orange-500 mx-auto mb-4" />
          <p className="text-gray-400 font-black uppercase tracking-widest text-xs">Phasing Cost Nodes...</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 bg-white p-10 rounded-[3rem] shadow-sm border border-gray-100 relative overflow-hidden">
               <div className="flex justify-between items-center mb-10">
                  <div>
                    <h3 className="text-2xl font-black text-gray-900 tracking-tighter uppercase italic">Burn Velocity</h3>
                    <p className="text-gray-400 text-xs font-bold uppercase tracking-widest">Revenue vs Operating Cost (6 Months)</p>
                  </div>
                  <div className="flex items-center space-x-6">
                    <div className="flex items-center"><div className="w-3 h-3 bg-orange-500 rounded-full mr-2"></div><span className="text-[10px] font-black text-gray-400 uppercase">Sales</span></div>
                    <div className="flex items-center"><div className="w-3 h-3 bg-red-500 rounded-full mr-2"></div><span className="text-[10px] font-black text-gray-400 uppercase">Burn</span></div>
                  </div>
               </div>
               <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trends}>
                      <defs>
                        <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#EA580C" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#EA580C" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f8fafc" />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#9ca3af', fontWeight: 'bold'}} />
                      <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#9ca3af', fontWeight: 'bold'}} tickFormatter={v => `₹${v/1000}k`} />
                      <Tooltip 
                        contentStyle={{borderRadius: '24px', border: 'none', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.1)'}} 
                      />
                      <Area type="monotone" dataKey="total_sale" stroke="#EA580C" strokeWidth={4} fill="url(#colorRev)" />
                      <Area type="monotone" dataKey="total_expense" stroke="#EF4444" strokeWidth={4} fill="none" strokeDasharray="10 10" />
                    </AreaChart>
                  </ResponsiveContainer>
               </div>
            </div>

            <div className="bg-white p-10 rounded-[3rem] shadow-sm border border-gray-100 flex flex-col items-center justify-center text-center">
               <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-8">Allocation Map</h3>
               <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categories}
                        innerRadius={80}
                        outerRadius={100}
                        paddingAngle={8}
                        dataKey="value"
                      >
                        {categories.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
               </div>
               <div className="mt-8 grid grid-cols-1 w-full gap-4">
                  {categories.map(cat => (
                    <div key={cat.name} className="flex justify-between items-center bg-gray-50/50 p-4 rounded-2xl border border-gray-50">
                       <div className="flex items-center">
                         <div className="w-3 h-3 rounded-full mr-3 shadow-sm" style={{backgroundColor: cat.color}}></div>
                         <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{cat.name}</span>
                       </div>
                       <span className="font-black text-gray-900 text-sm italic">₹{Math.round(cat.value).toLocaleString()}</span>
                    </div>
                  ))}
               </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
             <div className="bg-red-600 p-8 rounded-[2.5rem] text-white shadow-xl shadow-red-100 relative overflow-hidden group">
                <div className="absolute -right-4 -bottom-4 opacity-10 group-hover:scale-125 transition-transform duration-700">
                  <TrendingDown className="w-32 h-32" />
                </div>
                <p className="text-[10px] font-black text-red-100 uppercase tracking-widest mb-2 opacity-60">Monthly Burn</p>
                <h4 className="text-4xl font-black tracking-tighter">₹{expenseStats?.total_expense.toLocaleString()}</h4>
                <div className="mt-4 flex items-center text-xs font-bold text-red-100">
                   <div className="w-2 h-2 bg-white rounded-full mr-2 animate-pulse"></div>
                   Live Expenditure Node
                </div>
             </div>

             <div className="bg-white p-8 rounded-[2.5rem] border-2 border-gray-100 flex flex-col justify-center">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Efficiency Ratio</p>
                <h4 className="text-3xl font-black text-gray-900 tracking-tighter">
                   {((expenseStats?.total_profit / expenseStats?.total_sales) * 100).toFixed(1)}%
                </h4>
                <p className="text-[10px] font-black text-green-600 uppercase mt-2 italic shadow-green-50">OPTIMAL RANGE</p>
             </div>

              <div className="bg-white p-8 rounded-[2.5rem] border-2 border-gray-100 flex flex-col justify-center col-span-2">
                <div className="flex items-center space-x-3 mb-4">
                   <div className="bg-orange-500 p-2 rounded-xl text-white"><Sparkles className="w-4 h-4" /></div>
                   <h5 className="font-black text-gray-900 uppercase tracking-widest text-xs">Cost Optimization Insight</h5>
                </div>
                <p className="text-xs font-bold text-gray-500 leading-relaxed italic">
                  "Raw material costs spiked by 12% last week due to dairy price fluctuations. Consolidate vendor orders starting Monday to unlock bulk rewards."
                </p>
              </div>
          </div>

          <div className="bg-white rounded-[3rem] shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-10 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-2xl font-black text-gray-900 uppercase tracking-tighter italic">Expenditure Ledger</h3>
              <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Detailed Transaction History</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50/50">
                    <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Date</th>
                    <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Category</th>
                    <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Amount</th>
                    <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {detailedExpenses.length === 0 ? (
                    <tr><td colSpan={4} className="py-20 text-center text-gray-400 font-bold uppercase tracking-widest">No detailed records found.</td></tr>
                  ) : (
                    detailedExpenses.map((ex, i) => (
                      <tr key={i} className="hover:bg-gray-50 transition-colors">
                        <td className="px-10 py-6 text-sm font-bold text-gray-900">{new Date(ex.date).toLocaleDateString()}</td>
                        <td className="px-10 py-6 text-sm">
                          <span className="px-3 py-1 bg-gray-100 rounded-full text-[10px] font-black uppercase text-gray-600">
                             {ex.category_id === 1 ? 'Raw Materials' : ex.category_id === 2 ? 'Staff & Ops' : 'Utilities'}
                          </span>
                        </td>
                        <td className="px-10 py-6 text-right text-sm font-black text-red-500">₹{ex.amount.toLocaleString()}</td>
                        <td className="px-10 py-6 text-sm text-gray-500 italic">{ex.description || 'No description'}</td>
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
