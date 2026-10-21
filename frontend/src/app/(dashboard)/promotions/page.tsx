"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
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
const SOCIAL_API = getApiUrl("/api/v1/restaurant/social");
const ADS_API = getApiUrl("/api/v1/restaurant/ads");

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
  schedule?: PromotionSchedule;
};

type PromotionSchedule = {
  phase: "upcoming" | "live" | "ended";
  days_until_start: number;
  days_remaining: number;
  send_ready_on: string;
  can_send_now: boolean;
};

type ScheduledCampaignQueueRow = {
  promotion: Promotion;
  phase: "due_today" | "upcoming" | "overdue";
  audience_count: number;
  ready_count: number;
  missing_count: number;
  can_activate: boolean;
  recommended_action: string;
};

type ScheduledCampaignQueue = {
  generated_at: string;
  summary: {
    scheduled_count: number;
    due_today_count: number;
    upcoming_count: number;
    overdue_count: number;
    ready_count: number;
    missing_count: number;
  };
  campaigns: ScheduledCampaignQueueRow[];
};

type CampaignSendQueueRow = {
  promotion: Promotion;
  audience_count: number;
  ready_count: number;
  missing_count: number;
  provider_status: ProviderStatus;
  can_dry_run: boolean;
  can_send: boolean;
  live_confirmation_phrase?: string;
  queue_status: CampaignSendQueueView | "scheduled_wait";
  queue_label: string;
  live_send_blockers: string[];
  latest_attempted_at?: string | null;
  recommended_action: string;
  attempted_count: number;
  sent_count: number;
  dry_run_count: number;
  failed_count: number;
  skipped_count: number;
  needs_attention_count: number;
  retryable_count: number;
};

type CampaignSendQueueView =
  | "all"
  | "needs_dry_run"
  | "provider_blocked"
  | "ready_to_send"
  | "audience_blocked"
  | "dry_run_done";

