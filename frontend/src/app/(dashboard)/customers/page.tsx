"use client";

import { useEffect, useState } from "react";
import { Mail, Phone, Plus, RefreshCw, Search, Users } from "lucide-react";
import { getApiUrl } from "@/lib/api";

const CUSTOMERS_API = getApiUrl("/api/v1/restaurant/customers");

type Customer = {
  id: number;
  name?: string | null;
  phone: string;
  email?: string | null;
  opt_in_marketing: boolean;
  total_orders: number;
  total_spend: number;
  last_order_at?: string | null;
};

type Summary = {
  total_customers: number;
  opted_in_customers: number;
  repeat_customers: number;
  recorded_spend: number;
};

const emptyForm = {
  name: "",
  phone: "",
  email: "",
  opt_in_marketing: true,
  notes: "",
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async (query = search) => {
    const params = query ? `?q=${encodeURIComponent(query)}` : "";
    const [customersRes, summaryRes] = await Promise.all([
      fetch(`${CUSTOMERS_API}/${params}`),
      fetch(`${CUSTOMERS_API}/summary`),
    ]);
    setCustomers(await customersRes.json());
    setSummary(await summaryRes.json());
  };

  const saveCustomer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const response = await fetch(`${CUSTOMERS_API}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.name || null,
        phone: formData.phone,
        email: formData.email || null,
        opt_in_marketing: formData.opt_in_marketing,
        notes: formData.notes || null,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.detail || "Could not save customer.");
      return;
    }
    setMessage(`Saved ${data.phone}.`);
    setShowAdd(false);
    setFormData(emptyForm);
    fetchData();
  };

  return (
    <div className="p-8 bg-[#0a0a0b] min-h-screen text-white">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-orange-400 underline decoration-orange-500/20 underline-offset-8">
            Customer Repository
          </h1>
          <p className="text-sm text-gray-500 mt-3">
            Contacts captured from counter orders and manual entries.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => fetchData()}
            className="bg-white/5 text-white px-4 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-white/10"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="bg-white text-black px-5 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-orange-500 hover:text-white"
          >
            <Plus className="w-4 h-4" /> Add Customer
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-6 rounded-xl border border-orange-500/20 bg-orange-500/10 px-5 py-3 text-sm text-orange-100">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Metric label="Total Contacts" value={summary?.total_customers || 0} />
        <Metric label="Marketing Opt-in" value={summary?.opted_in_customers || 0} />
        <Metric label="Repeat Customers" value={summary?.repeat_customers || 0} />
        <Metric label="Recorded Spend" value={`Rs ${Math.round(summary?.recorded_spend || 0).toLocaleString()}`} />
      </div>

      <div className="bg-[#1a1a1c] border border-white/5 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") fetchData();
              }}
              placeholder="Search by name or phone"
              className="w-full bg-black/30 border border-white/10 rounded-xl py-3 pl-11 pr-4 outline-none focus:border-orange-500"
            />
          </div>
          <button
            onClick={() => fetchData()}
            className="px-5 py-3 rounded-xl bg-orange-500 text-white font-bold hover:bg-orange-600"
          >
            Search
          </button>
        </div>

        <div className="space-y-3">
          {customers.map((customer) => (
            <div key={customer.id} className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center bg-black/25 border border-white/5 rounded-xl p-4">
              <div className="lg:col-span-4">
                <p className="font-black">{customer.name || "Walk-in Customer"}</p>
                <p className="text-xs text-gray-500">Last order: {customer.last_order_at ? customer.last_order_at.slice(0, 10) : "Not yet"}</p>
              </div>
              <div className="lg:col-span-3 flex items-center gap-2 text-sm text-gray-300">
                <Phone className="w-4 h-4 text-orange-400" /> {customer.phone}
              </div>
              <div className="lg:col-span-3 flex items-center gap-2 text-sm text-gray-300">
                <Mail className="w-4 h-4 text-orange-400" /> {customer.email || "No email"}
              </div>
              <div className="lg:col-span-2 text-right">
                <p className="font-black">Rs {Math.round(customer.total_spend || 0).toLocaleString()}</p>
                <p className="text-xs text-gray-500">{customer.total_orders || 0} orders</p>
              </div>
            </div>
          ))}
          {!customers.length && (
            <div className="text-center text-gray-500 border border-dashed border-white/10 rounded-xl p-8">
              No customer contacts yet.
            </div>
          )}
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <form onSubmit={saveCustomer} className="w-full max-w-lg bg-[#1a1a1c] border border-white/10 rounded-xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-black flex items-center gap-2">
                <Users className="w-5 h-5 text-orange-400" /> Customer Contact
              </h2>
              <button type="button" onClick={() => setShowAdd(false)} className="text-gray-500 hover:text-white">
                Close
              </button>
            </div>
            <div className="space-y-4">
              <input
                value={formData.name}
                onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                placeholder="Name"
                className="w-full bg-black/30 border border-white/10 rounded-xl p-4 outline-none focus:border-orange-500"
              />
              <input
                value={formData.phone}
                onChange={(event) => setFormData({ ...formData, phone: event.target.value })}
                placeholder="Phone"
                required
                className="w-full bg-black/30 border border-white/10 rounded-xl p-4 outline-none focus:border-orange-500"
              />
              <input
                value={formData.email}
                onChange={(event) => setFormData({ ...formData, email: event.target.value })}
                placeholder="Email"
                type="email"
                className="w-full bg-black/30 border border-white/10 rounded-xl p-4 outline-none focus:border-orange-500"
              />
              <label className="flex items-center gap-3 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={formData.opt_in_marketing}
                  onChange={(event) => setFormData({ ...formData, opt_in_marketing: event.target.checked })}
                />
                Allow marketing messages
              </label>
              <textarea
                value={formData.notes}
                onChange={(event) => setFormData({ ...formData, notes: event.target.value })}
                placeholder="Notes"
                className="w-full bg-black/30 border border-white/10 rounded-xl p-4 outline-none focus:border-orange-500"
              />
              <button className="w-full bg-orange-500 rounded-xl py-4 font-black hover:bg-orange-600">
                Save Customer
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-[#1a1a1c] border border-white/5 rounded-xl p-5">
      <p className="text-xs text-gray-500 font-black uppercase tracking-widest">{label}</p>
      <p className="text-2xl font-black mt-2">{value}</p>
    </div>
  );
}
