"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Store as StoreIcon,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type StoreSummary = {
  id: number;
  name: string;
  code: string;
  address_line?: string | null;
  phone?: string | null;
  is_active: boolean;
  orders: number;
  revenue: number;
  avg_order_value: number;
  tips: number;
  refunds: number;
};

type Consolidated = {
  start_date: string;
  end_date: string;
  stores: StoreSummary[];
  totals: {
    orders: number;
    revenue: number;
    avg_order_value: number;
    tips: number;
    refunds: number;
  };
  best_store?: { id: number; name: string; revenue: number } | null;
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

export default function StoresPage() {
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [consolidated, setConsolidated] = useState<Consolidated | null>(null);
  const [startDate, setStartDate] = useState(isoDaysAgo(29));
  const [endDate, setEndDate] = useState(isoDaysAgo(0));
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(
      getApiUrl(`/api/v1/restaurant/stores/consolidated?start_date=${startDate}&end_date=${endDate}`),
      { credentials: "include", cache: "no-store" }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.detail || "Stores could not be loaded.");
      return;
    }
    setConsolidated(data);
    setStores(data.stores || []);
  }, [startDate, endDate]);

  useEffect(() => {
    setHydrated(true);
    void load();
  }, [load]);

  const createStore = async () => {
    setBusy("create");
    setMessage("");
    try {
      const response = await fetch(getApiUrl("/api/v1/restaurant/stores/"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim().toUpperCase(),
          address_line: address.trim() || null,
          phone: phone.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Store could not be created.");
      setName("");
      setCode("");
      setAddress("");
      setPhone("");
      setMessage(`${data.name} added to the franchise.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Store could not be created.");
    } finally {
      setBusy("");
    }
  };

  const toggleStore = async (store: StoreSummary) => {
    setBusy(`store-${store.id}`);
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/stores/${store.id}`),
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: !store.is_active }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Store could not be updated.");
      setMessage(`${data.name} is now ${data.is_active ? "active" : "paused"}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Store could not be updated.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div
      data-testid="stores-page"
      data-hydrated={hydrated ? "true" : "false"}
      className="mx-auto max-w-6xl space-y-6 animate-in fade-in duration-300"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-xs font-black uppercase tracking-widest text-gray-400 hover:text-orange-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to settings
          </Link>
          <h1 className="mt-2 flex items-center gap-3 text-3xl font-black text-gray-950">
            <Building2 className="h-7 w-7 text-orange-600" /> Stores & franchise
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Register locations, pause ordering per store and compare consolidated performance.
          </p>
        </div>
        <button
          type="button"
          data-testid="stores-refresh"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-widest text-gray-700 hover:border-orange-300"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {message && (
        <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-900">
          {message}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Stores
          </p>
          <p className="mt-1 text-2xl font-black text-gray-950">{stores.length}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Active
          </p>
          <p className="mt-1 text-2xl font-black text-emerald-700">
            {stores.filter((store) => store.is_active).length}
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Group orders
          </p>
          <p
            data-testid="consolidated-total-orders"
            className="mt-1 text-2xl font-black text-gray-950"
          >
            {consolidated?.totals.orders || 0}
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Group revenue
          </p>
          <p
            data-testid="consolidated-total-revenue"
            className="mt-1 text-2xl font-black text-gray-950"
          >
            {money(consolidated?.totals.revenue || 0)}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-orange-600">
              <CalendarDays className="h-4 w-4" /> Consolidated report
            </p>
            <h2 className="mt-1 text-lg font-black text-gray-950">
              Franchise performance by store
            </h2>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              From
              <input
                type="date"
                aria-label="Consolidated start date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
              />
            </label>
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              To
              <input
                type="date"
                aria-label="Consolidated end date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
              />
            </label>
            <button
              type="button"
              data-testid="consolidated-apply"
              onClick={() => void load()}
              className="h-10 rounded-lg bg-gray-950 px-4 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600"
            >
              Apply
            </button>
          </div>
        </div>

        {consolidated?.best_store && (
          <p className="mt-3 text-xs font-bold text-emerald-700">
            Best performing store: {consolidated.best_store.name} (
            {money(consolidated.best_store.revenue)})
          </p>
        )}

        <div
          data-testid="consolidated-table"
          className="mt-4 overflow-x-auto rounded-xl border border-gray-100"
        >
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-500">
              <tr>
                <th className="px-3 py-2">Store</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Orders</th>
                <th className="px-3 py-2 text-right">Revenue</th>
                <th className="px-3 py-2 text-right">Avg order</th>
                <th className="px-3 py-2 text-right">Tips</th>
                <th className="px-3 py-2 text-right">Refunds</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stores.map((store) => (
                <tr key={store.id} data-testid={`store-row-${store.id}`}>
                  <td className="px-3 py-2">
                    <p className="font-black text-gray-900">{store.name}</p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      {store.code}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest ${
                        store.is_active
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {store.is_active ? "Active" : "Paused"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-bold">{store.orders}</td>
                  <td className="px-3 py-2 text-right font-black">
                    {money(store.revenue)}
                  </td>
                  <td className="px-3 py-2 text-right font-bold">
                    {money(store.avg_order_value)}
                  </td>
                  <td className="px-3 py-2 text-right font-bold">{money(store.tips)}</td>
                  <td className="px-3 py-2 text-right font-bold">
                    {money(store.refunds)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-orange-50/60">
              <tr>
                <td className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-orange-700" colSpan={2}>
                  Group total
                </td>
                <td className="px-3 py-2 text-right font-black text-orange-800">
                  {consolidated?.totals.orders || 0}
                </td>
                <td className="px-3 py-2 text-right font-black text-orange-800">
                  {money(consolidated?.totals.revenue || 0)}
                </td>
                <td className="px-3 py-2 text-right font-black text-orange-800">
                  {money(consolidated?.totals.avg_order_value || 0)}
                </td>
                <td className="px-3 py-2 text-right font-black text-orange-800">
                  {money(consolidated?.totals.tips || 0)}
                </td>
                <td className="px-3 py-2 text-right font-black text-orange-800">
                  {money(consolidated?.totals.refunds || 0)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-orange-600">
            <Plus className="h-4 w-4" /> Add a store
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              Store name
              <input
                data-testid="store-name"
                aria-label="Store name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
              />
            </label>
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              Code
              <input
                data-testid="store-code"
                aria-label="Store code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="INDIRANAGAR"
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-black uppercase text-gray-900"
              />
            </label>
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              Address
              <input
                data-testid="store-address"
                aria-label="Store address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              Phone
              <input
                data-testid="store-phone"
                aria-label="Store phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>
          </div>
          <button
            type="button"
            data-testid="create-store"
            onClick={createStore}
            disabled={
              busy === "create" || name.trim().length < 2 || code.trim().length < 2
            }
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {busy === "create" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add store
          </button>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-orange-600">
            <StoreIcon className="h-4 w-4" /> Locations
          </p>
          <div className="mt-3 space-y-2">
            {stores.map((store) => (
              <div
                key={store.id}
                data-testid={`store-card-${store.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-3"
              >
                <div>
                  <p className="text-sm font-black text-gray-900">{store.name}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    {store.code} · {store.address_line || "Address not set"}
                  </p>
                </div>
                <button
                  type="button"
                  data-testid={`toggle-store-${store.id}`}
                  onClick={() => void toggleStore(store)}
                  disabled={busy === `store-${store.id}`}
                  className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest disabled:opacity-50 ${
                    store.is_active
                      ? "border border-gray-200 bg-white text-gray-600"
                      : "bg-emerald-600 text-white"
                  }`}
                >
                  {store.is_active ? "Pause" : "Activate"}
                  {store.is_active ? null : <CheckCircle2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