type CampaignSendQueue = {
  generated_at: string;
  summary: {
    view: CampaignSendQueueView;
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
  campaigns: CampaignSendQueueRow[];
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
  opt_in_marketing?: boolean;
  suppressed?: boolean;
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
  cleanup_recovered_ready_count?: number;
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
  readiness_label?: string;
  credential_checks?: ProviderCredentialCheck[];
  template_status?: string;
  template_label?: string;
  template_detail?: string;
  compliance_checks?: ProviderComplianceCheck[];
  safe_test_send?: {
    mode: "dry_run_only";
    live_send_blocked: boolean;
    requires_approval: boolean;
  };
  next_action?: string;
};

type ProviderCredentialCheck = {
  key: string;
  label: string;
  configured: boolean;
};

type ProviderComplianceCheck = {
  label: string;
  status: "enforced" | "manual" | "ready";
  detail: string;
};

type ProviderReadiness = {
  send_enabled: boolean;
  configured_count: number;
  channels: ProviderStatus[];
  safe_test_mode?: "dry_run_only";
  live_send_blocked?: boolean;
  compliance_summary?: string[];
  next_action?: string;
};

type DispatchActivationStatus =
  | "live_ready"
  | "partially_ready"
  | "setup_needed"
  | "credentials_needed"
  | "template_needed"
  | "test_proof_needed"
  | "recovery_needed"
  | "unsupported";

type DispatchDeliveryProof = {
  id: number;
  promotion_id?: number | null;
  channel: ChannelKey;
  provider?: string | null;
  status: CampaignDelivery["status"];
  dry_run: boolean;
  external_id?: string | null;
  recipient_masked?: string | null;
  issue_reason?: DeliveryReasonFilter | "none";
  error?: string | null;
  attempted_at?: string | null;
};

type DispatchDeliveryCounts = DeliveryAuditCounts & {
  attempted_count: number;
  sent_count: number;
  dry_run_count: number;
  failed_count: number;
  skipped_count: number;
  needs_attention_count: number;
  retryable_count?: number;
};

type DispatchChannelControl = {
  channel: ChannelKey;
  provider_status: ProviderStatus;
  activation_status: DispatchActivationStatus;
  blockers: string[];
  counts: DispatchDeliveryCounts;
  latest_dry_run?: DispatchDeliveryProof | null;
  latest_sent?: DispatchDeliveryProof | null;
  latest_issue?: DispatchDeliveryProof | null;
  next_action: string;
};

type CampaignDispatchControl = {
  generated_at: string;
  summary: {
    overall_status: DispatchActivationStatus;
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
  channels: DispatchChannelControl[];
  controls: ProviderComplianceCheck[];
  recent_delivery_events: DispatchDeliveryProof[];
};

type SocialPlatformKey = "facebook" | "instagram";

type SocialProviderStatus = {
  platform: SocialPlatformKey;
  provider: string;
  configured: boolean;
  readiness_label?: string;
  missing_settings?: string[];
  next_action?: string;
};

type SocialReadiness = {
  generated_at: string;
  providers: Record<SocialPlatformKey, SocialProviderStatus>;
  schedule: {
    due_count: number;
    eligible_count: number;
    blocked_count: number;
  };
  audit: {
    attempted_count: number;
    published_count: number;
    dry_run_count: number;
    failed_count: number;
    skipped_count: number;
    retryable_count: number;
    provider_issue_count: number;
    asset_issue_count: number;
    needs_review_count: number;
  };
  checklist: string[];
  next_action: string;
};

type AdProviderStatus = {
  provider: string;
  configured: boolean;
  readiness_label?: string;
  missing_settings?: string[];
  launch_mode?: string;
  next_action?: string;
};

type AdLaunchReadiness = {
  provider_status: AdProviderStatus;
  ready_count: number;
  blocked_count: number;
  planned_budget: number;
  campaigns: {
    id: number;
    name: string;
    eligible: boolean;
    blockers: string[];
  }[];
};

type AdSyncReadiness = {
  generated_at: string;
  provider_status: AdProviderStatus;
  audit: {
    attempted_count: number;
    launched_count: number;
    dry_run_count: number;
    failed_count: number;
    skipped_count: number;
    retryable_count: number;
    external_sync_count: number;
    provider_setup_issue_count: number;
    provider_issue_count: number;
    external_id_issue_count: number;
    needs_review_count: number;
    external_id_count: number;
    provider_state_count: number;
    unsynced_live_count: number;
  };
  checklist: {
    label: string;
    passed: boolean;
    detail: string;
  }[];
  guardrails: string[];
  next_action: string;
};

type MarketingChecklistItem = {
  label: string;
  passed: boolean;
  detail: string;
};

type ProviderTestSendResult = {
  status: "dry_run_test_generated";
  mode: "dry_run_only";
  generated_at: string;
  test_id: string;
  channel: ChannelKey;
  provider_status: ProviderStatus;
  recipient_masked: string;
  normalized_destination: string;
  message_preview: string;
  queued: boolean;
  live_send_blocked: boolean;
  compliance_checks: ProviderComplianceCheck[];
  next_action: string;
};

type AudienceChannelReadiness = {
  ready_count: number;
  missing_count: number;
  destination_missing_count?: number;
  suppressed_count?: number;
  ready_percent: number;
};

type AudienceHygiene = {
  audience: AudienceKey;
  total_contacts: number;
  opted_in_count: number;
  opted_out_count: number;
  email_ready_count: number;
  missing_email_count: number;
  phone_ready_count: number;
  missing_phone_count: number;
  channels: Record<ChannelKey, AudienceChannelReadiness>;
  recommended_channel?: ChannelKey | null;
  readiness_notes: string[];
  customers: Contact[];
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
  customer?: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  destination?: string | null;
  provider?: string | null;
  status: "sent" | "dry_run" | "failed" | "skipped" | "pending";
  external_id?: string | null;
  error?: string | null;
  dry_run: boolean;
  retryable?: boolean;
  recovery_action?: string;
  attempted_at?: string | null;
};

type DeliveryStatusFilter = "all" | "needs_attention" | CampaignDelivery["status"];
type DeliveryReasonFilter =
  | "all"
  | "consent"
  | "missing_destination"
  | "already_sent"
  | "provider"
  | "needs_review";

type DeliveryAuditCounts = {
  consent_blocked_count: number;
  missing_destination_count: number;
  already_sent_count: number;
  provider_issue_count: number;
  needs_review_count: number;
};

type DeliveryHistory = {
  status_filter?: DeliveryStatusFilter;
  reason_filter?: DeliveryReasonFilter;
  latest_attempted_at?: string | null;
  attempted_count: number;
  sent_count: number;
  dry_run_count: number;
  failed_count: number;
  skipped_count: number;
  needs_attention_count: number;
  retryable_count: number;
  audit_counts?: DeliveryAuditCounts;
  consent_blocked_count?: number;
  missing_destination_count?: number;
  already_sent_count?: number;
  provider_issue_count?: number;
  needs_review_count?: number;
  deliveries: CampaignDelivery[];
};

type DeliveryRetryResult = {
  promotion: Promotion;
  provider_status: ProviderStatus;
  channel: ChannelKey;
  dry_run: boolean;
  status_filter: DeliveryStatusFilter;
  reason_filter: DeliveryReasonFilter;
  source_count: number;
  skipped_source_count: number;
  retried_customer_count: number;
  attempted_count: number;
  sent_count: number;
  dry_run_count: number;
  failed_count: number;
  skipped_count: number;
  needs_attention_count: number;
  retryable_count: number;
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

type CampaignPerformanceRow = CampaignPerformance & {
  promotion: string;
  promotion_detail: Promotion;
  avg_daily_sale_during: number;
  total_revenue_during: number;
  redemption_count: number;
  redemption_revenue: number;
  redemption_discount: number;
};

type MarketingPerformanceRollup = {
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
  best_campaign?: CampaignPerformanceRow | null;
  campaigns: CampaignPerformanceRow[];
};

type CampaignActivityEvent = {
  id: string;
  type: "campaign" | "delivery" | "cleanup" | "redemption" | "social" | "ad";
  title: string;
  status: string;
  timestamp?: string | null;
  detail: string;
  metric?: string | null;
  href?: string | null;
};

type CampaignActivityTimeline = {
  summary: {
    event_count: number;
    delivery_events: number;
    cleanup_events: number;
    redemption_events: number;
    handoff_events: number;
  };
  events: CampaignActivityEvent[];
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

type CampaignReturnState = {
  fromCleanup: boolean;
  campaignId: number | null;
};

type LaunchSupervisorStatus = "ready" | "watching" | "blocked" | "pending";

type LaunchSupervisorStep = {
  key: string;
  label: string;
  status: LaunchSupervisorStatus;
  metric: string;
  detail: string;
  action: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
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

const deliveryStatusFilters: { value: DeliveryStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "needs_attention", label: "Needs Attention" },
  { value: "dry_run", label: "Dry Run" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Skipped" },
];

const deliveryReasonFilters: { value: DeliveryReasonFilter; label: string }[] = [
  { value: "all", label: "All Reasons" },
  { value: "consent", label: "Needs Consent" },
  { value: "missing_destination", label: "Missing Destination" },
  { value: "already_sent", label: "Already Sent" },
  { value: "provider", label: "Provider Issue" },
  { value: "needs_review", label: "Needs Review" },
];

const sendQueueViews: { value: CampaignSendQueueView; label: string; countKey: keyof CampaignSendQueue["summary"] }[] = [
  { value: "all", label: "All", countKey: "campaign_count" },
  { value: "needs_dry_run", label: "Needs Dry Run", countKey: "dry_run_needed_count" },
  { value: "provider_blocked", label: "Provider Blocked", countKey: "provider_blocked_count" },
  { value: "ready_to_send", label: "Ready To Send", countKey: "live_ready_count" },
  { value: "audience_blocked", label: "Audience Blocked", countKey: "audience_blocked_count" },
  { value: "dry_run_done", label: "Already Sent", countKey: "dry_run_done_count" },
];

const defaultSocialImage =
  "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1200&q=80";

function dateInputValue(offsetDays = 0) {
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + offsetDays);
  return nextDate.toISOString().slice(0, 10);
}

function defaultTestRecipient(channel: ChannelKey) {
  if (channel === "email") return "guest@example.com";
  if (channel === "sms") return "+919876543210";
  return "+919876543210";
}

function campaignDurationDays(promotion: Promotion) {
  const start = new Date(`${promotion.start_date}T00:00:00`);
  const end = new Date(`${promotion.end_date}T00:00:00`);
  const duration = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  return Number.isFinite(duration) ? Math.max(duration, 1) : 7;
}

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
  const [dispatchControl, setDispatchControl] = useState<CampaignDispatchControl | null>(null);
  const [providerTestChannel, setProviderTestChannel] = useState<ChannelKey>("whatsapp");
  const [providerTestRecipient, setProviderTestRecipient] = useState(defaultTestRecipient("whatsapp"));
  const [providerTestTemplate, setProviderTestTemplate] = useState(emptyForm.message_template);
  const [providerTestResult, setProviderTestResult] = useState<ProviderTestSendResult | null>(null);
  const [providerTesting, setProviderTesting] = useState(false);
  const [outreach, setOutreach] = useState<Outreach | null>(null);
  const [dispatch, setDispatch] = useState<Dispatch | null>(null);
  const [deliveryHistory, setDeliveryHistory] = useState<DeliveryHistory | null>(null);
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryStatusFilter>("all");
  const [deliveryReasonFilter, setDeliveryReasonFilter] = useState<DeliveryReasonFilter>("all");
  const [performance, setPerformance] = useState<CampaignPerformance | null>(null);
  const [activityTimeline, setActivityTimeline] = useState<CampaignActivityTimeline | null>(null);
  const [performanceRollup, setPerformanceRollup] = useState<MarketingPerformanceRollup | null>(null);
  const [scheduleQueue, setScheduleQueue] = useState<ScheduledCampaignQueue | null>(null);
  const [sendQueue, setSendQueue] = useState<CampaignSendQueue | null>(null);
  const [socialReadiness, setSocialReadiness] = useState<SocialReadiness | null>(null);
  const [adLaunchReadiness, setAdLaunchReadiness] = useState<AdLaunchReadiness | null>(null);
  const [adSyncReadiness, setAdSyncReadiness] = useState<AdSyncReadiness | null>(null);
  const [sendQueueView, setSendQueueView] = useState<CampaignSendQueueView>("all");
  const [audienceHygiene, setAudienceHygiene] = useState<AudienceHygiene | null>(null);
  const [hygieneAudience, setHygieneAudience] = useState<AudienceKey>("marketing_opt_in");
  const [playbook, setPlaybook] = useState<RetentionPlaybookEntry[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const audienceRequestRef = useRef(0);
  const [sending, setSending] = useState<"dry_run" | "send" | "force_dry_run" | "force_send" | null>(null);
  const [scheduleDate, setScheduleDate] = useState(dateInputValue(1));
  const [scheduleDuration, setScheduleDuration] = useState("7");
  const [scheduling, setScheduling] = useState(false);
  const [activatingDueSchedules, setActivatingDueSchedules] = useState(false);
  const [queueDryRunningId, setQueueDryRunningId] = useState<number | null>(null);
  const [queueLiveSendingId, setQueueLiveSendingId] = useState<number | null>(null);
  const [retryingDeliveryIssues, setRetryingDeliveryIssues] = useState(false);
  const [creatingPlaybookAudience, setCreatingPlaybookAudience] = useState<AudienceKey | null>(null);
  const [creatingSocialPost, setCreatingSocialPost] = useState(false);
  const [creatingAdCampaign, setCreatingAdCampaign] = useState(false);
  const [creatingLaunchBundle, setCreatingLaunchBundle] = useState(false);
  const [cleanupReturn, setCleanupReturn] = useState<CampaignReturnState>({
    fromCleanup: false,
    campaignId: null,
  });

  useEffect(() => {
    const initialReturn = readInitialCampaignReturn();
    setCleanupReturn(initialReturn);
    if (initialReturn.fromCleanup) {
      setMessage("Returned from customer cleanup. Re-check readiness before sending newly ready contacts.");
    }
    fetchPromotions(initialReturn.campaignId);
    fetchProviderReadiness();
    fetchDispatchControl();
    fetchPlaybook();
    fetchPerformanceRollup();
    fetchScheduleQueue();
    fetchSendQueue();
    fetchMarketingLiveReadiness();
    fetchAudienceHygiene();
  }, []);

  const selectedPromotion = useMemo(
    () => promotions.find((promotion) => promotion.id === selectedId) || null,
    [promotions, selectedId]
  );
  const showCleanupReturnPanel =
    cleanupReturn.fromCleanup &&
    Boolean(selectedPromotion) &&
    (!cleanupReturn.campaignId || cleanupReturn.campaignId === selectedPromotion?.id);

  useEffect(() => {
    if (!selectedPromotion) return;
    const today = dateInputValue();
    setScheduleDate(selectedPromotion.start_date >= today ? selectedPromotion.start_date : dateInputValue(1));
    setScheduleDuration(String(campaignDurationDays(selectedPromotion)));
  }, [selectedPromotion?.id]);

  const activeCount = promotions.filter((promotion) => promotion.status === "active").length;
  const scheduledCount = promotions.filter((promotion) => promotion.status === "scheduled").length;
  const scheduleQueueRows = scheduleQueue?.campaigns || [];
  const sendQueueRows = sendQueue?.campaigns || [];
  const selectedSchedule = selectedPromotion?.schedule;
  const selectedScheduledFuture =
    selectedPromotion?.status === "scheduled" && selectedSchedule?.phase === "upcoming";
  const selectedSocialHandoff = performance?.social.latest_post || null;
  const selectedAdHandoff = performance?.ads.latest_campaign || null;
  const launchBundleReadyCount = [selectedSocialHandoff, selectedAdHandoff].filter(Boolean).length;
  const selectedSendQueueRow = selectedPromotion
    ? sendQueueRows.find((row) => row.promotion.id === selectedPromotion.id) || null
    : null;
  const selectedReadyCount = dispatch?.send_ready_count ?? selectedSendQueueRow?.ready_count ?? 0;
  const selectedMissingCount = dispatch?.missing_destination_count ?? selectedSendQueueRow?.missing_count ?? 0;
  const sendGateStatus: LaunchSupervisorStatus = selectedSendQueueRow?.can_send
    ? "ready"
    : selectedSendQueueRow?.can_dry_run || (deliveryHistory?.dry_run_count || 0) > 0
    ? "watching"
    : dispatch?.provider_status?.configured || selectedReadyCount > 0
    ? "pending"
    : "blocked";
  const socialSupervisorStatus: LaunchSupervisorStatus = selectedSocialHandoff
    ? "ready"
    : socialReadiness?.schedule.eligible_count
    ? "pending"
    : "blocked";
  const adSupervisorStatus: LaunchSupervisorStatus = selectedAdHandoff
    ? "ready"
    : adLaunchReadiness?.ready_count
    ? "pending"
    : "blocked";
  const measurementSupervisorStatus: LaunchSupervisorStatus = performance?.redemptions.count
    ? "ready"
    : performance
    ? "watching"
    : "pending";
  const launchSupervisorSteps: LaunchSupervisorStep[] = selectedPromotion
    ? [
        {
          key: "send",
          label: "Customer Send Gate",
          status: sendGateStatus,
          metric: `${selectedReadyCount} ready / ${selectedMissingCount} missing`,
          detail:
            selectedSendQueueRow?.recommended_action ||
            dispatch?.provider_status?.next_action ||
            "Run the dry-run proof before sending this campaign to customers.",
          action: "Review send queue",
          href: `/promotions?campaign=${selectedPromotion.id}`,
          icon: Send,
        },
        {
          key: "social",
          label: "Social Draft",
          status: socialSupervisorStatus,
          metric: selectedSocialHandoff
            ? `Post #${selectedSocialHandoff.id}`
            : `${socialReadiness?.schedule.eligible_count || 0} due-ready`,
          detail: selectedSocialHandoff
            ? `${formatPlatforms(selectedSocialHandoff.platforms)} draft is ready for publishing.`
            : "Build the launch bundle to prepare Facebook and Instagram copy.",
          action: "Open social",
          href: performance?.social.latest_post_id
            ? `/social?post=${performance.social.latest_post_id}`
            : "/social",
          icon: Share2,
        },
        {
          key: "ad",
          label: "Meta Ad Handoff",
          status: adSupervisorStatus,
          metric: selectedAdHandoff
            ? `Ad #${selectedAdHandoff.id}`
            : `${adLaunchReadiness?.ready_count || 0} preflight-ready`,
          detail: selectedAdHandoff
            ? `${formatPlatforms(selectedAdHandoff.platforms)} sales ad is staged with ${formatRupees(
                selectedAdHandoff.daily_budget || selectedAdHandoff.lifetime_budget
              )} budget.`
            : adLaunchReadiness?.provider_status.next_action ||
              "Build the launch bundle to create the Meta ad handoff.",
          action: "Open ads",
          href: performance?.ads.latest_campaign_id
            ? `/ads?campaign=${performance.ads.latest_campaign_id}`
            : "/ads",
          icon: Target,
        },
        {
          key: "measurement",
          label: "Measurement",
          status: measurementSupervisorStatus,
          metric: `${performance?.redemptions.count || 0} orders / ${formatRupees(
            performance?.redemptions.revenue || 0
          )}`,
          detail:
            performance?.redemptions.count
              ? "Coupon orders are already rolling into campaign performance."
              : "Redemptions, ad spend and ROAS will update here after customers use the coupon.",
          action: "Open reports",
          href: "/reports",
          icon: Megaphone,
        },
      ]
    : [];
  const launchSupervisorReadyCount = launchSupervisorSteps.filter((step) => step.status === "ready").length;
  const bestCampaign = performanceRollup?.best_campaign || null;
  const comparisonRows = performanceRollup?.campaigns.slice(0, 6) || [];
  const hygieneChannels = channelOptions.map((option) => option.value);
  const providerChannels = (["whatsapp", "sms", "email"] as ChannelKey[]).map((channel) => ({
    channel,
    status: providerReadiness?.channels.find((item) => item.channel === channel),
  }));
  const fallbackDispatchControls: ProviderComplianceCheck[] = [
    {
      label: "Secret-safe activation",
      status: "enforced",
      detail: "Only missing setting names and masked recipients are shown; provider secrets are never returned.",
    },
    {
      label: "Consent gate",
      status: "enforced",
      detail: "Campaign delivery skips customers without promotional opt-in before any provider call.",
    },
    {
      label: "Dry-run proof",
      status: "enforced",
      detail: "Live campaign sends stay blocked until a dry-run receipt exists for the channel.",
    },
    {
      label: "Recovery queue",
      status: "ready",
      detail: "Failed and skipped deliveries are classified for resend or contact-cleanup action.",
    },
  ];
  const fallbackDispatchChannels: DispatchChannelControl[] = providerChannels.map(({ channel, status }) => ({
    channel,
    provider_status:
      status || {
        channel,
        provider: "checking",
        enabled: false,
        configured: false,
        unsupported: false,
        missing_settings: [],
        readiness_label: "Checking",
      },
    activation_status: status?.configured ? "test_proof_needed" : "credentials_needed",
    blockers: status?.missing_settings?.length ? status.missing_settings : ["Loading delivery proof"],
    counts: {
      attempted_count: 0,
      sent_count: 0,
      dry_run_count: 0,
      failed_count: 0,
      skipped_count: 0,
      needs_attention_count: 0,
      retryable_count: 0,
      consent_blocked_count: 0,
      missing_destination_count: 0,
      already_sent_count: 0,
      provider_issue_count: 0,
      needs_review_count: 0,
    },
    latest_dry_run: null,
    latest_sent: null,
    latest_issue: null,
    next_action: status?.next_action || "Loading delivery proof and provider audit.",
  }));
  const dispatchSummary =
    dispatchControl?.summary || {
      overall_status: (providerReadiness?.configured_count ? "partially_ready" : "setup_needed") as DispatchActivationStatus,
      send_enabled: Boolean(providerReadiness?.send_enabled),
      configured_count: providerReadiness?.configured_count || 0,
      live_ready_count: 0,
      blocked_count: 3,
      attempted_count: 0,
      sent_count: 0,
      dry_run_count: 0,
      failed_count: 0,
      skipped_count: 0,
      needs_attention_count: 0,
      provider_issue_count: 0,
      next_action: providerReadiness?.next_action || "Loading delivery proof and provider audit.",
    };
  const dispatchChannels = dispatchControl?.channels || fallbackDispatchChannels;
  const dispatchControls = dispatchControl?.controls || fallbackDispatchControls;
  const deliveryAuditCounts = deliveryHistory?.audit_counts || {
    consent_blocked_count: deliveryHistory?.consent_blocked_count || 0,
    missing_destination_count: deliveryHistory?.missing_destination_count || 0,
    already_sent_count: deliveryHistory?.already_sent_count || 0,
    provider_issue_count: deliveryHistory?.provider_issue_count || 0,
    needs_review_count: deliveryHistory?.needs_review_count || 0,
  };
  const socialProviderCount = Object.keys(socialReadiness?.providers || {}).length;
  const socialProviderReadyCount = Object.values(socialReadiness?.providers || {}).filter(
    (status) => status.configured
  ).length;
  const socialIssueCount =
    (socialReadiness?.audit.provider_issue_count || 0) +
    (socialReadiness?.audit.asset_issue_count || 0) +
    (socialReadiness?.audit.needs_review_count || 0);
  const adIssueCount =
    (adSyncReadiness?.audit.provider_setup_issue_count || 0) +
    (adSyncReadiness?.audit.provider_issue_count || 0) +
    (adSyncReadiness?.audit.external_id_issue_count || 0) +
    (adSyncReadiness?.audit.needs_review_count || 0);
  const campaignSenderChecklist: MarketingChecklistItem[] = [
    {
      label: "Channel credentials",
      passed: (providerReadiness?.configured_count || 0) === 3,
      detail: `${providerReadiness?.configured_count || 0}/3 WhatsApp, SMS and email providers are configured.`,
    },
    {
      label: "Dry-run coverage",
      passed: (sendQueue?.summary.dry_run_needed_count || 0) === 0 && (sendQueue?.summary.campaign_count || 0) > 0,
      detail: `${sendQueue?.summary.dry_run_done_count || 0} done, ${sendQueue?.summary.dry_run_needed_count || 0} still need proof.`,
    },
    {
      label: "Audience quality",
      passed: (sendQueue?.summary.audience_blocked_count || 0) === 0 && (sendQueue?.summary.missing_contacts || 0) === 0,
      detail: `${sendQueue?.summary.send_ready_contacts || 0} contacts ready, ${sendQueue?.summary.missing_contacts || 0} missing destination.`,
    },
    {
      label: "Live send gate",
      passed:
        (sendQueue?.summary.live_ready_count || 0) > 0 &&
        (sendQueue?.summary.provider_blocked_count || 0) === 0 &&
        providerReadiness?.live_send_blocked === false,
      detail: `${sendQueue?.summary.live_ready_count || 0} campaign(s) live-ready, ${sendQueue?.summary.provider_blocked_count || 0} provider blocked.`,
    },
  ];
  const socialPostingChecklist: MarketingChecklistItem[] = [
    {
      label: "Social providers",
      passed: socialProviderCount > 0 && socialProviderReadyCount === socialProviderCount,
      detail: `${socialProviderReadyCount}/${socialProviderCount || 2} Facebook and Instagram providers are ready.`,
    },
    {
      label: "Auto-publish queue",
      passed:
        (socialReadiness?.schedule.blocked_count || 0) === 0 &&
        (socialReadiness?.schedule.eligible_count || 0) >= (socialReadiness?.schedule.due_count || 0),
      detail: `${socialReadiness?.schedule.eligible_count || 0} eligible, ${socialReadiness?.schedule.blocked_count || 0} blocked due posts.`,
    },
    {
      label: "Content audit",
      passed: socialIssueCount === 0,
      detail: `${socialIssueCount} provider, asset or review issue(s) need attention.`,
    },
    {
      label: "Dry-run history",
      passed: (socialReadiness?.audit.dry_run_count || 0) > 0 || (socialReadiness?.audit.published_count || 0) > 0,
      detail: `${socialReadiness?.audit.dry_run_count || 0} dry-run, ${socialReadiness?.audit.published_count || 0} published receipt(s).`,
    },
  ];
  const adLaunchChecklist: MarketingChecklistItem[] = [
    {
      label: "Meta provider",
      passed: Boolean(adLaunchReadiness?.provider_status.configured),
      detail: adLaunchReadiness?.provider_status.readiness_label || "Meta provider readiness is loading.",
    },
    {
      label: "Launch preflight",
      passed: (adLaunchReadiness?.blocked_count || 0) === 0 && (adLaunchReadiness?.ready_count || 0) > 0,
      detail: `${adLaunchReadiness?.ready_count || 0} ready, ${adLaunchReadiness?.blocked_count || 0} blocked campaign(s).`,
    },
    {
      label: "External ID sync",
      passed: (adSyncReadiness?.audit.unsynced_live_count || 0) === 0,
      detail: `${adSyncReadiness?.audit.unsynced_live_count || 0} live/paused/completed campaign(s) need Meta ID sync.`,
    },
    {
      label: "Provider action audit",
      passed: adIssueCount === 0,
      detail: `${adIssueCount} provider, setup, external ID or review issue(s).`,
    },
  ];
  const marketingLiveChecks = [...campaignSenderChecklist, ...socialPostingChecklist, ...adLaunchChecklist];
  const marketingPassedChecks = marketingLiveChecks.filter((item) => item.passed).length;
  const marketingReadinessScore = Math.round((marketingPassedChecks / marketingLiveChecks.length) * 100);
  const marketingNextActions = [
    dispatchSummary.next_action,
    providerReadiness?.next_action,
    socialReadiness?.next_action,
    adSyncReadiness?.next_action || adLaunchReadiness?.provider_status.next_action,
  ].filter(Boolean) as string[];

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

  const fetchDispatchControl = async () => {
    const response = await fetch(`${PROMOTIONS_API}/providers/dispatch-control`, {
      credentials: "include",
    });
    if (!response.ok) {
      setDispatchControl(null);
      return;
    }
    setDispatchControl(await response.json());
  };

  const changeProviderTestChannel = (channel: ChannelKey) => {
    setProviderTestChannel(channel);
    setProviderTestRecipient(defaultTestRecipient(channel));
    setProviderTestResult(null);
  };

  const runProviderTestSend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProviderTesting(true);
    try {
      const response = await fetch(`${PROMOTIONS_API}/providers/test-send`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: providerTestChannel,
          recipient: providerTestRecipient,
          message_template: providerTestTemplate,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.detail || "Safe test send could not be generated.");
        return;
      }
      setProviderTestResult(data);
      setMessage(`${channelLabel(providerTestChannel)} safe test send generated in dry-run mode.`);
      await fetchProviderReadiness();
      await fetchDispatchControl();
    } catch {
      setMessage("Safe test send could not be generated.");
    } finally {
      setProviderTesting(false);
    }
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

  const fetchPerformanceRollup = async () => {
    const response = await fetch(`${PROMOTIONS_API}/performance?limit=12`, {
      credentials: "include",
    });
    if (!response.ok) {
      setPerformanceRollup(null);
      return;
    }
    setPerformanceRollup(await response.json());
  };

  const fetchScheduleQueue = async () => {
    const response = await fetch(`${PROMOTIONS_API}/schedule/queue?limit=20`, {
      credentials: "include",
    });
    if (!response.ok) {
      setScheduleQueue(null);
      return;
    }
    setScheduleQueue(await response.json());
  };

  const fetchSendQueue = async (view: CampaignSendQueueView = sendQueueView) => {
    const params = new URLSearchParams({ limit: "50", view });
    const response = await fetch(`${PROMOTIONS_API}/send/queue?${params.toString()}`, {
      credentials: "include",
    });
    if (!response.ok) {
      setSendQueue(null);
      return;
    }
    setSendQueue(await response.json());
  };

  const fetchMarketingLiveReadiness = async () => {
    try {
      const [socialResponse, adLaunchResponse, adSyncResponse] = await Promise.all([
        fetch(`${SOCIAL_API}/readiness?limit=20`, { credentials: "include" }),
        fetch(`${ADS_API}/launch-readiness?limit=20`, { credentials: "include" }),
        fetch(`${ADS_API}/sync-readiness?limit=20`, { credentials: "include" }),
      ]);
      setSocialReadiness(socialResponse.ok ? await socialResponse.json() : null);
      setAdLaunchReadiness(adLaunchResponse.ok ? await adLaunchResponse.json() : null);
      setAdSyncReadiness(adSyncResponse.ok ? await adSyncResponse.json() : null);
    } catch {
      setSocialReadiness(null);
      setAdLaunchReadiness(null);
      setAdSyncReadiness(null);
    }
  };

  const fetchAudienceHygiene = async (audience: AudienceKey = hygieneAudience) => {
    const requestId = audienceRequestRef.current + 1;
    audienceRequestRef.current = requestId;
    const response = await fetch(`${PROMOTIONS_API}/audience?audience=${audience}&limit=8`, {
      credentials: "include",
    });
    if (requestId !== audienceRequestRef.current) return;
    if (!response.ok) {
      setAudienceHygiene(null);
      return;
    }
    const data = await response.json();
    if (requestId !== audienceRequestRef.current) return;
    setAudienceHygiene(data);
    setHygieneAudience(audience);
  };

  const fetchPromotions = async (preferredSelectedId: number | null = null) => {
    setLoading(true);
    const response = await fetch(`${PROMOTIONS_API}/`, { credentials: "include" });
    const data: Promotion[] = await response.json();
    setPromotions(data);
    const preferredExists = preferredSelectedId
      ? data.some((promotion) => promotion.id === preferredSelectedId)
      : false;
    const currentExists = selectedId
      ? data.some((promotion) => promotion.id === selectedId)
      : false;
    const nextSelectedId = preferredExists
      ? preferredSelectedId
      : currentExists
      ? selectedId
      : data[0]?.id || null;
    setSelectedId(nextSelectedId);
    if (nextSelectedId) {
      await fetchCampaignDetails(nextSelectedId);
      const promotion = data.find((item) => item.id === nextSelectedId);
      if (promotion) {
        await fetchAudienceHygiene(promotion.audience);
      }
    } else {
      setOutreach(null);
      setDispatch(null);
      setDeliveryHistory(null);
      setPerformance(null);
      setActivityTimeline(null);
    }
    setLoading(false);
  };

  const fetchCampaignDetails = async (promotionId: number) => {
    await Promise.all([
      fetchOutreach(promotionId),
      fetchDispatch(promotionId),
      fetchDeliveries(promotionId),
      fetchPerformance(promotionId),
      fetchActivityTimeline(promotionId),
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

  const fetchDeliveries = async (
    promotionId: number,
    filter = deliveryFilter,
    reasonFilter = deliveryReasonFilter
  ) => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    if (reasonFilter !== "all") params.set("reason", reasonFilter);
    const query = params.toString() ? `?${params.toString()}` : "";
    const response = await fetch(`${PROMOTIONS_API}/${promotionId}/deliveries${query}`, {
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

  const fetchActivityTimeline = async (promotionId: number) => {
    const response = await fetch(`${PROMOTIONS_API}/${promotionId}/timeline`, {
      credentials: "include",
    });
    if (!response.ok) {
      setActivityTimeline(null);
      return;
    }
    setActivityTimeline(await response.json());
  };

  const selectPromotion = (promotionId: number) => {
    setSelectedId(promotionId);
    setCleanupReturn({ fromCleanup: false, campaignId: promotionId });
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      params.set("campaign", String(promotionId));
      params.delete("source");
      window.history.replaceState(null, "", `?${params.toString()}`);
    }
    fetchCampaignDetails(promotionId);
    const promotion = promotions.find((item) => item.id === promotionId);
    if (promotion) {
      fetchAudienceHygiene(promotion.audience);
    }
  };

  const changeHygieneAudience = (audience: AudienceKey) => {
    setHygieneAudience(audience);
    fetchAudienceHygiene(audience);
  };

  const changeSendQueueView = (view: CampaignSendQueueView) => {
    setSendQueueView(view);
    fetchSendQueue(view);
  };

  const changeDeliveryFilter = (filter: DeliveryStatusFilter) => {
    setDeliveryFilter(filter);
    if (selectedId) {
      fetchDeliveries(selectedId, filter, deliveryReasonFilter);
    }
  };

  const changeDeliveryReasonFilter = (filter: DeliveryReasonFilter) => {
    setDeliveryReasonFilter(filter);
    if (selectedId) {
      fetchDeliveries(selectedId, deliveryFilter, filter);
    }
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
    await fetchPerformanceRollup();
    await fetchSendQueue();
    await fetchAudienceHygiene(data.promotion.audience);
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
    await fetchPerformanceRollup();
    await fetchSendQueue();
    await fetchAudienceHygiene(data.promotion.audience);
    setSelectedId(data.promotion.id);
    await fetchCampaignDetails(data.promotion.id);
    setCreatingPlaybookAudience(null);
  };

  const scheduleCampaign = async () => {
    if (!selectedPromotion) return;
    const durationDays = Math.max(1, Number(scheduleDuration) || 7);
    setScheduling(true);
    const response = await fetch(`${PROMOTIONS_API}/${selectedPromotion.id}/schedule`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_date: scheduleDate,
        duration_days: durationDays,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.detail || "Campaign could not be scheduled.");
      setScheduling(false);
      return;
    }

    setMessage(`Scheduled ${data.promotion.name} for ${data.promotion.start_date}.`);
    await fetchPromotions(data.promotion.id);
    await fetchScheduleQueue();
    await fetchSendQueue();
    await fetchPerformanceRollup();
    setScheduling(false);
  };

  const activateDueSchedules = async () => {
    setActivatingDueSchedules(true);
    const response = await fetch(`${PROMOTIONS_API}/schedule/activate-due`, {
      method: "POST",
      credentials: "include",
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.detail || "Due campaigns could not be activated.");
      setActivatingDueSchedules(false);
      return;
    }

    setMessage(`Activated ${data.activated_count} due scheduled campaigns.`);
    await fetchPromotions(data.campaigns?.[0]?.id || selectedId);
    await fetchScheduleQueue();
    await fetchSendQueue();
    await fetchPerformanceRollup();
    setActivatingDueSchedules(false);
  };

  const runQueueDryRun = async (promotionId: number) => {
    setQueueDryRunningId(promotionId);
    const response = await fetch(`${PROMOTIONS_API}/${promotionId}/send`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dry_run: true, limit: 50 }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.detail || "Queue dry run failed.");
      setQueueDryRunningId(null);
      return;
    }

    setMessage(`Queue dry run checked ${data.attempted_count} contacts for ${data.promotion.name}.`);
    await fetchPromotions(promotionId);
    await fetchSendQueue();
    await fetchCampaignDetails(promotionId);
    await fetchPerformanceRollup();
    setQueueDryRunningId(null);
  };

  const runQueueLiveSend = async (row: CampaignSendQueueRow) => {
    const blockers = row.live_send_blockers.length ? row.live_send_blockers.join(", ") : "provider setup";
    if (!row.can_send) {
      setMessage(`${row.promotion.name} cannot send live yet: ${blockers}.`);
      return;
    }
    const confirmationPhrase = row.live_confirmation_phrase || `LIVE SEND ${row.promotion.id}`;
    const typedConfirmation = window.prompt(
      `Type ${confirmationPhrase} to send ${row.promotion.name} to ${row.ready_count} ready contacts.`
    );
    if (typedConfirmation !== confirmationPhrase) {
      setMessage(`Live send cancelled for ${row.promotion.name}. Confirmation phrase did not match.`);
      return;
    }

    setQueueLiveSendingId(row.promotion.id);
    const response = await fetch(`${PROMOTIONS_API}/${row.promotion.id}/send`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dry_run: false,
        limit: 50,
        live_confirmation: typedConfirmation,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.detail || "Queue live send failed.");
      setQueueLiveSendingId(null);
      return;
    }

    setMessage(
      `Queue live send finished for ${data.promotion.name}: ${data.sent_count} sent, ${data.skipped_count} skipped, ${data.failed_count} failed.`
    );
    await fetchPromotions(row.promotion.id);
    await fetchSendQueue();
    await fetchCampaignDetails(row.promotion.id);
    await fetchPerformanceRollup();
    setQueueLiveSendingId(null);
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

  const copyCleanupQueue = async () => {
    if (!deliveryHistory?.deliveries.length) {
      setMessage(`No cleanup rows match ${deliveryReasonFilterLabel(deliveryReasonFilter)}.`);
      return;
    }
    const rows = deliveryHistory.deliveries.map((delivery) =>
      [
        deliveryReasonFilterLabel(deliveryReasonFilter),
        delivery.status,
        delivery.customer?.phone || "",
        delivery.customer?.email || "",
        delivery.customer?.name || "",
        delivery.error || "",
        delivery.recovery_action || "",
      ].join("\t")
    );
    await navigator.clipboard.writeText(
      [
        "reason\tstatus\tphone\temail\tname\terror\trecovery_action",
        ...rows,
      ].join("\n")
    );
    setMessage(`Copied ${deliveryHistory.deliveries.length} cleanup rows from ${deliveryReasonFilterLabel(deliveryReasonFilter)}.`);
  };

  const retryCurrentDeliveryIssue = async () => {
    if (!selectedPromotion || !deliveryHistory) return;
    setRetryingDeliveryIssues(true);
    const response = await fetch(`${PROMOTIONS_API}/${selectedPromotion.id}/deliveries/retry`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dry_run: true,
        limit: 50,
        status: deliveryFilter,
        reason: deliveryReasonFilter,
      }),
    });
    const data: DeliveryRetryResult | { detail?: string } = await response.json();
    if (!response.ok) {
      setMessage(("detail" in data && data.detail) || "Delivery retry failed.");
      setRetryingDeliveryIssues(false);
      return;
    }

    const result = data as DeliveryRetryResult;
    setMessage(
      `Retried ${result.retried_customer_count} customers from ${deliveryReasonFilterLabel(deliveryReasonFilter)}: ${result.dry_run_count} ready, ${result.skipped_count} still blocked.`
    );
    await fetchCampaignDetails(selectedPromotion.id);
    await fetchPerformanceRollup();
    await fetchSendQueue();
    setRetryingDeliveryIssues(false);
  };

  const sendCampaign = async (
    dryRun: boolean,
    options: { forceResend?: boolean; markCompleted?: boolean } = {}
  ) => {
    if (!selectedPromotion) return;
    const forced = Boolean(options.forceResend);
    if (!dryRun || forced) {
      const action = dryRun
        ? `rerun the dry-run check for ${selectedPromotion.name}`
        : forced
        ? `force resend ${selectedPromotion.name} to ready contacts`
        : `send ${selectedPromotion.name} to ready ${channelLabel(selectedPromotion.channel)} contacts`;
      const confirmed = window.confirm(`Confirm you want to ${action}?`);
      if (!confirmed) return;
    }
    setSending(forced ? (dryRun ? "force_dry_run" : "force_send") : dryRun ? "dry_run" : "send");
    const response = await fetch(`${PROMOTIONS_API}/${selectedPromotion.id}/send`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dry_run: dryRun,
        limit: 50,
        force_resend: forced,
        mark_completed: Boolean(options.markCompleted),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.detail || "Campaign send failed.");
      setSending(null);
      return;
    }
    setMessage(
      dryRun
        ? `${forced ? "Forced dry run" : "Dry run"} checked ${data.attempted_count} contacts.`
        : `${forced ? "Force resend" : "Send"} finished: ${data.sent_count} sent, ${data.skipped_count} skipped, ${data.failed_count} failed.`
    );
    await fetchCampaignDetails(selectedPromotion.id);
    await fetchPerformanceRollup();
    await fetchSendQueue();
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
      await fetchActivityTimeline(selectedPromotion.id);
      await fetchPerformanceRollup();
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
      await fetchActivityTimeline(selectedPromotion.id);
      await fetchPerformanceRollup();
    } catch {
      setMessage("Ad campaign could not be created.");
    } finally {
      setCreatingAdCampaign(false);
    }
  };

  const createLaunchBundle = async () => {
    if (!selectedPromotion) return;
    setCreatingLaunchBundle(true);
    try {
      const offerLink = orderOfferLink(selectedPromotion);
      const [socialResponse, adResponse] = await Promise.all([
        fetch(`${PROMOTIONS_API}/${selectedPromotion.id}/social-post`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            link_url: offerLink,
            image_url: defaultSocialImage,
            platforms: ["facebook", "instagram"],
            status: "ready",
          }),
        }),
        fetch(`${PROMOTIONS_API}/${selectedPromotion.id}/ad-campaign`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            link_url: offerLink,
            image_url: defaultSocialImage,
            platforms: ["facebook", "instagram"],
            objective: "sales",
            daily_budget: 500,
            status: "ready",
          }),
        }),
      ]);
      const [socialData, adData] = await Promise.all([
        socialResponse.json().catch(() => ({})),
        adResponse.json().catch(() => ({})),
      ]);
      if (!socialResponse.ok || !adResponse.ok) {
        setMessage(
          [
            !socialResponse.ok ? socialData.detail || "Social post could not be created." : null,
            !adResponse.ok ? adData.detail || "Ad campaign could not be created." : null,
          ]
            .filter(Boolean)
            .join(" ")
        );
        return;
      }
      setMessage(
        `Launch bundle ready for ${selectedPromotion.name}: social post #${socialData.post.id} and ad campaign #${adData.campaign.id}.`
      );
      await fetchPerformance(selectedPromotion.id);
      await fetchActivityTimeline(selectedPromotion.id);
      await fetchPerformanceRollup();
    } catch {
      setMessage("Launch bundle could not be created.");
    } finally {
      setCreatingLaunchBundle(false);
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
              fetchDispatchControl();
              fetchPlaybook();
              fetchPerformanceRollup();
              fetchScheduleQueue();
              fetchSendQueue();
              fetchMarketingLiveReadiness();
              fetchAudienceHygiene();
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

      <section
        data-testid="marketing-live-readiness-board"
        className="mb-8 rounded-xl border border-sky-500/10 bg-[#101417] p-6"
      >
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-sky-300">Marketing Live Readiness</p>
            <h2 className="mt-1 text-xl font-black">Campaign sender, social publishing and Meta ads handoff</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
              One checklist for the channels we discussed: promotional sends, auto social posts and ad launch readiness before real credentials go live.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              data-testid="marketing-live-readiness-score"
              className={`rounded-full px-4 py-2 text-xs font-black uppercase ${marketingScoreClass(marketingReadinessScore)}`}
            >
              {marketingReadinessScore}% ready
            </span>
            <span className="rounded-full bg-white/10 px-4 py-2 text-xs font-black uppercase text-gray-300">
              {marketingPassedChecks}/{marketingLiveChecks.length} checks passed
            </span>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
          <MarketingChecklistCard
            testId="marketing-sender-checklist"
            icon={Send}
            label="Campaign Sender Checklist"
            title="WhatsApp, SMS and email"
            status={`${sendQueue?.summary.live_ready_count || 0} live-ready`}
            href="#campaign-send-queue"
            action="Open send queue"
            items={campaignSenderChecklist}
            metrics={[
              { label: "Providers", value: `${providerReadiness?.configured_count || 0}/3` },
              { label: "Ready Campaigns", value: `${sendQueue?.summary.ready_campaign_count || 0}` },
              { label: "Ready Contacts", value: `${sendQueue?.summary.send_ready_contacts || 0}` },
            ]}
          />
          <MarketingChecklistCard
            testId="marketing-social-checklist"
            icon={Share2}
            label="Social Posting Checklist"
            title="Facebook and Instagram"
            status={`${socialReadiness?.schedule.eligible_count || 0} due-ready`}
            href="/social"
            action="Open social"
            items={socialPostingChecklist}
            metrics={[
              { label: "Providers", value: `${socialProviderReadyCount}/${socialProviderCount || 2}` },
              { label: "Due Posts", value: `${socialReadiness?.schedule.due_count || 0}` },
              { label: "Blocked", value: `${socialReadiness?.schedule.blocked_count || 0}` },
            ]}
          />
          <MarketingChecklistCard
            testId="marketing-ad-checklist"
            icon={Target}
            label="Ad Launch Checklist"
            title="Meta Ads"
            status={`${adLaunchReadiness?.ready_count || 0} preflight-ready`}
            href="/ads"
            action="Open ads"
            items={adLaunchChecklist}
            metrics={[
              { label: "Ready", value: `${adLaunchReadiness?.ready_count || 0}` },
              { label: "Blocked", value: `${adLaunchReadiness?.blocked_count || 0}` },
              { label: "Budget", value: `Rs ${Math.round(adLaunchReadiness?.planned_budget || 0).toLocaleString()}` },
            ]}
          />
        </div>

        <div
          data-testid="marketing-live-readiness-next-actions"
          className="grid grid-cols-1 gap-3 rounded-xl border border-white/5 bg-black/25 p-4 lg:grid-cols-3"
        >
          {marketingNextActions.map((action, index) => (
            <div key={`${action}-${index}`} className="flex items-start gap-3 text-sm leading-6 text-gray-400">
              <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-yellow-300" />
              <span>{action}</span>
            </div>
          ))}
          {!marketingNextActions.length && (
            <div className="text-sm font-semibold leading-6 text-gray-500">
              Live-readiness checks are loading from campaign, social and ad systems.
            </div>
          )}
        </div>
      </section>

      <section
        data-testid="messaging-readiness-command"
        className="mb-8 rounded-xl border border-orange-500/10 bg-[#1a1a1c] p-6"
      >
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-orange-400">
              WhatsApp / SMS / Email Readiness
            </p>
            <h2 className="mt-1 text-xl font-black">Provider setup, template compliance and safe test-send</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
              Confirm credentials, production content checks and dry-run proofs before any campaign can move into live sending.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-sky-500/10 px-4 py-2 text-xs font-black uppercase text-sky-200">
              Safe test: dry-run only
            </span>
            <span
              className={`rounded-full px-4 py-2 text-xs font-black uppercase ${
                providerReadiness?.live_send_blocked === false
                  ? "bg-green-500/10 text-green-300"
                  : "bg-yellow-500/10 text-yellow-300"
              }`}
            >
              {providerReadiness?.configured_count || 0}/3 providers ready
            </span>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {providerChannels.map(({ channel, status }) => (
            <ProviderCard key={channel} status={status} channel={channel} />
          ))}
        </div>

        <div
          data-testid="campaign-dispatch-control"
          className="mb-5 rounded-xl border border-white/5 bg-black/25 p-5"
        >
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-orange-400">Campaign Dispatch Control</p>
              <h3 className="mt-1 text-lg font-black">Live-provider blockers and send proof</h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
                One view for credentials, consent, dry-run receipts and recovery work before WhatsApp, SMS or email goes live.
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-black uppercase ${dispatchActivationClass(
                dispatchSummary.overall_status
              )}`}
            >
              {dispatchActivationLabel(dispatchSummary.overall_status)}
            </span>
          </div>

          {dispatchControl || providerReadiness ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
                <MiniSignal icon={CheckCircle2} label="Live Ready" value={`${dispatchSummary.live_ready_count}/3`} />
                <MiniSignal icon={AlertTriangle} label="Blocked" value={`${dispatchSummary.blocked_count}`} />
                <MiniSignal icon={Send} label="Dry Runs" value={`${dispatchSummary.dry_run_count}`} />
                <MiniSignal icon={MessageCircle} label="Sent" value={`${dispatchSummary.sent_count}`} />
                <MiniSignal icon={Clock} label="Attention" value={`${dispatchSummary.needs_attention_count}`} />
                <MiniSignal icon={RefreshCw} label="Provider Issues" value={`${dispatchSummary.provider_issue_count}`} />
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {dispatchControls.map((control) => (
                  <div key={control.label} className="rounded-lg border border-white/5 bg-white/[0.03] p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-black text-white">{control.label}</p>
                      <span className="rounded-full bg-green-500/10 px-2 py-1 text-[10px] font-black uppercase text-green-300">
                        {control.status}
                      </span>
                    </div>
                    <p className="text-xs font-semibold leading-5 text-gray-500">{control.detail}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                {dispatchChannels.map((channel) => (
                  <div
                    data-testid={`dispatch-channel-${channel.channel}`}
                    key={`dispatch-${channel.channel}`}
                    className="rounded-xl border border-white/5 bg-white/[0.03] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black text-white">{channelLabel(channel.channel)}</p>
                        <p className="mt-1 text-xs font-semibold text-gray-500">
                          {channel.provider_status.provider} | {channel.provider_status.readiness_label}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-black uppercase ${dispatchActivationClass(
                          channel.activation_status
                        )}`}
                      >
                        {dispatchActivationLabel(channel.activation_status)}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <div className="rounded-lg border border-white/5 bg-black/25 p-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-600">Dry Run</p>
                        <p className="mt-1 text-sm font-black text-gray-200">{channel.counts.dry_run_count}</p>
                      </div>
                      <div className="rounded-lg border border-white/5 bg-black/25 p-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-600">Sent</p>
                        <p className="mt-1 text-sm font-black text-gray-200">{channel.counts.sent_count}</p>
                      </div>
                      <div className="rounded-lg border border-white/5 bg-black/25 p-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-600">Issues</p>
                        <p className="mt-1 text-sm font-black text-gray-200">{channel.counts.needs_attention_count}</p>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      <DispatchProofRow label="Dry-run proof" proof={channel.latest_dry_run} empty="Awaiting proof" />
                      <DispatchProofRow label="Last live send" proof={channel.latest_sent} empty="No live send yet" />
                      <DispatchProofRow label="Latest issue" proof={channel.latest_issue} empty="No open issue" />
                    </div>

                    {channel.blockers.length > 0 && (
                      <div className="mt-4 rounded-lg border border-yellow-500/10 bg-yellow-500/5 p-3">
                        <p className="text-xs font-black uppercase tracking-widest text-yellow-300">Blockers</p>
                        <p className="mt-2 break-words text-xs font-semibold leading-5 text-yellow-100">
                          {channel.blockers.join(", ")}
                        </p>
                      </div>
                    )}
                    <p className="mt-4 text-xs font-semibold leading-5 text-gray-500">{channel.next_action}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-white/5 bg-white/[0.03] p-4">
                <p className="text-xs font-black uppercase tracking-widest text-gray-500">Next Operator Action</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-gray-300">{dispatchSummary.next_action}</p>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-white/10 p-8 text-center text-sm font-semibold leading-6 text-gray-500">
              Dispatch control is loading the provider audit and delivery proof.
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <form
            data-testid="safe-test-send-form"
            onSubmit={runProviderTestSend}
            className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-5"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-orange-400">Safe Test Send</p>
                <h3 className="mt-1 text-lg font-black">Generate a dry-run receipt</h3>
              </div>
              <Send className="h-5 w-5 text-orange-300" />
            </div>
            <div className="space-y-4">
              <Select
                label="Test Channel"
                value={providerTestChannel}
                options={channelOptions}
                onChange={(value) => changeProviderTestChannel(value as ChannelKey)}
              />
              <label className="space-y-2">
                <span className="text-xs font-black uppercase tracking-widest text-gray-500">Test Recipient</span>
                <input
                  data-testid="safe-test-recipient"
                  value={providerTestRecipient}
                  onChange={(event) => setProviderTestRecipient(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-orange-500"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-black uppercase tracking-widest text-gray-500">Template Preview</span>
                <textarea
                  data-testid="safe-test-template"
                  value={providerTestTemplate}
                  onChange={(event) => setProviderTestTemplate(event.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-white/10 bg-black/30 p-4 text-sm leading-6 outline-none focus:border-orange-500"
                />
              </label>
              <button
                data-testid="run-safe-test-send"
                type="submit"
                disabled={providerTesting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 py-3 font-black text-white hover:bg-orange-600 disabled:cursor-wait disabled:bg-orange-500/50"
              >
                <CheckCircle2 className="h-4 w-4" />
                {providerTesting ? "Generating" : "Run Safe Test Send"}
              </button>
            </div>
          </form>

          <div
            data-testid="safe-test-send-result"
            className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-7"
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-orange-400">Readiness Receipt</p>
                <h3 className="mt-1 text-lg font-black">
                  {providerTestResult ? "Dry-run test generated" : "Waiting for safe test"}
                </h3>
              </div>
              <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-black uppercase text-blue-200">
                Live send blocked
              </span>
            </div>
            {providerTestResult ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <MiniSignal icon={MessageCircle} label="Channel" value={channelLabel(providerTestResult.channel)} />
                  <MiniSignal icon={Send} label="Mode" value="Dry Run" />
                  <MiniSignal icon={Users} label="Recipient" value={providerTestResult.recipient_masked} />
                  <MiniSignal icon={CheckCircle2} label="Queued" value={providerTestResult.queued ? "Yes" : "No"} />
                </div>
                <div className="rounded-lg border border-white/5 bg-white/[0.03] p-4">
                  <p className="mb-2 text-xs font-black uppercase tracking-widest text-gray-500">Message Preview</p>
                  <p className="text-sm font-semibold leading-6 text-gray-300">{providerTestResult.message_preview}</p>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {providerTestResult.compliance_checks.map((check) => (
                    <div key={`${providerTestResult.test_id}-${check.label}`} className="rounded-lg border border-white/5 bg-white/[0.03] p-3">
                      <p className="text-sm font-black text-white">{check.label}</p>
                      <p className="mt-1 text-xs font-semibold uppercase text-green-300">{check.status}</p>
                      <p className="mt-2 text-xs leading-5 text-gray-500">{check.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-white/10 p-8 text-center text-sm font-semibold leading-6 text-gray-500">
                Choose a channel and run a safe test to see the masked recipient, rendered message and compliance receipt.
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          {(providerReadiness?.compliance_summary || ["Consent gate ready.", "Destination validation ready.", "Dry-run proof required."]).map((item) => (
            <div key={item} className="rounded-lg border border-white/5 bg-black/25 p-3 text-sm font-semibold leading-6 text-gray-400">
              {item}
            </div>
          ))}
        </div>
      </section>

      <section data-testid="scheduled-campaign-queue" className="mb-8 rounded-xl border border-orange-500/10 bg-[#1a1a1c] p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-orange-400">
              Scheduled Campaign Queue
            </p>
            <h2 className="mt-1 text-xl font-black">Due campaigns and upcoming send windows</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
              Activate due campaigns into the live window, then run the normal provider send checklist.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={fetchScheduleQueue}
              className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-4 py-3 font-bold text-white hover:bg-white/10"
            >
              <RefreshCw className="h-4 w-4" /> Refresh Queue
            </button>
            <button
              data-testid="activate-due-campaigns"
              type="button"
              onClick={activateDueSchedules}
              disabled={activatingDueSchedules || !(scheduleQueue?.summary.due_today_count || 0)}
              className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 font-black text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              {activatingDueSchedules ? "Activating" : "Activate Due"}
            </button>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <MiniSignal icon={Calendar} label="Scheduled" value={`${scheduleQueue?.summary.scheduled_count || 0}`} />
          <MiniSignal icon={CheckCircle2} label="Due Today" value={`${scheduleQueue?.summary.due_today_count || 0}`} />
          <MiniSignal icon={Clock} label="Upcoming" value={`${scheduleQueue?.summary.upcoming_count || 0}`} />
          <MiniSignal icon={AlertTriangle} label="Overdue" value={`${scheduleQueue?.summary.overdue_count || 0}`} />
          <MiniSignal icon={Send} label="Ready Contacts" value={`${scheduleQueue?.summary.ready_count || 0}`} />
        </div>

        <div className="overflow-hidden rounded-xl border border-white/5 bg-black/25">
          <div className="grid grid-cols-12 gap-3 border-b border-white/5 px-4 py-3 text-xs font-black uppercase tracking-widest text-gray-600">
            <span className="col-span-4">Campaign</span>
            <span className="col-span-2 text-right">Window</span>
            <span className="col-span-2 text-right">Ready</span>
            <span className="col-span-2 text-right">State</span>
            <span className="col-span-2 text-right">Action</span>
          </div>
          {scheduleQueueRows.map((row) => (
            <div
              data-testid={`scheduled-queue-row-${row.promotion.id}`}
              key={`scheduled-${row.promotion.id}`}
              className="grid grid-cols-12 gap-3 border-b border-white/5 px-4 py-3 text-sm"
            >
              <div className="col-span-4 min-w-0">
                <p className="break-words font-black text-white">{row.promotion.name}</p>
                <p className="mt-1 text-xs font-semibold uppercase text-gray-600">
                  {row.promotion.code || "No code"} | {audienceLabel(row.promotion.audience)}
                </p>
              </div>
              <div className="col-span-2 text-right text-gray-400">
                <p>{row.promotion.start_date}</p>
                <p className="mt-1 text-xs text-gray-600">to {row.promotion.end_date}</p>
              </div>
              <div className="col-span-2 text-right">
                <p className="font-black text-gray-200">{row.ready_count}</p>
                <p className="mt-1 text-xs text-gray-600">{row.missing_count} gaps</p>
              </div>
              <div className="col-span-2 text-right">
                <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${scheduleQueuePhaseClass(row.phase)}`}>
                  {scheduleQueuePhaseLabel(row.phase)}
                </span>
                <p className="mt-2 text-xs font-semibold leading-5 text-gray-600">{row.recommended_action}</p>
              </div>
              <div className="col-span-2 text-right">
                <button
                  type="button"
                  onClick={() => selectPromotion(row.promotion.id)}
                  className="rounded-lg bg-white/10 px-3 py-2 text-xs font-black uppercase text-white hover:bg-orange-500"
                >
                  Open
                </button>
              </div>
            </div>
          ))}
          {!scheduleQueueRows.length && (
            <div className="p-8 text-center text-sm font-semibold text-gray-500">
              No scheduled campaigns are waiting in the queue.
            </div>
          )}
        </div>
      </section>

      <section id="campaign-send-queue" data-testid="campaign-send-queue" className="mb-8 rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-orange-400">
              Campaign Send Queue
            </p>
            <h2 className="mt-1 text-xl font-black">Dry-run and provider readiness</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
              Check active campaigns before live sending. Provider-blocked rows can still run a dry-run.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fetchSendQueue()}
            className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-4 py-3 font-bold text-white hover:bg-white/10"
          >
            <RefreshCw className="h-4 w-4" /> Refresh Send Queue
          </button>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <MiniSignal icon={Megaphone} label="Live Campaigns" value={`${sendQueue?.summary.campaign_count || 0}`} />
          <MiniSignal icon={CheckCircle2} label="Ready Campaigns" value={`${sendQueue?.summary.ready_campaign_count || 0}`} />
          <MiniSignal icon={Clock} label="Need Dry Run" value={`${sendQueue?.summary.dry_run_needed_count || 0}`} />
          <MiniSignal icon={AlertTriangle} label="Provider Blocked" value={`${sendQueue?.summary.provider_blocked_count || 0}`} />
          <MiniSignal icon={Send} label="Ready Contacts" value={`${sendQueue?.summary.send_ready_contacts || 0}`} />
        </div>

        <div data-testid="send-queue-filters" className="mb-5 flex flex-wrap gap-2">
          {sendQueueViews.map((view) => (
            <button
              data-testid={`send-queue-filter-${view.value}`}
              key={view.value}
              type="button"
              onClick={() => changeSendQueueView(view.value)}
              className={`rounded-lg border px-3 py-2 text-xs font-black uppercase ${
                sendQueueView === view.value
                  ? "border-orange-500 bg-orange-500 text-white"
                  : "border-white/10 bg-white/5 text-gray-400 hover:border-white/20 hover:text-white"
              }`}
            >
              {view.label}
              <span className="ml-2 text-white/70">{sendQueue?.summary[view.countKey] || 0}</span>
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-white/5 bg-black/25">
          <div className="grid grid-cols-12 gap-3 border-b border-white/5 px-4 py-3 text-xs font-black uppercase tracking-widest text-gray-600">
            <span className="col-span-3">Campaign</span>
            <span className="col-span-2 text-right">Audience</span>
            <span className="col-span-2 text-right">Dry Runs</span>
            <span className="col-span-2 text-right">Provider</span>
            <span className="col-span-3 text-right">Action</span>
          </div>
          {sendQueueRows.map((row) => (
            <div
              data-testid={`send-queue-row-${row.promotion.id}`}
              key={`send-queue-${row.promotion.id}`}
              className="grid grid-cols-12 gap-3 border-b border-white/5 px-4 py-3 text-sm"
            >
              <div className="col-span-3 min-w-0">
                <p className="break-words font-black text-white">{row.promotion.name}</p>
                <p className="mt-1 text-xs font-semibold uppercase text-gray-600">
                  {row.promotion.code || "No code"} | {channelLabel(row.promotion.channel)}
                </p>
              </div>
              <div className="col-span-2 text-right">
                <p className="font-black text-gray-200">{row.ready_count} ready</p>
                <p className="mt-1 text-xs text-gray-600">{row.missing_count} gaps</p>
              </div>
              <div className="col-span-2 text-right">
                <p className="font-black text-gray-200">{row.dry_run_count}</p>
                <p className="mt-1 text-xs text-gray-600">{row.attempted_count} attempts</p>
              </div>
              <div className="col-span-2 text-right">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-black uppercase ${sendQueueStatusClass(row.queue_status)}`}
                >
                  {row.queue_label}
                </span>
                <p className="mt-2 text-xs font-black uppercase text-gray-500">{row.provider_status.provider}</p>
                <p className="mt-2 text-xs font-semibold leading-5 text-gray-600">{row.recommended_action}</p>
                {row.can_send ? (
                  <p
                    data-testid={`send-queue-live-confirmation-${row.promotion.id}`}
                    className="mt-2 break-words text-[11px] font-black uppercase tracking-widest text-emerald-300"
                  >
                    Confirm: {row.live_confirmation_phrase || `LIVE SEND ${row.promotion.id}`}
                  </p>
                ) : null}
              </div>
              <div className="col-span-3 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => selectPromotion(row.promotion.id)}
                  className="rounded-lg bg-white/10 px-3 py-2 text-xs font-black uppercase text-white hover:bg-white/15"
                >
                  Open
                </button>
                <button
                  data-testid={`send-queue-dry-run-${row.promotion.id}`}
                  type="button"
                  onClick={() => runQueueDryRun(row.promotion.id)}
                  disabled={queueDryRunningId !== null || !row.can_dry_run}
                  className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-black uppercase text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {queueDryRunningId === row.promotion.id ? "Checking" : "Dry Run"}
                </button>
                <button
                  data-testid={`send-queue-live-send-${row.promotion.id}`}
                  type="button"
                  onClick={() => runQueueLiveSend(row)}
                  disabled={queueLiveSendingId !== null || !row.can_send}
                  title={
                    row.can_send
                      ? "Send live campaign"
                      : row.live_send_blockers.length
                      ? `Blocked: ${row.live_send_blockers.join(", ")}`
                      : "Live send blocked"
                  }
                  className={`rounded-lg px-3 py-2 text-xs font-black uppercase disabled:cursor-not-allowed ${
                    row.can_send
                      ? "bg-emerald-400 text-black hover:bg-emerald-300"
                      : "bg-white/10 text-gray-500"
                  }`}
                >
                  {queueLiveSendingId === row.promotion.id ? "Sending" : "Send Live"}
                </button>
              </div>
            </div>
          ))}
          {!sendQueueRows.length && (
            <div className="p-8 text-center text-sm font-semibold text-gray-500">
              No active campaigns match {sendQueueViews.find((view) => view.value === sendQueueView)?.label || "this view"}.
            </div>
          )}
        </div>
      </section>

      <section className="mb-8 rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-orange-400">
              Marketing Performance Board
            </p>
            <h2 className="mt-1 text-xl font-black">Campaign comparison and coupon ROI</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
              Compare coupon revenue, discount cost, outreach conversion, social drafts, and ad handoff in one view.
            </p>
          </div>
          <button
            onClick={fetchPerformanceRollup}
            className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-4 py-3 font-bold text-white hover:bg-white/10"
          >
            <RefreshCw className="h-4 w-4" /> Refresh Board
          </button>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <MiniSignal
            icon={ShoppingBag}
            label="Coupon Revenue"
            value={formatRupees(performanceRollup?.summary.redemption_revenue || 0)}
          />
          <MiniSignal
            icon={Tag}
            label="Coupon Orders"
            value={`${performanceRollup?.summary.redemption_orders || 0}`}
          />
          <MiniSignal
            icon={Users}
            label="Unique Buyers"
            value={`${performanceRollup?.summary.unique_customers || 0}`}
          />
          <MiniSignal
            icon={Share2}
            label="Social Posts"
            value={`${performanceRollup?.summary.social_post_count || 0}`}
          />
          <MiniSignal
            icon={Target}
            label="Ad Budget"
            value={formatRupees(performanceRollup?.summary.planned_ad_budget || 0)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="rounded-xl border border-orange-500/10 bg-black/25 p-5 xl:col-span-4">
            <p className="text-xs font-black uppercase tracking-widest text-orange-400">
              Best Campaign
            </p>
            <h3 className="mt-2 break-words text-lg font-black">
              {bestCampaign?.promotion || "No campaign revenue yet"}
            </h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-gray-500">
              {bestCampaign
                ? `${bestCampaign.redemptions.count} coupon orders, ${formatRupees(
                    bestCampaign.redemptions.revenue
                  )} revenue, ${bestCampaign.outreach.conversion_rate_percent}% outreach conversion.`
                : "Revenue appears here after a coupon order is attributed to a campaign."}
            </p>
            {bestCampaign ? (
              <button
                type="button"
                onClick={() => selectPromotion(bestCampaign.promotion_detail.id)}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-black text-white hover:bg-orange-600"
              >
                Open Campaign <ExternalLink className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          <div className="xl:col-span-8">
            <div className="overflow-hidden rounded-xl border border-white/5 bg-black/25">
              <div className="grid grid-cols-12 gap-3 border-b border-white/5 px-4 py-3 text-xs font-black uppercase tracking-widest text-gray-600">
                <span className="col-span-4">Campaign Comparison</span>
                <span className="col-span-2 text-right">Revenue</span>
                <span className="col-span-2 text-right">Orders</span>
                <span className="col-span-2 text-right">Outreach</span>
                <span className="col-span-2 text-right">Handoffs</span>
              </div>
              {comparisonRows.map((row) => (
                <button
                  key={row.promotion_detail.id}
                  type="button"
                  onClick={() => selectPromotion(row.promotion_detail.id)}
                  className="grid w-full grid-cols-12 gap-3 border-b border-white/5 px-4 py-3 text-left text-sm hover:bg-white/[0.03]"
                >
                  <span className="col-span-4 min-w-0">
                    <span className="block break-words font-black text-white">{row.promotion}</span>
                    <span className="mt-1 block text-xs font-semibold uppercase text-gray-600">
                      {row.campaign_window.phase} | {row.promotion_detail.code || "No code"}
                    </span>
                  </span>
                  <span className="col-span-2 text-right font-black text-gray-200">
                    {formatRupees(row.redemptions.revenue)}
                  </span>
                  <span className="col-span-2 text-right text-gray-400">
                    {row.redemptions.count}
                  </span>
                  <span className="col-span-2 text-right text-gray-400">
                    {row.outreach.conversion_rate_percent}%
                  </span>
                  <span className="col-span-2 text-right text-gray-400">
                    {row.social.post_count + row.ads.campaign_count}
                  </span>
                </button>
              ))}
              {!comparisonRows.length && (
                <div className="p-8 text-center text-sm font-semibold text-gray-500">
                  No campaign performance rows yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="mb-8 rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-orange-400">
              Audience Hygiene
            </p>
            <h2 className="mt-1 text-xl font-black">Contact readiness before campaign sends</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
              Check consent, email gaps, phone coverage, and the best-ready channel before launching a promotion.
            </p>
          </div>
          <div className="flex min-w-[16rem] flex-wrap items-end gap-3">
            <div className="w-64">
              <Select
                label="Audience Hygiene Segment"
                value={hygieneAudience}
                options={audienceOptions}
                onChange={(value) => changeHygieneAudience(value as AudienceKey)}
              />
            </div>
            <button
              onClick={() => fetchAudienceHygiene()}
              className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-4 py-4 font-bold text-white hover:bg-white/10"
            >
              <RefreshCw className="h-4 w-4" /> Refresh Hygiene
            </button>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <MiniSignal
            icon={Users}
            label="Contacts"
            value={`${audienceHygiene?.total_contacts || 0}`}
          />
          <MiniSignal
            icon={CheckCircle2}
            label="Opted In"
            value={`${audienceHygiene?.opted_in_count || 0}`}
          />
          <MiniSignal
            icon={AlertTriangle}
            label="Opted Out"
            value={`${audienceHygiene?.opted_out_count || 0}`}
          />
          <MiniSignal
            icon={Mail}
            label="Email Gaps"
            value={`${audienceHygiene?.missing_email_count || 0}`}
          />
          <MiniSignal
            icon={Phone}
            label="Phone Gaps"
            value={`${audienceHygiene?.missing_phone_count || 0}`}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:col-span-7">
            {hygieneChannels.map((channel) => (
              <ChannelReadinessCard
                key={channel}
                channel={channel}
                readiness={audienceHygiene?.channels[channel]}
                recommended={audienceHygiene?.recommended_channel === channel}
              />
            ))}
          </div>
          <div className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-orange-400">
                  Recommended Channel
                </p>
                <h3 className="mt-1 text-lg font-black">
                  {audienceHygiene?.recommended_channel
                    ? channelLabel(audienceHygiene.recommended_channel)
                    : "No ready channel yet"}
                </h3>
              </div>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase text-gray-300">
                {audienceLabel(audienceHygiene?.audience || hygieneAudience)}
              </span>
            </div>
            <div className="space-y-2">
              {(audienceHygiene?.readiness_notes || ["Audience hygiene is loading."]).map((note) => (
                <div
                  key={note}
                  className="rounded-lg border border-white/5 bg-white/[0.03] p-3 text-sm font-semibold leading-6 text-gray-400"
                >
                  {note}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-xl border border-white/5 bg-black/25">
          <div className="grid grid-cols-12 gap-3 border-b border-white/5 px-4 py-3 text-xs font-black uppercase tracking-widest text-gray-600">
            <span className="col-span-4">Sample Contact</span>
            <span className="col-span-3">Phone</span>
            <span className="col-span-3">Email</span>
            <span className="col-span-2 text-right">Consent</span>
          </div>
          {(audienceHygiene?.customers || []).map((contact) => (
            <HygieneContactRow key={contact.id} contact={contact} />
          ))}
          {audienceHygiene && !audienceHygiene.customers.length ? (
            <div className="p-8 text-center text-sm font-semibold text-gray-500">
              No matching contacts yet.
            </div>
          ) : null}
        </div>
      </section>

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
                    disabled={sending !== null || selectedScheduledFuture || !dispatch?.provider_status?.configured}
                    title={
                      selectedScheduledFuture
                        ? `Scheduled for ${selectedPromotion.start_date}`
                        : dispatch?.provider_status?.configured
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
                    label="Recovered"
                    value={`${dispatch?.cleanup_recovered_ready_count || 0} ready`}
                  />
                  <Detail
                    label="Missing"
                    value={`${dispatch?.missing_destination_count || 0} contacts`}
                  />
                  <Detail
                    label="Provider"
                    value={providerLabel(dispatch?.provider_status)}
                  />
                </div>

                <section
                  data-testid="promotion-launch-bundle"
                  className="mb-6 rounded-xl border border-sky-500/10 bg-black/25 p-5"
                >
                  <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-sky-300">
                        Offer Launch Bundle
                      </p>
                      <h3 className="mt-1 text-lg font-black">Social draft plus Meta ad handoff</h3>
                      <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-gray-500">
                        Build the public marketing assets from the selected coupon using the same offer link, image, dates, and message.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${checkRatioClass(launchBundleReadyCount, 2)}`}>
                        {launchBundleReadyCount}/2 ready
                      </span>
                      <button
                        data-testid="create-launch-bundle-button"
                        type="button"
                        onClick={createLaunchBundle}
                        disabled={creatingLaunchBundle}
                        className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-3 text-sm font-black text-white hover:bg-sky-600 disabled:cursor-wait disabled:opacity-50"
                      >
                        <ShoppingBag className="h-4 w-4" />
                        {creatingLaunchBundle ? "Building" : "Build Launch Bundle"}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <div
                      data-testid="launch-bundle-social-card"
                      className="rounded-lg border border-white/5 bg-white/[0.03] p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300">
                            <Share2 className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-black uppercase tracking-widest text-gray-600">Social Draft</p>
                            <p className="mt-1 break-words text-sm font-black leading-5 text-gray-100">
                              {selectedSocialHandoff?.title || "Not created yet"}
                            </p>
                          </div>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${handoffStatusClass(selectedSocialHandoff?.status || "pending")}`}>
                          {selectedSocialHandoff?.status || "pending"}
                        </span>
                      </div>
                      <p className="mt-3 break-words text-xs font-semibold leading-5 text-gray-500">
                        {selectedSocialHandoff
                          ? `${formatPlatforms(selectedSocialHandoff.platforms)} | Post #${selectedSocialHandoff.id}`
                          : "Creates a ready Facebook and Instagram post with the coupon order link."}
                      </p>
                      <Link
                        data-testid="launch-bundle-social-link"
                        href={
                          performance?.social.latest_post_id
                            ? `/social?post=${performance.social.latest_post_id}`
                            : "/social"
                        }
                        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-xs font-black text-white hover:bg-white/15"
                      >
                        Open Social <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </div>

                    <div
                      data-testid="launch-bundle-ad-card"
                      className="rounded-lg border border-white/5 bg-white/[0.03] p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-300">
                            <Target className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-black uppercase tracking-widest text-gray-600">Meta Ad</p>
                            <p className="mt-1 break-words text-sm font-black leading-5 text-gray-100">
                              {selectedAdHandoff?.name || "Not created yet"}
                            </p>
                          </div>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${handoffStatusClass(selectedAdHandoff?.status || "pending")}`}>
                          {selectedAdHandoff?.status || "pending"}
                        </span>
                      </div>
                      <p className="mt-3 break-words text-xs font-semibold leading-5 text-gray-500">
                        {selectedAdHandoff
                          ? `${formatPlatforms(selectedAdHandoff.platforms)} | ${formatRupees(selectedAdHandoff.daily_budget || selectedAdHandoff.lifetime_budget)} budget`
                          : "Creates a ready sales campaign for Facebook and Instagram with controlled daily budget."}
                      </p>
                      <Link
                        data-testid="launch-bundle-ad-link"
                        href={
                          performance?.ads.latest_campaign_id
                            ? `/ads?campaign=${performance.ads.latest_campaign_id}`
                            : "/ads"
                        }
                        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-xs font-black text-white hover:bg-white/15"
                      >
                        Open Ads <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                </section>

                <section
                  data-testid="promotion-launch-supervisor"
                  className="mb-6 rounded-xl border border-white/5 bg-black/25 p-5"
                >
                  <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-green-300">
                        Launch Supervisor
                      </p>
                      <h3 className="mt-1 text-lg font-black">Selected campaign action status</h3>
                      <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-gray-500">
                        Track the customer send gate, public social draft, Meta ad handoff and coupon measurement from one place.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        data-testid="launch-supervisor-score"
                        className={`rounded-full px-3 py-1 text-xs font-black uppercase ${checkRatioClass(
                          launchSupervisorReadyCount,
                          launchSupervisorSteps.length || 1
                        )}`}
                      >
                        {launchSupervisorReadyCount}/{launchSupervisorSteps.length || 4} clear
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          fetchCampaignDetails(selectedPromotion.id);
                          fetchPerformanceRollup();
                          fetchSendQueue();
                          fetchMarketingLiveReadiness();
                        }}
                        className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-xs font-black uppercase text-white hover:bg-white/15"
                      >
                        <RefreshCw className="h-4 w-4" /> Refresh Status
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {launchSupervisorSteps.map((step) => (
                      <LaunchSupervisorCard key={step.key} step={step} />
                    ))}
                  </div>
                </section>

                <section
                  data-testid="campaign-schedule-panel"
                  className="mb-6 rounded-xl border border-orange-500/10 bg-black/25 p-5"
                >
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-orange-400">
                        Campaign Schedule
                      </p>
                      <h3 className="mt-1 text-lg font-black">
                        {selectedSchedule?.phase === "upcoming"
                          ? `Queued for ${selectedPromotion.start_date}`
                          : selectedSchedule?.phase === "live"
                          ? "Live in the current offer window"
                          : "Schedule the next send window"}
                      </h3>
                      <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-gray-500">
                        Future scheduled campaigns stay available for dry runs, but live sending is held until the start date.
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${timelineStatusClass(selectedSchedule?.phase || "scheduled")}`}>
                      {selectedSchedule?.phase || "checking"}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-5">
                    <Input
                      label="Start Date"
                      type="date"
                      value={scheduleDate}
                      onChange={setScheduleDate}
                    />
                    <Input
                      label="Duration Days"
                      type="number"
                      value={scheduleDuration}
                      onChange={setScheduleDuration}
                    />
                    <Detail
                      label="Ready On"
                      value={selectedSchedule?.send_ready_on || selectedPromotion.start_date}
                    />
                    <Detail
                      label="Until"
                      value={selectedPromotion.end_date}
                    />
                    <Detail
                      label="Send Guard"
                      value={selectedSchedule?.can_send_now ? "Live send allowed" : "Live send held"}
                    />
                  </div>
                  <button
                    data-testid="schedule-campaign-button"
                    type="button"
                    onClick={scheduleCampaign}
                    disabled={scheduling || scheduleDate < dateInputValue()}
                    className="mt-4 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 font-black text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
                    title={scheduleDate < dateInputValue() ? "Choose today or a future date" : "Schedule campaign"}
                  >
                    <Calendar className="h-4 w-4" /> {scheduling ? "Scheduling" : "Schedule Campaign"}
                  </button>
                </section>

                <section className="mb-6 rounded-xl border border-white/5 bg-black/25 p-5">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-orange-400">
                        Campaign Activity Timeline
                      </p>
                      <h3 className="mt-1 text-lg font-black">Dry runs, cleanup, handoffs, and redemptions</h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <MiniSignal
                        icon={Clock}
                        label="Events"
                        value={`${activityTimeline?.summary.event_count || 0}`}
                      />
                      <MiniSignal
                        icon={AlertTriangle}
                        label="Cleanup"
                        value={`${activityTimeline?.summary.cleanup_events || 0}`}
                      />
                      <MiniSignal
                        icon={Tag}
                        label="Redemptions"
                        value={`${activityTimeline?.summary.redemption_events || 0}`}
                      />
                    </div>
                  </div>
                  <div data-testid="campaign-activity-timeline" className="space-y-2">
                    {(activityTimeline?.events || []).slice(0, 8).map((event) => (
                      <TimelineEventRow key={event.id} event={event} />
                    ))}
                    {activityTimeline && !activityTimeline.events.length && (
                      <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-sm font-semibold text-gray-500">
                        No activity has been recorded for this campaign yet.
                      </div>
                    )}
                    {!activityTimeline && (
                      <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-sm font-semibold text-gray-500">
                        Timeline is loading.
                      </div>
                    )}
                  </div>
                </section>

                {showCleanupReturnPanel && (
                  <section
                    data-testid="cleanup-return-panel"
                    className="mb-6 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-black uppercase tracking-widest text-emerald-300">
                          Cleanup Return
                        </p>
                        <h3 className="mt-1 text-lg font-black text-white">
                          Re-check newly ready contacts
                        </h3>
                        <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-emerald-100/80">
                          {dispatch?.cleanup_recovered_ready_count || 0} contacts from this campaign&apos;s consent or email cleanup are now send-ready.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          data-testid="cleanup-recheck-ready"
                          type="button"
                          onClick={() => sendCampaign(true)}
                          disabled={sending !== null}
                          className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-black text-black hover:bg-orange-500 hover:text-white disabled:cursor-wait disabled:opacity-50"
                        >
                          <RefreshCw className="h-4 w-4" /> Re-check Readiness
                        </button>
                        <button
                          type="button"
                          onClick={() => sendCampaign(false)}
                          disabled={sending !== null || !dispatch?.provider_status?.configured}
                          title={
                            dispatch?.provider_status?.configured
                              ? "Send to ready contacts that have not already been sent"
                              : `Missing: ${dispatch?.provider_status?.missing_settings.join(", ") || "provider setup"}`
                          }
                          className="inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-4 py-3 text-sm font-black text-black hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Send className="h-4 w-4" /> Send Newly Ready
                        </button>
                      </div>
                    </div>
                  </section>
                )}

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

                {deliveryHistory ? (
                  <div data-testid="delivery-recovery-panel" className="mt-6 rounded-xl border border-white/5 bg-black/25 p-5">
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-widest text-orange-400">
                          Delivery Recovery
                        </p>
                        <h3 className="mt-1 font-black">Recent Delivery Attempts</h3>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => sendCampaign(true, { forceResend: true })}
                          disabled={sending !== null}
                          className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-xs font-black text-white hover:bg-white/15 disabled:cursor-wait disabled:opacity-50"
                        >
                          <RefreshCw className="h-3.5 w-3.5" /> Recheck Audience
                        </button>
                        <button
                          type="button"
                          onClick={() => sendCampaign(false, { forceResend: true })}
                          disabled={sending !== null || !dispatch?.provider_status?.configured}
                          title={
                            dispatch?.provider_status?.configured
                              ? "Force resend campaign"
                              : `Missing: ${dispatch?.provider_status?.missing_settings.join(", ") || "provider setup"}`
                          }
                          className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-black text-black hover:bg-orange-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Send className="h-3.5 w-3.5" /> Force Resend
                        </button>
                      </div>
                    </div>

                    <div className="mb-4 rounded-xl border border-white/5 bg-white/[0.03] p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-widest text-orange-400">
                            Suppression Audit
                          </p>
                          <p className="mt-1 text-sm font-semibold text-gray-500">
                            Filter skipped or failed sends by the exact action needed.
                          </p>
                        </div>
                        <span className="rounded-full bg-black/30 px-3 py-1 text-xs font-black uppercase text-gray-400">
                          {deliveryReasonFilterLabel(deliveryReasonFilter)}
                        </span>
                      </div>
                      <div
                        data-testid="delivery-provider-gate"
                        className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-white/5 bg-black/25 p-4"
                      >
                        <div>
                          <p className="text-xs font-black uppercase tracking-widest text-gray-600">Provider Gate</p>
                          <p className="mt-1 text-sm font-black text-white">
                            {providerLabel(dispatch?.provider_status)}
                          </p>
                          <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">
                            {dispatch?.provider_status?.configured
                              ? "Live retries can be sent after a clean dry-run."
                              : `Missing: ${dispatch?.provider_status?.missing_settings.join(", ") || "provider setup"}`}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-black uppercase ${
                            dispatch?.provider_status?.configured
                              ? "bg-green-500/15 text-green-300"
                              : "bg-yellow-500/15 text-yellow-300"
                          }`}
                        >
                          {dispatch?.provider_status?.configured ? "Ready" : "Setup Needed"}
                        </span>
                      </div>
                      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
                        <MiniSignal
                          icon={AlertTriangle}
                          label="Needs Consent"
                          value={`${deliveryAuditCounts.consent_blocked_count}`}
                        />
                        <MiniSignal
                          icon={Mail}
                          label="Missing Dest."
                          value={`${deliveryAuditCounts.missing_destination_count}`}
                        />
                        <MiniSignal
                          icon={Copy}
                          label="Already Sent"
                          value={`${deliveryAuditCounts.already_sent_count}`}
                        />
                        <MiniSignal
                          icon={Send}
                          label="Provider"
                          value={`${deliveryAuditCounts.provider_issue_count}`}
                        />
                        <MiniSignal
                          icon={Clock}
                          label="Review"
                          value={`${deliveryAuditCounts.needs_review_count}`}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                      {deliveryReasonFilters.map((filter) => (
                        <button
                          data-testid={`delivery-reason-filter-${filter.value}`}
                          key={filter.value}
                          type="button"
                          onClick={() => changeDeliveryReasonFilter(filter.value)}
                            className={`rounded-lg border px-3 py-2 text-xs font-black uppercase ${
                              deliveryReasonFilter === filter.value
                                ? "border-sky-400 bg-sky-500/20 text-sky-100"
                                : "border-white/10 bg-white/5 text-gray-400 hover:border-white/20 hover:text-white"
                            }`}
                          >
                            {filter.label}
                          </button>
                        ))}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                          href={cleanupQueueHref("opted_out", selectedPromotion.id)}
                          className="inline-flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs font-black uppercase text-amber-100 hover:bg-amber-500/20"
                        >
                          <Users className="h-4 w-4" /> Open Consent Queue
                        </Link>
                        <Link
                          href={cleanupQueueHref("missing_email", selectedPromotion.id)}
                          className="inline-flex items-center gap-2 rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-xs font-black uppercase text-sky-100 hover:bg-sky-500/20"
                        >
                          <Mail className="h-4 w-4" /> Open Email Cleanup
                        </Link>
                        <button
                          type="button"
                          onClick={copyCleanupQueue}
                          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-black uppercase text-gray-300 hover:border-white/20 hover:text-white"
                        >
                          <Copy className="h-4 w-4" /> Copy Current Queue
                        </button>
                        <button
                          data-testid="retry-current-delivery-issue"
                          type="button"
                          onClick={retryCurrentDeliveryIssue}
                          disabled={retryingDeliveryIssues || !deliveryHistory.retryable_count}
                          className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-3 py-2 text-xs font-black uppercase text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <RefreshCw className={`h-4 w-4 ${retryingDeliveryIssues ? "animate-spin" : ""}`} />
                          {retryingDeliveryIssues ? "Retrying" : "Retry Current Issue"}
                        </button>
                      </div>
                    </div>

                    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
                      <MiniSignal icon={Send} label="Attempts" value={`${deliveryHistory.attempted_count}`} />
                      <MiniSignal icon={CheckCircle2} label="Dry Runs" value={`${deliveryHistory.dry_run_count}`} />
                      <MiniSignal icon={AlertTriangle} label="Needs Attention" value={`${deliveryHistory.needs_attention_count}`} />
                      <MiniSignal icon={RefreshCw} label="Retryable" value={`${deliveryHistory.retryable_count}`} />
                      <MiniSignal
                        icon={Clock}
                        label="Latest"
                        value={
                          deliveryHistory.latest_attempted_at
                            ? new Date(deliveryHistory.latest_attempted_at).toLocaleDateString()
                            : "No attempts"
                        }
                      />
                    </div>

                    <div className="mb-4 flex flex-wrap gap-2">
                      {deliveryStatusFilters.map((filter) => (
                        <button
                          data-testid={`delivery-status-filter-${filter.value}`}
                          key={filter.value}
                          type="button"
                          onClick={() => changeDeliveryFilter(filter.value)}
                          className={`rounded-lg border px-3 py-2 text-xs font-black uppercase ${
                            deliveryFilter === filter.value
                              ? "border-orange-500 bg-orange-500 text-white"
                              : "border-white/10 bg-white/5 text-gray-400 hover:border-white/20 hover:text-white"
                          }`}
                        >
                          {filter.label}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-2">
                      {deliveryHistory.deliveries.slice(0, 8).map((delivery) => (
                        <div
                          key={delivery.id}
                          className="grid grid-cols-1 gap-3 rounded-lg border border-white/5 bg-black/30 p-3 text-sm md:grid-cols-12"
                        >
                          <div className="min-w-0 md:col-span-3">
                            <p className="break-words font-bold text-white">
                              {delivery.customer?.name || "Walk-in Customer"}
                            </p>
                            <p className="break-all text-xs text-gray-500">
                              {delivery.destination || delivery.customer?.email || delivery.customer?.phone || "No destination"}
                            </p>
                          </div>
                          <div className="md:col-span-2">
                            <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(delivery.status)}`}>
                              {delivery.status.replace("_", " ")}
                            </span>
                          </div>
                          <div className="text-gray-500 md:col-span-2">
                            {delivery.provider || "No provider"}
                            <p className="mt-1 text-xs">
                              {delivery.attempted_at ? new Date(delivery.attempted_at).toLocaleString() : "Not attempted"}
                            </p>
                          </div>
                          <div className="min-w-0 break-words text-gray-400 md:col-span-3">
                            {delivery.external_id || delivery.error || "Ready"}
                          </div>
                          <div className="min-w-0 break-words text-xs font-semibold leading-5 text-gray-500 md:col-span-2">
                            {delivery.recovery_action || "Review delivery."}
                          </div>
                        </div>
                      ))}
                      {!deliveryHistory.deliveries.length && (
                        <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-sm font-semibold text-gray-500">
                          No delivery attempts match {deliveryFilterLabel(deliveryFilter)} and {deliveryReasonFilterLabel(deliveryReasonFilter)}.
                        </div>
                      )}
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

function formatDateTime(value?: string | null) {
  if (!value) return "No record";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function DispatchProofRow({
  label,
  proof,
  empty,
}: {
  label: string;
  proof?: DispatchDeliveryProof | null;
  empty: string;
}) {
  return (
    <div className="rounded-lg border border-white/5 bg-black/25 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-widest text-gray-500">{label}</p>
        {proof ? (
          <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${statusClass(proof.status)}`}>
            {proof.status.replace("_", " ")}
          </span>
        ) : (
          <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-black uppercase text-gray-400">
            Waiting
          </span>
        )}
      </div>
      {proof ? (
        <div className="space-y-1">
          <p className="text-sm font-black text-gray-200">
            #{proof.id} {proof.recipient_masked ? `| ${proof.recipient_masked}` : ""}
          </p>
          <p className="text-xs font-semibold text-gray-500">{formatDateTime(proof.attempted_at)}</p>
          {proof.error && <p className="break-words text-xs font-semibold leading-5 text-yellow-200">{proof.error}</p>}
        </div>
      ) : (
        <p className="text-sm font-semibold text-gray-500">{empty}</p>
      )}
    </div>
  );
}

function MarketingChecklistCard({
  testId,
  icon: Icon,
  label,
  title,
  status,
  href,
  action,
  metrics,
  items,
}: {
  testId: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  title: string;
  status: string;
  href: string;
  action: string;
  metrics: { label: string; value: string }[];
  items: MarketingChecklistItem[];
}) {
  const passedCount = items.filter((item) => item.passed).length;

  return (
    <div data-testid={testId} className="rounded-xl border border-white/5 bg-black/25 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-300">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-widest text-sky-300">{label}</p>
            <h3 className="mt-1 break-words text-lg font-black leading-6 text-white">{title}</h3>
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${checkRatioClass(passedCount, items.length)}`}>
          {passedCount}/{items.length} ready
        </span>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        {metrics.map((metric) => (
          <div key={`${label}-${metric.label}`} className="rounded-lg border border-white/5 bg-white/[0.03] p-3">
            <p className="text-[11px] font-black uppercase tracking-widest text-gray-600">{metric.label}</p>
            <p className="mt-1 break-words text-sm font-black text-gray-200">{metric.value}</p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {items.map((item) => (
          <div key={`${label}-${item.label}`} className="flex items-start gap-3">
            {item.passed ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-300" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-300" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-black text-gray-100">{item.label}</p>
              <p className="mt-1 break-words text-xs font-semibold leading-5 text-gray-500">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4">
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase text-gray-300">
          {status}
        </span>
        <Link
          href={href}
          className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/15"
        >
          {action} <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

function checkRatioClass(passedCount: number, totalCount: number) {
  if (passedCount === totalCount) return "bg-green-500/15 text-green-300";
  if (passedCount >= Math.ceil(totalCount / 2)) return "bg-yellow-500/15 text-yellow-300";
  return "bg-red-500/15 text-red-300";
}

function marketingScoreClass(score: number) {
  if (score >= 85) return "bg-green-500/15 text-green-300";
  if (score >= 50) return "bg-yellow-500/15 text-yellow-300";
  return "bg-red-500/15 text-red-300";
}

function ChannelReadinessCard({
  channel,
  readiness,
  recommended,
}: {
  channel: ChannelKey;
  readiness?: AudienceChannelReadiness;
  recommended: boolean;
}) {
  const iconMap = {
    whatsapp: MessageCircle,
    sms: Phone,
    email: Mail,
  };
  const Icon = iconMap[channel];
  const percent = readiness?.ready_percent || 0;
  const ready = readiness?.ready_count || 0;
  const missing = readiness?.destination_missing_count ?? readiness?.missing_count ?? 0;
  const suppressed = readiness?.suppressed_count || 0;

  return (
    <div
      className={`rounded-xl border p-5 ${
        recommended
          ? "border-green-500/40 bg-green-500/10"
          : "border-white/5 bg-black/25"
      }`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-300">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="font-black">{channelLabel(channel)}</p>
            <p className="mt-1 text-xs font-semibold text-gray-500">
              {ready} ready | {missing} gaps | {suppressed} blocked
            </p>
          </div>
        </div>
        {recommended ? (
          <span className="rounded-full bg-green-500/15 px-3 py-1 text-xs font-black uppercase text-green-300">
            Best
          </span>
        ) : null}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${percent >= 80 ? "bg-green-400" : percent >= 40 ? "bg-yellow-400" : "bg-red-400"}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <p className="mt-3 text-sm font-black text-gray-200">{percent}% ready</p>
    </div>
  );
}

function HygieneContactRow({ contact }: { contact: Contact }) {
  return (
    <div className="grid grid-cols-12 gap-3 border-b border-white/5 px-4 py-3 text-sm">
      <div className="col-span-4 min-w-0">
        <p className="break-words font-black text-white">{contact.name || "Walk-in Customer"}</p>
        <p className="mt-1 text-xs font-semibold text-gray-600">
          Rs {Math.round(contact.total_spend || 0).toLocaleString()} spend
        </p>
      </div>
      <div className="col-span-3 min-w-0 break-all text-gray-400">{contact.phone || "No phone"}</div>
      <div className="col-span-3 min-w-0 break-all text-gray-400">{contact.email || "No email"}</div>
      <div className="col-span-2 text-right">
        <span
          className={`rounded-full px-3 py-1 text-xs font-black uppercase ${
            contact.opt_in_marketing === false
              ? "bg-yellow-500/15 text-yellow-300"
              : "bg-green-500/15 text-green-300"
          }`}
        >
          {contact.opt_in_marketing === false ? "Opted out" : "Opted in"}
        </span>
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

function LaunchSupervisorCard({ step }: { step: LaunchSupervisorStep }) {
  const Icon = step.icon;
  return (
    <div
      data-testid={`launch-supervisor-${step.key}`}
      className="rounded-lg border border-white/5 bg-white/[0.03] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${launchSupervisorIconClass(step.status)}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-widest text-gray-600">{step.label}</p>
            <p className="mt-1 break-words text-sm font-black leading-5 text-white">{step.metric}</p>
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${launchSupervisorStatusClass(step.status)}`}>
          {launchSupervisorStatusLabel(step.status)}
        </span>
      </div>
      <p className="mt-3 min-h-14 break-words text-xs font-semibold leading-5 text-gray-500">{step.detail}</p>
      <Link
        href={step.href}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-xs font-black text-white hover:bg-white/15"
      >
        {step.action} <ExternalLink className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function launchSupervisorStatusLabel(status: LaunchSupervisorStatus) {
  if (status === "ready") return "clear";
  if (status === "watching") return "tracking";
  if (status === "blocked") return "blocked";
  return "pending";
}

function launchSupervisorStatusClass(status: LaunchSupervisorStatus) {
  if (status === "ready") return "bg-green-500/15 text-green-300";
  if (status === "watching") return "bg-blue-500/15 text-blue-300";
  if (status === "blocked") return "bg-yellow-500/15 text-yellow-300";
  return "bg-white/10 text-gray-300";
}

function launchSupervisorIconClass(status: LaunchSupervisorStatus) {
  if (status === "ready") return "bg-green-500/10 text-green-300";
  if (status === "watching") return "bg-blue-500/10 text-blue-300";
  if (status === "blocked") return "bg-yellow-500/10 text-yellow-300";
  return "bg-white/10 text-gray-300";
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

function deliveryFilterLabel(filter: DeliveryStatusFilter) {
  return deliveryStatusFilters.find((option) => option.value === filter)?.label || filter;
}

function deliveryReasonFilterLabel(filter: DeliveryReasonFilter) {
  return deliveryReasonFilters.find((option) => option.value === filter)?.label || filter;
}

function readInitialCampaignReturn(): CampaignReturnState {
  if (typeof window === "undefined") {
    return { fromCleanup: false, campaignId: null };
  }

  const params = new URLSearchParams(window.location.search);
  const campaignId = Number(params.get("campaign"));
  return {
    fromCleanup: params.get("source") === "campaign_cleanup_return",
    campaignId: Number.isFinite(campaignId) && campaignId > 0 ? campaignId : null,
  };
}

function cleanupQueueHref(segment: "opted_out" | "missing_email", promotionId: number) {
  const params = new URLSearchParams({
    segment,
    source: "campaign_cleanup",
    campaign: String(promotionId),
  });
  return `/customers?${params.toString()}`;
}

function TimelineEventRow({ event }: { event: CampaignActivityEvent }) {
  const Icon = timelineEventIcon(event.type);
  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border border-white/5 bg-white/[0.03] p-3 text-sm md:grid-cols-12">
      <div className="flex items-start gap-3 md:col-span-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${timelineEventTone(event.type)}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="break-words font-black text-white">{event.title}</p>
          <p className="mt-1 text-xs font-semibold uppercase text-gray-600">
            {event.timestamp ? new Date(event.timestamp).toLocaleString() : "No timestamp"}
          </p>
        </div>
      </div>
      <div className="min-w-0 break-words leading-6 text-gray-400 md:col-span-5">
        {event.detail}
      </div>
      <div className="flex flex-col items-start gap-2 md:col-span-3 md:items-end">
        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${timelineStatusClass(event.status)}`}>
          {event.status.replace("_", " ")}
        </span>
        <span className="max-w-full break-words text-left text-xs font-black uppercase text-gray-500 md:text-right">
          {event.metric || event.type}
        </span>
      </div>
    </div>
  );
}

function timelineEventIcon(type: CampaignActivityEvent["type"]) {
  if (type === "cleanup") return AlertTriangle;
  if (type === "redemption") return Tag;
  if (type === "social") return Share2;
  if (type === "ad") return Target;
  if (type === "delivery") return Send;
  return Megaphone;
}

function timelineEventTone(type: CampaignActivityEvent["type"]) {
  if (type === "cleanup") return "bg-amber-500/10 text-amber-300";
  if (type === "redemption") return "bg-green-500/10 text-green-300";
  if (type === "social") return "bg-sky-500/10 text-sky-300";
  if (type === "ad") return "bg-violet-500/10 text-violet-300";
  if (type === "delivery") return "bg-orange-500/10 text-orange-300";
  return "bg-white/10 text-gray-300";
}

function timelineStatusClass(status: string) {
  if (["sent", "ready", "active", "completed", "closed"].includes(status)) {
    return "bg-green-500/15 text-green-300";
  }
  if (["dry_run", "scheduled", "planned"].includes(status)) {
    return "bg-blue-500/15 text-blue-300";
  }
  if (["failed", "skipped"].includes(status)) {
    return "bg-yellow-500/15 text-yellow-300";
  }
  return "bg-white/10 text-gray-300";
}

function scheduleQueuePhaseLabel(phase: ScheduledCampaignQueueRow["phase"]) {
  if (phase === "due_today") return "Due Today";
  if (phase === "overdue") return "Overdue";
  return "Upcoming";
}

function scheduleQueuePhaseClass(phase: ScheduledCampaignQueueRow["phase"]) {
  if (phase === "due_today") return "bg-green-500/15 text-green-300";
  if (phase === "overdue") return "bg-yellow-500/15 text-yellow-300";
  return "bg-blue-500/15 text-blue-300";
}

function sendQueueStatusClass(status: CampaignSendQueueRow["queue_status"]) {
  if (status === "ready_to_send") return "bg-green-500/15 text-green-300";
  if (status === "needs_dry_run") return "bg-orange-500/15 text-orange-300";
  if (status === "provider_blocked") return "bg-yellow-500/15 text-yellow-300";
  if (status === "audience_blocked") return "bg-red-500/15 text-red-300";
  if (status === "dry_run_done") return "bg-blue-500/15 text-blue-300";
  return "bg-white/10 text-gray-300";
}

function dispatchActivationLabel(status?: DispatchActivationStatus) {
  if (status === "live_ready") return "Live Ready";
  if (status === "partially_ready") return "Partially Ready";
  if (status === "setup_needed") return "Setup Needed";
  if (status === "credentials_needed") return "Credentials Needed";
  if (status === "template_needed") return "Template Needed";
  if (status === "test_proof_needed") return "Proof Needed";
  if (status === "recovery_needed") return "Recovery Needed";
  if (status === "unsupported") return "Unsupported";
  return "Checking";
}

function dispatchActivationClass(status?: DispatchActivationStatus) {
  if (status === "live_ready") return "bg-green-500/15 text-green-300";
  if (status === "test_proof_needed") return "bg-orange-500/15 text-orange-300";
  if (status === "partially_ready") return "bg-blue-500/15 text-blue-300";
  if (status === "credentials_needed" || status === "template_needed") return "bg-yellow-500/15 text-yellow-300";
  if (status === "recovery_needed" || status === "unsupported") return "bg-red-500/15 text-red-300";
  return "bg-white/10 text-gray-300";
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
  const credentialChecks = status?.credential_checks || [];

  return (
    <div data-testid={`provider-readiness-${channel}`} className="rounded-xl border border-white/5 bg-black/25 p-5">
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
          {status?.readiness_label || (ready ? "Provider ready" : "Setup needed")}
        </span>
      </div>

      <div className="mt-4 rounded-lg border border-white/5 bg-black/30 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-500">
          {ready ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-300" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 text-yellow-300" />
          )}
          {status?.safe_test_send?.mode === "dry_run_only" ? "Safe test available" : ready ? "Live send available" : "Missing setup"}
        </div>
        <p className="text-sm font-semibold leading-6 text-gray-400">
          {ready
            ? `${channelLabel(channel)} can send through ${status?.provider}.`
            : status?.missing_settings?.join(", ") || "Provider status is loading."}
        </p>
      </div>

      <div className="mt-4 space-y-2">
        {credentialChecks.map((check) => (
          <div key={`${channel}-${check.key}`} className="flex items-center justify-between gap-3 text-xs font-semibold">
            <span className="text-gray-500">{check.label}</span>
            <span className={check.configured ? "text-green-300" : "text-yellow-300"}>
              {check.configured ? "ready" : "missing"}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-white/5 bg-white/[0.03] p-3">
        <p className="text-xs font-black uppercase tracking-widest text-gray-500">Template Compliance</p>
        <p className="mt-2 text-sm font-black text-white">{status?.template_label || "Template status loading"}</p>
        <p className="mt-1 text-xs leading-5 text-gray-500">
          {status?.template_detail || "Provider template checks appear here."}
        </p>
      </div>

      <p className="mt-4 text-xs font-semibold leading-5 text-gray-500">
        {status?.next_action || "Refresh readiness before sending."}
      </p>
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
