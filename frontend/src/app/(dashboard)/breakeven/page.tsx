"use client";

import { useState, useEffect } from "react";
import { AlertCircle, CheckCircle2, Loader2, PieChart, Settings } from "lucide-react";
import { getApiUrl } from "@/lib/api";

const API_BASE = getApiUrl("/api/v1/restaurant/stats/breakeven");

function formatNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString("en-IN") : "0";
}

function completionPercent(revenue: unknown, breakEvenRevenue: unknown) {
  const revenueValue = Number(revenue);
  const breakEvenValue = Number(breakEvenRevenue);
  if (!Number.isFinite(revenueValue) || !Number.isFinite(breakEvenValue) || breakEvenValue <= 0) return 0;
  return Math.min(100, Math.max(0, (revenueValue / breakEvenValue) * 100));
}

export default function BreakevenPage() {
  const [data, setData] = useState<any>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [isSavingSetup, setIsSavingSetup] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [setupData, setSetupData] = useState({
    month: new Date().toISOString().slice(0,7),
    rent: 55000,
    salaries: 120000,
    utilities: 15000,
    other_fixed: 5000,
    avg_order_value: 250
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    return () => controller.abort();
  }, []);

  const fetchData = async (signal?: AbortSignal) => {
    try {
      const res = await fetch(API_BASE, {
        credentials: "include",
        cache: "no-store",
        signal,
      });
      if (!res.ok) throw new Error(`Request failed with HTTP ${res.status}.`);
      setData(await res.json());
    } catch (error) {
      if (signal?.aborted) return;
      console.warn("Break-even data is temporarily unavailable", error);
      if (!data) {
        setMessage({ type: "error", text: "Break-even data could not be loaded right now." });
      }
    }
  };

  const saveSetup = async () => {
    if (isSavingSetup) return;
    if (!/^\d{4}-\d{2}$/.test(setupData.month)) {
      setMessage({ type: "error", text: "Select a valid month before saving fixed costs." });
      return;
    }
    if (setupData.avg_order_value <= 0) {
      setMessage({ type: "error", text: "Average order value must be greater than zero." });
      return;
    }

    setIsSavingSetup(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/setup?${new URLSearchParams(setupData as any)}`, {
        method: 'POST',
        credentials: "include",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || `Request failed with HTTP ${response.status}.`);
      setShowSetup(false);
      await fetchData();
      setMessage({ type: "success", text: `Break-even setup saved for ${result.month || setupData.month}.` });
    } catch (error) {
      console.warn("Break-even setup could not be updated", error);
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Break-even setup could not be updated.",
      });
    } finally {
      setIsSavingSetup(false);
    }
  };

  const updateSetupNumber = (key: "rent" | "salaries" | "utilities" | "other_fixed" | "avg_order_value", value: string) => {
    setSetupData((current) => ({
      ...current,
      [key]: Number.isFinite(Number(value)) ? Number(value) : 0,
    }));
  };

  return (
    <div className="p-8 bg-[#0a0a0b] min-h-screen text-white">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-green-400 to-blue-500 bg-clip-text text-transparent underline decoration-green-500/20 underline-offset-8">
            Profitability & Break-even
        </h1>
        <button 
          onClick={() => setShowSetup(true)}
          className="flex items-center gap-2 px-6 py-3 bg-white/5 border border-white/10 rounded-2xl font-bold hover:bg-white hover:text-black transition-all"
        >
          <Settings className="w-5 h-5" /> Configure Fixed Costs
        </button>
      </div>

      {message && (
        <div
          className={`mb-6 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold ${
            message.type === "success"
              ? "border-green-500/30 bg-green-500/10 text-green-100"
              : "border-red-500/30 bg-red-500/10 text-red-100"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Main Analysis */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-gradient-to-br from-[#1a1a1c] to-[#0a0a0b] p-8 rounded-[2.5rem] border border-white/5 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-green-500/5 blur-[100px] rounded-full -mr-32 -mt-32"></div>
            
            <div className="flex justify-between items-center mb-10">
              <span className="text-sm font-bold text-gray-500 uppercase tracking-widest">Daily Revenue vs Break-even</span>
              {data?.today_above_breakeven ? (
                 <span className="bg-green-500/10 text-green-400 px-4 py-1 rounded-full text-[10px] font-black uppercase border border-green-500/20">Profitable Today</span>
              ) : (
                 <span className="bg-red-500/10 text-red-400 px-4 py-1 rounded-full text-[10px] font-black uppercase border border-red-500/20">Below Target</span>
              )}
            </div>

            <div className="flex flex-col md:flex-row gap-12 items-center">
              <div className="flex-1 space-y-2">
                <p className="text-4xl font-black">Rs {formatNumber(data?.today_revenue)}</p>
                <p className="text-sm text-gray-500">Revenue Recorded Today</p>
              </div>
              <div className="h-20 w-px bg-white/10 hidden md:block"></div>
              <div className="flex-1 space-y-2">
                <p className="text-4xl font-black text-gray-400">Rs {formatNumber(data?.daily_breakeven_revenue)}</p>
                <p className="text-sm text-gray-500">Break-even Goal (Daily)</p>
              </div>
            </div>

            <div className="mt-12 h-6 bg-white/5 rounded-full relative overflow-hidden">
              <div 
                className={`h-full transition-all duration-1000 ${data?.today_above_breakeven ? 'bg-green-500' : 'bg-orange-500'}`}
                style={{ width: `${completionPercent(data?.today_revenue, data?.daily_breakeven_revenue)}%` }}
              ></div>
            </div>
            <p className="mt-4 text-xs font-bold text-gray-400 uppercase text-center">{data?.status_message}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-[#1a1a1c] p-6 rounded-[2.5rem] border border-white/5">
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-tighter mb-1">Fixed Monthly</p>
                <p className="text-2xl font-bold">Rs {formatNumber(data?.fixed_costs?.total)}</p>
            </div>
            <div className="bg-[#1a1a1c] p-6 rounded-[2.5rem] border border-white/5">
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-tighter mb-1">Break-even Orders</p>
                <p className="text-2xl font-bold">{data?.daily_breakeven_orders} / day</p>
            </div>
            <div className="bg-[#1a1a1c] p-6 rounded-[2.5rem] border border-white/5">
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-tighter mb-1">AOV Target</p>
                <p className="text-2xl font-bold">Rs {formatNumber(data?.avg_order_value)}</p>
            </div>
          </div>
        </div>

        {/* Breakdown Panel */}
        <div className="lg:col-span-4 bg-[#1a1a1c] p-8 rounded-[2.5rem] border border-white/5">
          <h3 className="text-lg font-bold mb-8 flex items-center gap-2">
            <PieChart className="w-5 h-5 text-blue-400" /> Cost Distribution
          </h3>
          <div className="space-y-6">
            {data?.fixed_costs && Object.entries(data.fixed_costs).filter(([k]) => k !== 'total').map(([key, val]: any) => (
              <div key={key} className="flex justify-between items-center group">
                <span className="text-gray-400 text-sm capitalize group-hover:text-white transition-colors">{key}</span>
                <span className="font-mono text-white">Rs {formatNumber(val)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showSetup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-xl p-4">
          <div
            data-testid="breakeven-setup-modal"
            className="w-full max-w-2xl bg-[#1a1a1c] rounded-[3rem] p-10 border border-white/10 animate-in zoom-in-95 duration-350"
          >
            <h2 className="text-2xl font-bold mb-8 text-center bg-gradient-to-r from-white to-gray-500 bg-clip-text text-transparent">Configure Monthly Base</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-gray-500 uppercase ml-1">Rent</span>
                  <input aria-label="Rent" type="number" value={setupData.rent} disabled={isSavingSetup} onChange={(e)=>updateSetupNumber("rent", e.target.value)} className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl outline-none focus:border-white/20 disabled:cursor-wait disabled:opacity-60" />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-gray-500 uppercase ml-1">Salaries</span>
                  <input aria-label="Salaries" type="number" value={setupData.salaries} disabled={isSavingSetup} onChange={(e)=>updateSetupNumber("salaries", e.target.value)} className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl outline-none focus:border-white/20 disabled:cursor-wait disabled:opacity-60" />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-gray-500 uppercase ml-1">Utilities</span>
                  <input aria-label="Utilities" type="number" value={setupData.utilities} disabled={isSavingSetup} onChange={(e)=>updateSetupNumber("utilities", e.target.value)} className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl outline-none focus:border-white/20 disabled:cursor-wait disabled:opacity-60" />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-gray-500 uppercase ml-1">Other Fixed</span>
                  <input aria-label="Other Fixed" type="number" value={setupData.other_fixed} disabled={isSavingSetup} onChange={(e)=>updateSetupNumber("other_fixed", e.target.value)} className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl outline-none focus:border-white/20 disabled:cursor-wait disabled:opacity-60" />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <span className="text-[10px] font-black text-gray-500 uppercase ml-1">Month Select (YYYY-MM)</span>
                  <input aria-label="Month Select" type="month" value={setupData.month} disabled={isSavingSetup} onChange={(e)=>setSetupData({...setupData, month: e.target.value})} className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl outline-none disabled:cursor-wait disabled:opacity-60" />
                </div>
                <div>
                  <span className="text-[10px] font-black text-gray-500 uppercase ml-1">Average Order Value</span>
                  <input aria-label="Average Order Value" type="number" value={setupData.avg_order_value} disabled={isSavingSetup} onChange={(e)=>updateSetupNumber("avg_order_value", e.target.value)} className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl outline-none disabled:cursor-wait disabled:opacity-60" />
                </div>
              </div>
              <div className="flex gap-4 pt-6">
                 <button disabled={isSavingSetup} onClick={() => setShowSetup(false)} className="flex-1 p-5 rounded-2xl font-bold text-gray-400 hover:text-white transition-colors disabled:cursor-wait disabled:opacity-50">Cancel</button>
                 <button disabled={isSavingSetup} onClick={saveSetup} className="flex flex-1 items-center justify-center gap-2 bg-white text-black p-5 rounded-2xl font-black hover:bg-green-500 hover:text-white transition-all active:scale-95 shadow-2xl disabled:cursor-wait disabled:bg-white/20 disabled:text-white/60">
                  {isSavingSetup && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isSavingSetup ? "Saving..." : "Apply & Update"}
                 </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
