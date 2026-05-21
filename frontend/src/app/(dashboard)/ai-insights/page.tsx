"use client";
import React, { useState, useEffect } from 'react';
import { Sparkles, TrendingUp, TrendingDown, Target, Zap, Loader2, AlertCircle, BrainCircuit, Lightbulb, ChevronRight } from 'lucide-react';
import { getApiUrl } from '@/lib/api';

export default function AIInsights() {
  const [insights, setInsights] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchInsights();
  }, []);

  const fetchInsights = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl('/api/v1/restaurant/insights/ai-insights'));
      const result = await res.json();
      if (result.status === "success") {
        setInsights(result.data);
      } else {
        setError(result.message || "Intelligence node synchronization failed.");
      }
    } catch (err) {
      setError("Unable to establish neural link with backend.");
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) return (
    <div className="h-[80vh] flex flex-col items-center justify-center space-y-8 animate-in fade-in duration-1000">
      <div className="relative">
        <div className="absolute inset-0 bg-orange-500/30 blur-[100px] rounded-full animate-pulse"></div>
        <div className="relative bg-white p-8 rounded-[3rem] shadow-2xl border-4 border-orange-50">
          <BrainCircuit className="w-20 h-20 text-orange-600 animate-pulse" />
        </div>
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tighter italic">Analyzing Pizza Blitz Dataset</h2>
        <p className="text-gray-400 font-bold uppercase tracking-widest text-xs animate-pulse">Gemini 1.5 Flash is extracting patterns...</p>
      </div>
    </div>
  );

  const displayData = insights || {
    summary: "AI systems are currently initializing. Based on raw telemetry, your operational flow remains stable with a slight upward trend in weekend velocity.",
    tips: ["Refine inventory buffers for peak weekend hours.", "Audit utility costs for midnight energy spikes.", "Boost classic pepperoni visibility via main dashboard."]
  };

  return (
    <div className="max-w-6xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-12 duration-1000">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="bg-black p-4 rounded-3xl shadow-xl shadow-orange-100">
            <Sparkles className="w-8 h-8 text-orange-500" />
          </div>
          <div>
            <h1 className="text-5xl font-black text-gray-900 uppercase tracking-tighter leading-none">Neural Insights</h1>
            <p className="text-gray-500 mt-2 font-bold uppercase tracking-widest text-[10px] opacity-60">Artificial Intelligence Driven Strategy Layer</p>
          </div>
        </div>
        <button onClick={fetchInsights} className="bg-gray-50 hover:bg-gray-100 text-gray-400 px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all">
          Force Resync
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border-2 border-red-100 p-6 rounded-[2rem] flex items-center text-red-700 shadow-lg shadow-red-50">
          <AlertCircle className="w-6 h-6 mr-4 shrink-0" />
          <p className="font-black uppercase tracking-tight text-sm">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2 space-y-10">
          <div className="bg-white p-12 rounded-[3.5rem] shadow-2xl shadow-orange-50/50 border border-orange-50 relative overflow-hidden group">
             <div className="absolute top-0 right-0 p-12 opacity-5 scale-150 rotate-12 group-hover:rotate-0 transition-transform duration-1000">
               <BrainCircuit className="w-64 h-64" />
             </div>
             <div className="relative z-10">
               <div className="flex items-center space-x-2 text-orange-600 mb-6 font-black uppercase tracking-[0.3em] text-[10px]">
                  <span className="w-1.5 h-1.5 bg-orange-600 rounded-full animate-ping"></span>
                  <span>System Synthesis</span>
               </div>
               <h3 className="text-3xl font-black text-gray-900 mb-6 tracking-tighter italic uppercase underline decoration-orange-500 decoration-8 underline-offset-8">Executive Summary</h3>
               <p className="text-gray-700 leading-relaxed text-2xl font-bold tracking-tight">
                 "{displayData.summary}"
               </p>
             </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
             {displayData.tips.map((tip: string, i: number) => (
               <div key={i} className="flex flex-col p-10 rounded-[3rem] bg-gray-50/50 border-2 border-transparent hover:border-orange-200 transition-all group relative overflow-hidden">
                  <div className="absolute -top-4 -right-4 w-20 h-20 bg-orange-100 rounded-full opacity-0 group-hover:opacity-20 scale-150 transition-all"></div>
                  <div className="bg-black text-white w-10 h-10 rounded-2xl flex items-center justify-center text-sm font-black mb-6 shadow-lg rotate-3 group-hover:rotate-0 transition-transform">
                    {i + 1}
                  </div>
                  <h4 className="text-xl font-black text-gray-900 mb-3 tracking-tighter uppercase italic">Directive {i+1}</h4>
                  <p className="text-gray-500 font-bold leading-relaxed">{tip}</p>
                  <div className="mt-8 pt-6 border-t border-gray-100 flex items-center text-[10px] font-black text-orange-600 uppercase tracking-widest">
                     Explore Strategy <ChevronRight className="w-3 h-3 ml-1 group-hover:translate-x-1 transition-transform" />
                  </div>
               </div>
             ))}
          </div>
        </div>

        <div className="space-y-10">
          <div className="bg-black p-10 rounded-[3.5rem] text-white shadow-2xl shadow-orange-100 relative overflow-hidden group">
             <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/20 to-orange-500/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
             <div className="flex items-center space-x-3 mb-8">
               <div className="bg-white/10 p-3 rounded-2xl"><Target className="w-5 h-5 text-orange-400" /></div>
               <h4 className="font-black uppercase tracking-widest text-xs italic">Operational Target</h4>
             </div>
             <div className="space-y-8 relative z-10">
                <div className="bg-white/5 p-6 rounded-[2rem] border border-white/10 backdrop-blur-sm">
                   <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">High Impact Vector</p>
                   <p className="font-black text-2xl tracking-tighter italic">Inventory Turnover</p>
                </div>
                <div className="bg-white/5 p-6 rounded-[2rem] border border-white/10 backdrop-blur-sm">
                   <p className="text-[10px] text-green-400 font-bold uppercase tracking-widest mb-1">Potential Monthly Yield</p>
                   <p className="font-black text-4xl text-green-400 tracking-tighter">₹4,500+</p>
                </div>
                <button className="w-full py-5 bg-orange-600 rounded-[2rem] font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-orange-900/50 hover:bg-orange-500 transition-all active:scale-95">
                   Optimize Model
                </button>
             </div>
          </div>

          <div className="bg-white p-10 rounded-[3.5rem] border-2 border-gray-100 relative group overflow-hidden">
             <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:rotate-12 transition-transform">
               <Zap className="w-24 h-24" />
             </div>
             <div className="flex items-center space-x-3 mb-8 text-orange-600">
               <Zap className="w-5 h-5 fill-orange-600" />
               <h4 className="font-black uppercase tracking-widest text-xs italic">Live Quick Wins</h4>
             </div>
             <ul className="space-y-6">
               <li className="flex items-start group/li cursor-pointer">
                 <div className="w-2 h-2 bg-orange-500 rounded-full mt-2 mr-4 shrink-0 group-hover/li:scale-150 transition-transform"></div>
                 <p className="text-sm font-black text-gray-600 tracking-tight group-hover/li:text-gray-900 transition-colors uppercase italic">Recalibrate weekend prep logic</p>
               </li>
               <li className="flex items-start group/li cursor-pointer">
                 <div className="w-2 h-2 bg-orange-500 rounded-full mt-2 mr-4 shrink-0 group-hover/li:scale-150 transition-transform"></div>
                 <p className="text-sm font-black text-gray-600 tracking-tight group-hover/li:text-gray-900 transition-colors uppercase italic">Audit vendor pricing variances</p>
               </li>
               <li className="flex items-start group/li cursor-pointer">
                 <div className="w-2 h-2 bg-orange-500 rounded-full mt-2 mr-4 shrink-0 group-hover/li:scale-150 transition-transform"></div>
                 <p className="text-sm font-black text-gray-600 tracking-tight group-hover/li:text-gray-900 transition-colors uppercase italic">Auto-sync ledger before peak shift</p>
               </li>
             </ul>
          </div>

          <div className="bg-orange-50 p-8 rounded-[2.5rem] border border-orange-100 flex items-center justify-between">
             <div>
                <p className="text-[10px] font-black text-orange-800 uppercase tracking-widest">Model Status</p>
                <p className="text-orange-900 font-bold text-xs uppercase">Gemini 1.5 Flash - Active</p>
             </div>
             <div className="animate-pulse flex space-x-1">
                <div className="w-2 h-2 bg-orange-400 rounded-full"></div>
                <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                <div className="w-2 h-2 bg-orange-600 rounded-full"></div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
