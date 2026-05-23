"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Copy,
  ExternalLink,
  Mail,
  Megaphone,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Send,
  Share2,
  ShoppingBag,
  Tag,
  Target,
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
  order_link?: string | null;
  destination?: string | null;
  action_url?: string | null;
  send_ready?: boolean;
  missing_reason?: string | null;
};

type Outreach = {
  audience_count: number;
  channel: ChannelKey;
  order_link?: string | null;
  message_preview: string;
  contacts: Contact[];
};

type Dispatch = Outreach & {
  send_ready_count: number;
  missing_destination_count: number;
  provider_status?: ProviderStatus;
};

type AudienceKey =
  | "all_customers"
  | "marketing_opt_in"
  | "repeat_customers"
  | "high_spenders"
  | "new_guests"
  | "regular_guests"
  | "vip_guests"
  | "active_customers"
  | "comeback_customers"
  | "win_back_customers";
type ChannelKey = "whatsapp" | "sms" | "email";
type StatusKey = "draft" | "scheduled" | "active" | "paused" | "completed";

type ProviderStatus = {
  channel: ChannelKey;
  provider: string;
  enabled: boolean;
  configured: boolean;
  unsupported: boolean;
  missing_settings: string[];
};

type ProviderReadiness = {
  send_enabled: boolean;
  configured_count: number;
  channels: ProviderStatus[];
};

type RetentionPlaybookCampaign = {
  name: string;
  description: string;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  audience: AudienceKey;
  channel: ChannelKey;
  status: StatusKey;
  duration_days: number;
  message_template: string;
};

type RetentionPlaybookEntry = {
  audience: AudienceKey;
  label: string;
  intent: string;
  audience_count: number;
  send_ready_count: number;
  missing_destination_count: number;
  recommended_campaign: RetentionPlaybookCampaign;
};

type CampaignDelivery = {
  id: number;
  channel: ChannelKey;
  destination?: string | null;
  provider?: string | null;
  status: "sent" | "dry_run" | "failed" | "skipped" | "pending";
  external_id?: string | null;
  error?: string | null;
  dry_run: boolean;
  attempted_at?: string | null;
};

type DeliveryHistory = {
  attempted_count: number;
  sent_count: number;
  dry_run_count: number;
  failed_count: number;
  skipped_count: number;
  deliveries: CampaignDelivery[];
};

type SocialDraftSummary = {
  id: number;
  title: string;
  status: string;
  platforms: string[];
  scheduled_at?: string | null;
};

type AdCampaignSummary = {
  id: number;
  name: string;
  objective: string;
  platforms: string[];
  status: string;
  daily_budget: number;
  lifetime_budget: number;
};

type CampaignPerformance = {
  campaign_window: {
    total_days: number;
    elapsed_days: number;
    remaining_days: number;
    phase: "upcoming" | "live" | "ended";
  };
  redemptions: {
    count: number;
    revenue: number;
    discount: number;
    average_order_value: number;
    unique_customers: number;
  };
  outreach: {
    attempted_count: number;
    sent_count: number;
    dry_run_count: number;
    failed_count: number;
    skipped_count: number;
    conversion_rate_percent: number;
  };
  social: {
    post_count: number;
    ready_count: number;
    scheduled_count: number;
    latest_post_id?: number | null;
    latest_post?: SocialDraftSummary | null;
  };
  ads: {
    campaign_count: number;
    planned_budget: number;
    spend: number;
    reported_revenue: number;
    roas: number;
    launch_count: number;
    latest_campaign_id?: number | null;
    latest_campaign?: AdCampaignSummary | null;
  };
};

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
  { value: "new_guests", label: "New Guests" },
  { value: "regular_guests", label: "Regular Guests" },
  { value: "vip_guests", label: "VIP Guests" },
  { value: "active_customers", label: "Active This Week" },
  { value: "comeback_customers", label: "Comeback Due" },
  { value: "win_back_customers", label: "Win-back Priority" },
];

const retentionAudienceOptions = audienceOptions.filter((option) =>
  ["new_guests", "regular_guests", "vip_guests", "active_customers", "comeback_customers", "win_back_customers"].includes(option.value)
);

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

