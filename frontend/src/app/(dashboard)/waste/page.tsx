"use client";
import React, { useState, useEffect } from 'react';
import { Trash2, ClipboardList, TrendingDown, Plus, Loader2, AlertTriangle, PieChart, CheckCircle2 } from 'lucide-react';
import { getApiUrl } from '@/lib/api';

interface WasteItem {
  id: string;
  date: string;
  item_name: string;
  quantity: number;
  unit: string;
  estimated_cost: number;
  reason: string;
}

interface WasteSummary {
  total_waste_cost: number;
  top_items: { item_name: string; cost: number; percentage: number }[];
  count: number;
}

type WasteStatus = {
  type: "success" | "error" | "loading";
  text: string;
};

export default function WastePage() {
  const [wasteLogs, setWasteLogs] = useState<WasteItem[]>([]);
  const [summary, setSummary] = useState<WasteSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<WasteStatus | null>(null);
  const [newWaste, setNewWaste] = useState({
    date: new Date().toISOString().split('T')[0],
    item_name: '',
    quantity: 0,
    unit: 'kg',
    estimated_cost: 0,
    reason: ''
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchWasteData(controller.signal);
    return () => controller.abort();
  }, []);

  const fetchWasteData = async (signal?: AbortSignal) => {
    try {
      const [logsRes, summaryRes] = await Promise.all([
        fetch(getApiUrl('/api/v1/restaurant/sales/waste'), { signal, credentials: "include", cache: "no-store" }),
        fetch(getApiUrl('/api/v1/restaurant/sales/waste/summary'), { signal, credentials: "include", cache: "no-store" })
      ]);
      
      if (logsRes.ok) {
        const data = await logsRes.json();
        setWasteLogs(Array.isArray(data) ? data : []);
      }
      if (summaryRes.ok) setSummary(await summaryRes.json());
    } catch {
      if (signal?.aborted) return;
      setStatus({ type: "error", text: "Waste data is temporarily unavailable." });
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setStatus({ type: "loading", text: "Saving waste entry..." });
    try {
      const res = await fetch(getApiUrl('/api/v1/restaurant/sales/waste'), {
        method: 'POST',
        credentials: "include",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newWaste)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.message || "Failed to log waste.");
      setNewWaste({
        date: new Date().toISOString().split('T')[0],
        item_name: '',
        quantity: 0,
        unit: 'kg',
        estimated_cost: 0,
        reason: ''
      });
      setStatus({ type: "success", text: `${data.item_name || "Waste item"} logged to waste audit for Rs ${Number(data.estimated_cost || 0).toLocaleString()}.` });
      await fetchWasteData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to log waste.";
      setStatus({ type: "error", text: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 italic">Waste Management</h1>
          <p className="text-gray-500 text-sm italic tracking-tight">Track spoilage, errors, and loss to optimize margins.</p>
        </div>
        <div className="bg-orange-50 px-6 py-3 rounded-2xl border border-orange-100 flex items-center space-x-4">
          <div className="text-right">
             <p className="text-[10px] uppercase font-bold text-orange-600">Total Loss (30D)</p>
             <p className="text-xl font-black text-orange-900">Rs {summary?.total_waste_cost?.toLocaleString() || '0'}</p>
          </div>
          <TrendingDown className="w-8 h-8 text-orange-600 opacity-20" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 h-fit">
          <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center italic">
            <Plus className="w-5 h-5 mr-2 text-red-500" />
            Log Waste Event
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Date</label>
                <input 
                  type="date" 
                  aria-label="Waste event date"
                  required
                  value={newWaste.date}
                  onChange={e => setNewWaste({...newWaste, date: e.target.value})}
                  className="w-full mt-1 p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all text-xs font-bold"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Item Name</label>
                <input 
                  type="text" 
                  aria-label="Waste item name"
                  required
                  value={newWaste.item_name}
                  onChange={e => setNewWaste({...newWaste, item_name: e.target.value})}
                  className="w-full mt-1 p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all text-xs"
                  placeholder="Pizza Base"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Quantity</label>
                <div className="flex space-x-2">
                  <input 
                    type="number" 
                    aria-label="Waste quantity"
                    required
                    value={newWaste.quantity}
                    onChange={e => setNewWaste({...newWaste, quantity: Number(e.target.value)})}
                    className="w-full mt-1 p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all text-xs"
                  />
                  <select 
                    aria-label="Waste quantity unit"
                    value={newWaste.unit}
                    onChange={e => setNewWaste({...newWaste, unit: e.target.value})}
                    className="p-3 mt-1 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold"
                  >
                    <option value="kg">KG</option>
                    <option value="gm">GM</option>
                    <option value="unit">Unit</option>
                    <option value="ltr">Ltr</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Estimated Cost</label>
                <div className="relative">
                  <span className="absolute left-3 top-4 text-gray-400 text-xs">Rs</span>
                  <input 
                    type="number" 
                    aria-label="Estimated waste cost"
                    required
                    value={newWaste.estimated_cost}
                    onChange={e => setNewWaste({...newWaste, estimated_cost: Number(e.target.value)})}
                    className="w-full mt-1 p-3 pl-9 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all text-xs"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase">Reason for Waste</label>
              <textarea 
                aria-label="Reason for waste"
                required
                value={newWaste.reason}
                onChange={e => setNewWaste({...newWaste, reason: e.target.value})}
                className="w-full mt-1 p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all text-xs h-20"
                placeholder="Expired, burned, customer return..."
              />
            </div>
            <button 
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-red-600 text-white p-4 rounded-2xl font-black hover:bg-black transition-all disabled:opacity-50 uppercase tracking-widest text-xs flex items-center justify-center space-x-2"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              <span>{isSubmitting ? "Saving Waste Entry" : "Commit to Waste Log"}</span>
            </button>
          </form>
          {status ? (
            <div
              role={status.type === "error" ? "alert" : "status"}
              className={`mt-4 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${
                status.type === "success"
                  ? "border-green-200 bg-green-50 text-green-800"
                  : status.type === "error"
                    ? "border-red-200 bg-red-50 text-red-800"
                    : "border-orange-200 bg-orange-50 text-orange-800"
              }`}
            >
              {status.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : status.type === "loading" ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0" />
              )}
              <span>{status.text}</span>
            </div>
          ) : null}
        </div>

        {/* Analytics & Table */}
        <div className="lg:col-span-2 space-y-6">
          {/* Top Waste Chart */}
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
             <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center italic tracking-tighter">
              <PieChart className="w-5 h-5 mr-2 text-indigo-600" />
              High-Impact Loss Items
            </h3>
            <div className="space-y-4">
              {summary?.top_items?.map((item, i) => (
                <div key={i}>
                  <div className="flex justify-between text-xs font-bold mb-1">
                    <span className="text-gray-700">{item.item_name}</span>
                    <span className="text-red-600">Rs {item.cost.toLocaleString()} ({item.percentage}%)</span>
                  </div>
                  <div className="w-full bg-gray-50 h-2 rounded-full overflow-hidden">
                    <div 
                      className="bg-red-500 h-full rounded-full transition-all duration-1000" 
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
              {(!summary?.top_items || summary.top_items.length === 0) && (
                <p className="text-center text-xs text-gray-400 py-4 italic">No major loss items detected in the current cycle.</p>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
            <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center italic tracking-tighter">
              <ClipboardList className="w-5 h-5 mr-2 text-orange-600" />
              Audit Trail
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-50">
                    <th className="py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Date</th>
                    <th className="py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Item</th>
                    <th className="py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Qty</th>
                    <th className="py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Cost</th>
                    <th className="py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest pl-6">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {wasteLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50 transition-colors group">
                      <td className="py-4 text-[11px] text-gray-500 tabular-nums">{log.date}</td>
                      <td className="py-4 text-[11px] font-bold text-gray-900">{log.item_name}</td>
                      <td className="py-4 text-[11px] text-gray-600 text-center">{log.quantity} {log.unit}</td>
                      <td className="py-4 text-[11px] font-black text-red-600 text-right">Rs {log.estimated_cost.toLocaleString()}</td>
                      <td className="py-4 text-[10px] text-gray-400 pl-6 italic">{log.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {wasteLogs.length === 0 && !isLoading && (
                <div className="py-12 text-center text-gray-400 italic text-sm">
                  The logs are clean. Excellent efficiency!
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
