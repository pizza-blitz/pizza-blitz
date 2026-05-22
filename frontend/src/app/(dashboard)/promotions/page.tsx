"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  Copy,
  Megaphone,
  Plus,
  RefreshCw,
  Send,
  Tag,
  Users,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const PROMOTIONS_API = getApiUrl("/api/v1/restaurant/promotions");

type Promotion = {
  id: number;
  name: string;
  code?: string | null;
  start_date: string;
  end_date: string;
  description?: string | null;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  audience: AudienceKey;
  channel: ChannelKey;
  status: StatusKey;
  message_template?: string | null;
};

type Contact = {
  id: number;
  name?: string | null;
  phone: string;
  email?: string | null;
  total_orders: number;
  total_spend: number;
  message: string;
};

type Outreach = {
  audience_count: number;
  channel: ChannelKey;
  message_preview: string;
  contacts: Contact[];
};

type AudienceKey = "all_customers" | "marketing_opt_in" | "repeat_customers" | "high_spenders";
type ChannelKey = "whatsapp" | "sms" | "email";
type StatusKey = "draft" | "scheduled" | "active" | "paused" | "completed";

type CampaignForm = {
  name: string;
  code: string;
  start_date: string;
  end_date: string;
  description: string;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  audience: AudienceKey;
  channel: ChannelKey;
  status: StatusKey;
  message_template: string;
};

const audienceOptions: { value: AudienceKey; label: string }[] = [
  { value: "marketing_opt_in", label: "Marketing Opt-in" },
  { value: "all_customers", label: "All Customers" },
  { value: "repeat_customers", label: "Repeat Customers" },
  { value: "high_spenders", label: "High Spenders" },
];

const channelOptions: { value: ChannelKey; label: string }[] = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
];

const statusOptions: { value: StatusKey; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "scheduled", label: "Scheduled" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
];

const emptyForm: CampaignForm = {
  name: "",
  code: "",
  start_date: new Date().toISOString().slice(0, 10),
  end_date: new Date().toISOString().slice(0, 10),
  description: "",
  discount_type: "percentage" as const,
  discount_value: 10,
  audience: "marketing_opt_in" as AudienceKey,
  channel: "whatsapp" as ChannelKey,
  status: "draft" as StatusKey,
  message_template:
    "Hi {name}, Pizza Blitz has {offer} for you. Use code {code} before {end_date}. Reply or visit us to order.",
};

