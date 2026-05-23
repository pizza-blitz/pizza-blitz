"use client";
import React, { useState, useEffect } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Calendar, CreditCard, Download, Share2, IndianRupee, TrendingUp, TrendingDown, FileText, Loader2, Mail, Megaphone, MessageCircle, Phone, ShoppingBag, Tag, Target, Users } from 'lucide-react';
import { getApiUrl } from '@/lib/api';

const Award = ({className}: {className?: string}) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/></svg>
);

export default function Reports() {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reportError, setReportError] = useState("");
  const [period, setPeriod] = useState("30days");
  const [selectedMarketingCampaignId, setSelectedMarketingCampaignId] = useState<number | null>(null);

  useEffect(() => {
    fetchReports();
  }, [period]);

  const fetchReports = async () => {
    setIsLoading(true);
    setReportError("");
    try {
      const comparisonPeriod = period === "lifetime" ? "1year" : period;
      const fetchJson = async (endpoint: string) => {
        const response = await fetch(getApiUrl(endpoint), {
          cache: "no-store",
          credentials: "include",
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.detail || `Report request failed: ${endpoint}`);
        }
        return payload;
      };
      const [statsRes, salesRes, forecastRes, trendRes, comparisonRes, marketingRes, orderChannelRes, customerSegmentRes] = await Promise.all([
        fetchJson(`/api/v1/restaurant/stats/dashboard-stats?period=${period}`),
        fetchJson('/api/v1/restaurant/sales/'),
        fetchJson('/api/v1/restaurant/stats/insights/monthly-forecast'),
        fetchJson('/api/v1/restaurant/stats/insights/profit-trend?months=12'),
        fetchJson(`/api/v1/restaurant/stats/compare/performance-dashboard?period=${comparisonPeriod}`),
        fetchJson('/api/v1/restaurant/promotions/performance?limit=25'),
        fetchJson(`/api/v1/restaurant/stats/compare/order-channel-dashboard?period=${comparisonPeriod}`),
        fetchJson('/api/v1/restaurant/customers/segments/report')
      ]);

      setData({
        summary: statsRes.metrics,
        records: Array.isArray(salesRes) ? [...salesRes].reverse().slice(0, 10) : [],
        forecast: forecastRes,
        trends: trendRes.trend || [],
        comparison: comparisonRes,
        marketing: marketingRes,
        orderChannels: orderChannelRes,
        customerSegments: customerSegmentRes
      });
    } catch (err) { 
      console.error(err);
      setData(null);
      setReportError(err instanceof Error ? err.message : "Reports could not be loaded.");
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

  const formatMoney = (value: number) => `Rs ${Math.round(Number(value || 0)).toLocaleString()}`;

  const segmentChannelLabel = (value: string) => {
    if (value === "whatsapp") return "WhatsApp";
    if (value === "email") return "Email";
    if (value === "sms") return "SMS";
    return "Cleanup";
  };

  const percentChange = (current: number, baseline: number) => {
    const currentValue = Number(current || 0);
    const baselineValue = Number(baseline || 0);
    if (baselineValue === 0) return 0;
    return Math.round(((currentValue - baselineValue) / baselineValue) * 1000) / 10;
  };

  const formatPercent = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

  const comparison = data?.comparison;
  const marketing = data?.marketing;
  const orderChannels = data?.orderChannels;
  const customerSegments = data?.customerSegments;
  const orderChannelRows = orderChannels?.channel_mix || [];
  const paymentRows = orderChannels?.payment_mix || [];
  const paymentStatusRows = orderChannels?.payment_status_mix || [];
  const fulfillmentStatusRows = orderChannels?.fulfillment_status_mix || [];
  const campaignRows = marketing?.campaigns || [];
  const marketingRows = campaignRows.slice(0, 6);
  const marketingLeader = marketing?.best_campaign || campaignRows[0] || null;
  const marketingRevenue = Number(marketing?.summary?.redemption_revenue || 0);
  const marketingDiscount = Number(marketing?.summary?.redemption_discount || 0);
  const marketingNetValue = Math.max(marketingRevenue - marketingDiscount, 0);
  const marketingReadyReach = campaignRows.reduce(
    (total: number, row: any) => total + Number(row.outreach?.sent_count || 0) + Number(row.outreach?.dry_run_count || 0),
    0
  );
  const marketingAttentionCount = campaignRows.reduce(
    (total: number, row: any) => total + Number(row.outreach?.needs_attention_count || 0),
    0
  );
  const marketingConversionRate = marketingReadyReach
    ? Math.round((Number(marketing?.summary?.redemption_orders || 0) / marketingReadyReach) * 1000) / 10
    : 0;
  const marketingChannelMix = ["email", "whatsapp", "sms"].map((channel) => {
    const rows = campaignRows.filter((row: any) => row.promotion_detail?.channel === channel);
    const revenue = rows.reduce((total: number, row: any) => total + Number(row.redemptions?.revenue || 0), 0);
    const readyReach = rows.reduce(
      (total: number, row: any) => total + Number(row.outreach?.sent_count || 0) + Number(row.outreach?.dry_run_count || 0),
      0
    );
    return {
      channel,
      count: rows.length,
      revenue,
      readyReach,
      share: marketingRevenue ? Math.round((revenue / marketingRevenue) * 1000) / 10 : 0,
    };
  });
  const marketingDecisionRows = campaignRows.slice(0, 5).map((row: any) => {
    const readyReach = Number(row.outreach?.sent_count || 0) + Number(row.outreach?.dry_run_count || 0);
    const netValue = Math.max(Number(row.redemptions?.revenue || 0) - Number(row.redemptions?.discount || 0), 0);
    const conversionRate = Number(row.outreach?.conversion_rate_percent || 0);
    let action = "Keep warming";
    if (netValue > 0 && conversionRate >= 1) action = "Scale next offer";
    else if (Number(row.outreach?.needs_attention_count || 0) > 0) action = "Clean audience";
    else if (Number(row.ads?.planned_budget || 0) > 0 && netValue === 0) action = "Review ad handoff";
    return { ...row, readyReach, netValue, conversionRate, action };
  });
  const selectedMarketingCampaign =
    campaignRows.find((row: any) => Number(row.promotion_detail?.id) === Number(selectedMarketingCampaignId)) ||
    marketingLeader;
  const selectedMarketingReadyReach = selectedMarketingCampaign
    ? Number(selectedMarketingCampaign.outreach?.sent_count || 0) + Number(selectedMarketingCampaign.outreach?.dry_run_count || 0)
    : 0;
  const selectedMarketingNetValue = selectedMarketingCampaign
    ? Math.max(
        Number(selectedMarketingCampaign.redemptions?.revenue || 0) -
          Number(selectedMarketingCampaign.redemptions?.discount || 0),
        0
      )
    : 0;
  const customerSegmentRows = customerSegments?.segments ? customerSegments.segments.slice(0, 6) : [];
  const segmentLeader = customerSegments?.top_segment || customerSegmentRows[0] || null;
  const valueLeader = customerSegments?.strongest_value_segment || segmentLeader;
  const cleanupLeader = customerSegments?.largest_cleanup_segment || segmentLeader;
  const weekdayRows = comparison?.weekday_breakdown
    ? [...comparison.weekday_breakdown].sort((a: any, b: any) => Number(b.current_sale || 0) - Number(a.current_sale || 0))
    : [];
  const varianceRows = comparison?.daily_comparison
    ? comparison.daily_comparison.slice(-7).map((row: any) => ({
        ...row,
        previousChange: percentChange(row.current_sale, row.previous_sale),
        yoyChange: percentChange(row.current_sale, row.last_year_sale),
      }))
    : [];

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
      ) : reportError ? (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-6 text-yellow-900">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="text-lg font-black">Reports need attention</h2>
          </div>
          <p className="text-sm font-semibold leading-6">
            {reportError}
          </p>
          <button
            onClick={fetchReports}
            className="mt-5 rounded-md bg-yellow-900 px-4 py-2 text-sm font-black uppercase tracking-widest text-white"
          >
            Retry Reports
          </button>
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

          {orderChannels && (
            <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Order Channel Comparison</p>
                  <h2 className="mt-1 text-xl font-black text-gray-950">Counter, Website, Pickup, and Delivery Performance</h2>
                </div>
                <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-black uppercase tracking-widest text-gray-500">
                  {orderChannels.period.current_start} to {orderChannels.period.current_end}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MarketingMetric
                  icon={ShoppingBag}
                  label="Current Orders"
                  value={`${orderChannels.current.orders || 0}`}
                />
                <MarketingMetric
                  icon={IndianRupee}
                  label="Order Revenue"
                  value={formatMoney(orderChannels.current.revenue)}
                />
                <MarketingMetric
                  icon={CreditCard}
                  label="Average Order"
                  value={formatMoney(orderChannels.current.average_order_value)}
                />
                <MarketingMetric
                  icon={AlertTriangle}
                  label="Unsettled Orders"
                  value={`${orderChannels.summary.unsettled_orders || 0}`}
                />
              </div>

              <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.15fr_0.85fr]">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Channel Revenue Mix</p>
                      <p className="mt-1 text-sm font-bold text-gray-500">Revenue share with previous-period and YoY movement.</p>
                    </div>
                    <BarChart3 className="h-5 w-5 text-orange-600" />
                  </div>
                  <div className="space-y-3">
                    {orderChannelRows.length ? (
                      orderChannelRows.map((row: any) => {
                        const positive = Number(row.yoy_change_percent || 0) >= 0;
                        return (
                          <div key={`channel-${row.key}`} className="rounded-lg border border-gray-200 bg-white p-4">
                            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-black text-gray-950">{row.label}</p>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                                  {row.current.orders || 0} orders | {formatMoney(row.current.average_order_value)} avg
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-black text-gray-950">{formatMoney(row.current.revenue)}</p>
                                <p className={`text-[10px] font-black ${positive ? "text-green-700" : "text-red-700"}`}>
                                  {formatPercent(Number(row.yoy_change_percent || 0))} YoY
                                </p>
                              </div>
                            </div>
                            <div className="h-2 rounded-full bg-gray-100">
                              <div className="h-2 rounded-full bg-orange-600" style={{ width: `${Math.min(100, Math.max(0, Number(row.current_share_percent || 0)))}%` }} />
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest">
                              <span className="rounded-md bg-gray-100 px-2 py-1 text-gray-600">Share {Number(row.current_share_percent || 0).toFixed(1)}%</span>
                              <span className="rounded-md bg-blue-50 px-2 py-1 text-blue-700">Prev {formatPercent(Number(row.previous_change_percent || 0))}</span>
                              <span className={positive ? "rounded-md bg-green-50 px-2 py-1 text-green-700" : "rounded-md bg-red-50 px-2 py-1 text-red-700"}>
                                YoY {formatPercent(Number(row.yoy_change_percent || 0))}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm font-bold text-gray-400">
                        Channel comparison will populate after orders are captured.
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Payment Method Mix</p>
                        <h3 className="mt-1 text-lg font-black text-gray-950">Tender Performance</h3>
                      </div>
                      <CreditCard className="h-5 w-5 text-orange-600" />
                    </div>
                    <div className="space-y-3">
                      {paymentRows.length ? (
                        paymentRows.map((row: any) => (
                          <div key={`payment-${row.key}`} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 p-3">
                            <div>
                              <p className="text-sm font-black text-gray-950">{row.label}</p>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                                {row.current.orders || 0} orders | Share {Number(row.current_share_percent || 0).toFixed(1)}%
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-black text-gray-950">{formatMoney(row.current.revenue)}</p>
                              <p className="text-[10px] font-black text-gray-500">{formatPercent(Number(row.previous_change_percent || 0))} prev</p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm font-bold text-gray-400">No payment method split yet.</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                    <StatusMix title="Payment Status" rows={paymentStatusRows} formatMoney={formatMoney} />
                    <StatusMix title="Fulfillment Status" rows={fulfillmentStatusRows} formatMoney={formatMoney} />
                  </div>

                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-700" />
                      <p className="text-[10px] font-black uppercase tracking-widest text-amber-900">Operating Insights</p>
                    </div>
                    <div className="space-y-2">
                      {(orderChannels.insights || []).map((insight: string) => (
                        <p key={insight} className="rounded-md bg-white px-3 py-2 text-sm font-bold text-amber-900">
                          {insight}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {customerSegments && (
            <section data-testid="customer-segment-intelligence" className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Customer Segment Intelligence</p>
                  <h2 className="mt-1 text-xl font-black text-gray-950">Who to target next</h2>
                </div>
                <a
                  href="/customers"
                  className="inline-flex items-center rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-black uppercase tracking-widest text-gray-600 hover:bg-orange-50 hover:text-orange-700"
                >
                  <Users className="mr-2 h-4 w-4" />
                  Open Customers
                </a>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                <MarketingMetric
                  icon={Users}
                  label="Customers"
                  value={`${customerSegments.summary.total_customers || 0}`}
                />
                <MarketingMetric
                  icon={MessageCircle}
                  label="Reachable"
                  value={`${customerSegments.summary.reachable_customers || 0}`}
                />
                <MarketingMetric
                  icon={TrendingUp}
                  label="Recorded Spend"
                  value={formatMoney(customerSegments.summary.total_spend)}
                />
                <MarketingMetric
                  icon={Mail}
                  label="Email Gaps"
                  value={`${customerSegments.summary.email_gap_customers || 0}`}
                />
                <MarketingMetric
                  icon={Phone}
                  label="Phone Gaps"
                  value={`${customerSegments.summary.phone_gap_customers || 0}`}
                />
              </div>

              <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[0.86fr_1.14fr]">
                <div className="rounded-lg border border-green-200 bg-green-50 p-5">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-green-700">Best Next Segment</p>
                      <h3 className="mt-1 text-xl font-black text-gray-950">{segmentLeader?.label || "No segment yet"}</h3>
                    </div>
                    <Target className="h-6 w-6 text-green-700" />
                  </div>
                  {segmentLeader ? (
                    <>
                      <p className="text-sm font-bold leading-6 text-green-900">{segmentLeader.intent}</p>
                      <div className="mt-4 grid grid-cols-1 gap-3 2xl:grid-cols-2">
                        <MarketingCommandMetric label="Spend" value={formatMoney(segmentLeader.total_spend)} />
                        <MarketingCommandMetric label="Readiness" value={`${Number(segmentLeader.readiness_percent || 0).toFixed(1)}%`} />
                        <MarketingCommandMetric label="Reachable" value={`${segmentLeader.reachable_count || 0}`} />
                        <MarketingCommandMetric label="Channel" value={segmentChannelLabel(segmentLeader.recommended_channel)} />
                      </div>
                      <div className="mt-4 rounded-lg bg-white p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Recommended Action</p>
                        <p className="mt-1 text-sm font-black leading-6 text-gray-950">{segmentLeader.recommended_action}</p>
                      </div>
                      <a
                        href={segmentLeader.customer_list_url}
                        className="mt-4 inline-flex items-center rounded-md bg-gray-950 px-4 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600"
                      >
                        <Users className="mr-2 h-4 w-4" />
                        Open Segment Queue
                      </a>
                    </>
                  ) : (
                    <p className="rounded-lg border border-dashed border-green-200 bg-white p-5 text-sm font-bold text-green-900">
                      Customer segment reporting will appear after customers are captured.
                    </p>
                  )}
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-5">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">Segment Ranking</p>
                      <h3 className="mt-1 text-xl font-black text-gray-950">Value, reach, and cleanup priority</h3>
                    </div>
                    <span className="rounded-md bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-gray-600">
                      {customerSegments.summary.readiness_percent.toFixed(1)}% ready
                    </span>
                  </div>

                  <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <SegmentFocusCard
                      title="Value Leader"
                      label={valueLeader?.label || "No segment"}
                      value={valueLeader ? formatMoney(valueLeader.total_spend) : "Rs 0"}
                      detail={valueLeader ? `${valueLeader.revenue_share_percent.toFixed(1)}% of recorded spend` : "Awaiting customer spend"}
                    />
                    <SegmentFocusCard
                      title="Cleanup Leader"
                      label={cleanupLeader?.label || "No segment"}
                      value={cleanupLeader ? `${Number(cleanupLeader.email_gap_count || 0) + Number(cleanupLeader.phone_gap_count || 0)} gaps` : "0 gaps"}
                      detail={cleanupLeader ? cleanupLeader.recommended_action : "No cleanup action yet"}
                    />
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                    <table className="w-full min-w-[760px] text-left">
                      <thead className="bg-gray-950 text-white">
                        <tr>
                          <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">Segment</th>
                          <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Spend</th>
                          <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Reach</th>
                          <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Ready</th>
                          <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Channel</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {customerSegmentRows.length ? (
                          customerSegmentRows.map((row: any) => (
                            <tr key={`segment-${row.segment}`} className="hover:bg-orange-50/50">
                              <td className="px-4 py-3">
                                <p className="text-sm font-black text-gray-950">{row.label}</p>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                                  {row.customer_count} customers | {row.order_count} orders
                                </p>
                              </td>
                              <td className="px-4 py-3 text-right text-sm font-black text-green-700">{formatMoney(row.total_spend)}</td>
                              <td className="px-4 py-3 text-right text-sm font-black text-gray-950">{row.reachable_count}</td>
                              <td className="px-4 py-3 text-right">
                                <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-black text-gray-700">
                                  {Number(row.readiness_percent || 0).toFixed(1)}%
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right text-xs font-black uppercase tracking-widest text-gray-600">{row.recommended_channel}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} className="px-4 py-10 text-center text-sm font-bold text-gray-400">
                              Customer segment intelligence will populate after orders create customers.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </section>
          )}

          {marketing && (
            <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Marketing Attribution</p>
                  <h2 className="mt-1 text-xl font-black text-gray-950">Campaign Revenue Scoreboard</h2>
                </div>
                <a
                  href="/promotions"
                  className="inline-flex items-center rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-black uppercase tracking-widest text-gray-600 hover:bg-orange-50 hover:text-orange-700"
                >
                  <Megaphone className="mr-2 h-4 w-4" />
                  Open Promotions
                </a>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                <MarketingMetric
                  icon={IndianRupee}
                  label="Coupon Revenue"
                  value={formatMoney(marketing.summary.redemption_revenue)}
                />
                <MarketingMetric
                  icon={Tag}
                  label="Coupon Orders"
                  value={`${marketing.summary.redemption_orders || 0}`}
                />
                <MarketingMetric
                  icon={TrendingDown}
                  label="Discount Given"
                  value={formatMoney(marketing.summary.redemption_discount)}
                />
                <MarketingMetric
                  icon={Share2}
                  label="Social Drafts"
                  value={`${marketing.summary.social_post_count || 0}`}
                />
                <MarketingMetric
                  icon={Target}
                  label="Ad Budget"
                  value={formatMoney(marketing.summary.planned_ad_budget)}
                />
              </div>

              <div data-testid="marketing-roi-command" className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                <div className="rounded-lg border border-orange-200 bg-orange-50 p-5">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-700">Marketing ROI Command</p>
                      <h3 className="mt-1 text-xl font-black text-gray-950">Best campaign to repeat</h3>
                    </div>
                    <Award className="h-6 w-6 text-orange-700" />
                  </div>
                  {marketingLeader ? (
                    <div>
                      <p className="text-2xl font-black leading-tight text-gray-950">{marketingLeader.promotion_detail.name}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest">
                        <span className="rounded-md bg-white px-2 py-1 text-orange-700">{marketingLeader.promotion_detail.code || "No code"}</span>
                        <span className="rounded-md bg-white px-2 py-1 text-gray-600">{marketingLeader.promotion_detail.channel}</span>
                        <span className="rounded-md bg-white px-2 py-1 text-gray-600">{marketingLeader.campaign_window.phase}</span>
                      </div>
                      <div className="mt-5 grid grid-cols-2 gap-3">
                        <MarketingCommandMetric label="Net Value" value={formatMoney(Math.max(Number(marketingLeader.redemptions.revenue || 0) - Number(marketingLeader.redemptions.discount || 0), 0))} />
                        <MarketingCommandMetric label="Conversion" value={`${Number(marketingLeader.outreach.conversion_rate_percent || 0).toFixed(1)}%`} />
                        <MarketingCommandMetric label="Orders" value={`${marketingLeader.redemptions.count || 0}`} />
                        <MarketingCommandMetric label="Ready Reach" value={`${Number(marketingLeader.outreach.sent_count || 0) + Number(marketingLeader.outreach.dry_run_count || 0)}`} />
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-orange-200 bg-white p-5 text-sm font-bold text-orange-900">
                      Create a coupon campaign and attributed order to choose a repeatable winner.
                    </p>
                  )}
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-5">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">Comparison Signals</p>
                      <h3 className="mt-1 text-xl font-black text-gray-950">Which push deserves attention next</h3>
                    </div>
                    <span className="rounded-md bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-gray-600">
                      {campaignRows.length} campaigns
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    <MarketingCommandMetric label="Net Coupon Value" value={formatMoney(marketingNetValue)} />
                    <MarketingCommandMetric label="Ready Reach" value={`${marketingReadyReach}`} />
                    <MarketingCommandMetric label="Conversion" value={`${marketingConversionRate.toFixed(1)}%`} />
                    <MarketingCommandMetric label="Needs Cleanup" value={`${marketingAttentionCount}`} />
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-4 2xl:grid-cols-[0.82fr_1.18fr]">
                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                      <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-gray-500">Channel Mix</p>
                      <div className="space-y-3">
                        {marketingChannelMix.map((row) => (
                          <div key={row.channel}>
                            <div className="mb-1 flex items-center justify-between gap-3">
                              <p className="text-xs font-black uppercase tracking-widest text-gray-700">{row.channel}</p>
                              <p className="text-xs font-black text-gray-950">{formatMoney(row.revenue)}</p>
                            </div>
                            <div className="h-2 rounded-full bg-gray-100">
                              <div className="h-2 rounded-full bg-orange-600" style={{ width: `${Math.min(100, Math.max(0, row.share))}%` }} />
                            </div>
                            <div className="mt-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-gray-400">
                              <span>{row.count} campaigns</span>
                              <span>{row.readyReach} ready reach</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                      <table className="w-full min-w-[520px] text-left">
                        <thead className="bg-gray-950 text-white">
                          <tr>
                            <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">Next Push Ranking</th>
                            <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Net</th>
                            <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Conv.</th>
                            <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {marketingDecisionRows.length ? (
                            marketingDecisionRows.map((row: any) => (
                              <tr key={`decision-${row.promotion_detail.id}`} className="hover:bg-orange-50/50">
                                <td className="px-4 py-3">
                                  <p className="text-sm font-black text-gray-950">{row.promotion_detail.name}</p>
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                                    {row.readyReach} ready | {row.outreach.needs_attention_count || 0} cleanup
                                  </p>
                                </td>
                                <td className="px-4 py-3 text-right text-sm font-black text-green-700">{formatMoney(row.netValue)}</td>
                                <td className="px-4 py-3 text-right text-sm font-black text-gray-700">{row.conversionRate.toFixed(1)}%</td>
                                <td className="px-4 py-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedMarketingCampaignId(row.promotion_detail.id)}
                                    className="rounded-md bg-gray-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-gray-700 hover:bg-orange-100 hover:text-orange-700"
                                  >
                                    {row.action}
                                  </button>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={4} className="px-4 py-8 text-center text-sm font-bold text-gray-400">
                                Campaign ranking will appear after marketing activity is recorded.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>

              {selectedMarketingCampaign && (
                <div data-testid="campaign-drilldown-export" className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-5">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">Campaign Drill-Down Export</p>
                      <h3 className="mt-1 text-xl font-black text-gray-950">{selectedMarketingCampaign.promotion_detail.name}</h3>
                      <p className="mt-1 text-sm font-bold text-gray-500">
                        {selectedMarketingCampaign.promotion_detail.code || "No code"} | {selectedMarketingCampaign.promotion_detail.channel} | {selectedMarketingCampaign.campaign_window.phase}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={getApiUrl(`/api/v1/restaurant/promotions/performance/${selectedMarketingCampaign.promotion_detail.id}/export.csv`)}
                        className="inline-flex items-center rounded-md bg-gray-950 px-4 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600"
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Export CSV
                      </a>
                      <a
                        href={`/promotions?campaign=${selectedMarketingCampaign.promotion_detail.id}`}
                        className="inline-flex items-center rounded-md border border-gray-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-widest text-gray-700 hover:bg-orange-50 hover:text-orange-700"
                      >
                        <Megaphone className="mr-2 h-4 w-4" />
                        Open Campaign
                      </a>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
                    <MarketingCommandMetric label="Net Coupon Value" value={formatMoney(selectedMarketingNetValue)} />
                    <MarketingCommandMetric label="Revenue" value={formatMoney(selectedMarketingCampaign.redemptions.revenue)} />
                    <MarketingCommandMetric label="Discount" value={formatMoney(selectedMarketingCampaign.redemptions.discount)} />
                    <MarketingCommandMetric label="Orders" value={`${selectedMarketingCampaign.redemptions.count || 0}`} />
                    <MarketingCommandMetric label="Ready Reach" value={`${selectedMarketingReadyReach}`} />
                    <MarketingCommandMetric label="Conversion" value={`${Number(selectedMarketingCampaign.outreach.conversion_rate_percent || 0).toFixed(1)}%`} />
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
                    <DrilldownList
                      title="Outreach Readiness"
                      rows={[
                        ["Sent", selectedMarketingCampaign.outreach.sent_count],
                        ["Dry Run Ready", selectedMarketingCampaign.outreach.dry_run_count],
                        ["Needs Attention", selectedMarketingCampaign.outreach.needs_attention_count],
                        ["Failed", selectedMarketingCampaign.outreach.failed_count],
                      ]}
                    />
                    <DrilldownList
                      title="Handoffs"
                      rows={[
                        ["Social Posts", selectedMarketingCampaign.social.post_count],
                        ["Ready Social", selectedMarketingCampaign.social.ready_count],
                        ["Ad Campaigns", selectedMarketingCampaign.ads.campaign_count],
                        ["Ad Launches", selectedMarketingCampaign.ads.launch_count],
                      ]}
                    />
                    <DrilldownList
                      title="Ad Economics"
                      rows={[
                        ["Planned Budget", formatMoney(selectedMarketingCampaign.ads.planned_budget)],
                        ["Reported Spend", formatMoney(selectedMarketingCampaign.ads.spend)],
                        ["Reported Revenue", formatMoney(selectedMarketingCampaign.ads.reported_revenue)],
                        ["ROAS", `${Number(selectedMarketingCampaign.ads.roas || 0).toFixed(2)}x`],
                      ]}
                    />
                  </div>
                </div>
              )}

              <div className="mt-5 overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full min-w-[860px] text-left">
                  <thead className="bg-gray-950 text-white">
                    <tr>
                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">Campaign</th>
                      <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Revenue</th>
                      <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Orders</th>
                      <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Discount</th>
                      <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Avg Order</th>
                      <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Social</th>
                      <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Ad Budget</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {marketingRows.length ? (
                      marketingRows.map((row: any) => (
                        <tr key={row.promotion_detail.id} className="hover:bg-orange-50/50">
                          <td className="px-4 py-3">
                            <p className="text-sm font-black text-gray-950">{row.promotion_detail.name}</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                              {row.promotion_detail.code || "No code"} | {row.campaign_window.phase}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-black text-green-700">
                            {formatMoney(row.redemptions.revenue)}
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-black text-gray-950">
                            {row.redemptions.count}
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-red-600">
                            {formatMoney(row.redemptions.discount)}
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-gray-700">
                            {formatMoney(row.redemptions.average_order_value)}
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-gray-700">
                            {row.social.post_count}
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-gray-700">
                            {formatMoney(row.ads.planned_budget)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-sm font-bold text-gray-400">
                          No coupon campaign attribution is available yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {comparison && (
            <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.75fr_1.25fr]">
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Weekday Mix</p>
                    <h2 className="mt-1 text-xl font-black text-gray-950">Strongest Sales Days</h2>
                  </div>
                  <BarChart3 className="h-5 w-5 text-orange-600" />
                </div>
                <div className="space-y-3">
                  {weekdayRows.map((row: any, index: number) => {
                    const maxSale = Number(weekdayRows[0]?.current_sale || 0);
                    const width = maxSale > 0 ? Math.max(8, (Number(row.current_sale || 0) / maxSale) * 100) : 0;
                    const yoyPositive = Number(row.yoy_change_percent || 0) >= 0;
                    return (
                      <div key={row.weekday} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-black text-gray-950">{index + 1}. {row.weekday}</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{row.days} comparison days</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-black text-gray-950">Rs {Number(row.current_sale || 0).toLocaleString()}</p>
                            <p className={`text-[10px] font-black ${yoyPositive ? "text-green-700" : "text-red-700"}`}>
                              {formatPercent(Number(row.yoy_change_percent || 0))} YoY
                            </p>
                          </div>
                        </div>
                        <div className="h-2 rounded-full bg-white">
                          <div className="h-2 rounded-full bg-orange-600" style={{ width: `${width}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Same-Day Variance</p>
                    <h2 className="mt-1 text-xl font-black text-gray-950">Last 7 Operating Days</h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-md bg-green-50 px-3 py-2 text-xs font-black text-green-700">
                      Best: {comparison.best_day?.label || "No data"}
                    </span>
                    <span className="rounded-md bg-red-50 px-3 py-2 text-xs font-black text-red-700">
                      Soft: {comparison.slowest_day?.label || "No data"}
                    </span>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full min-w-[760px] text-left">
                    <thead className="bg-gray-950 text-white">
                      <tr>
                        <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">Date</th>
                        <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Current</th>
                        <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Vs Previous</th>
                        <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Vs Last Year</th>
                        <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest">Profit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {varianceRows.map((row: any) => {
                        const previousPositive = Number(row.previousChange || 0) >= 0;
                        const yoyPositive = Number(row.yoyChange || 0) >= 0;
                        return (
                          <tr key={`variance-${row.date}`} className="hover:bg-orange-50/50">
                            <td className="px-4 py-3">
                              <p className="text-sm font-black text-gray-900">{row.label}</p>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{row.weekday}</p>
                            </td>
                            <td className="px-4 py-3 text-right text-sm font-black text-gray-950">Rs {Number(row.current_sale || 0).toLocaleString()}</td>
                            <td className="px-4 py-3 text-right">
                              <span className={`rounded-md px-2 py-1 text-xs font-black ${previousPositive ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                                {formatPercent(Number(row.previousChange || 0))}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className={`rounded-md px-2 py-1 text-xs font-black ${yoyPositive ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                                {formatPercent(Number(row.yoyChange || 0))}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right text-sm font-black text-green-700">Rs {Number(row.current_profit || 0).toLocaleString()}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
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

function MarketingMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-orange-100 text-orange-700">
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-2 text-xl font-black text-gray-950">{value}</p>
    </div>
  );
}

function MarketingCommandMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-1 break-words text-lg font-black text-gray-950">{value}</p>
    </div>
  );
}

function SegmentFocusCard({
  title,
  label,
  value,
  detail,
}: {
  title: string;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{title}</p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-gray-950">{label}</p>
          <p className="mt-1 text-xs font-bold leading-5 text-gray-500">{detail}</p>
        </div>
        <p className="text-lg font-black text-gray-950">{value}</p>
      </div>
    </div>
  );
}

function DrilldownList({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string | number]>;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-gray-500">{title}</p>
      <div className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={`${title}-${label}`} className="flex items-center justify-between gap-3 rounded-md bg-gray-50 px-3 py-2">
            <span className="text-xs font-bold uppercase tracking-widest text-gray-500">{label}</span>
            <span className="text-sm font-black text-gray-950">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusMix({
  title,
  rows,
  formatMoney,
}: {
  title: string;
  rows: any[];
  formatMoney: (value: number) => string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-gray-500">{title}</p>
      <div className="space-y-2">
        {rows.length ? (
          rows.map((row: any) => (
            <div key={`${title}-${row.key}`} className="rounded-md bg-white px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-black text-gray-950">{row.label}</p>
                <p className="text-xs font-black text-gray-700">{row.current.orders || 0}</p>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                <span>{formatMoney(row.current.revenue)}</span>
                <span>{Number(row.current_share_percent || 0).toFixed(1)}%</span>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-md border border-dashed border-gray-300 bg-white px-3 py-4 text-center text-sm font-bold text-gray-400">No split yet.</p>
        )}
      </div>
    </div>
  );
}
