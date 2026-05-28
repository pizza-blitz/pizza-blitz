"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Mail,
  MessageCircle,
  Phone,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const CUSTOMERS_API = getApiUrl("/api/v1/restaurant/customers");
const PROMOTIONS_API = getApiUrl("/api/v1/restaurant/promotions");

type CustomerSummary = {
  total_customers: number;
  opted_in_customers: number;
  opted_out_customers: number;
  repeat_customers: number;
  high_spenders: number;
  email_ready_customers: number;
  missing_email_customers: number;
  recorded_spend: number;
};

type SegmentRow = {
  segment: string;
  label: string;
  intent: string;
  customer_count: number;
  reachable_count: number;
  email_ready_count: number;
  phone_ready_count: number;
  email_gap_count: number;
  phone_gap_count: number;
  readiness_percent: number;
  total_spend: number;
  recommended_channel: string;
  recommended_action: string;
  customer_list_url: string;
};

type SegmentReport = {
  summary: {
    total_customers: number;
    reachable_customers: number;
    readiness_percent: number;
    email_ready_customers: number;
    phone_ready_customers: number;
    email_gap_customers: number;
    phone_gap_customers: number;
  };
  top_segment?: SegmentRow | null;
  strongest_value_segment?: SegmentRow | null;
  largest_cleanup_segment?: SegmentRow | null;
  segments: SegmentRow[];
};

type QueueCampaign = {
  promotion: {
    id: number;
    name: string;
    code?: string | null;
    channel: "whatsapp" | "sms" | "email";
    audience: string;
    status: string;
    end_date: string;
  };
  audience_count: number;
  ready_count: number;
  missing_count: number;
  queue_status: string;
  queue_label: string;
  can_dry_run: boolean;
  can_send: boolean;
  dry_run_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  needs_attention_count: number;
  recommended_action: string;
};

type SendQueue = {
  summary: {
    campaign_count: number;
    filtered_count: number;
    ready_campaign_count: number;
    dry_run_needed_count: number;
    provider_blocked_count: number;
    live_ready_count: number;
    audience_blocked_count: number;
    dry_run_done_count: number;
    send_ready_contacts: number;
    missing_contacts: number;
  };
  campaigns: QueueCampaign[];
};

type DispatchContact = {
  id: number;
  name?: string | null;
  phone: string;
  email?: string | null;
  opt_in_marketing?: boolean;
  total_orders: number;
  total_spend: number;
  message: string;
  destination?: string | null;
  action_url?: string | null;
  send_ready?: boolean;
  missing_reason?: string | null;
  suppressed?: boolean;
};

type DispatchReview = {
  promotion: QueueCampaign["promotion"];
  audience_count: number;
  channel: QueueCampaign["promotion"]["channel"];
  message_preview: string;
  send_ready_count: number;
  missing_destination_count: number;
  cleanup_recovered_ready_count?: number;
  contacts: DispatchContact[];
};

type CleanupDraft = {
  email: string;
  opt_in_marketing: boolean;
};

type ChannelControl = {
  channel: "whatsapp" | "sms" | "email";
  activation_status: string;
  blockers: string[];
  provider_status: {
    provider: string;
    configured: boolean;
    enabled: boolean;
    readiness_label?: string;
    next_action?: string;
  };
  counts: {
    attempted_count: number;
    sent_count: number;
    dry_run_count: number;
    failed_count: number;
    skipped_count: number;
    needs_attention_count: number;
  };
  next_action: string;
};

type DispatchControl = {
  summary: {
    overall_status: string;
    send_enabled: boolean;
    configured_count: number;
    live_ready_count: number;
    blocked_count: number;
    attempted_count: number;
    sent_count: number;
    dry_run_count: number;
    failed_count: number;
    skipped_count: number;
    needs_attention_count: number;
    provider_issue_count: number;
    next_action: string;
  };
  channels: ChannelControl[];
  controls: { label: string; status: string; detail: string }[];
  recent_delivery_events: {
    id: number;
    channel: string;
    provider?: string | null;
    status: string;
    dry_run: boolean;
    recipient_masked?: string | null;
    issue_reason?: string | null;
    attempted_at?: string | null;
  }[];
};

