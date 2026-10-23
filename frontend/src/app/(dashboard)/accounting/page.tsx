"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Calculator,
  Download,
  FileSpreadsheet,
  Landmark,
  Loader2,
  RefreshCw,
  Receipt,
  Wallet,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type PaymentRow = {
  method: string;
  orders: number;
  billed: number;
  tax: number;
};

type StoreRow = {
  store_id: number;
  store_name: string;
  store_code: string;
  orders: number;
  billed: number;
  tax: number;
  refunds: number;
};

type AccountingSummary = {
  start_date: string;
  end_date: string;
  orders: number;
  gross_sales: number;
  discounts: number;
  tax: number;
  cgst: number;
  sgst: number;
  tips: number;
  refunds: number;
  total_billed: number;
  net_collected: number;
  avg_order_value: number;
  payments: PaymentRow[];
  stores: StoreRow[];
};

function businessToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isoDaysAgo(days: number) {
  const date = new Date(`${businessToday()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function money(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

export default function AccountingPage() {
  const [summary, setSummary] = useState<AccountingSummary | null>(null);
  const [startDate, setStartDate] = useState(isoDaysAgo(29));
  const [endDate, setEndDate] = useState(isoDaysAgo(0));
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(
        getApiUrl(
          `/api/v1/restaurant/accounting/summary?start_date=${startDate}&end_date=${endDate}`
        ),
        { credentials: "include", cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Accounting summary failed.");
      setSummary(data);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Accounting summary failed."
      );
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    setHydrated(true);
    void load();
  }, [load]);

  const download = async () => {
    setDownloading(true);
    try {
      const response = await fetch(
        getApiUrl(
          `/api/v1/restaurant/accounting/export?start_date=${startDate}&end_date=${endDate}`
        ),
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("CSV export failed.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `pizza-blitz-accounting-${startDate}-to-${endDate}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("GST CSV downloaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "CSV export failed.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      data-testid="accounting-page"
      data-hydrated={hydrated ? "true" : "false"}
      className="space-y-6 animate-in fade-in duration-300"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
            <Landmark className="h-4 w-4" /> Finance
          </p>
          <h1 className="mt-1 text-3xl font-black text-gray-950">Accounting & GST</h1>
          <p className="mt-1 text-sm text-gray-500">
            Tax split, payment mix, store totals and a Tally/Zoho-ready order CSV.
          </p>
        </div>
        <button
          type="button"
          data-testid="accounting-download"
          onClick={download}
          disabled={downloading}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600 disabled:opacity-50"
        >
          {downloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Download GST CSV
        </button>
      </div>

      {message && (
        <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-900">
          {message}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-100 bg-white p-4">
        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
          From
          <input
            type="date"
            aria-label="Accounting start date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
          />
        </label>
        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
          To
          <input
            type="date"
            aria-label="Accounting end date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
          />
        </label>
        <button
          type="button"
          data-testid="accounting-apply"
          onClick={() => void load()}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-orange-600 px-4 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-700"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Apply
        </button>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Gross sales
          </p>
          <p data-testid="accounting-gross" className="mt-1 text-2xl font-black text-gray-950">
            {money(summary?.gross_sales || 0)}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-gray-500">
            {summary?.orders || 0} orders · AOV {money(summary?.avg_order_value || 0)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            GST collected
          </p>
          <p data-testid="accounting-tax" className="mt-1 text-2xl font-black text-gray-950">
            {money(summary?.tax || 0)}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-gray-500">
            CGST {money(summary?.cgst || 0)} · SGST {money(summary?.sgst || 0)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Net collected
          </p>
          <p data-testid="accounting-net" className="mt-1 text-2xl font-black text-emerald-700">
            {money(summary?.net_collected || 0)}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-gray-500">
            Refunds {money(summary?.refunds || 0)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Tips & discounts
          </p>
          <p className="mt-1 text-2xl font-black text-gray-950">
            {money(summary?.tips || 0)}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-gray-500">
            Discounts {money(summary?.discounts || 0)}
          </p>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
            <Wallet className="h-4 w-4 text-orange-600" /> Payment mix
          </p>
          <div
            data-testid="accounting-payment-table"
            className="mt-3 overflow-x-auto"
          >
            <table className="w-full min-w-[360px] text-left text-sm">
              <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-500">
                <tr>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2 text-right">Orders</th>
                  <th className="px-3 py-2 text-right">Billed</th>
                  <th className="px-3 py-2 text-right">GST</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(summary?.payments || []).length ? (
                  summary?.payments.map((row) => (
                    <tr key={row.method}>
                      <td className="px-3 py-2 font-black capitalize text-gray-900">
                        {row.method.replace(/_/g, " ")}
                      </td>
                      <td className="px-3 py-2 text-right font-bold">{row.orders}</td>
                      <td className="px-3 py-2 text-right font-black">
                        {money(row.billed)}
                      </td>
                      <td className="px-3 py-2 text-right font-bold">
                        {money(row.tax)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center font-bold text-gray-400">
                      No payments in this range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
            <Receipt className="h-4 w-4 text-orange-600" /> Store totals
          </p>
          <div data-testid="accounting-store-table" className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[360px] text-left text-sm">
              <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-500">
                <tr>
                  <th className="px-3 py-2">Store</th>
                  <th className="px-3 py-2 text-right">Orders</th>
                  <th className="px-3 py-2 text-right">Billed</th>
                  <th className="px-3 py-2 text-right">GST</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(summary?.stores || []).length ? (
                  summary?.stores.map((row) => (
                    <tr key={row.store_id}>
                      <td className="px-3 py-2">
                        <p className="font-black text-gray-900">{row.store_name}</p>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                          {row.store_code}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right font-bold">{row.orders}</td>
                      <td className="px-3 py-2 text-right font-black">
                        {money(row.billed)}
                      </td>
                      <td className="px-3 py-2 text-right font-bold">
                        {money(row.tax)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center font-bold text-gray-400">
                      No store activity in this range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-orange-100 bg-orange-50 p-5">
        <p className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-orange-800">
          <Calculator className="h-4 w-4" /> CSV contents
        </p>
        <p className="mt-2 text-sm font-semibold text-orange-900">
          One row per non-cancelled order with business date, store, payment method,
          subtotal, discount, CGST/SGST, tip, refund and net collected. Import into
          Tally, Zoho Books or QuickBooks as a sales journal.
        </p>
        <p className="mt-2 flex items-center gap-2 text-[11px] font-bold text-orange-700">
          <FileSpreadsheet className="h-3.5 w-3.5" /> Tax is split evenly into CGST and
          SGST; export a different range with the date picker.
        </p>
      </section>
    </div>
  );
}
