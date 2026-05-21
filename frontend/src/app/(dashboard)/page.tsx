"use client";
import React, { useState, useEffect } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, Cell } from 'recharts';
import { TrendingUp, ShoppingBag, DollarSign, TrendingDown, Calendar, ArrowUpRight, ArrowDownRight, Award, Clock } from 'lucide-react';
import { getApiUrl } from '@/lib/api';

const Sparkles = ({className}: {className?: string}) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>
);

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [insights, setInsights] = useState<any>(null);
  const [monthlyData, setMonthlyData] = useState<any[]>([]);
  const [lifetime, setLifetime] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [period, setPeriod] = useState("30days");

  useEffect(() => {
    fetchAllData();
  }, [period]);

  const fetchAllData = async () => {
    setIsLoading(true);
    try {
      const [statsRes, insightsRes, monthlyRes, lifetimeRes] = await Promise.all([
        fetch(getApiUrl(`/api/v1/restaurant/stats/dashboard-stats?period=${period}`)).then(r => r.json()),
        fetchInsights(),
        fetch(getApiUrl(`/api/v1/restaurant/stats/insights/monthly-breakdown`)).then(r => r.json()),
        fetch(getApiUrl(`/api/v1/restaurant/stats/insights/lifetime-summary`)).then(r => r.json())
      ]);
      
      setStats(statsRes);
      setMonthlyData(monthlyRes);
      setLifetime(lifetimeRes);
    } catch (error) {
      console.error("Failed to fetch dashboard data", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchInsights = async () => {
    try {
      const [comparison, dayOfWeek, forecast, profitTrend] = await Promise.all([
        fetch(getApiUrl(`/api/v1/restaurant/stats/compare/same-period?period=30days`)).then(r => r.json()),
        fetch(getApiUrl(`/api/v1/restaurant/stats/insights/day-of-week`)).then(r => r.json()),
        fetch(getApiUrl(`/api/v1/restaurant/stats/insights/monthly-forecast`)).then(r => r.json()),
        fetch(getApiUrl(`/api/v1/restaurant/stats/insights/profit-trend?months=1`)).then(r => r.json())
      ]);
      const data = { comparison, dayOfWeek, forecast, profitTrend };
      setInsights(data);
      return data;
    } catch (error) {
      console.error("Failed to fetch insights", error);
    }
  };

  if (isLoading && !stats) return <div className="p-8 text-center text-gray-500 animate-pulse">Loading Advanced Intelligence...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Business Intelligence</h1>
          <p className="text-gray-500 text-sm">Real-time performance metrics & multi-year historical analysis.</p>
        </div>
        <div className="flex space-x-2">
          {[
            {label: '7D', val: '7days'}, 
            {label: '30D', val: '30days'}, 
            {label: '3M', val: '3months'},
            {label: '1Y', val: '1year'},
            {label: 'Life', val: 'lifetime'}
          ].map(filter => (
            <button 
              key={filter.val} 
              onClick={() => setPeriod(filter.val)}
              className={`px-4 py-2 text-xs border rounded-xl transition-all font-bold shadow-sm ${
                period === filter.val 
                  ? 'bg-orange-600 text-white border-orange-700 scale-105' 
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-orange-50 hover:text-orange-600'
              }`}>
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Metric Cards */}
      {stats && stats.metrics && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[
            { title: "Net Revenue", value: `₹${stats.metrics.total_sales.toLocaleString()}`, icon: DollarSign, growth: stats.metrics.sales_growth, positive: stats.metrics.sales_growth >= 0 },
            { title: "Operating Cost", value: `₹${stats.metrics.total_expense.toLocaleString()}`, icon: ShoppingBag, growth: null, positive: false },
            { title: "Gross Profit", value: `₹${stats.metrics.total_profit.toLocaleString()}`, icon: TrendingUp, growth: null, positive: true },
            { title: "Daily Average", value: `₹${Math.round(stats.metrics.avg_daily_sale).toLocaleString()}`, icon: Calendar, growth: null, positive: true },
          ].map((stat, i) => {
            const Icon = stat.icon;
            return (
              <div key={i} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 hov-lift relative overflow-hidden group">
                <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:scale-110 transition-transform">
                  <Icon className="w-24 h-24" />
                </div>
                <div className="flex justify-between items-start relative z-10">
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{stat.title}</p>
                    <h3 className="text-2xl font-black text-gray-900 mt-1">{stat.value}</h3>
                  </div>
                  <div className={`p-3 rounded-2xl ${stat.positive ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                </div>
                {stat.growth !== null && (
                  <div className="mt-4 flex items-center relative z-10">
                    {stat.positive ? <ArrowUpRight className="w-4 h-4 text-green-600 mr-1" /> : <ArrowDownRight className="w-4 h-4 text-red-600 mr-1" />}
                    <span className={`text-sm font-bold ${stat.positive ? 'text-green-600' : 'text-red-600'}`}>
                      {Math.abs(stat.growth)}%
                    </span>
                    <span className="text-xs text-gray-400 ml-2">vs prev period</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Advanced Section: Lifetime Summary & Monthly Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Breakdown Chart */}
        <div className="lg:col-span-2 bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h3 className="text-xl font-black text-gray-900">Historical Scale</h3>
              <p className="text-gray-400 text-sm">Monthly sales vs profit since launch</p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center"><div className="w-3 h-3 bg-orange-500 rounded-full mr-2"></div><span className="text-xs font-bold text-gray-500">Sales</span></div>
              <div className="flex items-center"><div className="w-3 h-3 bg-indigo-500 rounded-full mr-2"></div><span className="text-xs font-bold text-gray-500">Profit</span></div>
            </div>
          </div>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 900, height: 300 }}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 10}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 10}} tickFormatter={(val) => `₹${val/1000}k`} />
                <Tooltip 
                  cursor={{fill: '#F9FAFB'}}
                  contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)'}}
                />
                <Bar dataKey="total_sale" fill="#EA580C" radius={[6, 6, 0, 0]} barSize={20} />
                <Bar dataKey="profit" fill="#6366F1" radius={[6, 6, 0, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Lifetime Performance Card */}
        <div className="bg-indigo-600 rounded-3xl p-8 text-white shadow-xl shadow-indigo-100 relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Award className="w-40 h-40" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center space-x-2 mb-6">
              <Clock className="w-5 h-5 text-indigo-200" />
              <p className="text-indigo-200 font-bold uppercase tracking-widest text-xs">Since {lifetime?.start_date || 'Day 1'}</p>
            </div>
            <h3 className="text-3xl font-black mb-2">Lifetime Power</h3>
            <p className="text-indigo-100 text-sm mb-8 opacity-80">Accumulated business value across all cycles.</p>
            
            <div className="space-y-6">
              <div className="bg-white/10 backdrop-blur-md p-5 rounded-2xl border border-white/10">
                <p className="text-xs text-indigo-200 font-bold uppercase mb-1">Total Revenue Generated</p>
                <div className="flex items-end justify-between">
                  <p className="text-2xl font-black">₹{lifetime?.total_revenue?.toLocaleString() || '0'}</p>
                  <TrendingUp className="w-5 h-5 text-green-300" />
                </div>
              </div>
              <div className="bg-white/10 backdrop-blur-md p-5 rounded-2xl border border-white/10">
                <p className="text-xs text-indigo-200 font-bold uppercase mb-1">Average Monthly Flow</p>
                <p className="text-2xl font-black">₹{lifetime?.avg_monthly_revenue?.toLocaleString() || '0'}</p>
              </div>
            </div>
          </div>
          
          <div className="relative z-10 mt-8 pt-8 border-t border-white/10 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-indigo-300 font-bold uppercase">Best Month</p>
              <p className="font-bold text-sm tracking-tight">{lifetime?.best_month?.name}</p>
            </div>
            <div className="text-right text-green-300 font-black text-lg">
              ₹{Math.round((lifetime?.best_month?.amount || 0) / 1000)}k
            </div>
          </div>
        </div>
      </div>

      {/* Advanced Business Intelligence Insights */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
         {/* Reusing existing insight cards style but with cleaner wiring */}
         <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 hov-lift">
            <p className="text-xs font-bold text-gray-400 uppercase mb-2">YoY Performance</p>
            <div className="flex items-center justify-between">
              <h4 className="text-xl font-black text-gray-900">
                {insights?.comparison ? (insights.comparison.change_percent >= 0 ? '+' : '') + insights.comparison.change_percent + '%' : '...'}
              </h4>
              <div className={`p-2 rounded-xl ${insights?.comparison?.direction === 'up' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                {insights?.comparison?.direction === 'up' ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
              </div>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">vs same month last year</p>
         </div>

         <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 hov-lift">
            <p className="text-xs font-bold text-gray-400 uppercase mb-2">Peak Day</p>
            <h4 className="text-xl font-black text-gray-900">{insights?.dayOfWeek?.best_day?.day || '...'}</h4>
            <div className="flex items-center mt-2 text-orange-600">
              <TrendingUp className="w-3 h-3 mr-1" />
              <span className="text-[10px] font-bold">₹{Math.round(insights?.dayOfWeek?.best_day?.average_sale || 0).toLocaleString()} avg</span>
            </div>
         </div>

         <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 hov-lift">
            <p className="text-xs font-bold text-gray-400 uppercase mb-2">Month Projection</p>
            <h4 className="text-xl font-black text-gray-900">₹{Math.round(insights?.forecast?.projected_total || 0).toLocaleString()}</h4>
            <div className="flex items-center mt-2 text-indigo-600">
              <TrendingUp className="w-3 h-3 mr-1" />
              <span className="text-[10px] font-bold">{insights?.forecast?.change_percent}% vs target</span>
            </div>
         </div>

         <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 hov-lift border-l-4 border-l-orange-500">
            <p className="text-xs font-bold text-orange-600 uppercase mb-2">AI Pulse</p>
            <p className="text-[11px] font-bold text-gray-700 leading-tight">
              {insights?.profitTrend?.trend?.length > 0 
                ? `Profit margin is stable at ${insights.profitTrend.trend[0].margin_percent}%.` 
                : 'Analyzing sales velocity...'}
            </p>
         </div>
      </div>

      {/* Granular Area Chart */}
      <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h3 className="text-xl font-black text-gray-900 uppercase tracking-tighter italic">Velocity Tracker</h3>
            <p className="text-gray-400 text-xs">Daily sales & cost fluctuations for {period}</p>
          </div>
        </div>
        {stats?.chart_data && (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 900, height: 256 }}>
              <AreaChart data={stats.chart_data}>
                <defs>
                  <linearGradient id="colorSale" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#EA580C" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#EA580C" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="#F3F4F6" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 10}} dy={10} hide={period === 'lifetime'} />
                <Tooltip 
                  contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)'}}
                  formatter={(val: any) => [`₹${val.toLocaleString()}`]}
                />
                <Area type="monotone" dataKey="sale" stroke="#EA580C" strokeWidth={3} fillOpacity={1} fill="url(#colorSale)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
