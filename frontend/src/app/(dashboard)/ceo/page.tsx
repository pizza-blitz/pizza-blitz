"use client";

import { useEffect, useState } from "react";
import { 
  TrendingUp, TrendingDown, Target, Zap, 
  MessageSquare, LayoutDashboard, Share2, 
  CheckCircle2, AlertCircle, Info, Calendar
} from "lucide-react";
import { 
  LineChart, Line, AreaChart, Area, XAxis, YAxis, 
  CartesianGrid, Tooltip, ResponsiveContainer, 
  BarChart, Bar, Cell 
} from "recharts";
import { getApiUrl } from "@/lib/api";

const API_BASE = getApiUrl("/api/v1/restaurant/stats");

async function fetchJson(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}.`);
  }
  return response.json();
}

function formatNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString("en-IN") : "0";
}

export default function CEODashboard() {
  const [health, setHealth] = useState<any>(null);
  const [target, setTarget] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    async function fetchData(signal: AbortSignal) {
      try {
        const [healthData, targetData, summaryData] = await Promise.all([
          fetchJson(`${API_BASE}/insights/health-score`, signal),
          fetchJson(`${API_BASE}/target/status`, signal),
          fetchJson(`${API_BASE}/ceo-summary`, signal)
        ]);
        setHealth(healthData);
        setTarget(targetData);
        setSummary(summaryData);
      } catch (e) {
        if (signal.aborted) return;
        console.warn("CEO dashboard data is temporarily unavailable", e);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }
    fetchData(controller.signal);
    return () => controller.abort();
  }, []);

  const shareWeeklyPulse = async () => {
    try {
      const data = await fetchJson(`${API_BASE}/weekly-summary/whatsapp`);
      if (!data.whatsapp_url) throw new Error("Weekly pulse link is unavailable.");
      window.open(data.whatsapp_url, '_blank');
    } catch (e) {
      alert("Weekly pulse is temporarily unavailable.");
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-[#0a0a0b]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-orange-500/20 border-t-orange-500 rounded-full animate-spin"></div>
        <p className="text-gray-400 font-medium animate-pulse">Pizza Blitz CEO Node Connecting...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-white p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-500 bg-clip-text text-transparent">
            CEO Intelligence Hub
          </h1>
          <p className="text-gray-400 mt-1 flex items-center gap-2">
            <Calendar className="w-4 h-4" /> Reporting Period: {summary?.period || "Loading..."}
          </p>
        </div>
        <button 
          onClick={shareWeeklyPulse}
          className="group flex items-center gap-2 px-6 py-3 bg-white text-black font-semibold rounded-2xl hover:bg-orange-500 transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.1)] active:scale-95"
        >
          <Share2 className="w-5 h-5 group-hover:rotate-12 transition-transform" />
          One-Click Weekly Pulse
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Health Score & Recommendation */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-[#1a1a1c] to-[#0a0a0b] p-8 border border-white/5 shadow-2xl">
            <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/10 blur-[60px] rounded-full -mr-16 -mt-16"></div>
            
            <div className="flex justify-between items-center mb-6">
              <span className="text-xs font-bold tracking-widest text-gray-500 uppercase">Operational Health</span>
              <Zap className="w-5 h-5 text-orange-500" />
            </div>

            <div className="flex flex-col items-center gap-2 mb-8">
              <span className="text-8xl font-black bg-gradient-to-b from-white to-gray-600 bg-clip-text text-transparent">
                {health?.health_score || 0}
              </span>
              <div className={`px-4 py-1 rounded-full text-xs font-bold uppercase tracking-tighter border ${
                health?.color === 'green' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                health?.color === 'yellow' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
                'bg-red-500/10 text-red-400 border-red-500/20'
              }`}>
                {health?.grade || "Analyzing"} Performance
              </div>
            </div>

            <div className="space-y-4">
              {health?.breakdown && Object.entries(health.breakdown).map(([key, val]: [any, any]) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>{val.label}</span>
                    <span className="text-white font-mono">{val.value}%</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-1000 ${
                        val.score > 20 ? 'bg-green-500' : val.score > 12 ? 'bg-orange-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${(val.score/25)*100}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2.5rem] bg-[#1a1a1c] p-6 border border-white/5">
            <h3 className="flex items-center gap-2 text-sm font-bold text-gray-400 mb-4 uppercase tracking-widest">
              <Zap className="w-4 h-4 text-orange-500" /> Executive Note
            </h3>
            <p className="text-lg leading-relaxed text-gray-100 italic">
              "{health?.recommendation || "System processing data. Please wait."}"
            </p>
          </div>
        </div>

        {/* Center Column: Targets & Trends */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Target Card */}
            <div className="rounded-[2.5rem] bg-gradient-to-br from-[#1a1a1c] to-[#121214] p-8 border border-white/5">
              <div className="flex justify-between items-center mb-6">
                <Target className="w-6 h-6 text-orange-500" />
                <span className="text-sm font-bold text-gray-500 uppercase">Monthly Target</span>
              </div>
              <div className="flex items-end gap-2 mb-2">
                <span className="text-4xl font-bold">Rs {formatNumber(target?.revenue_so_far)}</span>
                <span className="text-gray-500 mb-1.5">/ Rs {formatNumber(target?.monthly_target)}</span>
              </div>
              <div className="text-xs text-orange-400 font-medium mb-6">
                {target?.status_message}
              </div>
              
              <div className="relative h-4 bg-white/5 rounded-full overflow-hidden mb-2">
                <div 
                  className="h-full bg-orange-500 rounded-full transition-all duration-1000 shadow-[0_0_15px_rgba(249,115,22,0.5)]"
                  style={{ width: `${Math.min(100, target?.target_achieved_pct || 0)}%` }}
                ></div>
              </div>
              <div className="flex justify-between text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                <span>{target?.target_achieved_pct || 0}% Complete</span>
                <span>{target?.days_remaining || 0} Days Left</span>
              </div>
            </div>

            {/* AI Projection Card */}
            <div className="rounded-[2.5rem] bg-[#1a1a1c] p-8 border border-white/5">
              <div className="flex justify-between items-center mb-6">
                <LayoutDashboard className="w-6 h-6 text-blue-400" />
                <span className="text-sm font-bold text-gray-500 uppercase">Projections</span>
              </div>
              <p className="text-xs text-gray-500 mb-2">Projected Month End Revenue</p>
              <div className="text-4xl font-bold mb-4">
                Rs {formatNumber(target?.projected_month_total)}
              </div>
              <div className={`flex items-center gap-1.5 text-sm font-bold ${target?.on_track ? 'text-green-400' : 'text-red-400'}`}>
                {target?.on_track ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {target?.on_track ? 'ON TRACK TO SMASH' : 'BELOW FORECAST'}
              </div>
            </div>
          </div>

          {/* Weekly Pulse Table */}
          <div className="rounded-[2.5rem] bg-[#1a1a1c] border border-white/5 overflow-hidden">
            <div className="p-8 border-b border-white/5 flex justify-between items-center bg-[#1e1e21]">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Zap className="w-5 h-5 text-orange-500" /> This Week's Operational Health
              </h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-white/5">
              <div className="p-8 flex flex-col gap-2">
                <span className="text-xs text-gray-500 uppercase font-bold tracking-widest">Revenue</span>
                <span className="text-2xl font-bold">Rs {formatNumber(summary?.this_week_revenue)}</span>
                <span className={`text-xs font-bold ${summary?.direction === 'up' ? 'text-green-400' : 'text-red-400'}`}>
                  {summary?.direction === 'up' ? '+' : ''}{summary?.week_on_week_change}% WoW
                </span>
              </div>
              <div className="p-8 flex flex-col gap-2">
                <span className="text-xs text-gray-500 uppercase font-bold tracking-widest">Profit Margin</span>
                <span className="text-2xl font-bold">{summary?.profit_margin || 0}%</span>
                <span className="text-xs text-gray-500 font-medium tracking-tight">Net post-operations</span>
              </div>
              <div className="p-8 flex flex-col gap-2">
                <span className="text-xs text-gray-500 uppercase font-bold tracking-widest">Best Performer</span>
                <span className="text-lg font-bold overflow-hidden text-ellipsis whitespace-nowrap">
                  {summary?.best_day?.date || "N/A"}
                </span>
                <span className="text-xs text-green-400 font-bold tracking-tight">Rs {formatNumber(summary?.best_day?.revenue)}</span>
              </div>
              <div className="p-8 flex flex-col gap-2">
                <span className="text-xs text-gray-500 uppercase font-bold tracking-widest">Urgent Review</span>
                <span className="text-lg font-bold overflow-hidden text-ellipsis whitespace-nowrap">
                  {summary?.worst_day?.date || "N/A"}
                </span>
                <span className="text-xs text-red-400 font-bold tracking-tight">Rs {formatNumber(summary?.worst_day?.revenue)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
