"use client";

import { useState, useEffect } from "react";
import { PieChart, Settings } from "lucide-react";
import { getApiUrl } from "@/lib/api";

const API_BASE = getApiUrl("/api/v1/restaurant/stats/breakeven");

export default function BreakevenPage() {
  const [data, setData] = useState<any>(null);
  const [showSetup, setShowSetup] = useState(false);
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
      const res = await fetch(API_BASE, { signal });
      setData(await res.json());
    } catch (error) {
      if (signal?.aborted) return;
      console.error("Failed to fetch break-even data", error);
    }
  };

  const saveSetup = async () => {
    await fetch(`${API_BASE}/setup?${new URLSearchParams(setupData as any)}`, { method: 'POST' });
    setShowSetup(false);
    fetchData();
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
                <p className="text-4xl font-black">₹{data?.today_revenue.toLocaleString()}</p>
                <p className="text-sm text-gray-500">Revenue Recorded Today</p>
              </div>
              <div className="h-20 w-px bg-white/10 hidden md:block"></div>
              <div className="flex-1 space-y-2">
                <p className="text-4xl font-black text-gray-400">₹{data?.daily_breakeven_revenue.toLocaleString()}</p>
                <p className="text-sm text-gray-500">Break-even Goal (Daily)</p>
              </div>
            </div>

            <div className="mt-12 h-6 bg-white/5 rounded-full relative overflow-hidden">
              <div 
                className={`h-full transition-all duration-1000 ${data?.today_above_breakeven ? 'bg-green-500' : 'bg-orange-500'}`}
                style={{ width: `${Math.min(100, (data?.today_revenue / data?.daily_breakeven_revenue) * 100)}%` }}
              ></div>
            </div>
            <p className="mt-4 text-xs font-bold text-gray-400 uppercase text-center">{data?.status_message}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-[#1a1a1c] p-6 rounded-[2.5rem] border border-white/5">
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-tighter mb-1">Fixed Monthly</p>
                <p className="text-2xl font-bold">₹{data?.fixed_costs.total.toLocaleString()}</p>
            </div>
            <div className="bg-[#1a1a1c] p-6 rounded-[2.5rem] border border-white/5">
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-tighter mb-1">Break-even Orders</p>
                <p className="text-2xl font-bold">{data?.daily_breakeven_orders} / day</p>
            </div>
            <div className="bg-[#1a1a1c] p-6 rounded-[2.5rem] border border-white/5">
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-tighter mb-1">AOV Target</p>
                <p className="text-2xl font-bold">₹{data?.avg_order_value}</p>
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
                <span className="font-mono text-white">₹{val.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showSetup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-xl p-4">
          <div className="w-full max-w-lg bg-[#1a1a1c] rounded-[3rem] p-10 border border-white/10 animate-in zoom-in-95 duration-350">
            <h2 className="text-2xl font-bold mb-8 text-center bg-gradient-to-r from-white to-gray-500 bg-clip-text text-transparent">Configure Monthly Base</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-gray-500 uppercase ml-1">Rent</span>
                  <input type="number" value={setupData.rent} onChange={(e)=>setSetupData({...setupData, rent: parseInt(e.target.value)}) } className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl outline-none focus:border-white/20" />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-gray-500 uppercase ml-1">Salaries</span>
                  <input type="number" value={setupData.salaries} onChange={(e)=>setSetupData({...setupData, salaries: parseInt(e.target.value)}) } className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl outline-none focus:border-white/20" />
                </div>
              </div>
              <div>
                <span className="text-[10px] font-black text-gray-500 uppercase ml-1">Month Select (YYYY-MM)</span>
                <input type="month" value={setupData.month} onChange={(e)=>setSetupData({...setupData, month: e.target.value})} className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl outline-none" />
              </div>
              <div className="flex gap-4 pt-6">
                 <button onClick={() => setShowSetup(false)} className="flex-1 p-5 rounded-2xl font-bold text-gray-400 hover:text-white transition-colors">Cancel</button>
                 <button onClick={saveSetup} className="flex-1 bg-white text-black p-5 rounded-2xl font-black hover:bg-green-500 hover:text-white transition-all active:scale-95 shadow-2xl">Apply & Update</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
