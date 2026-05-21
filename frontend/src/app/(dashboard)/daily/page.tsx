"use client";
import React, { useState } from 'react';
import { Save, AlertCircle, CheckCircle2, IndianRupee, Loader2, ArrowRight } from 'lucide-react';
import { getApiUrl } from '@/lib/api';

export default function DailyEntry() {
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    total_sale: "",
    cash_collected: "",
    total_expense: "",
    payment_method: "mixed",
    notes: ""
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<{type: 'success' | 'error', msg: string, detail?: any} | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setStatus(null);

    const payload = {
      date: formData.date,
      total_sale: parseFloat(formData.total_sale),
      cash_collected: parseFloat(formData.cash_collected),
      total_expense: parseFloat(formData.total_expense),
      payment_method: formData.payment_method,
      notes: formData.notes
    };

    try {
      const res = await fetch(getApiUrl('/api/v1/restaurant/sales/daily-entry'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const result = await res.json();
      
      if (!res.ok) throw new Error(result.detail || "Failed to save daily entry");
      
      setStatus({ 
        type: 'success', 
        msg: result.message || "Daily entry synchronized successfully!",
        detail: result.data
      });
      
      // Clear form except date
      setFormData({
        ...formData,
        total_sale: "",
        cash_collected: "",
        total_expense: "",
        notes: ""
      });
    } catch (err: any) {
      setStatus({ type: 'error', msg: err.message || "Something went wrong" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
      <div className="text-center">
        <h1 className="text-4xl font-black text-gray-900 uppercase tracking-tighter">Daily Ledger Sync</h1>
        <p className="text-gray-500 mt-2 font-medium">Commit daily operations to the decentralized cloud database.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <form onSubmit={handleSubmit} className="bg-white p-10 rounded-[2.5rem] shadow-2xl shadow-orange-100 border border-orange-50 space-y-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-orange-50 rounded-bl-[5rem] -mr-16 -mt-16 opacity-50"></div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-3">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Accounting Date</label>
                <input 
                  type="date" 
                  required
                  value={formData.date}
                  onChange={e => setFormData({...formData, date: e.target.value})}
                  className="w-full p-4 bg-gray-50 border-2 border-transparent border-b-gray-200 rounded-2xl focus:border-orange-500 focus:bg-white outline-none transition-all font-bold text-gray-800"
                />
              </div>
              <div className="space-y-3">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Revenue Channel</label>
                <select 
                  value={formData.payment_method}
                  onChange={e => setFormData({...formData, payment_method: e.target.value})}
                  className="w-full p-4 bg-gray-50 border-2 border-transparent border-b-gray-200 rounded-2xl focus:border-orange-500 focus:bg-white outline-none transition-all font-bold text-gray-700"
                >
                  <option value="mixed">Omnichannel (Mixed)</option>
                  <option value="cash">Hard Cash Only</option>
                  <option value="online">Digital / Online Only</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-3">
                <label className="text-xs font-black text-orange-600 uppercase tracking-widest ml-1">Gross Sales</label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-orange-400 font-bold">₹</div>
                  <input 
                    type="number" 
                    required
                    step="0.01"
                    placeholder="0.00"
                    value={formData.total_sale}
                    onChange={e => setFormData({...formData, total_sale: e.target.value})}
                    className="w-full pl-8 p-4 bg-orange-50/30 border-2 border-transparent border-b-orange-200 rounded-2xl focus:border-orange-500 focus:bg-white outline-none transition-all font-black text-xl text-gray-900"
                  />
                </div>
              </div>
              <div className="space-y-3">
                <label className="text-xs font-black text-blue-600 uppercase tracking-widest ml-1">Cash In Hand</label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-400 font-bold">₹</div>
                  <input 
                    type="number" 
                    required
                    step="0.01"
                    placeholder="0.00"
                    value={formData.cash_collected}
                    onChange={e => setFormData({...formData, cash_collected: e.target.value})}
                    className="w-full pl-8 p-4 bg-blue-50/30 border-2 border-transparent border-b-blue-200 rounded-2xl focus:border-blue-500 focus:bg-white outline-none transition-all font-black text-xl text-gray-900"
                  />
                </div>
              </div>
              <div className="space-y-3">
                <label className="text-xs font-black text-red-600 uppercase tracking-widest ml-1">Burn / Expense</label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-red-400 font-bold">₹</div>
                  <input 
                    type="number" 
                    required
                    step="0.01"
                    placeholder="0.00"
                    value={formData.total_expense}
                    onChange={e => setFormData({...formData, total_expense: e.target.value})}
                    className="w-full pl-8 p-4 bg-red-50/30 border-2 border-transparent border-b-red-200 rounded-2xl focus:border-red-500 focus:bg-white outline-none transition-all font-black text-xl text-gray-900"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Operational Audit Notes</label>
              <textarea 
                rows={3}
                placeholder="Detail any variances or special incidents..."
                value={formData.notes}
                onChange={e => setFormData({...formData, notes: e.target.value})}
                className="w-full p-5 bg-gray-50 border-2 border-transparent border-b-gray-200 rounded-2xl focus:border-orange-500 focus:bg-white outline-none transition-all font-medium text-gray-700"
              />
            </div>

            {status && (
              <div className={`p-6 rounded-3xl flex items-start space-x-4 animate-in zoom-in-95 duration-300 ${status.type === 'success' ? 'bg-green-50 text-green-800 border-2 border-green-100 shadow-lg shadow-green-100/50' : 'bg-red-50 text-red-800 border-2 border-red-100 shadow-lg shadow-red-100/50'}`}>
                {status.type === 'success' ? (
                  <CheckCircle2 className="w-6 h-6 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-6 h-6 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-black text-lg tracking-tight leading-none mb-1">{status.msg}</p>
                  {status.detail && (
                    <p className="text-xs font-bold opacity-70">
                      Sync ID: {status.detail.date} | Profit Calculated: ₹{status.detail.profit}
                    </p>
                  )}
                </div>
              </div>
            )}

            <button 
              type="submit"
              disabled={isSubmitting}
              className="w-full py-6 bg-black hover:bg-orange-600 text-white rounded-3xl font-black text-xl shadow-2xl shadow-orange-200 transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center disabled:opacity-50 uppercase tracking-widest group"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-6 h-6 mr-3 animate-spin" />
                  Encrypting & Syncing...
                </>
              ) : (
                <>
                  <Save className="w-6 h-6 mr-3 group-hover:rotate-12 transition-transform" />
                  Commit to Ledger
                </>
              )}
            </button>
          </form>
        </div>

        <div className="space-y-6">
          <div className="bg-orange-600 p-8 rounded-[2.5rem] text-white shadow-xl shadow-orange-100 relative overflow-hidden">
            <div className="absolute -bottom-8 -left-8 opacity-10">
              <IndianRupee className="w-48 h-48" />
            </div>
            <h4 className="font-black text-2xl mb-4 group flex items-center">
              Business Logic
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-2 transition-transform" />
            </h4>
            <ul className="space-y-4 text-orange-100 font-bold text-sm">
              <li className="flex items-start">
                <span className="bg-white/20 p-1 rounded-lg mr-3 mt-1"><CheckCircle2 className="w-3 h-3 text-white" /></span>
                Entries overwrite existing records for corrected audit trails.
              </li>
              <li className="flex items-start">
                <span className="bg-white/20 p-1 rounded-lg mr-3 mt-1"><CheckCircle2 className="w-3 h-3 text-white" /></span>
                Profit is auto-calculated: (Sales - Expenses).
              </li>
              <li className="flex items-start">
                <span className="bg-white/20 p-1 rounded-lg mr-3 mt-1"><CheckCircle2 className="w-3 h-3 text-white" /></span>
                Data scales instantly across all BI dashboards.
              </li>
            </ul>
          </div>

          <div className="bg-white p-8 rounded-[2.5rem] border-2 border-gray-100 shadow-sm">
             <h5 className="font-black text-gray-900 uppercase tracking-widest text-xs mb-4">Audit Transparency</h5>
             <div className="space-y-4">
                <div className="flex justify-between items-center pb-4 border-b border-gray-50">
                   <p className="text-gray-400 font-bold text-xs">COMMITTED BY</p>
                   <p className="text-gray-900 font-black text-sm uppercase italic">Rest.-ID-001</p>
                </div>
                <div className="flex justify-between items-center pb-4 border-b border-gray-50">
                   <p className="text-gray-400 font-bold text-xs">NODE STATUS</p>
                   <p className="text-green-600 font-black text-sm flex items-center"><span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span> ACTIVE</p>
                </div>
                <div className="flex justify-between items-center">
                   <p className="text-gray-400 font-bold text-xs">ENCRYPTION</p>
                   <p className="text-gray-900 font-black text-sm tracking-widest opacity-30">AES-256</p>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
