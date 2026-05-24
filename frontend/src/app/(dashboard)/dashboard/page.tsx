"use client";
import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { TrendingUp, ShoppingBag, DollarSign, Calendar, ArrowUpRight, ArrowDownRight, Award, Clock } from 'lucide-react';
import { getApiUrl } from '@/lib/api';

function formatCurrency(value: number | undefined | null, fractionDigits = 0) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: fractionDigits,
  }).format(Number(value || 0));
}

function formatCompactCurrency(value: number) {
  if (Math.abs(value) >= 1000) {
    return `${formatCurrency(value / 1000, 1)}k`;
  }
  return formatCurrency(value, 0);
}

function EmptyChartState({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-52 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-5 text-center">
      <p className="text-sm font-bold text-gray-400">{label}</p>
    </div>
  );
}

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
        fetch(getApiUrl(`/api/v1/restaurant/stats/dashboard-stats?period=${period}`), { credentials: "include" }).then(r => r.json()),
        fetchInsights(),
        fetch(getApiUrl(`/api/v1/restaurant/stats/insights/monthly-breakdown`), { credentials: "include" }).then(r => r.json()),
        fetch(getApiUrl(`/api/v1/restaurant/stats/insights/lifetime-summary`), { credentials: "include" }).then(r => r.json())
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
        fetch(getApiUrl(`/api/v1/restaurant/stats/compare/same-period?period=30days`), { credentials: "include" }).then(r => r.json()),
        fetch(getApiUrl(`/api/v1/restaurant/stats/insights/day-of-week`), { credentials: "include" }).then(r => r.json()),
        fetch(getApiUrl(`/api/v1/restaurant/stats/insights/monthly-forecast`), { credentials: "include" }).then(r => r.json()),
        fetch(getApiUrl(`/api/v1/restaurant/stats/insights/profit-trend?months=1`), { credentials: "include" }).then(r => r.json())
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
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight text-gray-900 sm:text-3xl">Business Intelligence</h1>
          <p className="mt-1 text-sm text-gray-500">Real-time performance metrics & multi-year historical analysis.</p>
        </div>
        <div className="grid w-full grid-cols-5 gap-2 lg:flex lg:w-auto lg:max-w-full lg:overflow-x-auto lg:pb-1">
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
              className={`min-w-0 rounded-md border px-3 py-2 text-xs font-bold shadow-sm transition-all lg:shrink-0 ${
                period === filter.val
                  ? 'bg-orange-600 text-white border-orange-700'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-orange-50 hover:text-orange-600'
              }`}>
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Metric Cards */}
      {stats && stats.metrics && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-6">
          {[
            { title: "Net Revenue", value: formatCurrency(stats.metrics.total_sales, 2), icon: DollarSign, growth: stats.metrics.sales_growth, positive: stats.metrics.sales_growth >= 0 },
            { title: "Operating Cost", value: formatCurrency(stats.metrics.total_expense, 2), icon: ShoppingBag, growth: null, positive: false },
            { title: "Gross Profit", value: formatCurrency(stats.metrics.total_profit, 2), icon: TrendingUp, growth: null, positive: true },
            { title: "Daily Average", value: formatCurrency(Math.round(stats.metrics.avg_daily_sale), 0), icon: Calendar, growth: null, positive: true },
          ].map((stat, i) => {
            const Icon = stat.icon;
            return (
              <div key={i} data-testid="dashboard-metric-card" className="group relative overflow-hidden rounded-lg border border-gray-100 bg-white p-4 shadow-sm md:p-6">
                <div className="absolute -bottom-4 -right-4 opacity-5 transition-transform group-hover:scale-110">
                  <Icon className="h-16 w-16 md:h-24 md:w-24" />
                </div>
                <div className="relative z-10 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 md:text-xs">{stat.title}</p>
                    <h3 className="mt-1 break-words text-xl font-black leading-tight text-gray-900 md:text-2xl">{stat.value}</h3>
                  </div>
                  <div className={`rounded-md p-2 md:p-3 ${stat.positive ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'}`}>
                    <Icon className="h-4 w-4 md:h-5 md:w-5" />
                  </div>
                </div>
                {stat.growth !== null && (
                  <div className="relative z-10 mt-3 flex flex-wrap items-center gap-x-1 gap-y-0.5">
                    {stat.positive ? <ArrowUpRight className="h-4 w-4 text-green-600" /> : <ArrowDownRight className="h-4 w-4 text-red-600" />}
                    <span className={`text-sm font-bold ${stat.positive ? 'text-green-600' : 'text-red-600'}`}>
                      {Math.abs(stat.growth)}%
                    </span>
                    <span className="text-[11px] text-gray-400">vs prev period</span>
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
        <div className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-8 lg:col-span-2">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-xl font-black text-gray-900">Historical Scale</h3>
              <p className="text-gray-400 text-sm">Monthly sales vs profit since launch</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center"><div className="w-3 h-3 bg-orange-500 rounded-full mr-2"></div><span className="text-xs font-bold text-gray-500">Sales</span></div>
              <div className="flex items-center"><div className="w-3 h-3 bg-indigo-500 rounded-full mr-2"></div><span className="text-xs font-bold text-gray-500">Profit</span></div>
            </div>
          </div>
          <div className="h-[260px] sm:h-[300px]">
            {monthlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 900, height: 300 }}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 10}} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 10}} tickFormatter={(val) => formatCompactCurrency(Number(val))} />
                  <Tooltip
                    cursor={{fill: '#F9FAFB'}}
                    contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)'}}
                    formatter={(val: any) => [formatCurrency(Number(val), 2)]}
                  />
                  <Bar dataKey="total_sale" fill="#EA580C" radius={[6, 6, 0, 0]} barSize={20} />
                  <Bar dataKey="profit" fill="#6366F1" radius={[6, 6, 0, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChartState label="Monthly history will appear after the first reporting cycle." />
            )}
          </div>
        </div>

        {/* Lifetime Performance Card */}
        <div className="relative flex flex-col justify-between overflow-hidden rounded-3xl bg-indigo-600 p-6 text-white shadow-xl shadow-indigo-100 sm:p-8">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Award className="w-40 h-40" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center space-x-2 mb-6">
              <Clock className="w-5 h-5 text-indigo-200" />
              <p className="text-indigo-200 font-bold uppercase tracking-widest text-xs">Since {lifetime?.start_date || 'Day 1'}</p>
            </div>
            <h3 className="mb-2 text-2xl font-black sm:text-3xl">Lifetime Power</h3>
            <p className="text-indigo-100 text-sm mb-8 opacity-80">Accumulated business value across all cycles.</p>

            <div className="space-y-6">
              <div className="bg-white/10 backdrop-blur-md p-5 rounded-2xl border border-white/10">
                <p className="text-xs text-indigo-200 font-bold uppercase mb-1">Total Revenue Generated</p>
                <div className="flex items-end justify-between">
                  <p className="text-2xl font-black">{formatCurrency(lifetime?.total_revenue, 2)}</p>
                  <TrendingUp className="w-5 h-5 text-green-300" />
                </div>
              </div>
              <div className="bg-white/10 backdrop-blur-md p-5 rounded-2xl border border-white/10">
                <p className="text-xs text-indigo-200 font-bold uppercase mb-1">Average Monthly Flow</p>
                <p className="text-2xl font-black">{formatCurrency(lifetime?.avg_monthly_revenue, 2)}</p>
              </div>
            </div>
          </div>

          <div className="relative z-10 mt-8 pt-8 border-t border-white/10 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-indigo-300 font-bold uppercase">Best Month</p>
              <p className="font-bold text-sm tracking-tight">{lifetime?.best_month?.name}</p>
            </div>
            <div className="text-right text-green-300 font-black text-lg">
              {formatCompactCurrency(lifetime?.best_month?.amount || 0)}
            </div>
          </div>
        </div>
      </div>

      {/* Advanced Business Intelligence Insights */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-6">
         {/* Reusing existing insight cards style but with cleaner wiring */}
         <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm md:p-6">
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

         <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm md:p-6">
            <p className="text-xs font-bold text-gray-400 uppercase mb-2">Peak Day</p>
            <h4 className="text-xl font-black text-gray-900">{insights?.dayOfWeek?.best_day?.day || '...'}</h4>
            <div className="flex items-center mt-2 text-orange-600">
              <TrendingUp className="w-3 h-3 mr-1" />
              <span className="text-[10px] font-bold">{formatCurrency(Math.round(insights?.dayOfWeek?.best_day?.average_sale || 0), 0)} avg</span>
            </div>
         </div>

         <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm md:p-6">
            <p className="text-xs font-bold text-gray-400 uppercase mb-2">Month Projection</p>
            <h4 className="text-xl font-black text-gray-900">{formatCurrency(Math.round(insights?.forecast?.projected_total || 0), 0)}</h4>
            <div className="flex items-center mt-2 text-indigo-600">
              <TrendingUp className="w-3 h-3 mr-1" />
              <span className="text-[10px] font-bold">{insights?.forecast?.change_percent}% vs target</span>
            </div>
         </div>

         <div className="rounded-lg border border-l-4 border-gray-100 border-l-orange-500 bg-white p-4 shadow-sm md:p-6">
            <p className="text-xs font-bold text-orange-600 uppercase mb-2">AI Pulse</p>
            <p className="text-[11px] font-bold text-gray-700 leading-tight">
              {insights?.profitTrend?.trend?.length > 0
                ? `Profit margin is stable at ${insights.profitTrend.trend[0].margin_percent}%.`
                : 'Analyzing sales velocity...'}
            </p>
         </div>
      </div>

      {/* Granular Area Chart */}
      <div className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-8">
        <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-xl font-black text-gray-900 uppercase tracking-tighter italic">Velocity Tracker</h3>
            <p className="text-gray-400 text-xs">Daily sales & cost fluctuations for {period}</p>
          </div>
        </div>
        <div className="h-64">
          {stats?.chart_data?.length > 0 ? (
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
                  formatter={(val: any) => [formatCurrency(Number(val), 2)]}
                />
                <Area type="monotone" dataKey="sale" stroke="#EA580C" strokeWidth={3} fillOpacity={1} fill="url(#colorSale)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChartState label="Daily movement will appear after sales activity is recorded." />
          )}
        </div>
      </div>
    </div>
  );
}
