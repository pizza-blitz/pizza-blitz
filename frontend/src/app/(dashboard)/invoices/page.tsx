"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, Printer, Receipt, Search } from "lucide-react";
import { getApiUrl } from "@/lib/api";

const API_BASE = getApiUrl("/api/v1/restaurant/orders/invoices");

type Invoice = {
  id: number;
  invoice_number: string;
  customer_name?: string | null;
  date: string;
  payment_method?: string | null;
  cgst: number;
  sgst: number;
  total: number;
};

type InvoiceStatus = {
  type: "success" | "error" | "info";
  text: string;
};

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<InvoiceStatus | null>(null);
  const [invoiceFooter, setInvoiceFooter] = useState("");

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setError("");
    setStatus(null);
    fetch(API_BASE, { cache: "no-store", credentials: "include" })
      .then(async (res) => {
        const payload = await res.json().catch(() => []);
        if (!res.ok) {
          throw new Error(payload.detail || "Invoice archive could not be loaded.");
        }
        return payload;
      })
      .then((payload) => {
        if (isMounted) {
          setInvoices(Array.isArray(payload) ? payload : []);
          setStatus({
            type: "success",
            text: `Invoice archive loaded with ${Array.isArray(payload) ? payload.length : 0} invoice${Array.isArray(payload) && payload.length === 1 ? "" : "s"}.`,
          });
        }
      })
      .catch((err) => {
        if (isMounted) {
          setInvoices([]);
          setError(err instanceof Error ? err.message : "Invoice archive could not be loaded.");
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    fetch(getApiUrl("/api/v1/restaurant/billing-settings/public"), { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setInvoiceFooter(data?.settings?.invoice_footer || ""))
      .catch(() => setInvoiceFooter(""));
  }, []);

  const filtered = invoices.filter((i) =>
    i.invoice_number.toLowerCase().includes(search.toLowerCase()) ||
    i.customer_name?.toLowerCase().includes(search.toLowerCase())
  );

  const handlePrint = (invoice: Invoice) => {
    try {
      setStatus({
        type: "info",
        text: `Print view prepared for invoice ${invoice.invoice_number}.`,
      });
      window.print();
    } catch {
      setStatus({
        type: "error",
        text: `Could not open print view for invoice ${invoice.invoice_number}.`,
      });
    }
  };

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
            aria-label="Search invoices"
            placeholder="Search by ID or Customer..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white/5 border border-white/10 p-4 pl-12 rounded-2xl outline-none focus:border-orange-500 transition-all font-medium"
          />
        </div>
      </div>

      {status && !isLoading && (
        <div
          role={status.type === "error" ? "alert" : "status"}
          className={`mb-6 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${
            status.type === "success"
              ? "border-green-400/30 bg-green-500/10 text-green-100"
              : status.type === "error"
                ? "border-red-400/30 bg-red-500/10 text-red-100"
                : "border-orange-400/30 bg-orange-500/10 text-orange-100"
          }`}
        >
          {status.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : status.type === "error" ? (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          ) : (
            <Printer className="h-4 w-4 shrink-0" />
          )}
          <span>{status.text}</span>
        </div>
      )}

      {isLoading && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-white/5 bg-[#1a1a1c] py-24 text-gray-400">
          <Loader2 className="mb-4 h-10 w-10 animate-spin text-orange-400" />
          <p className="text-xs font-black uppercase tracking-widest">Loading invoice archive...</p>
        </div>
      )}

      {error && !isLoading && (
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-6 text-yellow-100">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="text-lg font-black">Invoice archive needs attention</h2>
          </div>
          <p className="text-sm font-semibold leading-6">{error}</p>
        </div>
      )}

      {!isLoading && !error && (
      <div className="grid grid-cols-1 gap-4">
        {filtered.map((inv) => (
          <div key={inv.id} className="group bg-[#1a1a1c] p-6 rounded-[2rem] border border-white/5 hover:border-orange-500/30 transition-all flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-6 w-full md:w-auto">
              <div className="w-14 h-14 rounded-2xl bg-orange-500/10 flex items-center justify-center group-hover:bg-orange-500 group-hover:text-white transition-all text-orange-500">
                <Receipt className="w-6 h-6" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-black text-gray-500 uppercase tracking-widest leading-none mb-1">Invoice {inv.invoice_number}</span>
                <span className="text-xl font-bold">{inv.customer_name || 'Walk-in'}</span>
                <span className="text-xs text-gray-500 mt-0.5">{inv.date} | {inv.payment_method}</span>
              </div>
            </div>

            <div className="flex items-center gap-10 w-full md:w-auto justify-between md:justify-end">
              <div className="flex flex-col items-end">
                <span className="text-[10px] font-black text-gray-500 uppercase tracking-tighter">GST</span>
                <span className="text-sm font-mono text-orange-400/80">Rs {inv.cgst + inv.sgst}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[10px] font-black text-gray-500 uppercase tracking-tighter">Total Amount</span>
                <span className="text-2xl font-black">Rs {inv.total.toLocaleString()}</span>
              </div>
              <button 
                type="button"
                aria-label={`Print invoice ${inv.invoice_number}`}
                onClick={() => handlePrint(inv)}
                className="p-4 bg-white/5 rounded-2xl hover:bg-white hover:text-black transition-all border border-white/5 active:scale-95 shadow-xl"
              >
                <Printer className="w-5 h-5" />
              </button>
            </div>
          </div>
        ))}
      </div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-32 opacity-20">
          <Search className="w-16 h-16 mb-4" />
          <p className="text-xl font-bold italic">No matching invoices found in history node.</p>
        </div>
      )}

      {invoiceFooter && !isLoading && !error && (
        <p
          data-testid="invoice-footer"
          className="mt-8 border-t border-white/10 pt-4 text-center text-xs font-semibold text-gray-500"
        >
          {invoiceFooter}
        </p>
      )}
    </div>
  );
}
