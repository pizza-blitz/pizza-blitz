"use client";

import { useState, useEffect } from "react";
import { Info, Printer, Receipt, Search } from "lucide-react";
import { getApiUrl } from "@/lib/api";

const API_BASE = getApiUrl("/api/v1/restaurant/orders/invoices");

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch(API_BASE).then(res => res.json()).then(setInvoices);
  }, []);

  const filtered = invoices.filter((i: any) => 
    i.invoice_number.toLowerCase().includes(search.toLowerCase()) ||
    i.customer_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-8 bg-[#0a0a0b] min-h-screen text-white">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-orange-400 to-red-500 bg-clip-text text-transparent underline decoration-orange-500/20 underline-offset-8">
            GST Invoice Archive
          </h1>
          <p className="text-gray-500 text-sm mt-3 flex items-center gap-2">
            <Info className="w-4 h-4" /> Comprehensive repository of all restaurant tax filings.
          </p>
        </div>
        
        <div className="relative w-full md:w-96">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
          <input 
            type="text" 
            placeholder="Search by ID or Customer..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white/5 border border-white/10 p-4 pl-12 rounded-2xl outline-none focus:border-orange-500 transition-all font-medium"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {filtered.map((inv: any) => (
          <div key={inv.id} className="group bg-[#1a1a1c] p-6 rounded-[2rem] border border-white/5 hover:border-orange-500/30 transition-all flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-6 w-full md:w-auto">
              <div className="w-14 h-14 rounded-2xl bg-orange-500/10 flex items-center justify-center group-hover:bg-orange-500 group-hover:text-white transition-all text-orange-500">
                <Receipt className="w-6 h-6" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-black text-gray-500 uppercase tracking-widest leading-none mb-1">Invoice {inv.invoice_number}</span>
                <span className="text-xl font-bold">{inv.customer_name || 'Walk-in'}</span>
                <span className="text-xs text-gray-500 mt-0.5">{inv.date} • {inv.payment_method}</span>
              </div>
            </div>

            <div className="flex items-center gap-10 w-full md:w-auto justify-between md:justify-end">
              <div className="flex flex-col items-end">
                <span className="text-[10px] font-black text-gray-500 uppercase tracking-tighter">GST (5%)</span>
                <span className="text-sm font-mono text-orange-400/80">₹{inv.cgst + inv.sgst}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[10px] font-black text-gray-500 uppercase tracking-tighter">Total Amount</span>
                <span className="text-2xl font-black">₹{inv.total.toLocaleString()}</span>
              </div>
              <button 
                onClick={() => window.print()}
                className="p-4 bg-white/5 rounded-2xl hover:bg-white hover:text-black transition-all border border-white/5 active:scale-95 shadow-xl"
              >
                <Printer className="w-5 h-5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-32 opacity-20">
          <Search className="w-16 h-16 mb-4" />
          <p className="text-xl font-bold italic">No matching invoices found in history node.</p>
        </div>
      )}
    </div>
  );
}
