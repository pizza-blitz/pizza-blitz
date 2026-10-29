"use client";
import React, { useState, useEffect } from 'react';
import { AlertCircle, BrainCircuit, CheckCircle2, Loader2, Sparkles, Target, Zap } from 'lucide-react';
import { getApiUrl } from '@/lib/api';

type AiInsightPayload = {
  summary: string;
  tips: string[];
};

export default function AIInsights() {
  const [insights, setInsights] = useState<AiInsightPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [syncMessage, setSyncMessage] = useState<{ type: "success" | "warning" | "error" | "loading"; text: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchInsights(controller.signal);
    return () => controller.abort();
  }, []);

  const fetchInsights = async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    setSyncMessage({ type: "loading", text: "Refreshing insight model..." });
    try {
      const res = await fetch(getApiUrl('/api/v1/restaurant/insights/ai-insights'), {
        signal,
        credentials: "include",
        cache: "no-store",
      });
      const result = await res.json().catch(() => ({}));
      const data = result?.data;
      const hasData =
        data && typeof data.summary === "string" && Array.isArray(data.tips);
      if (res.ok && hasData && result.status === "success") {
        setInsights(data);
        setAiConfigured(true);
        const tipCount = data.tips.length;
        setSyncMessage({
          type: "success",
          text: `AI insights synced${tipCount ? ` with ${tipCount} directive${tipCount === 1 ? "" : "s"}` : ""}.`,
        });
      } else if (res.ok && hasData && result.status === "fallback") {
        // The AI provider is optional. When it is not configured the backend
        // still returns standard guidance, so show it with an honest warning
        // instead of treating the page as broken.
        setInsights(data);
        setAiConfigured(false);
        setSyncMessage({
          type: "warning",
          text:
            result.message ||
            "AI provider is not configured. Showing standard operating guidance.",
        });
      } else {
        const message =
          result.detail || result.message || "Insights could not be loaded.";
        setError(message);
        setSyncMessage({ type: "error", text: message });
      }
    } catch {
      if (signal?.aborted) return;
      const message = "The backend could not be reached.";
      setError(message);
      setSyncMessage({ type: "error", text: message });
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  };

  if (isLoading && !insights) return (
    <div className="h-[80vh] flex flex-col items-center justify-center space-y-8 animate-in fade-in duration-1000">
      <div className="relative">
        <div className="absolute inset-0 bg-orange-500/30 blur-[100px] rounded-full animate-pulse"></div>
        <div className="relative bg-white p-8 rounded-[3rem] shadow-2xl border-4 border-orange-50">
          <BrainCircuit className="w-20 h-20 text-orange-600 animate-pulse" />
        </div>
      </div>
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-black text-gray-900 uppercase tracking-tighter leading-none">Neural Insights</h1>
        <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tighter italic">Analyzing Pizza Blitz Dataset</h2>
        <p className="text-gray-400 font-bold uppercase tracking-widest text-xs animate-pulse">Analyzing your sales and stock data...</p>
      </div>
    </div>
  );

  const displayData = insights || {
    summary: "No guidance loaded yet. Use Force Resync to read your latest sales and stock figures.",
    tips: ["Connect an AI provider key to get model-written recommendations.", "Keep daily sales and inventory up to date so the numbers here mean something.", "Review the Reports page for the raw figures behind any suggestion."]
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
        <button
          onClick={() => void fetchInsights()}
          disabled={isLoading}
          className="flex items-center gap-2 bg-gray-50 hover:bg-gray-100 text-gray-500 px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all disabled:cursor-wait disabled:opacity-60"
        >
          {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          {isLoading ? "Syncing" : "Force Resync"}
        </button>
      </div>

      {syncMessage && (
        <div
          data-testid="ai-insights-status"
          className={`flex items-center rounded-[2rem] border-2 p-5 text-sm font-black uppercase tracking-tight shadow-lg ${
            syncMessage.type === "success"
              ? "border-green-100 bg-green-50 text-green-700 shadow-green-50"
              : syncMessage.type === "error"
                ? "border-red-100 bg-red-50 text-red-700 shadow-red-50"
                : syncMessage.type === "warning"
                  ? "border-amber-200 bg-amber-50 text-amber-800 shadow-amber-50"
                  : "border-orange-100 bg-orange-50 text-orange-700 shadow-orange-50"
          }`}
        >
          {syncMessage.type === "success" ? (
            <CheckCircle2 className="mr-4 h-6 w-6 shrink-0" />
          ) : syncMessage.type === "error" ? (
            <AlertCircle className="mr-4 h-6 w-6 shrink-0" />
          ) : syncMessage.type === "warning" ? (
            <AlertCircle className="mr-4 h-6 w-6 shrink-0" />
          ) : (
            <Loader2 className="mr-4 h-6 w-6 shrink-0 animate-spin" />
          )}
          <p>{syncMessage.text}</p>
        </div>
      )}

      {error && syncMessage?.type !== "error" && (
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
                 &ldquo;{displayData.summary}&rdquo;
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
               </div>
             ))}
          </div>
        </div>

        <div className="space-y-10">
          <div className="bg-black p-10 rounded-[3.5rem] text-white shadow-2xl shadow-orange-100 relative overflow-hidden group">
             <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/20 to-orange-500/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
             <div className="flex items-center space-x-3 mb-8">
               <div className="bg-white/10 p-3 rounded-2xl"><Target className="w-5 h-5 text-orange-400" /></div>
               <h4 className="font-black uppercase tracking-widest text-xs italic">What This Reads</h4>
             </div>
             <div className="space-y-6 relative z-10">
                <div className="bg-white/5 p-6 rounded-[2rem] border border-white/10 backdrop-blur-sm">
                   <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">Sales &amp; expenses</p>
                   <p className="text-sm font-bold text-gray-200 leading-relaxed">The last 30 days of daily sales, summed into revenue, expense and net profit.</p>
                </div>
                <div className="bg-white/5 p-6 rounded-[2rem] border border-white/10 backdrop-blur-sm">
                   <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">Inventory</p>
                   <p className="text-sm font-bold text-gray-200 leading-relaxed">Items whose current stock has fallen below their minimum level.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void fetchInsights()}
                  disabled={isLoading}
                  className="flex w-full items-center justify-center gap-2 py-5 bg-orange-600 rounded-[2rem] font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-orange-900/50 hover:bg-orange-500 transition-all active:scale-95 disabled:cursor-wait disabled:bg-orange-300"
                >
                   {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                   {isLoading ? "Loading" : "Re-read my data"}
                </button>
             </div>
          </div>

          <div className="bg-white p-10 rounded-[3.5rem] border-2 border-gray-100 relative group overflow-hidden">
             <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:rotate-12 transition-transform">
               <Zap className="w-24 h-24" />
             </div>
             <div className="flex items-center space-x-3 mb-8 text-orange-600">
               <Zap className="w-5 h-5 fill-orange-600" />
               <h4 className="font-black uppercase tracking-widest text-xs italic">Getting Model-Written Insights</h4>
             </div>
             <ul className="space-y-6">
               <li className="flex items-start">
                 <div className="w-2 h-2 bg-orange-500 rounded-full mt-2 mr-4 shrink-0"></div>
                 <p className="text-sm font-bold text-gray-600 leading-relaxed">Put a Gemini API key in the backend <code className="bg-gray-100 px-1 rounded">.env</code> file as <code className="bg-gray-100 px-1 rounded">GEMINI_API_KEY</code>.</p>
               </li>
               <li className="flex items-start">
                 <div className="w-2 h-2 bg-orange-500 rounded-full mt-2 mr-4 shrink-0"></div>
                 <p className="text-sm font-bold text-gray-600 leading-relaxed">Restart the backend and press <span className="uppercase">Re-read my data</span>.</p>
               </li>
               <li className="flex items-start">
                 <div className="w-2 h-2 bg-orange-500 rounded-full mt-2 mr-4 shrink-0"></div>
                 <p className="text-sm font-bold text-gray-600 leading-relaxed">Without a key this page still works: it shows standard operating guidance from the same figures.</p>
               </li>
             </ul>
          </div>

          <div className="bg-orange-50 p-8 rounded-[2.5rem] border border-orange-100 flex items-center justify-between">
             <div>
                <p className="text-[10px] font-black text-orange-800 uppercase tracking-widest">Model Status</p>
                <p className="text-orange-900 font-bold text-xs uppercase" data-testid="ai-insights-model-status">
                  {aiConfigured === null
                    ? "Checking..."
                    : aiConfigured
                      ? "AI provider connected"
                      : "AI provider not connected - standard guidance"}
                </p>
             </div>
             <div className="animate-pulse flex space-x-1">
                <div className={`w-2 h-2 rounded-full ${aiConfigured ? "bg-orange-600" : "bg-orange-300"}`}></div>
                <div className={`w-2 h-2 rounded-full ${aiConfigured ? "bg-orange-500" : "bg-orange-200"}`}></div>
                <div className={`w-2 h-2 rounded-full ${aiConfigured ? "bg-orange-400" : "bg-orange-100"}`}></div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
