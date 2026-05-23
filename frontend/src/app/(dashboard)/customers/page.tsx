"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Copy,
  Filter,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
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
  opted_out_customers: number;
  repeat_customers: number;
  high_spenders: number;
  email_ready_customers: number;
  missing_email_customers: number;
  recorded_spend: number;
};

type SegmentKey =
  | "all"
  | "marketing_opt_in"
  | "opted_out"
  | "repeat_customers"
  | "high_spenders"
  | "with_email"
  | "missing_email";

const segmentOptions: { value: SegmentKey; label: string }[] = [
  { value: "all", label: "All Contacts" },
  { value: "marketing_opt_in", label: "Marketing Opt-in" },
  { value: "opted_out", label: "Opted Out" },
  { value: "repeat_customers", label: "Repeat Customers" },
  { value: "high_spenders", label: "High Spenders" },
  { value: "with_email", label: "Email Ready" },
  { value: "missing_email", label: "Missing Email" },
];

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
  const [segment, setSegment] = useState<SegmentKey>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async (query = search, selectedSegment = segment) => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (selectedSegment !== "all") params.set("segment", selectedSegment);
    const queryString = params.toString() ? `?${params.toString()}` : "";
    const [customersRes, summaryRes] = await Promise.all([
      fetch(`${CUSTOMERS_API}/${queryString}`, { credentials: "include" }),
      fetch(`${CUSTOMERS_API}/summary`, { credentials: "include" }),
    ]);
    setCustomers(await customersRes.json());
    setSummary(await summaryRes.json());
  };

  const selectSegment = (value: SegmentKey) => {
    setSegment(value);
    fetchData(search, value);
  };

  const copyContacts = async () => {
    if (!customers.length) {
      setMessage("No contacts in the current view.");
      return;
    }
    const rows = customers.map((customer) =>
      [
        segmentLabel(segment),
        customer.phone,
        customer.email || "",
        customer.name || "",
        customer.opt_in_marketing ? "yes" : "no",
        customer.total_orders || 0,
        customer.total_spend || 0,
        customer.last_order_at || "",
      ].join("\t")
    );
    await navigator.clipboard.writeText(
      [
        "segment\tphone\temail\tname\tmarketing_opt_in\ttotal_orders\ttotal_spend\tlast_order_at",
        ...rows,
      ].join("\n")
    );
    setMessage(`Copied ${customers.length} contacts from ${segmentLabel(segment)}.`);
  };

  const saveCustomer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const response = await fetch(`${CUSTOMERS_API}/`, {
      method: "POST",
      credentials: "include",
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

      <div className="grid grid-cols-1 gap-4 mb-8 md:grid-cols-2 xl:grid-cols-5">
        <Metric label="Total Contacts" value={summary?.total_customers || 0} />
        <Metric label="Marketing Opt-in" value={summary?.opted_in_customers || 0} />
        <Metric label="Opted Out" value={summary?.opted_out_customers || 0} />
        <Metric label="Email Ready" value={summary?.email_ready_customers || 0} />
        <Metric label="Recorded Spend" value={`Rs ${Math.round(summary?.recorded_spend || 0).toLocaleString()}`} />
      </div>

      <section className="mb-8 rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-black">Campaign Readiness</h2>
            <p className="mt-1 text-sm text-gray-500">
              Audience health before launching WhatsApp, SMS, or email offers.
            </p>
          </div>
          <Link
            href="/promotions"
            className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 font-bold text-black hover:bg-orange-500 hover:text-white"
          >
            <Send className="h-4 w-4" /> Open Campaigns
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          <ReadinessCard
            icon={MessageCircle}
            label="WhatsApp/SMS Ready"
            value={summary?.opted_in_customers || 0}
            helper="Opted-in contacts with saved phone numbers."
            tone="orange"
          />
          <ReadinessCard
            icon={Mail}
            label="Email Ready"
            value={summary?.email_ready_customers || 0}
            helper={`${summary?.missing_email_customers || 0} contacts still need email capture.`}
            tone="blue"
          />
          <ReadinessCard
            icon={TrendingUp}
            label="High Spenders"
            value={summary?.high_spenders || 0}
            helper="Best audience for premium bundles and party packs."
            tone="green"
          />
          <ReadinessCard
            icon={Users}
            label="Repeat Buyers"
            value={summary?.repeat_customers || 0}
            helper="Good fit for loyalty coupons and win-back offers."
            tone="violet"
          />
        </div>
      </section>

      <div className="bg-[#1a1a1c] border border-white/5 rounded-xl p-6">
        <div className="grid grid-cols-1 gap-3 mb-6 xl:grid-cols-12">
          <div className="relative xl:col-span-6">
            <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") fetchData();
              }}
              placeholder="Search by name, phone, email, or notes"
              className="w-full bg-black/30 border border-white/10 rounded-xl py-3 pl-11 pr-4 outline-none focus:border-orange-500"
            />
          </div>
          <label className="relative xl:col-span-3">
            <Filter className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
            <select
              value={segment}
              onChange={(event) => selectSegment(event.target.value as SegmentKey)}
              className="w-full appearance-none bg-black/30 border border-white/10 rounded-xl py-3 pl-11 pr-4 outline-none focus:border-orange-500"
            >
              {segmentOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => fetchData()}
            className="px-5 py-3 rounded-xl bg-orange-500 text-white font-bold hover:bg-orange-600 xl:col-span-1"
          >
            Search
          </button>
          <button
            onClick={copyContacts}
            className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white text-black font-bold hover:bg-orange-500 hover:text-white xl:col-span-2"
          >
            <Copy className="w-4 h-4" /> Copy
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
              <div className="lg:col-span-1">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-black ${
                    customer.opt_in_marketing
                      ? "bg-green-500/10 text-green-300"
                      : "bg-red-500/10 text-red-300"
                  }`}
                >
                  {customer.opt_in_marketing ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <XCircle className="h-3 w-3" />
                  )}
                  {customer.opt_in_marketing ? "Opt-in" : "Opt-out"}
                </span>
              </div>
              <div className="lg:col-span-1 text-right">
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

function ReadinessCard({
  icon: Icon,
  label,
  value,
  helper,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  helper: string;
  tone: "orange" | "blue" | "green" | "violet";
}) {
  const toneClass = {
    orange: "bg-orange-500/10 text-orange-300",
    blue: "bg-blue-500/10 text-blue-300",
    green: "bg-green-500/10 text-green-300",
    violet: "bg-violet-500/10 text-violet-300",
  }[tone];

  return (
    <div className="rounded-xl border border-white/5 bg-black/25 p-5">
      <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl ${toneClass}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-xs font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
      <p className="mt-3 min-h-10 text-sm font-semibold leading-5 text-gray-500">{helper}</p>
    </div>
  );
}

function segmentLabel(value: SegmentKey) {
  return segmentOptions.find((option) => option.value === value)?.label || value;
}