type Performance = {
  summary: {
    campaign_count: number;
    redemption_orders: number;
    redemption_revenue: number;
    redemption_discount: number;
    average_order_value: number;
    unique_customers: number;
    social_post_count: number;
    ad_campaign_count: number;
    planned_ad_budget: number;
  };
  best_campaign?: {
    promotion_detail?: {
      id: number;
      name: string;
      code?: string | null;
      channel?: string | null;
    };
    redemptions?: {
      count: number;
      revenue: number;
      discount: number;
      unique_customers: number;
    };
  } | null;
};

type CommsData = {
  customers: CustomerSummary;
  segments: SegmentReport;
  queue: SendQueue;
  dispatch: DispatchControl;
  performance: Performance;
};

function numberFmt(value?: number | null) {
  return Math.round(Number(value || 0)).toLocaleString("en-IN");
}

function moneyFmt(value?: number | null) {
  return `Rs ${Math.round(Number(value || 0)).toLocaleString("en-IN")}`;
}

function percentFmt(value?: number | null) {
  return `${Math.round(Number(value || 0))}%`;
}

function labelize(value?: string | null) {
  return (value || "unknown").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function channelIcon(channel: string) {
  if (channel === "email") return Mail;
  if (channel === "sms") return Phone;
  return MessageCircle;
}

function statusTone(value: string) {
  if (["live_ready", "ready_to_send", "sent", "ready", "configured"].includes(value)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (["partially_ready", "dry_run_done", "needs_dry_run", "scheduled_wait"].includes(value)) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-red-200 bg-red-50 text-red-700";
}

function cleanupHref(campaign: QueueCampaign) {
  const audience =
    campaign.promotion.audience === "all_customers"
      ? "all"
      : campaign.promotion.audience;
  return `/customers?segment=${encodeURIComponent(audience)}&source=campaign_cleanup&campaign=${campaign.promotion.id}`;
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Users;
}) {
  return (
    <article className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-black uppercase tracking-widest text-gray-500">{label}</p>
        <Icon className="h-5 w-5 text-orange-500" />
      </div>
      <p className="mt-3 text-2xl font-black text-gray-950">{value}</p>
      <p className="mt-1 text-sm font-semibold text-gray-500">{detail}</p>
    </article>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 p-5 text-center text-sm font-semibold text-gray-500">
      {children}
    </div>
  );
}

export default function CommunicationsPage() {
  const [data, setData] = useState<CommsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyCampaignId, setBusyCampaignId] = useState<number | null>(null);
  const [reviewLoadingId, setReviewLoadingId] = useState<number | null>(null);
  const [dispatchReview, setDispatchReview] = useState<DispatchReview | null>(null);
  const [cleanupDrafts, setCleanupDrafts] = useState<Record<number, CleanupDraft>>({});
  const [savingContactId, setSavingContactId] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  const fetchData = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [customersRes, segmentsRes, queueRes, dispatchRes, performanceRes] = await Promise.all([
        fetch(`${CUSTOMERS_API}/summary`, { credentials: "include" }),
        fetch(`${CUSTOMERS_API}/segments/report`, { credentials: "include" }),
        fetch(`${PROMOTIONS_API}/send/queue`, { credentials: "include" }),
        fetch(`${PROMOTIONS_API}/providers/dispatch-control`, { credentials: "include" }),
        fetch(`${PROMOTIONS_API}/performance`, { credentials: "include" }),
      ]);
      const responses = [customersRes, segmentsRes, queueRes, dispatchRes, performanceRes];
      const failed = responses.find((response) => !response.ok);
      if (failed) {
        setMessage(`Communication data returned HTTP ${failed.status}.`);
        return;
      }
      const [customers, segments, queue, dispatch, performance] = await Promise.all([
        customersRes.json(),
        segmentsRes.json(),
        queueRes.json(),
        dispatchRes.json(),
        performanceRes.json(),
      ]);
      setData({ customers, segments, queue, dispatch, performance });
    } catch {
      setMessage("Communication center could not load data right now.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const runDryRun = async (campaign: QueueCampaign) => {
    if (!campaign.can_dry_run) {
      setMessage(`Campaign ${campaign.promotion.name} needs send-ready contacts before dry-run proof.`);
      return;
    }

    setBusyCampaignId(campaign.promotion.id);
    setMessage("");
    try {
      const response = await fetch(`${PROMOTIONS_API}/${campaign.promotion.id}/send`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dry_run: true,
          limit: 50,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(result.detail || `Could not run dry-run proof for ${campaign.promotion.name}.`);
        return;
      }
      await fetchData();
      setMessage(
        `Dry-run proof recorded for ${campaign.promotion.name}: ${numberFmt(result.dry_run_count)} ready, ${numberFmt(result.skipped_count)} skipped.`
      );
    } catch {
      setMessage(`Could not run dry-run proof for ${campaign.promotion.name}.`);
    } finally {
      setBusyCampaignId(null);
    }
  };

  const openDispatchReview = async (campaign: QueueCampaign) => {
    setReviewLoadingId(campaign.promotion.id);
    setMessage("");
    try {
      const response = await fetch(`${PROMOTIONS_API}/${campaign.promotion.id}/dispatch?limit=50`, {
        credentials: "include",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(result.detail || `Could not open cleanup review for ${campaign.promotion.name}.`);
        return;
      }
      setDispatchReview(result);
      setCleanupDrafts(() => {
        const next: Record<number, CleanupDraft> = {};
        (result.contacts || []).forEach((contact: DispatchContact) => {
          next[contact.id] = {
            email: contact.email || "",
            opt_in_marketing: Boolean(contact.opt_in_marketing),
          };
        });
        return next;
      });
      setMessage(`Opened cleanup review for ${result.promotion?.name || campaign.promotion.name}.`);
    } catch {
      setMessage(`Could not open cleanup review for ${campaign.promotion.name}.`);
    } finally {
      setReviewLoadingId(null);
    }
  };

  const updateCleanupDraft = (contactId: number, patch: Partial<CleanupDraft>) => {
    setCleanupDrafts((current) => ({
      ...current,
      [contactId]: {
        email: current[contactId]?.email || "",
        opt_in_marketing: current[contactId]?.opt_in_marketing || false,
        ...patch,
      },
    }));
  };

  const saveContactCleanup = async (contact: DispatchContact) => {
    const draft = cleanupDrafts[contact.id] || {
      email: contact.email || "",
      opt_in_marketing: Boolean(contact.opt_in_marketing),
    };
    setSavingContactId(contact.id);
    setMessage("");
    try {
      const response = await fetch(`${CUSTOMERS_API}/${contact.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: draft.email.trim() || null,
          opt_in_marketing: draft.opt_in_marketing,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(result.detail || `Could not update ${contact.name || contact.phone}.`);
        return;
      }
      await fetchData();
      if (dispatchReview) {
        await openDispatchReview({ promotion: dispatchReview.promotion } as QueueCampaign);
      }
      setMessage(`Updated ${result.name || result.phone} for campaign cleanup.`);
    } catch {
      setMessage(`Could not update ${contact.name || contact.phone}.`);
    } finally {
      setSavingContactId(null);
    }
  };

  const prioritySegments = useMemo(() => {
    if (!data?.segments?.segments) return [];
    const seen = new Set<string>();
    return [
      data.segments.top_segment,
      data.segments.strongest_value_segment,
      data.segments.largest_cleanup_segment,
      ...data.segments.segments,
    ].filter((row): row is SegmentRow => {
      if (!row || seen.has(row.segment)) return false;
      seen.add(row.segment);
      return true;
    }).slice(0, 4);
  }, [data]);

  const queueCampaigns = data?.queue.campaigns || [];
  const recentEvents = data?.dispatch.recent_delivery_events || [];
  const bestCampaign = data?.performance.best_campaign;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 text-gray-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-orange-600">
              Customer Communication Center
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-normal text-gray-950">
              Messaging command board
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-gray-600">
              Track contact readiness, provider blockers, campaign queue pressure, and recent outreach proof from one place.
            </p>
          </div>
          <button
            data-testid="communications-refresh"
            onClick={fetchData}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-gray-950 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-gray-800"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </header>

        {message ? (
          <div
            data-testid="communications-message"
            className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800"
          >
            {message}
          </div>
        ) : null}

        <section
          data-testid="communications-metrics"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"
        >
          <MetricCard
            label="Reachable"
            value={numberFmt(data?.segments.summary.reachable_customers)}
            detail={`${percentFmt(data?.segments.summary.readiness_percent)} of contacts`}
            icon={Users}
          />
          <MetricCard
            label="Ready To Send"
            value={numberFmt(data?.queue.summary.send_ready_contacts)}
            detail={`${numberFmt(data?.queue.summary.missing_contacts)} blocked contacts`}
            icon={Send}
          />
          <MetricCard
            label="Channels"
            value={`${numberFmt(data?.dispatch.summary.live_ready_count)}/3`}
            detail={`${numberFmt(data?.dispatch.summary.blocked_count)} channels blocked`}
            icon={ShieldCheck}
          />
          <MetricCard
            label="Attention"
            value={numberFmt(data?.dispatch.summary.needs_attention_count)}
            detail={`${numberFmt(data?.dispatch.summary.failed_count)} failed attempts`}
            icon={AlertTriangle}
          />
          <MetricCard
            label="Revenue"
            value={moneyFmt(data?.performance.summary.redemption_revenue)}
            detail={`${numberFmt(data?.performance.summary.redemption_orders)} coupon orders`}
            icon={Target}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-gray-500">
                  Provider Readiness
                </p>
                <h2 className="text-xl font-black text-gray-950">Channel controls</h2>
              </div>
              <span
                data-testid="communications-provider-status"
                className={`rounded-md border px-3 py-1 text-xs font-black ${statusTone(data?.dispatch.summary.overall_status || "")}`}
              >
                {labelize(data?.dispatch.summary.overall_status)}
              </span>
            </div>
            <div
              data-testid="communications-channel-controls"
              className="grid gap-4 md:grid-cols-3"
            >
              {(data?.dispatch.channels || []).map((channel) => {
                const Icon = channelIcon(channel.channel);
                return (
                  <article
                    key={channel.channel}
                    data-testid={`communications-channel-${channel.channel}`}
                    className="rounded-md border border-gray-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Icon className="h-5 w-5 text-orange-500" />
                        <p className="font-black">{labelize(channel.channel)}</p>
                      </div>
                      <span className={`rounded-md border px-2 py-1 text-[11px] font-black ${statusTone(channel.activation_status)}`}>
                        {labelize(channel.activation_status)}
                      </span>
                    </div>
                    <p className="mt-3 text-xs font-bold text-gray-500">
                      Provider: {channel.provider_status.provider || "manual"}
                    </p>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-md bg-gray-50 p-2">
                        <p className="text-lg font-black">{numberFmt(channel.counts.dry_run_count)}</p>
                        <p className="text-[10px] font-bold uppercase text-gray-500">Dry</p>
                      </div>
                      <div className="rounded-md bg-gray-50 p-2">
                        <p className="text-lg font-black">{numberFmt(channel.counts.sent_count)}</p>
                        <p className="text-[10px] font-bold uppercase text-gray-500">Sent</p>
                      </div>
                      <div className="rounded-md bg-gray-50 p-2">
                        <p className="text-lg font-black">{numberFmt(channel.counts.needs_attention_count)}</p>
                        <p className="text-[10px] font-bold uppercase text-gray-500">Fix</p>
                      </div>
                    </div>
                    <p className="mt-4 text-sm font-semibold leading-5 text-gray-600">
                      {channel.blockers[0] || channel.next_action}
                    </p>
                  </article>
                );
              })}
              {!data?.dispatch.channels?.length && <EmptyState>Channel controls are loading.</EmptyState>}
            </div>
          </div>

          <aside>
            <div className="mb-3">
              <p className="text-xs font-black uppercase tracking-widest text-gray-500">
                Next Action
              </p>
              <h2 className="text-xl font-black text-gray-950">Operator brief</h2>
            </div>
            <article
              data-testid="communications-next-action"
              className="rounded-md border border-orange-200 bg-white p-5 shadow-sm"
            >
              <Sparkles className="h-6 w-6 text-orange-500" />
              <p className="mt-4 text-sm font-bold leading-6 text-gray-700">
                {data?.dispatch.summary.next_action || "Loading communication command status."}
              </p>
              <div className="mt-5 grid gap-2">
                <Link
                  href="/promotions"
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-orange-500 px-3 py-2 text-sm font-black text-white hover:bg-orange-600"
                >
                  <Send className="h-4 w-4" /> Campaign Queue
                </Link>
                <Link
                  href="/customers?segment=marketing_opt_in"
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-black text-gray-800 hover:bg-gray-50"
                >
                  <Users className="h-4 w-4" /> Contact Cleanup
                </Link>
              </div>
            </article>
          </aside>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-gray-500">
                  Campaign Send Queue
                </p>
                <h2 className="text-xl font-black text-gray-950">Approval and dry-run status</h2>
              </div>
              <span className="rounded-md bg-gray-950 px-3 py-1 text-xs font-black text-white">
                {numberFmt(data?.queue.summary.campaign_count)} active
              </span>
            </div>
            <div data-testid="communications-send-queue" className="space-y-3">
              {queueCampaigns.slice(0, 5).map((campaign) => {
                const Icon = channelIcon(campaign.promotion.channel);
                return (
                  <article
                    key={campaign.promotion.id}
                    data-testid={`communications-queue-campaign-${campaign.promotion.id}`}
                    className="rounded-md border border-gray-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-black text-gray-950">{campaign.promotion.name}</p>
                        <p className="mt-1 text-xs font-bold text-gray-500">
                          {labelize(campaign.promotion.audience)} - {campaign.promotion.code || "No code"}
                        </p>
                      </div>
                      <span className={`inline-flex items-center gap-2 rounded-md border px-3 py-1 text-xs font-black ${statusTone(campaign.queue_status)}`}>
                        <Icon className="h-3.5 w-3.5" /> {campaign.queue_label}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                      <div className="rounded-md bg-gray-50 p-2">
                        <p className="font-black">{numberFmt(campaign.ready_count)}</p>
                        <p className="text-[10px] font-bold uppercase text-gray-500">Ready</p>
                      </div>
                      <div className="rounded-md bg-gray-50 p-2">
                        <p className="font-black">{numberFmt(campaign.missing_count)}</p>
                        <p className="text-[10px] font-bold uppercase text-gray-500">Missing</p>
                      </div>
                      <div className="rounded-md bg-gray-50 p-2">
                        <p className="font-black">{numberFmt(campaign.dry_run_count)}</p>
                        <p className="text-[10px] font-bold uppercase text-gray-500">Dry</p>
                      </div>
                      <div className="rounded-md bg-gray-50 p-2">
                        <p className="font-black">{numberFmt(campaign.needs_attention_count)}</p>
                        <p className="text-[10px] font-bold uppercase text-gray-500">Fix</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm font-semibold text-gray-600">{campaign.recommended_action}</p>
                      <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                        <button
                          data-testid={`communications-run-dry-run-${campaign.promotion.id}`}
                          type="button"
                          disabled={!campaign.can_dry_run || busyCampaignId === campaign.promotion.id}
                          onClick={() => runDryRun(campaign)}
                          className="inline-flex items-center justify-center gap-2 rounded-md bg-gray-950 px-3 py-2 text-xs font-black text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                        >
                          <Send className="h-4 w-4" />
                          {busyCampaignId === campaign.promotion.id ? "Running" : "Run Dry Run"}
                        </button>
                        <Link
                          data-testid={`communications-cleanup-${campaign.promotion.id}`}
                          href={cleanupHref(campaign)}
                          className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs font-black text-gray-800 hover:bg-gray-50"
                        >
                          <Users className="h-4 w-4" /> Cleanup
                        </Link>
                        <button
                          data-testid={`communications-review-contacts-${campaign.promotion.id}`}
                          type="button"
                          onClick={() => openDispatchReview(campaign)}
                          className="inline-flex items-center justify-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-black text-orange-700 hover:bg-orange-100"
                        >
                          <AlertTriangle className="h-4 w-4" />
                          {reviewLoadingId === campaign.promotion.id ? "Opening" : "Review"}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
              {!queueCampaigns.length && <EmptyState>No active campaign is waiting in the send queue.</EmptyState>}
            </div>
          </div>

          <div>
            <div className="mb-3">
              <p className="text-xs font-black uppercase tracking-widest text-gray-500">
                Audience Priority
              </p>
              <h2 className="text-xl font-black text-gray-950">Segments to work next</h2>
            </div>
            <div data-testid="communications-segments" className="space-y-3">
              {prioritySegments.map((segment) => (
                <article
                  key={segment.segment}
                  data-testid={`communications-segment-${segment.segment}`}
                  className="rounded-md border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-black text-gray-950">{segment.label}</p>
                      <p className="mt-1 text-xs font-bold text-gray-500">{segment.intent}</p>
                    </div>
                    <span className="rounded-md bg-orange-50 px-3 py-1 text-xs font-black uppercase text-orange-700">
                      {labelize(segment.recommended_channel)}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-md bg-gray-50 p-2">
                      <p className="font-black">{numberFmt(segment.customer_count)}</p>
                      <p className="text-[10px] font-bold uppercase text-gray-500">Customers</p>
                    </div>
                    <div className="rounded-md bg-gray-50 p-2">
                      <p className="font-black">{numberFmt(segment.reachable_count)}</p>
                      <p className="text-[10px] font-bold uppercase text-gray-500">Reachable</p>
                    </div>
                    <div className="rounded-md bg-gray-50 p-2">
                      <p className="font-black">{percentFmt(segment.readiness_percent)}</p>
                      <p className="text-[10px] font-bold uppercase text-gray-500">Ready</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm font-semibold text-gray-600">{segment.recommended_action}</p>
                    <Link
                      href={segment.customer_list_url}
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs font-black text-gray-800 hover:bg-gray-50"
                    >
                      <Users className="h-4 w-4" /> Open
                    </Link>
                  </div>
                </article>
              ))}
              {!prioritySegments.length && <EmptyState>Audience segments are loading.</EmptyState>}
            </div>
          </div>
        </section>

        {dispatchReview ? (
          <section
            data-testid="communications-cleanup-review"
            className="rounded-md border border-orange-200 bg-white p-5 shadow-sm"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-orange-600">
                  Contact Cleanup Review
                </p>
                <h2 className="mt-2 text-xl font-black text-gray-950">
                  {dispatchReview.promotion.name}
                </h2>
                <p className="mt-1 text-sm font-semibold text-gray-500">
                  {numberFmt(dispatchReview.send_ready_count)} ready · {numberFmt(dispatchReview.missing_destination_count)} blocked · {labelize(dispatchReview.channel)}
                </p>
              </div>
              <button
                data-testid="communications-close-cleanup-review"
                type="button"
                onClick={() => setDispatchReview(null)}
                className="inline-flex items-center justify-center rounded-md border border-gray-200 px-3 py-2 text-xs font-black text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-3">
              {dispatchReview.contacts.slice(0, 8).map((contact) => {
                const draft = cleanupDrafts[contact.id] || {
                  email: contact.email || "",
                  opt_in_marketing: Boolean(contact.opt_in_marketing),
                };
                return (
                  <article
                    key={contact.id}
                    data-testid={`communications-cleanup-contact-${contact.id}`}
                    className={`rounded-md border p-4 ${
                      contact.send_ready
                        ? "border-emerald-200 bg-emerald-50"
                        : "border-amber-200 bg-amber-50"
                    }`}
                  >
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-black text-gray-950">
                            {contact.name || "Unnamed customer"}
                          </p>
                          <span className={`rounded-md px-2 py-1 text-[11px] font-black uppercase ${
                            contact.send_ready
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-700"
                          }`}>
                            {contact.send_ready ? "Ready" : contact.missing_reason || "Blocked"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-semibold text-gray-600">
                          {contact.phone || "No phone"} · {contact.email || "No email"} · Rs {numberFmt(contact.total_spend)}
                        </p>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-[minmax(180px,260px)_auto_auto] sm:items-center">
                        <input
                          data-testid={`communications-cleanup-email-${contact.id}`}
                          type="email"
                          value={draft.email}
                          onChange={(event) => updateCleanupDraft(contact.id, { email: event.target.value })}
                          placeholder="Email"
                          className="h-10 rounded-md border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none focus:border-orange-400"
                        />
                        <label className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-xs font-black text-gray-700">
                          <input
                            data-testid={`communications-cleanup-optin-${contact.id}`}
                            type="checkbox"
                            checked={draft.opt_in_marketing}
                            onChange={(event) =>
                              updateCleanupDraft(contact.id, { opt_in_marketing: event.target.checked })
                            }
                            className="h-4 w-4"
                          />
                          Opt-in
                        </label>
                        <button
                          data-testid={`communications-save-cleanup-${contact.id}`}
                          type="button"
                          onClick={() => saveContactCleanup(contact)}
                          disabled={savingContactId === contact.id}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-gray-950 px-4 text-xs font-black text-white hover:bg-gray-800 disabled:cursor-wait disabled:bg-gray-300"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          {savingContactId === contact.id ? "Saving" : "Save"}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
              {!dispatchReview.contacts.length && (
                <EmptyState>No contacts are in this campaign audience yet.</EmptyState>
              )}
            </div>
          </section>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-2">
          <article data-testid="communications-performance" className="rounded-md border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-gray-500">
                  Best Campaign
                </p>
                <h2 className="mt-2 text-xl font-black text-gray-950">
                  {bestCampaign?.promotion_detail?.name || "No campaign revenue yet"}
                </h2>
                <p className="mt-1 text-sm font-semibold text-gray-500">
                  {bestCampaign?.promotion_detail?.code || "Create and redeem a campaign to see this panel change."}
                </p>
              </div>
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-md bg-gray-50 p-3">
                <p className="text-xl font-black">{numberFmt(bestCampaign?.redemptions?.count)}</p>
                <p className="text-xs font-bold text-gray-500">Orders</p>
              </div>
              <div className="rounded-md bg-gray-50 p-3">
                <p className="text-xl font-black">{moneyFmt(bestCampaign?.redemptions?.revenue)}</p>
                <p className="text-xs font-bold text-gray-500">Revenue</p>
              </div>
              <div className="rounded-md bg-gray-50 p-3">
                <p className="text-xl font-black">{moneyFmt(bestCampaign?.redemptions?.discount)}</p>
                <p className="text-xs font-bold text-gray-500">Discount</p>
              </div>
              <div className="rounded-md bg-gray-50 p-3">
                <p className="text-xl font-black">{numberFmt(bestCampaign?.redemptions?.unique_customers)}</p>
                <p className="text-xs font-bold text-gray-500">Customers</p>
              </div>
            </div>
          </article>

          <article data-testid="communications-recent-events" className="rounded-md border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-gray-500">
                  Recent Proof
                </p>
                <h2 className="mt-2 text-xl font-black text-gray-950">Delivery events</h2>
              </div>
              <Clock3 className="h-6 w-6 text-orange-500" />
            </div>
            <div className="mt-4 space-y-3">
              {recentEvents.slice(0, 5).map((event) => (
                <div
                  key={event.id}
                  data-testid={`communications-event-${event.id}`}
                  className="flex items-center justify-between gap-3 rounded-md bg-gray-50 p-3"
                >
                  <div>
                    <p className="text-sm font-black text-gray-900">
                      {labelize(event.channel)} - {labelize(event.status)}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-gray-500">
                      {event.recipient_masked || "masked recipient"} - {event.dry_run ? "dry run" : "live"}
                    </p>
                  </div>
                  <span className="rounded-md bg-white px-2 py-1 text-xs font-black text-gray-600">
                    #{event.id}
                  </span>
                </div>
              ))}
              {!recentEvents.length && <EmptyState>No campaign delivery events have been recorded yet.</EmptyState>}
            </div>
          </article>
        </section>
      </div>
    </div>
  );
}