export default function PromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [outreach, setOutreach] = useState<Outreach | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchPromotions();
  }, []);

  const selectedPromotion = useMemo(
    () => promotions.find((promotion) => promotion.id === selectedId) || null,
    [promotions, selectedId]
  );

  const activeCount = promotions.filter((promotion) => promotion.status === "active").length;
  const scheduledCount = promotions.filter((promotion) => promotion.status === "scheduled").length;

  const fetchPromotions = async () => {
    setLoading(true);
    const response = await fetch(`${PROMOTIONS_API}/`);
    const data: Promotion[] = await response.json();
    setPromotions(data);
    const nextSelectedId = selectedId || data[0]?.id || null;
    setSelectedId(nextSelectedId);
    if (nextSelectedId) {
      await fetchOutreach(nextSelectedId);
    } else {
      setOutreach(null);
    }
    setLoading(false);
  };

  const fetchOutreach = async (promotionId: number) => {
    const response = await fetch(`${PROMOTIONS_API}/${promotionId}/outreach`);
    if (!response.ok) {
      setOutreach(null);
      return;
    }
    setOutreach(await response.json());
  };

  const selectPromotion = (promotionId: number) => {
    setSelectedId(promotionId);
    fetchOutreach(promotionId);
  };

  const savePromotion = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const response = await fetch(`${PROMOTIONS_API}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...formData,
        code: formData.code || null,
        description: formData.description || null,
        message_template: formData.message_template || null,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.detail || "Campaign could not be saved.");
      return;
    }
    setMessage(`Saved campaign ${data.promotion.name}.`);
    setShowAdd(false);
    setFormData(emptyForm);
    await fetchPromotions();
    selectPromotion(data.promotion.id);
  };

  const copyOutreach = async () => {
    if (!outreach?.contacts.length) {
      setMessage("No contacts available for this audience yet.");
      return;
    }
    const rows = outreach.contacts.map((contact) =>
      [contact.phone, contact.email || "", contact.name || "", contact.message].join("\t")
    );
    await navigator.clipboard.writeText(["phone\temail\tname\tmessage", ...rows].join("\n"));
    setMessage(`Copied ${outreach.contacts.length} outreach rows.`);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0b] p-8 text-white">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-orange-400 underline decoration-orange-500/20 underline-offset-8">
            Promotions
          </h1>
          <p className="mt-3 text-sm text-gray-500">
            Coupon campaigns connected with the customer repository.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={fetchPromotions}
            className="flex items-center gap-2 rounded-xl bg-white/5 px-4 py-3 font-bold text-white hover:bg-white/10"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 rounded-xl bg-white px-5 py-3 font-bold text-black hover:bg-orange-500 hover:text-white"
          >
            <Plus className="h-4 w-4" /> New Campaign
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-6 rounded-xl border border-orange-500/20 bg-orange-500/10 px-5 py-3 text-sm text-orange-100">
          {message}
        </div>
      )}

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-4">
        <Metric label="Campaigns" value={promotions.length} icon={Megaphone} />
        <Metric label="Active" value={activeCount} icon={CheckCircle2} />
        <Metric label="Scheduled" value={scheduledCount} icon={Calendar} />
        <Metric label="Audience" value={outreach?.audience_count || 0} icon={Users} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-5">
          <div className="rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-black">Campaign List</h2>
              <span className="rounded-full bg-black/30 px-3 py-1 text-xs font-black uppercase tracking-widest text-gray-500">
                {promotions.length} total
              </span>
            </div>
            <div className="space-y-3">
              {promotions.map((promotion) => (
                <button
                  key={promotion.id}
                  onClick={() => selectPromotion(promotion.id)}
                  className={`w-full rounded-xl border p-4 text-left transition ${
                    selectedId === promotion.id
                      ? "border-orange-500 bg-orange-500/10"
                      : "border-white/5 bg-black/25 hover:border-white/20"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-black">{promotion.name}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {promotion.start_date} to {promotion.end_date}
                      </p>
                    </div>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase text-gray-300">
                      {promotion.status}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-400">
                    <Pill icon={Tag} value={offerLabel(promotion)} />
                    <Pill icon={Users} value={audienceLabel(promotion.audience)} />
                    <Pill icon={Send} value={channelLabel(promotion.channel)} />
                  </div>
                </button>
              ))}
              {!promotions.length && (
                <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-gray-500">
                  No campaigns yet.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="xl:col-span-7">
          <div className="rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
            {selectedPromotion ? (
              <>
                <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-orange-400">
                      {selectedPromotion.code || "No Code"}
                    </p>
                    <h2 className="mt-2 text-2xl font-black">{selectedPromotion.name}</h2>
                    <p className="mt-2 text-sm text-gray-500">
                      {selectedPromotion.description || "Campaign details will appear here."}
                    </p>
                  </div>
                  <button
                    onClick={copyOutreach}
                    className="flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 font-bold text-white hover:bg-orange-600"
                  >
                    <Copy className="h-4 w-4" /> Copy Outreach
                  </button>
                </div>

                <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <Detail label="Audience" value={`${outreach?.audience_count || 0} contacts`} />
                  <Detail label="Channel" value={channelLabel(selectedPromotion.channel)} />
                  <Detail label="Offer" value={offerLabel(selectedPromotion)} />
                </div>

                <div className="mb-6 rounded-xl border border-white/5 bg-black/25 p-5">
                  <p className="mb-2 text-xs font-black uppercase tracking-widest text-gray-500">
                    Message Preview
                  </p>
                  <p className="text-sm leading-6 text-gray-200">
                    {outreach?.message_preview || "No preview available."}
                  </p>
                </div>

                <div className="space-y-3">
                  {(outreach?.contacts || []).map((contact) => (
                    <div
                      key={contact.id}
                      className="grid grid-cols-1 items-center gap-4 rounded-xl border border-white/5 bg-black/25 p-4 lg:grid-cols-12"
                    >
                      <div className="lg:col-span-4">
                        <p className="font-black">{contact.name || "Walk-in Customer"}</p>
                        <p className="text-xs text-gray-500">{contact.phone}</p>
                      </div>
                      <div className="text-sm text-gray-400 lg:col-span-3">
                        Rs {Math.round(contact.total_spend || 0).toLocaleString()} spend
                      </div>
                      <div className="text-sm text-gray-400 lg:col-span-5">
                        {contact.message}
                      </div>
                    </div>
                  ))}
                  {outreach && !outreach.contacts.length && (
                    <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-gray-500">
                      No matching contacts yet.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 p-12 text-center text-gray-500">
                Select or create a campaign.
              </div>
            )}
          </div>
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={savePromotion}
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-white/10 bg-[#1a1a1c] p-8"
          >
            <div className="mb-6 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xl font-black">
                <Megaphone className="h-5 w-5 text-orange-400" /> Campaign
              </h2>
              <button type="button" onClick={() => setShowAdd(false)} className="text-gray-500 hover:text-white">
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input
                label="Name"
                value={formData.name}
                onChange={(value) => setFormData({ ...formData, name: value })}
                required
              />
              <Input
                label="Code"
                value={formData.code}
                onChange={(value) => setFormData({ ...formData, code: value })}
              />
              <Input
                label="Start Date"
                type="date"
                value={formData.start_date}
                onChange={(value) => setFormData({ ...formData, start_date: value })}
                required
              />
              <Input
                label="End Date"
                type="date"
                value={formData.end_date}
                onChange={(value) => setFormData({ ...formData, end_date: value })}
                required
              />
              <label className="space-y-2">
                <span className="text-xs font-black uppercase tracking-widest text-gray-500">Discount Type</span>
                <select
                  value={formData.discount_type}
                  onChange={(event) =>
                    setFormData({
                      ...formData,
                      discount_type: event.target.value as "percentage" | "fixed",
                    })
                  }
                  className="w-full rounded-xl border border-white/10 bg-black/30 p-4 outline-none focus:border-orange-500"
                >
                  <option value="percentage">Percentage</option>
                  <option value="fixed">Fixed Amount</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-xs font-black uppercase tracking-widest text-gray-500">Discount Value</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.discount_value}
                  onChange={(event) =>
                    setFormData({ ...formData, discount_value: Number(event.target.value) })
                  }
                  className="w-full rounded-xl border border-white/10 bg-black/30 p-4 outline-none focus:border-orange-500"
                  required
                />
              </label>
              <Select
                label="Audience"
                value={formData.audience}
                options={audienceOptions}
                onChange={(value) => setFormData({ ...formData, audience: value as AudienceKey })}
              />
              <Select
                label="Channel"
                value={formData.channel}
                options={channelOptions}
                onChange={(value) => setFormData({ ...formData, channel: value as ChannelKey })}
              />
              <Select
                label="Status"
                value={formData.status}
                options={statusOptions}
                onChange={(value) => setFormData({ ...formData, status: value as StatusKey })}
              />
              <Input
                label="Description"
                value={formData.description}
                onChange={(value) => setFormData({ ...formData, description: value })}
              />
            </div>

            <label className="mt-4 block space-y-2">
              <span className="text-xs font-black uppercase tracking-widest text-gray-500">Message</span>
              <textarea
                value={formData.message_template}
                onChange={(event) => setFormData({ ...formData, message_template: event.target.value })}
                rows={4}
                className="w-full rounded-xl border border-white/10 bg-black/30 p-4 outline-none focus:border-orange-500"
              />
            </label>

            <button className="mt-6 w-full rounded-xl bg-orange-500 py-4 font-black text-white hover:bg-orange-600">
              Save Campaign
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function offerLabel(promotion: Promotion) {
  const value = Number(promotion.discount_value || 0).toLocaleString();
  return promotion.discount_type === "percentage" ? `${value}% off` : `Rs ${value} off`;
}

function audienceLabel(value: AudienceKey) {
  return audienceOptions.find((option) => option.value === value)?.label || value;
}

function channelLabel(value: ChannelKey) {
  return channelOptions.find((option) => option.value === value)?.label || value;
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-[#1a1a1c] p-5">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-400">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-xs font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-black/25 p-4">
      <p className="text-xs font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-2 font-black">{value}</p>
    </div>
  );
}

function Pill({
  icon: Icon,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1">
      <Icon className="h-3 w-3 text-orange-400" /> {value}
    </span>
  );
}

function Input({
  label,
  value,
  onChange,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-black uppercase tracking-widest text-gray-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-white/10 bg-black/30 p-4 outline-none focus:border-orange-500"
        required={required}
      />
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-black uppercase tracking-widest text-gray-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-white/10 bg-black/30 p-4 outline-none focus:border-orange-500"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
