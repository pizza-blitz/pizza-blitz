"use client";
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import {
  AlertTriangle,
  Award,
  BellRing,
  Calendar,
  Clock,
  DollarSign,
  ExternalLink,
  Flame,
  ShoppingBag,
  TimerReset,
  TrendingUp,
  Truck,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
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

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}: ${url}`);
  }
  return response.json();
}

function EmptyChartState({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-52 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-5 text-center">
      <p className="text-sm font-bold text-gray-400">{label}</p>
    </div>
  );
}

type DashboardOrder = {
  id: number;
  status: string;
  order_type: string;
  fulfillment_type?: string | null;
  total_amount?: number;
  customer_name?: string | null;
  created_at?: string | null;
  payment_due?: boolean;
  delivery_assignment?: {
    assigned_to?: string | null;
    status?: string | null;
  } | null;
};

type FlowReadiness = {
  summary: {
    today_order_count: number;
    active_order_count: number;
    open_count: number;
    preparing_count: number;
    ready_count: number;
    ready_to_close_count: number;
    payment_due_count: number;
    closed_count: number;
  };
  next_actions: string[];
};

type DeliveryQueue = {
  summary: {
    open_delivery_count: number;
    unassigned_count: number;
    assigned_count: number;
    out_for_delivery_count: number;
    address_review_count: number;
    payment_due_count: number;
  };
};

type OwnerAlert = {
  title: string;
  detail: string;
  tone: "emerald" | "amber" | "orange" | "sky" | "red" | "slate";
};

function CommandMetric({
  label,
  value,
  detail,
  icon: Icon,
  testId,
}: {
  label: string;
  value: number | string;
  detail: string;
  icon: typeof TimerReset;
  testId: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</p>
          <p data-testid={testId} className="mt-1 text-2xl font-black leading-none text-slate-950">
            {value}
          </p>
        </div>
        <span className="rounded-md bg-slate-50 p-2 text-slate-600">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 text-xs font-semibold leading-5 text-slate-500">{detail}</p>
    </div>
  );
}

function StatePill({
  label,
  value,
  tone = "slate",
  testId,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber" | "orange" | "sky" | "red" | "slate";
  testId: string;
}) {
  const toneClass = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    orange: "border-orange-200 bg-orange-50 text-orange-700",
    sky: "border-sky-200 bg-sky-50 text-sky-700",
    red: "border-red-200 bg-red-50 text-red-700",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  }[tone];

  return (
    <div className={`rounded-md border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] font-black uppercase tracking-wide opacity-75">{label}</p>
      <p data-testid={testId} className="mt-1 text-xl font-black leading-none">{value}</p>
    </div>
  );
}

