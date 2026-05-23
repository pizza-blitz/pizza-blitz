"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Award,
  CheckCircle2,
  Clock3,
  Copy,
  Filter,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Target,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const CUSTOMERS_API = getApiUrl("/api/v1/restaurant/customers");

type RetentionCounts = {
  new_guests: number;
  regular_guests: number;
  vip_guests: number;
  active_customers: number;
  comeback_customers: number;
  win_back_customers: number;
};

type Customer = {
  id: number;
  name?: string | null;
  phone: string;
  email?: string | null;
  opt_in_marketing: boolean;
  total_orders: number;
  total_spend: number;
  last_order_at?: string | null;
  notes?: string | null;
};

type CustomerDraft = {
  email: string;
  opt_in_marketing: boolean;
};

type RetentionCustomer = Customer & {
  tier: string;
  next_tier: string;
  tier_progress_percent: number;
  orders_to_next_tier: number;
  average_order_value: number;
  days_since_last_order?: number | null;
  cadence: string;
  retention_segment: string;
  recommended_action: string;
  priority_score: number;
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
  retention_segments?: RetentionCounts;
};

type Retention = {
  generated_at: string;
  counts: RetentionCounts;
  campaign_ready_count: number;
  average_order_value: number;
  customers: RetentionCustomer[];
};

type SegmentKey =
  | "all"
  | "marketing_opt_in"
  | "opted_out"
  | "repeat_customers"
  | "high_spenders"
  | "with_email"
  | "missing_email"
  | "new_guests"
  | "regular_guests"
  | "vip_guests"
  | "active_customers"
  | "comeback_customers"
  | "win_back_customers";

const segmentOptions: { value: SegmentKey; label: string }[] = [
  { value: "all", label: "All Contacts" },
  { value: "marketing_opt_in", label: "Marketing Opt-in" },
  { value: "opted_out", label: "Opted Out" },
  { value: "repeat_customers", label: "Repeat Customers" },
  { value: "high_spenders", label: "High Spenders" },
  { value: "with_email", label: "Email Ready" },
  { value: "missing_email", label: "Missing Email" },
  { value: "new_guests", label: "New Guests" },
  { value: "regular_guests", label: "Regular Guests" },
  { value: "vip_guests", label: "VIP Guests" },
  { value: "active_customers", label: "Active This Week" },
  { value: "comeback_customers", label: "Comeback Due" },
  { value: "win_back_customers", label: "Win-back Priority" },
];