const defaultSocialImage =
  "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1200&q=80";

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
  const [providerReadiness, setProviderReadiness] = useState<ProviderReadiness | null>(null);
  const [outreach, setOutreach] = useState<Outreach | null>(null);
  const [dispatch, setDispatch] = useState<Dispatch | null>(null);
  const [deliveryHistory, setDeliveryHistory] = useState<DeliveryHistory | null>(null);
  const [performance, setPerformance] = useState<CampaignPerformance | null>(null);
  const [playbook, setPlaybook] = useState<RetentionPlaybookEntry[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<"dry_run" | "send" | null>(null);
  const [creatingPlaybookAudience, setCreatingPlaybookAudience] = useState<AudienceKey | null>(null);
  const [creatingSocialPost, setCreatingSocialPost] = useState(false);
  const [creatingAdCampaign, setCreatingAdCampaign] = useState(false);

  useEffect(() => {
    fetchPromotions();
    fetchProviderReadiness();
    fetchPlaybook();
  }, []);

  const selectedPromotion = useMemo(
    () => promotions.find((promotion) => promotion.id === selectedId) || null,
    [promotions, selectedId]
  );

  const activeCount = promotions.filter((promotion) => promotion.status === "active").length;
  const scheduledCount = promotions.filter((promotion) => promotion.status === "scheduled").length;

  const fetchProviderReadiness = async () => {
    const response = await fetch(`${PROMOTIONS_API}/providers/status`, {
      credentials: "include",
    });
    if (!response.ok) {
      setProviderReadiness(null);
      return;
    }
    setProviderReadiness(await response.json());
  };

  const fetchPlaybook = async () => {
    const response = await fetch(`${PROMOTIONS_API}/retention-playbook`, {
      credentials: "include",
    });
    if (!response.ok) {
      setPlaybook([]);
      return;
    }
    const data = await response.json();
    setPlaybook(data.playbook || []);
  };

  const fetchPromotions = async () => {
    setLoading(true);
    const response = await fetch(`${PROMOTIONS_API}/`, { credentials: "include" });
    const data: Promotion[] = await response.json();
    setPromotions(data);
    const nextSelectedId = selectedId || data[0]?.id || null;
    setSelectedId(nextSelectedId);
    if (nextSelectedId) {
      await fetchCampaignDetails(nextSelectedId);
    } else {
      setOutreach(null);
      setDispatch(null);
      setDeliveryHistory(null);
      setPerformance(null);
    }
    setLoading(false);
  };

  const fetchCampaignDetails = async (promotionId: number) => {
    await Promise.all([
      fetchOutreach(promotionId),
      fetchDispatch(promotionId),
      fetchDeliveries(promotionId),
      fetchPerformance(promotionId),
    ]);
  };

  const fetchOutreach = async (promotionId: number) => {
    const response = await fetch(`${PROMOTIONS_API}/${promotionId}/outreach`, {
      credentials: "include",
    });
    if (!response.ok) {
      setOutreach(null);
      return;
    }
    setOutreach(await response.json());
  };

  const fetchDispatch = async (promotionId: number) => {
    const response = await fetch(`${PROMOTIONS_API}/${promotionId}/dispatch`, {
      credentials: "include",
    });
    if (!response.ok) {
      setDispatch(null);
      return;
    }
    setDispatch(await response.json());
  };

  const fetchDeliveries = async (promotionId: number) => {
    const response = await fetch(`${PROMOTIONS_API}/${promotionId}/deliveries`, {
      credentials: "include",
    });
    if (!response.ok) {
      setDeliveryHistory(null);
      return;
    }
    setDeliveryHistory(await response.json());
  };

  const fetchPerformance = async (promotionId: number) => {
    const response = await fetch(`${PROMOTIONS_API}/performance/${promotionId}`, {
      credentials: "include",
    });
    if (!response.ok) {
      setPerformance(null);
      return;
    }
    setPerformance(await response.json());
  };

  const selectPromotion = (promotionId: number) => {
    setSelectedId(promotionId);
    fetchCampaignDetails(promotionId);
  };

  const savePromotion = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const response = await fetch(`${PROMOTIONS_API}/`, {
      method: "POST",
      credentials: "include",
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

  const createPlaybookCampaign = async (audience: AudienceKey) => {
    setCreatingPlaybookAudience(audience);
    const response = await fetch(`${PROMOTIONS_API}/retention-playbook/${audience}/campaign`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active", duration_days: 7 }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.detail || "Playbook campaign could not be created.");
      setCreatingPlaybookAudience(null);
      return;
    }
    setMessage(`Created playbook campaign ${data.promotion.name}.`);
    await fetchPromotions();
    await fetchPlaybook();
    setSelectedId(data.promotion.id);
    await fetchCampaignDetails(data.promotion.id);
    setCreatingPlaybookAudience(null);
  };

  const copyOutreach = async () => {
    if (!dispatch?.contacts.length) {
      setMessage("No contacts available for this audience yet.");
      return;
    }
    const rows = dispatch.contacts.map((contact) =>
      [
        dispatch.channel,
        contact.destination || "",
        contact.phone,
        contact.email || "",
        contact.name || "",
        contact.message,
        contact.order_link || dispatch.order_link || "",
        contact.action_url || "",
        contact.missing_reason || "",
      ].join("\t")
    );
    await navigator.clipboard.writeText(
      [
        "channel\tdestination\tphone\temail\tname\tmessage\torder_link\taction_url\tmissing_reason",
        ...rows,
      ].join("\n")
    );
    setMessage(`Copied ${dispatch.contacts.length} send-prep rows.`);
  };

  const sendCampaign = async (dryRun: boolean) => {
    if (!selectedPromotion) return;
    if (!dryRun) {
      const confirmed = window.confirm(`Send ${selectedPromotion.name} to ready ${channelLabel(selectedPromotion.channel)} contacts?`);
      if (!confirmed) return;
    }
    setSending(dryRun ? "dry_run" : "send");
    const response = await fetch(`${PROMOTIONS_API}/${selectedPromotion.id}/send`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dry_run: dryRun, limit: 50 }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.detail || "Campaign send failed.");
      setSending(null);
      return;
    }
    setMessage(
      dryRun
        ? `Dry run checked ${data.attempted_count} contacts.`
        : `Send finished: ${data.sent_count} sent, ${data.skipped_count} skipped, ${data.failed_count} failed.`
    );
    await fetchCampaignDetails(selectedPromotion.id);
    setSending(null);
  };

  const createSocialPost = async () => {
    if (!selectedPromotion) return;
    setCreatingSocialPost(true);
    try {
      const response = await fetch(`${PROMOTIONS_API}/${selectedPromotion.id}/social-post`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          link_url: orderOfferLink(selectedPromotion),
          image_url: defaultSocialImage,
          platforms: ["facebook", "instagram"],
          status: "ready",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.detail || "Social post could not be created.");
        return;
      }
      setMessage(`Created social post #${data.post.id} from ${selectedPromotion.name}.`);
      await fetchPerformance(selectedPromotion.id);
    } catch {
      setMessage("Social post could not be created.");
    } finally {
      setCreatingSocialPost(false);
    }
  };

  const createAdCampaign = async () => {
    if (!selectedPromotion) return;
    setCreatingAdCampaign(true);
    try {
      const response = await fetch(`${PROMOTIONS_API}/${selectedPromotion.id}/ad-campaign`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          link_url: orderOfferLink(selectedPromotion),
          image_url: defaultSocialImage,
          platforms: ["facebook", "instagram"],
          objective: "sales",
          daily_budget: 500,
          status: "ready",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.detail || "Ad campaign could not be created.");
        return;
      }
      setMessage(`Created ad campaign #${data.campaign.id} from ${selectedPromotion.name}.`);
      await fetchPerformance(selectedPromotion.id);
    } catch {
      setMessage("Ad campaign could not be created.");
    } finally {
      setCreatingAdCampaign(false);
    }
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
            onClick={() => {
              fetchPromotions();
              fetchProviderReadiness();
              fetchPlaybook();
            }}
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

      <section className="mb-8 rounded-xl border border-orange-500/10 bg-[#1a1a1c] p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-orange-400">Retention Audience Bridge</p>
            <h2 className="mt-1 text-xl font-black">Target offers from customer loyalty segments</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
              The promotion audience picker now uses the same retention buckets from the customer command center.
            </p>
          </div>
          <button
            onClick={() => {
              setFormData({ ...emptyForm, audience: "vip_guests", status: "active" });
              setShowAdd(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 font-bold text-white hover:bg-orange-600"
          >
            <Target className="h-4 w-4" /> Build VIP Offer
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {retentionAudienceOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                setFormData({ ...emptyForm, audience: option.value, status: "active" });
                setShowAdd(true);
              }}
              className="rounded-lg border border-white/5 bg-black/25 p-4 text-left hover:border-orange-500/50 hover:bg-orange-500/10"
            >
              <p className="text-xs font-black uppercase tracking-widest text-gray-500">Audience</p>
              <p className="mt-2 min-h-10 text-sm font-black leading-5">{option.label}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="mb-8 rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-orange-400">Retention Campaign Playbook</p>
            <h2 className="mt-1 text-xl font-black">Recommended offers by customer segment</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
              Create a ready campaign from the current audience counts, channel readiness, and loyalty intent.
            </p>
          </div>
          <button
            onClick={fetchPlaybook}
            className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-4 py-3 font-bold text-white hover:bg-white/10"
          >
            <RefreshCw className="h-4 w-4" /> Refresh Playbook
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {playbook.map((entry) => (
            <article key={entry.audience} className="rounded-xl border border-white/5 bg-black/25 p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-gray-500">{entry.label}</p>
                  <h3 className="mt-2 text-lg font-black">{entry.recommended_campaign.name}</h3>
                </div>
                <span className="rounded-full bg-orange-500/10 px-3 py-1 text-xs font-black uppercase text-orange-200">
                  {offerFromCampaign(entry.recommended_campaign)}
                </span>
              </div>
              <p className="min-h-12 text-sm font-semibold leading-6 text-gray-500">{entry.intent}</p>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <MiniSignal icon={Users} label="Audience" value={`${entry.audience_count}`} />
                <MiniSignal icon={Send} label="Ready" value={`${entry.send_ready_count}`} />
                <MiniSignal icon={Mail} label="Channel" value={channelLabel(entry.recommended_campaign.channel)} />
              </div>
              <button
                onClick={() => createPlaybookCampaign(entry.audience)}
                aria-label={`Create ${entry.label} playbook campaign`}
                disabled={creatingPlaybookAudience === entry.audience}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 font-black text-white hover:bg-orange-600 disabled:cursor-wait disabled:bg-orange-500/50"
              >
                <Target className="h-4 w-4" />
                {creatingPlaybookAudience === entry.audience ? "Creating" : "Create Campaign"}
              </button>
            </article>
          ))}
          {!playbook.length && (
            <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-gray-500 lg:col-span-3">
              Playbook recommendations are loading.
            </div>
          )}
        </div>
      </section>

      <section className="mb-8 rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-black">Provider Send Console</h2>
            <p className="mt-1 text-sm text-gray-500">
              Live sending stays disabled until the channel credentials and global send switch are ready.
            </p>
          </div>
          <span
            className={`rounded-full px-4 py-2 text-xs font-black uppercase ${
              providerReadiness?.send_enabled
                ? "bg-green-500/10 text-green-300"
                : "bg-yellow-500/10 text-yellow-300"
            }`}
          >
            {providerReadiness?.send_enabled ? "Send switch on" : "Send switch off"}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {(["whatsapp", "sms", "email"] as ChannelKey[]).map((channel) => {
            const status = providerReadiness?.channels.find((item) => item.channel === channel);
            return (
              <ProviderCard
                key={channel}
                status={status}
                channel={channel}
              />
            );
          })}
        </div>
      </section>

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
                    <Copy className="h-4 w-4" /> Copy Send Links
                  </button>
                  <button
                    onClick={createSocialPost}
                    disabled={creatingSocialPost}
                    className="flex items-center gap-2 rounded-xl bg-white/10 px-5 py-3 font-bold text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Share2 className="h-4 w-4" /> {creatingSocialPost ? "Creating" : "Create Social Post"}
                  </button>
                  <button
                    onClick={createAdCampaign}
                    disabled={creatingAdCampaign}
                    className="flex items-center gap-2 rounded-xl bg-sky-500/15 px-5 py-3 font-bold text-sky-100 hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Target className="h-4 w-4" /> {creatingAdCampaign ? "Creating" : "Create Ad Campaign"}
                  </button>
                  <button
                    onClick={() => sendCampaign(true)}
                    disabled={sending !== null}
                    className="flex items-center gap-2 rounded-xl bg-white/10 px-5 py-3 font-bold text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" /> Dry Run
                  </button>
                  <button
                    onClick={() => sendCampaign(false)}
                    disabled={sending !== null || !dispatch?.provider_status?.configured}
                    title={
                      dispatch?.provider_status?.configured
                        ? "Send campaign"
                        : `Missing: ${dispatch?.provider_status?.missing_settings.join(", ") || "provider setup"}`
                    }
                    className="flex items-center gap-2 rounded-xl bg-white px-5 py-3 font-bold text-black hover:bg-orange-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" /> Send Now
                  </button>
                </div>

                <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
                  <Detail label="Audience" value={`${outreach?.audience_count || 0} contacts`} />
                  <Detail label="Channel" value={channelLabel(selectedPromotion.channel)} />
                  <Detail label="Offer" value={offerLabel(selectedPromotion)} />
                  <Detail label="Ready" value={`${dispatch?.send_ready_count || 0} contacts`} />
                  <Detail
                    label="Missing"
                    value={`${dispatch?.missing_destination_count || 0} contacts`}
                  />
                  <Detail
                    label="Provider"
                    value={providerLabel(dispatch?.provider_status)}
                  />
                </div>

                <section className="mb-6 rounded-xl border border-white/5 bg-black/25 p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-orange-400">
                        Campaign Performance
                      </p>
                      <h3 className="mt-1 text-lg font-black">Coupon Attribution</h3>
                    </div>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase text-gray-300">
                      {performance?.campaign_window.phase || "checking"}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <Detail
                      label="Revenue"
                      value={formatRupees(performance?.redemptions.revenue || 0)}
                    />
                    <Detail
                      label="Coupon Orders"
                      value={`${performance?.redemptions.count || 0}`}
                    />
                    <Detail
                      label="Discount Given"
                      value={formatRupees(performance?.redemptions.discount || 0)}
                    />
                    <Detail
                      label="Avg Order"
                      value={formatRupees(performance?.redemptions.average_order_value || 0)}
                    />
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                    <MiniSignal
                      icon={Users}
                      label="Unique Customers"
                      value={`${performance?.redemptions.unique_customers || 0}`}
                    />
                    <MiniSignal
                      icon={Share2}
                      label="Social Drafts"
                      value={`${performance?.social.post_count || 0}`}
                    />
                    <MiniSignal
                      icon={Target}
                      label="Ad Drafts"
                      value={`${performance?.ads.campaign_count || 0}`}
                    />
                    <MiniSignal
                      icon={Tag}
                      label="Ad Budget"
                      value={formatRupees(performance?.ads.planned_budget || 0)}
                    />
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <HandoffCard
                      icon={Share2}
                      label="Social Handoff"
                      title={performance?.social.latest_post?.title || "No social draft created"}
                      status={performance?.social.latest_post?.status || "pending"}
                      detail={
                        performance?.social.latest_post
                          ? `${formatPlatforms(
                              performance.social.latest_post.platforms
                            )} | Post #${performance.social.latest_post.id}`
                          : "Create a social post from this campaign."
                      }
                      href={
                        performance?.social.latest_post_id
                          ? `/social?post=${performance.social.latest_post_id}`
                          : "/social"
                      }
                      action="Open Social Publishing"
                    />
                    <HandoffCard
                      icon={Target}
                      label="Ad Handoff"
                      title={performance?.ads.latest_campaign?.name || "No ad campaign created"}
                      status={performance?.ads.latest_campaign?.status || "pending"}
                      detail={
                        performance?.ads.latest_campaign
                          ? `${formatPlatforms(
                              performance.ads.latest_campaign.platforms
                            )} | ${formatRupees(
                              performance.ads.latest_campaign.daily_budget ||
                                performance.ads.latest_campaign.lifetime_budget
                            )} budget`
                          : "Create an ad campaign from this promotion."
                      }
                      href={
                        performance?.ads.latest_campaign_id
                          ? `/ads?campaign=${performance.ads.latest_campaign_id}`
                          : "/ads"
                      }
                      action="Open Ad Campaigns"
                    />
                  </div>
                  {performance && performance.redemptions.count === 0 ? (
                    <div className="mt-4 rounded-lg border border-dashed border-white/10 bg-black/20 p-4 text-sm font-semibold text-gray-500">
                      No coupon orders are attributed to this campaign yet.
                    </div>
                  ) : null}
                </section>

                <div className="mb-6 rounded-xl border border-white/5 bg-black/25 p-5">
                  <p className="mb-2 text-xs font-black uppercase tracking-widest text-gray-500">
                    Message Preview
                  </p>
                  <p className="text-sm leading-6 text-gray-200">
                    {outreach?.message_preview || "No preview available."}
                  </p>
                </div>

                <div className="space-y-3">
                  {(dispatch?.contacts || outreach?.contacts || []).map((contact) => {
                    const orderLink = contact.order_link || dispatch?.order_link || outreach?.order_link;
                    return (
                    <div
                      key={contact.id}
                      className="grid grid-cols-1 items-center gap-4 rounded-xl border border-white/5 bg-black/25 p-4 lg:grid-cols-12"
                    >
                      <div className="min-w-0 lg:col-span-3">
                        <p className="break-words font-black">{contact.name || "Walk-in Customer"}</p>
                        <p className="break-words text-xs text-gray-500">{contact.phone}</p>
                      </div>
                      <div className="min-w-0 text-sm text-gray-400 lg:col-span-2">
                        Rs {Math.round(contact.total_spend || 0).toLocaleString()} spend
                      </div>
                      <div className="min-w-0 text-sm text-gray-400 lg:col-span-3">
                        <p className="text-xs font-black uppercase tracking-widest text-gray-600">
                          Destination
                        </p>
                        <p className={`break-all ${contact.send_ready === false ? "text-red-300" : "text-gray-300"}`}>
                          {contact.destination || contact.missing_reason || "Not prepared"}
                        </p>
                      </div>
                      <div className="min-w-0 break-words text-sm leading-6 text-gray-400 lg:col-span-3">
                        {contact.message}
                      </div>
                      <div className="flex gap-2 lg:col-span-1 lg:justify-end">
                        {orderLink && (
                          <a
                            href={orderLink}
                            target="_blank"
                            rel="noreferrer"
                            title="Open customer order link"
                            aria-label="Open customer order link"
                            className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500 text-white hover:bg-orange-600"
                          >
                            <ShoppingBag className="h-4 w-4" />
                          </a>
                        )}
                        {contact.action_url ? (
                          <a
                            href={contact.action_url}
                            target="_blank"
                            rel="noreferrer"
                            title={`Open ${channelLabel(selectedPromotion.channel)} send link`}
                            aria-label={`Open ${channelLabel(selectedPromotion.channel)} send link`}
                            className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-black hover:bg-orange-500 hover:text-white"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        ) : (
                          <span
                            title={contact.missing_reason || "Send link unavailable"}
                            className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-gray-600"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </span>
                        )}
                      </div>
                    </div>
                    );
                  })}
                  {outreach && !outreach.contacts.length && (
                    <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-gray-500">
                      No matching contacts yet.
                    </div>
                  )}
                </div>

                {deliveryHistory?.deliveries.length ? (
                  <div className="mt-6 rounded-xl border border-white/5 bg-black/25 p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3 className="font-black">Recent Delivery Attempts</h3>
                      <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase text-gray-400">
                        {deliveryHistory.sent_count} sent / {deliveryHistory.failed_count} failed
                      </span>
                    </div>
                    <div className="space-y-2">
                      {deliveryHistory.deliveries.slice(0, 6).map((delivery) => (
                        <div
                          key={delivery.id}
                          className="grid grid-cols-1 gap-3 rounded-lg border border-white/5 bg-black/30 p-3 text-sm md:grid-cols-12"
                        >
                          <div className="md:col-span-3">
                            <p className="font-bold text-white">{delivery.destination || "No destination"}</p>
                            <p className="text-xs text-gray-500">{delivery.provider || "No provider"}</p>
                          </div>
                          <div className="md:col-span-2">
                            <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(delivery.status)}`}>
                              {delivery.status}
                            </span>
                          </div>
                          <div className="text-gray-500 md:col-span-3">
                            {delivery.attempted_at ? new Date(delivery.attempted_at).toLocaleString() : "Not attempted"}
                          </div>
                          <div className="text-gray-400 md:col-span-4">
                            {delivery.external_id || delivery.error || "Ready"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
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

function offerFromCampaign(campaign: RetentionPlaybookCampaign) {
  const value = Number(campaign.discount_value || 0).toLocaleString();
  return campaign.discount_type === "percentage" ? `${value}% off` : `Rs ${value} off`;
}

function audienceLabel(value: AudienceKey) {
  return audienceOptions.find((option) => option.value === value)?.label || value;
}

function channelLabel(value: ChannelKey) {
  return channelOptions.find((option) => option.value === value)?.label || value;
}

function providerLabel(status?: ProviderStatus) {
  if (!status) return "Checking";
  return status.configured ? `${status.provider} ready` : `${status.provider} setup needed`;
}

function orderOfferLink(promotion: Promotion) {
  const orderUrl = new URL("/order", window.location.origin);
  if (promotion.code) {
    orderUrl.searchParams.set("coupon", promotion.code);
  }
  return orderUrl.toString();
}

function formatRupees(value: number) {
  return `Rs ${Math.round(Number(value || 0)).toLocaleString()}`;
}

function MiniSignal({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.03] p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/10 text-orange-300">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-black uppercase tracking-widest text-gray-600">{label}</p>
        <p className="text-sm font-black leading-5 text-gray-200">{value}</p>
      </div>
    </div>
  );
}

function HandoffCard({
  icon: Icon,
  label,
  title,
  status,
  detail,
  href,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  title: string;
  status: string;
  detail: string;
  href: string;
  action: string;
}) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-widest text-gray-600">{label}</p>
            <p className="mt-1 break-words text-sm font-black leading-5 text-gray-100">{title}</p>
          </div>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-black uppercase ${handoffStatusClass(
            status
          )}`}
        >
          {status.replace("_", " ")}
        </span>
      </div>
      <p className="mt-3 break-words text-xs font-semibold leading-5 text-gray-500">{detail}</p>
      <a
        href={href}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-xs font-black text-white hover:bg-white/15"
      >
        {action} <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

function formatPlatforms(platforms?: string[]) {
  if (!platforms || platforms.length === 0) return "No platform";
  return platforms
    .map((platform) => platform.replace("_", " "))
    .map((platform) => platform.charAt(0).toUpperCase() + platform.slice(1))
    .join(", ");
}

function handoffStatusClass(status: string) {
  if (status === "ready" || status === "scheduled" || status === "active") {
    return "bg-green-500/15 text-green-300";
  }
  if (status === "pending" || status === "draft") {
    return "bg-white/10 text-gray-300";
  }
  if (status === "failed" || status === "rejected") {
    return "bg-red-500/15 text-red-300";
  }
  return "bg-blue-500/15 text-blue-300";
}

function ProviderCard({
  channel,
  status,
}: {
  channel: ChannelKey;
  status?: ProviderStatus;
}) {
  const iconMap = {
    whatsapp: MessageCircle,
    sms: Phone,
    email: Mail,
  };
  const Icon = iconMap[channel];
  const ready = Boolean(status?.configured);

  return (
    <div className="rounded-xl border border-white/5 bg-black/25 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-xl ${
              ready ? "bg-green-500/10 text-green-300" : "bg-yellow-500/10 text-yellow-300"
            }`}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="font-black">{channelLabel(channel)}</p>
            <p className="mt-1 text-xs font-semibold text-gray-500">
              {status?.provider || "checking provider"}
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-black uppercase ${
            ready ? "bg-green-500/10 text-green-300" : "bg-yellow-500/10 text-yellow-300"
          }`}
        >
          {ready ? "Ready" : "Setup"}
        </span>
      </div>

      <div className="mt-4 rounded-lg border border-white/5 bg-black/30 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-500">
          {ready ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-300" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 text-yellow-300" />
          )}
          {ready ? "Live send available" : "Missing setup"}
        </div>
        <p className="text-sm font-semibold leading-6 text-gray-400">
          {ready
            ? `${channelLabel(channel)} can send through ${status?.provider}.`
            : status?.missing_settings?.join(", ") || "Provider status is loading."}
        </p>
      </div>
    </div>
  );
}

function statusClass(status: CampaignDelivery["status"]) {
  if (status === "sent") return "bg-green-500/15 text-green-300";
  if (status === "dry_run") return "bg-blue-500/15 text-blue-300";
  if (status === "failed") return "bg-red-500/15 text-red-300";
  if (status === "skipped") return "bg-yellow-500/15 text-yellow-300";
  return "bg-white/10 text-gray-300";
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