function OwnerAlertRow({ alert }: { alert: OwnerAlert }) {
  const toneClass = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    orange: "border-orange-200 bg-orange-50 text-orange-800",
    sky: "border-sky-200 bg-sky-50 text-sky-800",
    red: "border-red-200 bg-red-50 text-red-800",
    slate: "border-slate-200 bg-slate-50 text-slate-800",
  }[alert.tone];

  return (
    <li className={`rounded-md border px-3 py-3 ${toneClass}`}>
      <p className="text-sm font-black">{alert.title}</p>
      <p className="mt-1 text-xs font-semibold opacity-80">{alert.detail}</p>
    </li>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [insights, setInsights] = useState<any>(null);
  const [monthlyData, setMonthlyData] = useState<any[]>([]);
  const [lifetime, setLifetime] = useState<any>(null);
  const [todayOrders, setTodayOrders] = useState<DashboardOrder[]>([]);
  const [totalCollectedToday, setTotalCollectedToday] = useState(0);
  const [flowReadiness, setFlowReadiness] = useState<FlowReadiness | null>(null);
  const [deliveryQueue, setDeliveryQueue] = useState<DeliveryQueue | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [period, setPeriod] = useState("30days");

  useEffect(() => {
    const controller = new AbortController();
    fetchAllData(controller.signal);
    return () => controller.abort();
  }, [period]);

  const fetchAllData = async (signal?: AbortSignal) => {
    setIsLoading(true);
    try {
      const statsRes = await fetchJson(getApiUrl(`/api/v1/restaurant/stats/dashboard-stats?period=${period}`), {
        credentials: "include",
        signal,
      });
      if (signal?.aborted) return;
      setStats(statsRes);
      setIsLoading(false);

      const supportingTasks = [
        async () => setMonthlyData(await fetchJson(getApiUrl(`/api/v1/restaurant/stats/insights/monthly-breakdown`), { credentials: "include", signal })),
        async () => setLifetime(await fetchJson(getApiUrl(`/api/v1/restaurant/stats/insights/lifetime-summary`), { credentials: "include", signal })),
        async () => {
          const today = await fetchJson(getApiUrl("/api/v1/restaurant/orders/today"), { credentials: "include", cache: "no-store", signal });
          setTodayOrders(today.orders || []);
          setTotalCollectedToday(Number(today.total_collected_today || 0));
        },
        async () => setFlowReadiness(await fetchJson(getApiUrl("/api/v1/restaurant/orders/flow-readiness"), { credentials: "include", cache: "no-store", signal })),
        async () => setDeliveryQueue(await fetchJson(getApiUrl("/api/v1/restaurant/delivery/queue"), { credentials: "include", cache: "no-store", signal })),
        async () => void await fetchInsights(signal),
      ];
      const workers = Array.from({ length: 2 }, async () => {
        while (supportingTasks.length && !signal?.aborted) {
          const task = supportingTasks.shift();
          try {
            if (task) await task();
          } catch (error) {
            if (signal?.aborted) return;
            console.warn("Dashboard supporting data is temporarily unavailable", error);
          }
        }
      });
      await Promise.all(workers);
    } catch (error) {
      if (signal?.aborted) return;
      console.error("Failed to fetch dashboard data", error);
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  };

  const fetchInsights = async (signal?: AbortSignal) => {
    try {
      const comparison = await fetchJson(getApiUrl(`/api/v1/restaurant/stats/compare/same-period?period=30days`), { credentials: "include", signal });
      const dayOfWeek = await fetchJson(getApiUrl(`/api/v1/restaurant/stats/insights/day-of-week`), { credentials: "include", signal });
      const forecast = await fetchJson(getApiUrl(`/api/v1/restaurant/stats/insights/monthly-forecast`), { credentials: "include", signal });
      const profitTrend = await fetchJson(getApiUrl(`/api/v1/restaurant/stats/insights/profit-trend?months=1`), { credentials: "include", signal });
      if (signal?.aborted) return null;
      const data = { comparison, dayOfWeek, forecast, profitTrend };
      setInsights(data);
      return data;
    } catch (error) {
      if (signal?.aborted) return null;
      console.warn("Dashboard insights are temporarily unavailable", error);
      return null;
    }
  };

  const commandBoard = React.useMemo(() => {
    const flow = flowReadiness?.summary;
    const delivery = deliveryQueue?.summary;
    const activeOrders = todayOrders.filter((order) => order.status !== "closed");
    const deliveryOrders = todayOrders.filter(
      (order) =>
        (order.fulfillment_type || order.order_type || "").toLowerCase() === "delivery" &&
        order.status !== "closed"
    );
    const ownerAlerts: OwnerAlert[] = [];

    if (flow?.payment_due_count) {
      ownerAlerts.push({
        title: "Payment due",
        detail: `Confirm payment for ${flow.payment_due_count} active order(s).`,
        tone: "amber",
      });
    }
    if (flow?.ready_to_close_count) {
      ownerAlerts.push({
        title: "Ready to close",
        detail: `Print receipt and close ${flow.ready_to_close_count} ready order(s).`,
        tone: "emerald",
      });
    }
    if (flow?.open_count) {
      ownerAlerts.push({
        title: "Start prep",
        detail: `Start kitchen prep for ${flow.open_count} newly received order(s).`,
        tone: "orange",
      });
    }
    if (delivery?.unassigned_count) {
      ownerAlerts.push({
        title: "Assign riders",
        detail: `Assign riders to ${delivery.unassigned_count} delivery order(s).`,
        tone: "sky",
      });
    }
    if (delivery?.address_review_count) {
      ownerAlerts.push({
        title: "Address review",
        detail: `Confirm address details for ${delivery.address_review_count} delivery order(s).`,
        tone: "red",
      });
    }
    if (!ownerAlerts.length) {
      ownerAlerts.push({
        title: "No active blockers",
        detail: "Kitchen, payment and delivery queues are clear right now.",
        tone: "slate",
      });
    }

    return {
      todayOrders: flow?.today_order_count ?? todayOrders.length,
      activeOrders: flow?.active_order_count ?? activeOrders.length,
      open: flow?.open_count ?? activeOrders.filter((order) => order.status === "open").length,
      preparing: flow?.preparing_count ?? activeOrders.filter((order) => order.status === "preparing").length,
      ready: flow?.ready_count ?? activeOrders.filter((order) => order.status === "ready").length,
      readyToClose: flow?.ready_to_close_count ?? 0,
      paymentDue: flow?.payment_due_count ?? activeOrders.filter((order) => order.payment_due).length,
      closed: flow?.closed_count ?? todayOrders.filter((order) => order.status === "closed").length,
      deliveryOpen: delivery?.open_delivery_count ?? deliveryOrders.length,
      deliveryUnassigned: delivery?.unassigned_count ?? 0,
      deliveryAssigned: delivery?.assigned_count ?? 0,
      deliveryOut: delivery?.out_for_delivery_count ?? 0,
      deliveryAddressReview: delivery?.address_review_count ?? 0,
      deliveryPaymentDue: delivery?.payment_due_count ?? 0,
      ownerAlerts,
      activeValue: activeOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0),
    };
  }, [deliveryQueue, flowReadiness, todayOrders]);

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

      <section
        data-testid="today-command-board"
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
      >
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-black text-slate-950">Today Command Board</h2>
              <span className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black uppercase text-emerald-700">
                <BellRing className="h-3.5 w-3.5" />
                Live Ops
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-sm font-medium text-slate-500">
              Owner view for kitchen state, delivery handoff and action alerts.
            </p>
          </div>
          <Link
            href="/operations"
            className="inline-flex h-10 w-fit items-center gap-2 rounded-md border border-slate-200 bg-slate-950 px-4 text-sm font-black text-white shadow-sm hover:bg-slate-800"
          >
            Kitchen Ops
            <ExternalLink className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <CommandMetric
            label="Today's Orders"
            value={commandBoard.todayOrders}
            detail={`${commandBoard.closed} closed, ${formatCurrency(totalCollectedToday, 2)} collected`}
            icon={TimerReset}
            testId="today-orders-count"
          />
          <CommandMetric
            label="Kitchen Active"
            value={commandBoard.activeOrders}
            detail={`${commandBoard.open} new, ${commandBoard.preparing} preparing, ${commandBoard.ready} ready`}
            icon={Flame}
            testId="kitchen-active-count"
          />
          <CommandMetric
            label="Delivery Handoff"
            value={commandBoard.deliveryOpen}
            detail={`${commandBoard.deliveryUnassigned} unassigned, ${commandBoard.deliveryOut} on road`}
            icon={Truck}
            testId="delivery-handoff-count"
          />
          <CommandMetric
            label="Owner Alerts"
            value={commandBoard.ownerAlerts.length}
            detail={`${commandBoard.readyToClose} close-ready, ${commandBoard.paymentDue} payment due`}
            icon={AlertTriangle}
            testId="owner-alert-count"
          />
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[1.1fr_1.1fr_0.9fr]">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-black uppercase tracking-wide text-slate-700">Kitchen State</h3>
              <span className="text-xs font-bold text-slate-500">{formatCurrency(commandBoard.activeValue, 2)} active value</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatePill label="New" value={commandBoard.open} tone="orange" testId="kitchen-state-new" />
              <StatePill label="Preparing" value={commandBoard.preparing} tone="sky" testId="kitchen-state-preparing" />
              <StatePill label="Ready" value={commandBoard.ready} tone="emerald" testId="kitchen-state-ready" />
              <StatePill label="Close" value={commandBoard.readyToClose} tone="amber" testId="kitchen-state-close" />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-black uppercase tracking-wide text-slate-700">Delivery State</h3>
              <span className="text-xs font-bold text-slate-500">{commandBoard.deliveryOpen} open handoff</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <StatePill label="Unassigned" value={commandBoard.deliveryUnassigned} tone="orange" testId="delivery-state-unassigned" />
              <StatePill label="Assigned" value={commandBoard.deliveryAssigned} tone="sky" testId="delivery-state-assigned" />
              <StatePill label="On Road" value={commandBoard.deliveryOut} tone="emerald" testId="delivery-state-out" />
              <StatePill label="Address" value={commandBoard.deliveryAddressReview} tone="red" testId="delivery-state-address" />
              <StatePill label="Payment" value={commandBoard.deliveryPaymentDue} tone="amber" testId="delivery-state-payment" />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-700">Owner Alerts</h3>
            <ul data-testid="owner-alert-list" className="mt-3 space-y-2">
              {commandBoard.ownerAlerts.slice(0, 4).map((alert) => (
                <OwnerAlertRow key={`${alert.title}-${alert.detail}`} alert={alert} />
              ))}
            </ul>
          </div>
        </div>
      </section>

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