const validCustomerSegments = new Set<SegmentKey>(segmentOptions.map((option) => option.value));

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
  const [retention, setRetention] = useState<Retention | null>(null);
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<SegmentKey>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [customerDrafts, setCustomerDrafts] = useState<Record<number, CustomerDraft>>({});
  const [savingCustomerId, setSavingCustomerId] = useState<number | null>(null);
  const [fromCampaignCleanup, setFromCampaignCleanup] = useState(false);
  const [cleanupReturnHref, setCleanupReturnHref] = useState("/promotions");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const initial = readInitialCustomerFilters();
    setSearch(initial.query);
    setSegment(initial.segment);
    setFromCampaignCleanup(initial.fromCleanup);
    setCleanupReturnHref(campaignReturnHref(initial.campaignId));
    if (initial.fromCleanup) {
      setMessage(`Opened ${segmentLabel(initial.segment)} cleanup queue from campaign audit.`);
    }
    fetchData(initial.query, initial.segment);
  }, []);

  const fetchData = async (query = search, selectedSegment = segment) => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (selectedSegment !== "all") params.set("segment", selectedSegment);
    const queryString = params.toString() ? `?${params.toString()}` : "";
    const [customersRes, summaryRes, retentionRes] = await Promise.all([
      fetch(`${CUSTOMERS_API}/${queryString}`, { credentials: "include" }),
      fetch(`${CUSTOMERS_API}/summary`, { credentials: "include" }),
      fetch(`${CUSTOMERS_API}/retention`, { credentials: "include" }),
    ]);
    const customerRows = await customersRes.json();
    setCustomers(customerRows);
    setCustomerDrafts((current) => {
      const next = { ...current };
      customerRows.forEach((customer: Customer) => {
        next[customer.id] = {
          email: next[customer.id]?.email ?? customer.email ?? "",
          opt_in_marketing: next[customer.id]?.opt_in_marketing ?? customer.opt_in_marketing,
        };
      });
      return next;
    });
    setSummary(await summaryRes.json());
    setRetention(await retentionRes.json());
  };

  const selectSegment = (value: SegmentKey) => {
    setSegment(value);
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (value === "all") {
        params.delete("segment");
      } else {
        params.set("segment", value);
      }
      const query = params.toString();
      window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
    }
    fetchData(search, value);
  };

  const updateCustomerDraft = (customerId: number, patch: Partial<CustomerDraft>) => {
    setCustomerDrafts((current) => ({
      ...current,
      [customerId]: {
        email: current[customerId]?.email ?? "",
        opt_in_marketing: current[customerId]?.opt_in_marketing ?? false,
        ...patch,
      },
    }));
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

  const saveCustomerCleanup = async (customer: Customer) => {
    const draft = customerDrafts[customer.id] || {
      email: customer.email || "",
      opt_in_marketing: customer.opt_in_marketing,
    };
    setSavingCustomerId(customer.id);
    const response = await fetch(`${CUSTOMERS_API}/${customer.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: draft.email.trim() || null,
        opt_in_marketing: draft.opt_in_marketing,
      }),
    });
    const data = await response.json();
    setSavingCustomerId(null);
    if (!response.ok) {
      setMessage(data.detail || "Could not update customer cleanup.");
      return;
    }
    setMessage(`Updated ${data.name || data.phone} for campaign cleanup.`);
    await fetchData(search, segment);
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
        <div className="flex flex-wrap gap-3">
          {fromCampaignCleanup && (
            <Link
              href={cleanupReturnHref}
              className="bg-orange-500 text-white px-4 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-orange-600"
            >
              <Send className="w-4 h-4" /> Return To Campaigns
            </Link>
          )}
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

      {retention && (
        <section className="mb-8">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-orange-400">Retention Command Center</p>
              <h2 className="mt-1 text-2xl font-black">Customer loyalty and win-back queue</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => selectSegment("win_back_customers")}
                className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm font-black text-red-200 hover:bg-red-500/20"
              >
                Win-back
              </button>
              <button
                onClick={() => selectSegment("comeback_customers")}
                className="rounded-md border border-orange-400/30 bg-orange-500/10 px-3 py-2 text-sm font-black text-orange-100 hover:bg-orange-500/20"
              >
                Comeback
              </button>
              <button
                onClick={() => selectSegment("vip_guests")}
                className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm font-black text-emerald-100 hover:bg-emerald-500/20"
              >
                VIP
              </button>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
            <RetentionStat icon={Users} label="New Guests" value={retention.counts.new_guests} tone="orange" />
            <RetentionStat icon={ShieldCheck} label="Regular" value={retention.counts.regular_guests} tone="blue" />
            <RetentionStat icon={Award} label="VIP" value={retention.counts.vip_guests} tone="green" />
            <RetentionStat icon={Clock3} label="Active" value={retention.counts.active_customers} tone="violet" />
            <RetentionStat icon={Target} label="Comeback" value={retention.counts.comeback_customers} tone="orange" />
            <RetentionStat icon={MessageCircle} label="Win-back" value={retention.counts.win_back_customers} tone="red" />
          </div>

          <div className="overflow-hidden rounded-xl border border-white/5 bg-[#1a1a1c]">
            <div className="grid grid-cols-1 gap-3 border-b border-white/5 px-5 py-4 text-xs font-black uppercase tracking-widest text-gray-500 lg:grid-cols-12">
              <span className="lg:col-span-3">Customer</span>
              <span className="lg:col-span-2">Tier</span>
              <span className="lg:col-span-2">Cadence</span>
              <span className="lg:col-span-2">AOV</span>
              <span className="lg:col-span-3">Next Action</span>
            </div>
            <div className="divide-y divide-white/5">
              {retention.customers.slice(0, 8).map((customer) => (
                <div key={customer.id} className="grid grid-cols-1 gap-3 px-5 py-4 text-sm lg:grid-cols-12 lg:items-center">
                  <div className="lg:col-span-3">
                    <p className="font-black">{customer.name || "Walk-in Customer"}</p>
                    <p className="mt-1 text-xs font-semibold text-gray-500">{customer.phone}</p>
                  </div>
                  <div className="lg:col-span-2">
                    <span className="inline-flex rounded-md bg-white/5 px-2 py-1 text-xs font-black text-orange-100">
                      {customer.tier}
                    </span>
                    <div className="mt-2 h-2 rounded-full bg-black/40">
                      <div
                        className="h-2 rounded-full bg-orange-500"
                        style={{ width: `${Math.min(100, Math.max(0, customer.tier_progress_percent || 0))}%` }}
                      />
                    </div>
                  </div>
                  <div className="lg:col-span-2">
                    <p className="font-bold">{customer.cadence}</p>
                    <p className="text-xs text-gray-500">
                      {customer.days_since_last_order === null || customer.days_since_last_order === undefined
                        ? "No order age"
                        : `${customer.days_since_last_order} days ago`}
                    </p>
                  </div>
                  <div className="lg:col-span-2">
                    <p className="font-black">Rs {Math.round(customer.average_order_value || 0).toLocaleString()}</p>
                    <p className="text-xs text-gray-500">{customer.total_orders || 0} orders</p>
                  </div>
                  <div className="lg:col-span-3">
                    <p className="font-semibold text-gray-200">{customer.recommended_action}</p>
                    <p className="mt-1 text-xs text-gray-500">Priority {customer.priority_score}/100</p>
                  </div>
                </div>
              ))}
              {!retention.customers.length && (
                <div className="p-8 text-center text-gray-500">No retention records yet.</div>
              )}
            </div>
          </div>
        </section>
      )}

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
          {customers.map((customer) => {
            const draft = customerDrafts[customer.id] || {
              email: customer.email || "",
              opt_in_marketing: customer.opt_in_marketing,
            };
            const isSaving = savingCustomerId === customer.id;
            return (
              <div
                key={customer.id}
                data-testid={`customer-row-${customer.id}`}
                className="space-y-4 bg-black/25 border border-white/5 rounded-xl p-4"
              >
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                  <div className="lg:col-span-4">
                    <p className="font-black">{customer.name || "Walk-in Customer"}</p>
                    <p className="text-xs text-gray-500">
                      Last order: {customer.last_order_at ? customer.last_order_at.slice(0, 10) : "Not yet"}
                    </p>
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
                <div className="grid grid-cols-1 gap-3 border-t border-white/5 pt-4 md:grid-cols-12">
                  <label className="md:col-span-5">
                    <span className="mb-2 block text-xs font-black uppercase tracking-widest text-gray-500">
                      Email
                    </span>
                    <input
                      data-testid={`customer-email-${customer.id}`}
                      type="email"
                      value={draft.email}
                      onChange={(event) => updateCustomerDraft(customer.id, { email: event.target.value })}
                      placeholder="customer@example.com"
                      className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-3 text-sm outline-none focus:border-orange-500"
                    />
                  </label>
                  <label className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-sm font-bold text-gray-200 md:col-span-4">
                    <input
                      data-testid={`customer-consent-${customer.id}`}
                      type="checkbox"
                      checked={draft.opt_in_marketing}
                      onChange={(event) => updateCustomerDraft(customer.id, { opt_in_marketing: event.target.checked })}
                      className="h-4 w-4"
                    />
                    Marketing consent
                  </label>
                  <button
                    data-testid={`customer-save-${customer.id}`}
                    type="button"
                    onClick={() => saveCustomerCleanup(customer)}
                    disabled={isSaving}
                    className="flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-black text-black hover:bg-orange-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60 md:col-span-3"
                  >
                    <Save className="h-4 w-4" /> {isSaving ? "Saving..." : "Save Cleanup"}
                  </button>
                </div>
              </div>
            );
          })}
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

function RetentionStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: "orange" | "blue" | "green" | "violet" | "red";
}) {
  const toneClass = {
    orange: "bg-orange-500/10 text-orange-300",
    blue: "bg-blue-500/10 text-blue-300",
    green: "bg-green-500/10 text-green-300",
    violet: "bg-violet-500/10 text-violet-300",
    red: "bg-red-500/10 text-red-300",
  }[tone];

  return (
    <div className="rounded-xl border border-white/5 bg-[#1a1a1c] p-4">
      <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-md ${toneClass}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-xs font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
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

function readInitialCustomerFilters(): { query: string; segment: SegmentKey; fromCleanup: boolean; campaignId: number | null } {
  if (typeof window === "undefined") {
    return { query: "", segment: "all", fromCleanup: false, campaignId: null };
  }

  const params = new URLSearchParams(window.location.search);
  const segmentParam = params.get("segment") as SegmentKey | null;
  const segment = segmentParam && validCustomerSegments.has(segmentParam) ? segmentParam : "all";
  const campaignId = Number(params.get("campaign"));

  return {
    query: params.get("q") || "",
    segment,
    fromCleanup: params.get("source") === "campaign_cleanup",
    campaignId: Number.isFinite(campaignId) && campaignId > 0 ? campaignId : null,
  };
}

function campaignReturnHref(campaignId: number | null) {
  if (!campaignId) return "/promotions";
  return `/promotions?campaign=${campaignId}&source=campaign_cleanup_return`;
}
