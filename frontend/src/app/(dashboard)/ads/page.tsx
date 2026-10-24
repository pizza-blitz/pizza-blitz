"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Copy,
  History,
  Link as LinkIcon,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  Target,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";
import MediaPicker from "@/components/media-picker";

const ADS_API = getApiUrl("/api/v1/restaurant/ads");
const fetchWithAuth = (url: string, init?: RequestInit) => fetch(url, { ...init, credentials: "include" });

type ObjectiveKey = "awareness" | "traffic" | "engagement" | "leads" | "sales";
type PlatformKey = "facebook" | "instagram";
type CampaignStatus = "draft" | "planned" | "ready" | "launched" | "paused" | "completed" | "failed";

type AdCampaign = {
  id: number;
  name: string;
  objective: ObjectiveKey;
  platforms: PlatformKey[];
  audience?: string | null;
  location?: string | null;
  creative_message: string;
  link_url?: string | null;
  image_url?: string | null;
  daily_budget: number;
  lifetime_budget: number;
  start_date?: string | null;
  end_date?: string | null;
  status: CampaignStatus;
  external_campaign_id?: string | null;
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  revenue: number;
  ctr: number;
  cpc: number;
  cpa: number;
  roas: number;
};

type ProviderStatus = {
  provider: string;
  enabled: boolean;
  configured: boolean;
  missing_settings: string[];
  launch_mode: string;
  readiness_label?: string;
  graph_version?: string;
  credential_checks?: {
    key: string;
    label: string;
    configured: boolean;
  }[];
  external_sync?: {
    external_id_required_for_actions: boolean;
    paused_launch_mode: boolean;
    dry_run_available: boolean;
    local_status_sync_available: boolean;
  };
  guardrails?: string[];
  next_action?: string;
};

type AdsSummary = {
  total_campaigns: number;
  active_campaigns: number;
  total_spend: number;
  total_revenue: number;
  total_clicks: number;
  total_conversions: number;
  average_cpc: number;
  average_cpa: number;
  roas: number;
};

type AdLaunch = {
  id: number;
  provider?: string | null;
  status: "launched" | "dry_run" | "failed" | "skipped" | "pending";
  external_campaign_id?: string | null;
  error?: string | null;
  dry_run: boolean;
  issue_reason?: string;
  retryable?: boolean;
  recovery_action?: string;
  attempted_at?: string | null;
};

type LaunchHistory = {
  attempted_count: number;
  launched_count: number;
  dry_run_count: number;
  failed_count: number;
  skipped_count: number;
  retryable_count?: number;
  launches: AdLaunch[];
};

type AdAction = {
  id: number;
  campaign_id: number;
  action: "pause" | "resume" | "complete" | "duplicate" | "created_from_duplicate" | string;
  previous_status?: CampaignStatus | null;
  next_status?: CampaignStatus | null;
  note?: string | null;
  actor?: string | null;
  response_payload?: Record<string, unknown>;
  created_at?: string | null;
};

type ActionHistory = {
  action_count: number;
  pause_count: number;
  resume_count: number;
  complete_count: number;
  duplicate_count: number;
  external_sync_count?: number;
  actions: AdAction[];
};

type ReadinessCampaign = {
  id: number;
  name: string;
  objective: ObjectiveKey;
  status: CampaignStatus;
  platforms: PlatformKey[];
  budget: number;
  eligible: boolean;
  blockers: string[];
};

type LaunchReadiness = {
  provider_status: ProviderStatus;
  ready_count: number;
  blocked_count: number;
  planned_budget: number;
  campaigns: ReadinessCampaign[];
};

type SyncChecklistItem = {
  label: string;
  passed: boolean;
  detail: string;
};

type SyncCampaign = {
  id: number;
  name: string;
  status: CampaignStatus;
  external_campaign_id?: string | null;
  provider_state: "synced" | "local_only" | "needs_review" | string;
  sync_ready: boolean;
  guardrails: string[];
};

type AdSyncReadiness = {
  generated_at: string;
  provider_status: ProviderStatus;
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
    action_count: number;
  };
  checklist: SyncChecklistItem[];
  campaigns: SyncCampaign[];
  guardrails: string[];
  next_action: string;
};

type BudgetHealth = {
  today: string;
  start_date: string;
  end_date: string;
  budget_type: "daily" | "lifetime";
  total_budget: number;
  daily_budget: number;
  lifetime_budget: number;
  spend: number;
  revenue: number;
  remaining_budget: number;
  remaining_daily_budget: number;
  expected_spend_to_date: number;
  pacing_gap: number;
  pacing_ratio: number;
  elapsed_days: number;
  total_days: number;
  days_left: number;
  elapsed_percent: number;
  spend_percent: number;
  pacing_status: "no_budget" | "not_started" | "completed" | "over_pacing" | "under_pacing" | "on_track";
  performance_status: "learning" | "strong" | "profitable" | "needs_conversion" | "watch";
  roas: number;
  cpc: number;
  cpa: number;
  recommendations: string[];
};

type AdManagementStatus =
  | "setup_needed"
  | "sync_needed"
  | "budget_review"
  | "ready_to_launch"
  | "planning_needed";

type AdManagementCampaign = {
  id: number;
  name: string;
  objective: ObjectiveKey;
  status: CampaignStatus;
  platforms: PlatformKey[];
  budget: number;
  launch: {
    eligible: boolean;
    blockers: string[];
  };
  sync: SyncCampaign;
  budget_health: BudgetHealth & {
    attention_required: boolean;
  };
  latest_launch?: AdLaunch | null;
  latest_action?: AdAction | null;
  next_action: string;
};

type AdManagementControl = {
  generated_at: string;
  provider_status: ProviderStatus;
  summary: AdsSummary & {
    overall_status: AdManagementStatus;
    launch_ready_count: number;
    launch_blocked_count: number;
    budget_attention_count: number;
    unsynced_live_count: number;
    external_id_count: number;
    retryable_launch_count: number;
    dry_run_count: number;
    action_count: number;
    external_sync_count: number;
    next_action: string;
  };
  controls: {
    label: string;
    status: string;
    detail: string;
  }[];
  campaigns: AdManagementCampaign[];
  recent_launches: AdLaunch[];
  recent_actions: AdAction[];
};

type CampaignForm = {
  name: string;
  objective: ObjectiveKey;
  platforms: PlatformKey[];
  audience: string;
  location: string;
  creative_message: string;
  link_url: string;
  image_url: string;
  daily_budget: number;
  lifetime_budget: number;
  start_date: string;
  end_date: string;
  status: CampaignStatus;
};

type MetricsForm = {
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  revenue: number;
};

type AdSyncStatus = "launched" | "paused" | "completed" | "failed";

const emptyCampaign: CampaignForm = {
  name: "",
  objective: "traffic",
  platforms: ["facebook", "instagram"],
  audience: "",
  location: "",
  creative_message: "",
  link_url: "",
  image_url: "",
  daily_budget: 500,
  lifetime_budget: 0,
  start_date: new Date().toISOString().slice(0, 10),
  end_date: new Date().toISOString().slice(0, 10),
  status: "ready",
};

const objectiveOptions: { value: ObjectiveKey; label: string }[] = [
  { value: "traffic", label: "Traffic" },
  { value: "sales", label: "Sales" },
  { value: "leads", label: "Leads" },
  { value: "engagement", label: "Engagement" },
  { value: "awareness", label: "Awareness" },
];

const platformLabels: Record<PlatformKey, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
};

const syncStatusOptions: { value: AdSyncStatus; label: string }[] = [
  { value: "paused", label: "Paused" },
  { value: "launched", label: "Launched" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

export default function AdsManagerPage() {
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [summary, setSummary] = useState<AdsSummary | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [launchReadiness, setLaunchReadiness] = useState<LaunchReadiness | null>(null);
  const [syncReadiness, setSyncReadiness] = useState<AdSyncReadiness | null>(null);
  const [managementControl, setManagementControl] = useState<AdManagementControl | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [history, setHistory] = useState<LaunchHistory | null>(null);
  const [actionHistory, setActionHistory] = useState<ActionHistory | null>(null);
  const [budgetHealth, setBudgetHealth] = useState<BudgetHealth | null>(null);
  const [campaignForm, setCampaignForm] = useState(emptyCampaign);
  const [metricsForm, setMetricsForm] = useState<MetricsForm>({
    impressions: 0,
    clicks: 0,
    conversions: 0,
    spend: 0,
    revenue: 0,
  });
  const [showAdd, setShowAdd] = useState(false);
  const [message, setMessage] = useState("");
  const [syncResult, setSyncResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState<"dry_run" | "launch" | null>(null);
  const [actioning, setActioning] = useState<"pause" | "resume" | "complete" | "duplicate" | null>(null);
  const [syncing, setSyncing] = useState<"dry_run" | "apply" | null>(null);
  const [syncForm, setSyncForm] = useState<{ external_campaign_id: string; status: AdSyncStatus }>({
    external_campaign_id: "",
    status: "paused",
  });

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === selectedId) || null,
    [campaigns, selectedId]
  );
  const canPause =
    !!selectedCampaign && !["paused", "completed", "failed"].includes(selectedCampaign.status);
  const canResume = selectedCampaign?.status === "paused";
  const canComplete = !!selectedCampaign && selectedCampaign.status !== "completed";
  const budgetProgressWidth = `${Math.min(100, Math.max(0, budgetHealth?.spend_percent || 0))}%`;
  const elapsedProgressWidth = `${Math.min(100, Math.max(0, budgetHealth?.elapsed_percent || 0))}%`;

  useEffect(() => {
    const campaignParam = new URLSearchParams(window.location.search).get("campaign");
    const requestedCampaignId = campaignParam ? Number(campaignParam) : null;
    fetchAds(
      typeof requestedCampaignId === "number" && Number.isFinite(requestedCampaignId)
        ? requestedCampaignId
        : null
    );
  }, []);

  useEffect(() => {
    if (!selectedCampaign) return;
    setMetricsForm({
      impressions: selectedCampaign.impressions,
      clicks: selectedCampaign.clicks,
      conversions: selectedCampaign.conversions,
      spend: selectedCampaign.spend,
      revenue: selectedCampaign.revenue,
    });
    setSyncForm({
      external_campaign_id: selectedCampaign.external_campaign_id || "",
      status: syncStatusFromCampaign(selectedCampaign.status),
    });
  }, [selectedCampaign]);

  const fetchAds = async (preferredCampaignId?: number | null) => {
    setLoading(true);
    const [statusResponse, summaryResponse, campaignsResponse, readinessResponse, syncResponse, managementResponse] = await Promise.all([
      fetchWithAuth(`${ADS_API}/provider-status`),
      fetchWithAuth(`${ADS_API}/summary`),
      fetchWithAuth(`${ADS_API}/campaigns`),
      fetchWithAuth(`${ADS_API}/launch-readiness`),
      fetchWithAuth(`${ADS_API}/sync-readiness`),
      fetchWithAuth(`${ADS_API}/management-control?limit=100`),
    ]);
    if (statusResponse.ok) setProviderStatus(await statusResponse.json());
    if (summaryResponse.ok) setSummary(await summaryResponse.json());
    if (readinessResponse.ok) setLaunchReadiness(await readinessResponse.json());
    if (syncResponse.ok) setSyncReadiness(await syncResponse.json());
    if (managementResponse.ok) {
      setManagementControl(await managementResponse.json());
    } else {
      setManagementControl(null);
    }
    if (campaignsResponse.ok) {
      const data: AdCampaign[] = await campaignsResponse.json();
      setCampaigns(data);
      const preferredExists = preferredCampaignId
        ? data.some((campaign) => campaign.id === preferredCampaignId)
        : false;
      const currentExists = selectedId
        ? data.some((campaign) => campaign.id === selectedId)
        : false;
      let nextSelectedId: number | null = data[0]?.id || null;
      if (preferredExists && preferredCampaignId) {
        nextSelectedId = preferredCampaignId;
      } else if (currentExists && selectedId) {
        nextSelectedId = selectedId;
      }
      setSelectedId(nextSelectedId);
      if (nextSelectedId) {
        await Promise.all([
          fetchLaunches(nextSelectedId),
          fetchBudgetHealth(nextSelectedId),
          fetchActions(nextSelectedId),
        ]);
      } else {
        setHistory(null);
        setActionHistory(null);
        setBudgetHealth(null);
      }
    }
    setLoading(false);
  };

  const fetchLaunches = async (campaignId: number) => {
    const response = await fetchWithAuth(`${ADS_API}/campaigns/${campaignId}/launches`);
    if (!response.ok) {
      setHistory(null);
      return;
    }
    setHistory(await response.json());
  };

  const fetchActions = async (campaignId: number) => {
    const response = await fetchWithAuth(`${ADS_API}/campaigns/${campaignId}/actions`);
    if (!response.ok) {
      setActionHistory(null);
      return;
    }
    setActionHistory(await response.json());
  };

  const fetchBudgetHealth = async (campaignId: number) => {
    const response = await fetchWithAuth(`${ADS_API}/campaigns/${campaignId}/budget-health`);
    if (!response.ok) {
      setBudgetHealth(null);
      return;
    }
    const data: { budget_health: BudgetHealth } = await response.json();
    setBudgetHealth(data.budget_health);
  };

  const selectCampaign = (campaignId: number) => {
    setSelectedId(campaignId);
    setSelectedCampaignParam(campaignId);
    fetchLaunches(campaignId);
    fetchActions(campaignId);
    fetchBudgetHealth(campaignId);
  };

  const togglePlatform = (platform: PlatformKey) => {
    const platforms = campaignForm.platforms.includes(platform)
      ? campaignForm.platforms.filter((item) => item !== platform)
      : [...campaignForm.platforms, platform];
    setCampaignForm({ ...campaignForm, platforms });
  };

  const saveCampaign = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const response = await fetchWithAuth(`${ADS_API}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...campaignForm,
        audience: campaignForm.audience || null,
        location: campaignForm.location || null,
        link_url: campaignForm.link_url || null,
        image_url: campaignForm.image_url || null,
        start_date: campaignForm.start_date || null,
        end_date: campaignForm.end_date || null,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.detail || "Ad campaign could not be saved.");
      return;
    }
    setMessage(`Saved ad campaign ${data.campaign.name}.`);
    setShowAdd(false);
    setCampaignForm(emptyCampaign);
    await fetchAds();
    selectCampaign(data.campaign.id);
  };

  const saveMetrics = async () => {
    if (!selectedCampaign) return;
    const response = await fetchWithAuth(`${ADS_API}/campaigns/${selectedCampaign.id}/metrics`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metricsForm),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.detail || "Metrics could not be saved.");
      return;
    }
    setMessage(`Updated metrics for ${data.name}.`);
    await fetchAds();
    selectCampaign(selectedCampaign.id);
  };

  const launchCampaign = async (dryRun: boolean) => {
    if (!selectedCampaign) return;
    if (!dryRun) {
      const confirmed = window.confirm(`Create a paused Meta Ads campaign for ${selectedCampaign.name}?`);
      if (!confirmed) return;
    }
    setLaunching(dryRun ? "dry_run" : "launch");
    const response = await fetchWithAuth(`${ADS_API}/campaigns/${selectedCampaign.id}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dry_run: dryRun }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.detail || "Ad campaign launch failed.");
      setLaunching(null);
      return;
    }
    setMessage(
      dryRun
        ? "Dry run checked the Meta Ads launch payload."
        : `${data.launched_count} campaign launched, ${data.failed_count} failed.`
    );
    await fetchAds();
    await fetchLaunches(selectedCampaign.id);
    setLaunching(null);
  };

  const runCampaignAction = async (action: "pause" | "resume" | "complete") => {
    if (!selectedCampaign) return;
    setActioning(action);
    const response = await fetchWithAuth(`${ADS_API}/campaigns/${selectedCampaign.id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: `${actionLabel(action)} from Ads command board.` }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.detail || `Campaign ${action} failed.`);
      setActioning(null);
      return;
    }
    setMessage(`${data.campaign.name} marked ${data.campaign.status}.`);
    await fetchAds(selectedCampaign.id);
    await fetchActions(selectedCampaign.id);
    await fetchBudgetHealth(selectedCampaign.id);
    setActioning(null);
  };

  const duplicateCampaign = async () => {
    if (!selectedCampaign) return;
    setActioning("duplicate");
    const response = await fetchWithAuth(`${ADS_API}/campaigns/${selectedCampaign.id}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${selectedCampaign.name} Copy`,
        status: "ready",
        reset_metrics: true,
        note: "Duplicated from Ads command board.",
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.detail || "Campaign duplicate failed.");
      setActioning(null);
      return;
    }
    setMessage(`Duplicated ${selectedCampaign.name} into ${data.duplicate.name}.`);
    await fetchAds(data.duplicate.id);
    await Promise.all([
      fetchActions(data.duplicate.id),
      fetchLaunches(data.duplicate.id),
      fetchBudgetHealth(data.duplicate.id),
    ]);
    setActioning(null);
  };

  const syncExternalCampaign = async (dryRun: boolean) => {
    if (!selectedCampaign) return;
    setSyncing(dryRun ? "dry_run" : "apply");
    setSyncResult("");
    const response = await fetchWithAuth(`${ADS_API}/campaigns/${selectedCampaign.id}/external-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        external_campaign_id: syncForm.external_campaign_id || null,
        status: syncForm.status,
        dry_run: dryRun,
        note: dryRun ? "External sync dry run from Ads command board." : "External sync applied from Ads command board.",
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.detail || "External campaign sync failed.");
      setSyncing(null);
      return;
    }
    const externalId = data.sync_preview?.external_campaign_id || syncForm.external_campaign_id || "no external id";
    const resultText = dryRun
      ? `Dry run ready: ${externalId} can sync as ${syncForm.status}.`
      : `External sync applied: ${externalId} is now ${data.campaign.status}.`;
    setSyncResult(resultText);
    setMessage(resultText);
    if (!dryRun) {
      await fetchAds(selectedCampaign.id);
      await fetchActions(selectedCampaign.id);
      await fetchLaunches(selectedCampaign.id);
    }
    setSyncing(null);
  };

  const managementSummary =
    managementControl?.summary || {
      ...(summary || {
        total_campaigns: 0,
        active_campaigns: 0,
        total_spend: 0,
        total_revenue: 0,
        total_clicks: 0,
        total_conversions: 0,
        average_cpc: 0,
        average_cpa: 0,
        roas: 0,
      }),
      overall_status: providerStatus?.configured
        ? ("planning_needed" as AdManagementStatus)
        : ("setup_needed" as AdManagementStatus),
      launch_ready_count: launchReadiness?.ready_count || 0,
      launch_blocked_count: launchReadiness?.blocked_count || 0,
      budget_attention_count: 0,
      unsynced_live_count: syncReadiness?.audit.unsynced_live_count || 0,
      external_id_count: syncReadiness?.audit.external_id_count || 0,
      retryable_launch_count: syncReadiness?.audit.retryable_count || 0,
      dry_run_count: syncReadiness?.audit.dry_run_count || 0,
      action_count: syncReadiness?.audit.action_count || 0,
      external_sync_count: syncReadiness?.audit.external_sync_count || 0,
      next_action: syncReadiness?.next_action || providerStatus?.next_action || "Load ad management control.",
    };
  const managementControls =
    managementControl?.controls || [
      {
        label: "Provider launch gate",
        status: providerStatus?.configured ? "ready" : "blocked",
        detail: providerStatus?.configured
          ? "Meta Ads launch settings are configured."
          : providerStatus?.missing_settings.join(", ") || "Provider settings are loading.",
      },
      {
        label: "Budget pacing gate",
        status: "monitored",
        detail: "Budget and ROAS risks appear after campaign metrics are loaded.",
      },
      {
        label: "External ID audit",
        status: "enforced",
        detail: "Provider-connected campaigns should carry an external Meta campaign ID.",
      },
    ];
  const managementCampaigns = managementControl?.campaigns || [];

  return (
    <div className="min-h-screen bg-[#0a0a0b] p-8 text-white">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-orange-400 underline decoration-orange-500/20 underline-offset-8">
            Ad Campaigns
          </h1>
          <p className="mt-3 text-sm text-gray-500">
            Plan paid campaigns, track performance, and prepare Meta Ads launches.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => fetchAds()}
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
        <Metric label="Campaigns" value={summary?.total_campaigns || 0} icon={Target} />
        <Metric label="Spend" value={`Rs ${Math.round(summary?.total_spend || 0).toLocaleString()}`} icon={BarChart3} />
        <Metric label="Revenue" value={`Rs ${Math.round(summary?.total_revenue || 0).toLocaleString()}`} icon={CheckCircle2} />
        <Metric label="ROAS" value={`${summary?.roas || 0}x`} icon={Send} />
      </div>

      <section
        data-testid="ad-management-control"
        className="mb-8 rounded-xl border border-sky-500/10 bg-[#111115] p-6"
      >
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-sky-300">
              Ad Campaign Mission Control
            </p>
            <h2 className="mt-1 text-xl font-black">Launch readiness, budget risk, sync audit and next actions</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
              A single command view for Meta Ads setup, paused-launch safety, external IDs, pacing risk, and campaign actions.
            </p>
          </div>
          <span
            className={`rounded-full px-4 py-2 text-xs font-black uppercase ${adManagementStatusClass(
              managementSummary.overall_status
            )}`}
          >
            {adManagementStatusLabel(managementSummary.overall_status)}
          </span>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
          <ReadinessMetric label="Launch Ready" value={managementSummary.launch_ready_count} icon={CheckCircle2} />
          <ReadinessMetric label="Blocked" value={managementSummary.launch_blocked_count} icon={AlertTriangle} />
          <ReadinessMetric label="Budget Review" value={managementSummary.budget_attention_count} icon={BarChart3} />
          <ReadinessMetric label="Needs Sync" value={managementSummary.unsynced_live_count} icon={LinkIcon} />
          <ReadinessMetric label="Actions" value={managementSummary.action_count} icon={History} />
        </div>

        <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-5">
          {managementControls.map((control) => (
            <div key={`ad-management-control-${control.label}`} className="rounded-xl border border-white/5 bg-black/25 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-black text-white">{control.label}</p>
                <span className="rounded-full bg-sky-500/10 px-2 py-1 text-[11px] font-black uppercase text-sky-200">
                  {control.status}
                </span>
              </div>
              <p className="text-xs font-semibold leading-5 text-gray-500">{control.detail}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="xl:col-span-8">
            <div className="rounded-xl border border-white/5 bg-black/25 p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-sky-300">Priority Campaigns</p>
                  <h3 className="mt-1 text-lg font-black">What needs action first</h3>
                </div>
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase text-gray-400">
                  {managementCampaigns.length || campaigns.length} tracked
                </span>
              </div>
              <div className="space-y-3">
                {managementCampaigns.slice(0, 5).map((campaign) => (
                  <div
                    key={`ad-management-${campaign.id}`}
                    data-testid={`ad-management-campaign-${campaign.id}`}
                    className="grid grid-cols-1 gap-3 rounded-lg border border-white/5 bg-white/[0.03] p-3 text-sm lg:grid-cols-12"
                  >
                    <div className="lg:col-span-3">
                      <p className="font-black text-white">{campaign.name}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {objectiveLabel(campaign.objective)} | {campaign.platforms.map((platform) => platformLabels[platform]).join(", ")}
                      </p>
                    </div>
                    <div className="lg:col-span-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(campaign.status)}`}>
                        {campaign.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 lg:col-span-4">
                      <MiniState
                        label="Launch"
                        value={campaign.launch.eligible ? "ready" : "blocked"}
                        danger={!campaign.launch.eligible}
                      />
                      <MiniState
                        label="Budget"
                        value={campaign.budget_health.attention_required ? "review" : "ok"}
                        danger={campaign.budget_health.attention_required}
                      />
                      <MiniState
                        label="Sync"
                        value={campaign.sync.provider_state.replaceAll("_", " ")}
                        danger={campaign.sync.provider_state !== "synced" && ["launched", "paused", "completed"].includes(campaign.status)}
                      />
                    </div>
                    <div className="text-gray-400 lg:col-span-3">
                      <p className="font-semibold leading-6">{campaign.next_action}</p>
                      {campaign.latest_launch && (
                        <p className="mt-1 text-xs text-gray-500">
                          Latest launch: {campaign.latest_launch.status} | {campaign.latest_launch.recovery_action}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
                {!managementCampaigns.length && (
                  <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-sm font-semibold text-gray-500">
                    Management control is loading campaign priorities.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-sky-300">Operator Summary</p>
                <h3 className="mt-1 text-lg font-black">Current command decision</h3>
              </div>
              <Target className="h-5 w-5 text-sky-300" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <BudgetMetric label="Dry Runs" value={managementSummary.dry_run_count} />
              <BudgetMetric label="Retryable" value={managementSummary.retryable_launch_count} />
              <BudgetMetric label="External IDs" value={managementSummary.external_id_count} />
              <BudgetMetric label="Syncs" value={managementSummary.external_sync_count} />
            </div>
            <p className="mt-4 text-sm font-semibold leading-6 text-gray-300">{managementSummary.next_action}</p>
          </div>
        </div>
      </section>

      <section
        data-testid="ad-provider-sync-command"
        className="mb-8 rounded-xl border border-white/5 bg-[#1a1a1c] p-6"
      >
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-orange-400">Provider Sync</p>
            <h2 className="mt-1 text-xl font-black">Ad Provider Sync</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500">
              Provider launch controls, external campaign IDs, pause/resume guardrails and launch audit in one place.
            </p>
          </div>
          <span
            className={`rounded-full px-4 py-2 text-xs font-black uppercase ${
              syncReadiness?.provider_status.configured
                ? "bg-green-500/10 text-green-300"
                : "bg-yellow-500/10 text-yellow-300"
            }`}
          >
            {syncReadiness?.provider_status.readiness_label || "Checking"}
          </span>
        </div>

        <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-4">
          <ReadinessMetric
            label="External IDs"
            value={syncReadiness?.audit.external_id_count || 0}
            icon={LinkIcon}
          />
          <ReadinessMetric
            label="Unsynced Live"
            value={syncReadiness?.audit.unsynced_live_count || 0}
            icon={AlertTriangle}
          />
          <ReadinessMetric
            label="Retryable"
            value={syncReadiness?.audit.retryable_count || 0}
            icon={RefreshCw}
          />
          <ReadinessMetric
            label="Sync Actions"
            value={syncReadiness?.audit.external_sync_count || 0}
            icon={History}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-white/5 bg-black/25 p-5">
            <p className="mb-3 text-xs font-black uppercase tracking-widest text-gray-500">Credentials</p>
            <div className="space-y-3">
              {(syncReadiness?.provider_status.credential_checks || []).map((check) => (
                <div key={check.key} className="flex items-start gap-3 text-sm">
                  {check.configured ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-300" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-300" />
                  )}
                  <div>
                    <p className="font-bold text-white">{check.label}</p>
                    <p className="break-all text-xs text-gray-500">{check.key}</p>
                  </div>
                </div>
              ))}
              {!syncReadiness?.provider_status.credential_checks?.length && (
                <p className="text-sm text-gray-500">Provider credentials are loading.</p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-white/5 bg-black/25 p-5">
            <p className="mb-3 text-xs font-black uppercase tracking-widest text-gray-500">Sync Checklist</p>
            <div className="space-y-3">
              {(syncReadiness?.checklist || []).map((item) => (
                <div key={item.label} className="flex items-start gap-3 text-sm">
                  {item.passed ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-300" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-300" />
                  )}
                  <div>
                    <p className="font-bold text-white">{item.label}</p>
                    <p className="text-xs leading-5 text-gray-500">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/5 bg-black/25 p-5">
            <p className="mb-3 text-xs font-black uppercase tracking-widest text-gray-500">Next Action</p>
            <p className="text-sm font-semibold leading-6 text-gray-300">
              {syncReadiness?.next_action || providerStatus?.next_action || "Load sync readiness to see the next action."}
            </p>
            <div className="mt-4 rounded-lg border border-white/5 bg-black/30 p-3 text-xs leading-5 text-gray-500">
              Graph version: {syncReadiness?.provider_status.graph_version || providerStatus?.graph_version || "not set"}
            </div>
          </div>
        </div>

        {syncReadiness?.campaigns.length ? (
          <div className="mt-5 rounded-xl border border-white/5 bg-black/25 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-black">External ID Audit</h3>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase text-gray-400">
                {syncReadiness.campaigns.length} checked
              </span>
            </div>
            <div className="space-y-2">
              {syncReadiness.campaigns.slice(0, 5).map((campaign) => (
                <div
                  key={`sync-${campaign.id}`}
                  className="grid grid-cols-1 gap-3 rounded-lg border border-white/5 bg-black/30 p-3 text-sm md:grid-cols-12"
                >
                  <div className="md:col-span-4">
                    <p className="font-bold text-white">{campaign.name}</p>
                    <p className="text-xs text-gray-500">{campaign.external_campaign_id || "No external Meta ID"}</p>
                  </div>
                  <div className="md:col-span-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(campaign.status)}`}>
                      {campaign.status}
                    </span>
                  </div>
                  <div className="font-bold text-gray-300 md:col-span-2">{campaign.provider_state.replaceAll("_", " ")}</div>
                  <div className="text-gray-500 md:col-span-4">
                    {campaign.guardrails[0] || "Ready for provider sync."}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="mb-8 rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-black">Meta Ads Launch Console</h2>
            <p className="mt-1 text-sm text-gray-500">
              Launch readiness for paused Meta campaign shells before ad sets and creatives are activated.
            </p>
          </div>
          <span
            className={`rounded-full px-4 py-2 text-xs font-black uppercase ${
              launchReadiness?.provider_status.configured
                ? "bg-green-500/10 text-green-300"
                : "bg-yellow-500/10 text-yellow-300"
            }`}
          >
            {launchReadiness?.provider_status.configured ? "Meta ready" : "Setup needed"}
          </span>
        </div>

        <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-4">
          <ReadinessMetric label="Ready" value={launchReadiness?.ready_count || 0} icon={CheckCircle2} />
          <ReadinessMetric label="Blocked" value={launchReadiness?.blocked_count || 0} icon={AlertTriangle} />
          <ReadinessMetric
            label="Planned Budget"
            value={`Rs ${Math.round(launchReadiness?.planned_budget || 0).toLocaleString()}`}
            icon={BarChart3}
          />
          <ReadinessMetric
            label="Launch Mode"
            value={launchReadiness?.provider_status.launch_mode?.replaceAll("_", " ") || "paused campaign"}
            icon={Target}
          />
        </div>

        <div className="rounded-xl border border-white/5 bg-black/25 p-5">
          <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-500">
            {launchReadiness?.provider_status.configured ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-300" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-yellow-300" />
            )}
            Meta Ads Provider
          </div>
          <p className="text-sm font-semibold leading-6 text-gray-400">
            {launchReadiness?.provider_status.configured
              ? "Meta Ads can create paused campaigns for final review inside Meta Ads Manager."
              : launchReadiness?.provider_status.missing_settings.join(", ") || "Provider status is loading."}
          </p>
        </div>

        {launchReadiness?.campaigns.length ? (
          <div className="mt-5 rounded-xl border border-white/5 bg-black/25 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="font-black">Campaign Preflight</h3>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase text-gray-400">
                {launchReadiness.campaigns.length} checked
              </span>
            </div>
            <div className="space-y-2">
              {launchReadiness.campaigns.slice(0, 5).map((campaign) => (
                <div key={`ready-${campaign.id}`} className="grid grid-cols-1 gap-3 rounded-lg border border-white/5 bg-black/30 p-3 text-sm md:grid-cols-12">
                  <div className="md:col-span-4">
                    <p className="font-bold text-white">{campaign.name}</p>
                    <p className="text-xs text-gray-500">
                      {objectiveLabel(campaign.objective)} | Rs {Math.round(campaign.budget).toLocaleString()}
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${campaign.eligible ? "bg-green-500/15 text-green-300" : "bg-yellow-500/15 text-yellow-300"}`}>
                      {campaign.eligible ? "ready" : "blocked"}
                    </span>
                  </div>
                  <div className="text-gray-400 md:col-span-6">
                    {campaign.eligible
                      ? campaign.platforms.map((platform) => platformLabels[platform]).join(", ")
                      : campaign.blockers.join(", ")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-5">
          <div className="rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-black">Campaign Queue</h2>
              <span className="rounded-full bg-black/30 px-3 py-1 text-xs font-black uppercase tracking-widest text-gray-500">
                {campaigns.length} total
              </span>
            </div>
            <div className="space-y-3">
              {campaigns.map((campaign) => (
                <button
                  key={campaign.id}
                  onClick={() => selectCampaign(campaign.id)}
                  className={`w-full rounded-xl border p-4 text-left transition ${
                    selectedId === campaign.id
                      ? "border-orange-500 bg-orange-500/10"
                      : "border-white/5 bg-black/25 hover:border-white/20"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-black">{campaign.name}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-gray-500">{campaign.creative_message}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${statusClass(campaign.status)}`}>
                      {campaign.status}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-400">
                    <Pill icon={Target} value={objectiveLabel(campaign.objective)} />
                    {campaign.platforms.map((platform) => (
                      <Pill key={platform} icon={Send} value={platformLabels[platform]} />
                    ))}
                    {campaign.link_url && <Pill icon={LinkIcon} value="Link" />}
                  </div>
                </button>
              ))}
              {!campaigns.length && (
                <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-gray-500">
                  No ad campaigns yet.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="xl:col-span-7">
          <div className="rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
            {selectedCampaign ? (
              <>
                <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-orange-400">
                      Campaign #{selectedCampaign.id} | {objectiveLabel(selectedCampaign.objective)}
                    </p>
                    <h2 className="mt-2 text-2xl font-black">{selectedCampaign.name}</h2>
                    <p className="mt-3 text-sm leading-6 text-gray-300">{selectedCampaign.creative_message}</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => launchCampaign(true)}
                      disabled={launching !== null}
                      className="flex items-center gap-2 rounded-xl bg-white/10 px-5 py-3 font-bold text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Dry Run
                    </button>
                    <button
                      onClick={() => launchCampaign(false)}
                      disabled={launching !== null || !providerStatus?.configured}
                      title={providerStatus?.configured ? "Create paused Meta campaign" : `Missing: ${providerStatus?.missing_settings.join(", ") || "provider setup"}`}
                      className="flex items-center gap-2 rounded-xl bg-white px-5 py-3 font-bold text-black hover:bg-orange-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Send className="h-4 w-4" /> Launch
                    </button>
                  </div>
                </div>

                <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                  <Detail label="Budget" value={`Rs ${Math.round(selectedCampaign.daily_budget || selectedCampaign.lifetime_budget || 0).toLocaleString()}`} />
                  <Detail label="Clicks" value={`${selectedCampaign.clicks}`} />
                  <Detail label="CTR" value={`${selectedCampaign.ctr}%`} />
                  <Detail label="CPA" value={`Rs ${selectedCampaign.cpa}`} />
                  <Detail label="ROAS" value={`${selectedCampaign.roas}x`} />
                </div>

                <div
                  data-testid="ad-ops-actions"
                  className="mb-6 rounded-xl border border-white/5 bg-black/25 p-5"
                >
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-gray-500">Operations</p>
                      <h3 className="mt-1 text-lg font-black">Campaign Controls</h3>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(selectedCampaign.status)}`}>
                      {selectedCampaign.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <button
                      data-testid="pause-ad-campaign"
                      onClick={() => runCampaignAction("pause")}
                      disabled={!canPause || actioning !== null}
                      className="flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm font-bold text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Pause className="h-4 w-4" /> Pause
                    </button>
                    <button
                      data-testid="resume-ad-campaign"
                      onClick={() => runCampaignAction("resume")}
                      disabled={!canResume || actioning !== null}
                      className="flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm font-bold text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Play className="h-4 w-4" /> Resume
                    </button>
                    <button
                      data-testid="complete-ad-campaign"
                      onClick={() => runCampaignAction("complete")}
                      disabled={!canComplete || actioning !== null}
                      className="flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm font-bold text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Complete
                    </button>
                    <button
                      data-testid="duplicate-ad-campaign"
                      onClick={duplicateCampaign}
                      disabled={actioning !== null}
                      className="flex items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Copy className="h-4 w-4" /> Duplicate
                    </button>
                  </div>
                  {actioning && (
                    <p className="mt-3 text-xs font-bold uppercase tracking-widest text-orange-300">
                      Running {actionLabel(actioning)}...
                    </p>
                  )}
                </div>

                <div
                  data-testid="ad-external-sync-panel"
                  className="mb-6 rounded-xl border border-white/5 bg-black/25 p-5"
                >
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-gray-500">External Sync</p>
                      <h3 className="mt-1 text-lg font-black">Meta Campaign ID</h3>
                    </div>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase text-gray-400">
                      {selectedCampaign.external_campaign_id ? "ID attached" : "Local only"}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                    <label className="space-y-2 lg:col-span-3">
                      <span className="text-xs font-black uppercase tracking-widest text-gray-500">
                        External Campaign ID
                      </span>
                      <input
                        data-testid="external-campaign-id"
                        type="text"
                        value={syncForm.external_campaign_id}
                        onChange={(event) =>
                          setSyncForm({ ...syncForm, external_campaign_id: event.target.value })
                        }
                        placeholder="meta_campaign_123"
                        className="w-full rounded-xl border border-white/10 bg-black/30 p-4 outline-none focus:border-orange-500"
                      />
                    </label>
                    <Select
                      label="Provider Status"
                      value={syncForm.status}
                      options={syncStatusOptions}
                      onChange={(value) => setSyncForm({ ...syncForm, status: value as AdSyncStatus })}
                    />
                    <div className="grid grid-cols-2 gap-3 self-end">
                      <button
                        data-testid="dry-run-ad-sync"
                        onClick={() => syncExternalCampaign(true)}
                        disabled={syncing !== null}
                        className="flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm font-bold text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <CheckCircle2 className="h-4 w-4" /> Dry Run
                      </button>
                      <button
                        data-testid="apply-ad-sync"
                        onClick={() => syncExternalCampaign(false)}
                        disabled={syncing !== null}
                        className="flex items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <LinkIcon className="h-4 w-4" /> Apply
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 text-sm text-gray-300 md:grid-cols-2">
                    <p>
                      Current external ID:{" "}
                      <span className="font-black text-white">
                        {selectedCampaign.external_campaign_id || "Not attached"}
                      </span>
                    </p>
                    <p>
                      Guardrail:{" "}
                      <span className="font-black text-white">
                        {selectedCampaign.external_campaign_id ? "Pause/resume can be audited" : "Sync ID before provider actions"}
                      </span>
                    </p>
                  </div>
                  {syncResult && (
                    <div className="mt-4 rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-sm font-bold text-green-200">
                      {syncResult}
                    </div>
                  )}
                </div>

                {budgetHealth && (
                  <div
                    data-testid="ad-budget-command"
                    className="mb-6 rounded-xl border border-white/5 bg-black/25 p-5"
                  >
                    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-widest text-gray-500">Budget Pacing</p>
                        <h3 className="mt-2 text-lg font-black">Ad Spend Command</h3>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${pacingStatusClass(budgetHealth.pacing_status)}`}>
                          {pacingStatusLabel(budgetHealth.pacing_status)}
                        </span>
                        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${performanceStatusClass(budgetHealth.performance_status)}`}>
                          {performanceStatusLabel(budgetHealth.performance_status)}
                        </span>
                      </div>
                    </div>

                    <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-4">
                      <BudgetMetric label="Spent" value={formatRs(budgetHealth.spend)} />
                      <BudgetMetric label="Expected" value={formatRs(budgetHealth.expected_spend_to_date)} />
                      <BudgetMetric label="Remaining" value={formatRs(budgetHealth.remaining_budget)} />
                      <BudgetMetric label="Days Left" value={budgetHealth.days_left} />
                    </div>

                    <div className="space-y-4">
                      <div>
                        <div className="mb-2 flex justify-between text-xs font-black uppercase tracking-widest text-gray-500">
                          <span>Spend Used</span>
                          <span>{budgetHealth.spend_percent}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-orange-500" style={{ width: budgetProgressWidth }} />
                        </div>
                      </div>
                      <div>
                        <div className="mb-2 flex justify-between text-xs font-black uppercase tracking-widest text-gray-500">
                          <span>Time Used</span>
                          <span>{budgetHealth.elapsed_percent}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-blue-400" style={{ width: elapsedProgressWidth }} />
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-3 text-sm text-gray-300 md:grid-cols-2">
                      <p>
                        Pace gap: <span className="font-black text-white">{formatSignedRs(budgetHealth.pacing_gap)}</span>
                      </p>
                      <p>
                        Remaining daily pace:{" "}
                        <span className="font-black text-white">{formatRs(budgetHealth.remaining_daily_budget)}</span>
                      </p>
                    </div>

                    <div className="mt-5 rounded-lg border border-white/5 bg-black/30 p-4">
                      <p className="mb-2 text-xs font-black uppercase tracking-widest text-gray-500">Next Actions</p>
                      <div className="space-y-2 text-sm leading-6 text-gray-300">
                        {budgetHealth.recommendations.map((recommendation) => (
                          <p key={recommendation}>{recommendation}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
                  <NumberInput label="Impressions" value={metricsForm.impressions} onChange={(value) => setMetricsForm({ ...metricsForm, impressions: value })} />
                  <NumberInput label="Clicks" value={metricsForm.clicks} onChange={(value) => setMetricsForm({ ...metricsForm, clicks: value })} />
                  <NumberInput label="Conversions" value={metricsForm.conversions} onChange={(value) => setMetricsForm({ ...metricsForm, conversions: value })} />
                  <NumberInput label="Spend" value={metricsForm.spend} onChange={(value) => setMetricsForm({ ...metricsForm, spend: value })} />
                  <NumberInput label="Revenue" value={metricsForm.revenue} onChange={(value) => setMetricsForm({ ...metricsForm, revenue: value })} />
                </div>
                <button
                  onClick={saveMetrics}
                  className="mb-6 rounded-xl bg-orange-500 px-5 py-3 font-bold text-white hover:bg-orange-600"
                >
                  Save Metrics
                </button>

                <div className="mb-6 rounded-xl border border-white/5 bg-black/25 p-5">
                  <p className="mb-2 text-xs font-black uppercase tracking-widest text-gray-500">Launch Readiness</p>
                  <p className="text-sm text-gray-300">
                    {providerStatus?.configured
                      ? "Meta Ads provider is ready. Launch creates a paused campaign for review."
                      : `Provider setup needed: ${providerStatus?.missing_settings.join(", ") || "checking"}`}
                  </p>
                  {selectedCampaign.external_campaign_id && (
                    <p className="mt-2 text-sm text-orange-300">Meta campaign: {selectedCampaign.external_campaign_id}</p>
                  )}
                </div>

                {history?.launches.length ? (
                  <div className="rounded-xl border border-white/5 bg-black/25 p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3 className="font-black">Recent Launch Attempts</h3>
                      <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase text-gray-400">
                        {history.launched_count} launched / {history.retryable_count || 0} retryable
                      </span>
                    </div>
                    <div className="space-y-2">
                      {history.launches.slice(0, 8).map((launch) => (
                        <div
                          key={launch.id}
                          className="grid grid-cols-1 gap-3 rounded-lg border border-white/5 bg-black/30 p-3 text-sm md:grid-cols-12"
                        >
                          <div className="md:col-span-3">
                            <p className="font-bold text-white">{launch.provider || "No provider"}</p>
                            <p className="text-xs text-gray-500">{launch.external_campaign_id || "No external id"}</p>
                          </div>
                          <div className="md:col-span-2">
                            <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${launchStatusClass(launch.status)}`}>
                              {launch.status}
                            </span>
                          </div>
                          <div className="text-gray-500 md:col-span-3">
                            {launch.attempted_at ? new Date(launch.attempted_at).toLocaleString() : "Not attempted"}
                          </div>
                          <div className="break-all text-gray-400 md:col-span-4">
                            {launch.error || launch.recovery_action || "Ready"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-gray-500">
                    No launch attempts yet.
                  </div>
                )}

                <div
                  data-testid="ad-action-history"
                  className="mt-6 rounded-xl border border-white/5 bg-black/25 p-5"
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 font-black">
                      <History className="h-4 w-4 text-orange-400" /> Action History
                    </h3>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase text-gray-400">
                      {actionHistory?.action_count || 0} actions
                    </span>
                  </div>
                  {actionHistory?.actions.length ? (
                    <div className="space-y-2">
                      {actionHistory.actions.slice(0, 8).map((action) => (
                        <div
                          key={action.id}
                          className="grid grid-cols-1 gap-3 rounded-lg border border-white/5 bg-black/30 p-3 text-sm md:grid-cols-12"
                        >
                          <div className="md:col-span-3">
                            <p className="font-bold capitalize text-white">{action.action.replaceAll("_", " ")}</p>
                            <p className="text-xs text-gray-500">{action.actor || "Portal"}</p>
                          </div>
                          <div className="md:col-span-3">
                            <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass((action.next_status || "draft") as CampaignStatus)}`}>
                              {action.previous_status || "new"} to {action.next_status || "same"}
                            </span>
                          </div>
                          <div className="text-gray-500 md:col-span-3">
                            {action.created_at ? new Date(action.created_at).toLocaleString() : "Not recorded"}
                          </div>
                          <div className="text-gray-400 md:col-span-3">
                            {action.note || "No note"}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-gray-500">
                      No campaign actions yet.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 p-12 text-center text-gray-500">
                Select or create an ad campaign.
              </div>
            )}
          </div>
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={saveCampaign}
            className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-white/10 bg-[#1a1a1c] p-8"
          >
            <div className="mb-6 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xl font-black">
                <Target className="h-5 w-5 text-orange-400" /> Ad Campaign
              </h2>
              <button type="button" onClick={() => setShowAdd(false)} className="text-gray-500 hover:text-white">
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input label="Name" value={campaignForm.name} onChange={(value) => setCampaignForm({ ...campaignForm, name: value })} required />
              <Select
                label="Objective"
                value={campaignForm.objective}
                options={objectiveOptions}
                onChange={(value) => setCampaignForm({ ...campaignForm, objective: value as ObjectiveKey })}
              />
              <Input label="Audience" value={campaignForm.audience} onChange={(value) => setCampaignForm({ ...campaignForm, audience: value })} />
              <Input label="Location" value={campaignForm.location} onChange={(value) => setCampaignForm({ ...campaignForm, location: value })} />
              <Input label="Link URL" value={campaignForm.link_url} onChange={(value) => setCampaignForm({ ...campaignForm, link_url: value })} />
              <MediaPicker
                label="Creative image"
                value={campaignForm.image_url}
                onChange={(value) => setCampaignForm({ ...campaignForm, image_url: value })}
                testId="ad-image-picker"
                helpText="Pick a shared creative or upload a new image for this campaign."
              />
              <NumberInput label="Daily Budget" value={campaignForm.daily_budget} onChange={(value) => setCampaignForm({ ...campaignForm, daily_budget: value })} />
              <NumberInput label="Lifetime Budget" value={campaignForm.lifetime_budget} onChange={(value) => setCampaignForm({ ...campaignForm, lifetime_budget: value })} />
              <Input label="Start Date" type="date" value={campaignForm.start_date} onChange={(value) => setCampaignForm({ ...campaignForm, start_date: value })} />
              <Input label="End Date" type="date" value={campaignForm.end_date} onChange={(value) => setCampaignForm({ ...campaignForm, end_date: value })} />
              <Select
                label="Status"
                value={campaignForm.status}
                options={[
                  { value: "draft", label: "Draft" },
                  { value: "planned", label: "Planned" },
                  { value: "ready", label: "Ready" },
                ]}
                onChange={(value) => setCampaignForm({ ...campaignForm, status: value as CampaignStatus })}
              />
              <div className="space-y-2">
                <span className="text-xs font-black uppercase tracking-widest text-gray-500">Platforms</span>
                <div className="flex flex-wrap gap-3">
                  {(["facebook", "instagram"] as PlatformKey[]).map((platform) => (
                    <button
                      key={platform}
                      type="button"
                      onClick={() => togglePlatform(platform)}
                      className={`rounded-xl px-4 py-3 font-bold ${
                        campaignForm.platforms.includes(platform)
                          ? "bg-orange-500 text-white"
                          : "bg-black/30 text-gray-400 hover:bg-white/10"
                      }`}
                    >
                      {platformLabels[platform]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <label className="mt-4 block space-y-2">
              <span className="text-xs font-black uppercase tracking-widest text-gray-500">Creative Message</span>
              <textarea
                value={campaignForm.creative_message}
                onChange={(event) => setCampaignForm({ ...campaignForm, creative_message: event.target.value })}
                rows={5}
                className="w-full rounded-xl border border-white/10 bg-black/30 p-4 outline-none focus:border-orange-500"
                required
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

function objectiveLabel(value: ObjectiveKey) {
  return objectiveOptions.find((option) => option.value === value)?.label || value;
}

function setSelectedCampaignParam(campaignId: number) {
  const url = new URL(window.location.href);
  url.searchParams.set("campaign", String(campaignId));
  window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
}

function adManagementStatusLabel(status: AdManagementStatus) {
  const labels: Record<AdManagementStatus, string> = {
    setup_needed: "Setup Needed",
    sync_needed: "Sync Needed",
    budget_review: "Budget Review",
    ready_to_launch: "Ready To Launch",
    planning_needed: "Planning Needed",
  };
  return labels[status];
}

function adManagementStatusClass(status: AdManagementStatus) {
  if (status === "ready_to_launch") return "bg-green-500/15 text-green-300";
  if (status === "budget_review" || status === "sync_needed") return "bg-yellow-500/15 text-yellow-300";
  if (status === "setup_needed") return "bg-orange-500/15 text-orange-300";
  return "bg-blue-500/15 text-blue-300";
}

function syncStatusFromCampaign(status: CampaignStatus): AdSyncStatus {
  if (status === "launched" || status === "paused" || status === "completed" || status === "failed") {
    return status;
  }
  return "paused";
}

function statusClass(status: CampaignStatus) {
  if (status === "launched" || status === "completed") return "bg-green-500/15 text-green-300";
  if (status === "failed") return "bg-red-500/15 text-red-300";
  if (status === "planned") return "bg-blue-500/15 text-blue-300";
  if (status === "ready") return "bg-orange-500/15 text-orange-300";
  return "bg-white/10 text-gray-300";
}

function launchStatusClass(status: AdLaunch["status"]) {
  if (status === "launched") return "bg-green-500/15 text-green-300";
  if (status === "dry_run") return "bg-blue-500/15 text-blue-300";
  if (status === "failed") return "bg-red-500/15 text-red-300";
  if (status === "skipped") return "bg-yellow-500/15 text-yellow-300";
  return "bg-white/10 text-gray-300";
}

function actionLabel(action: "pause" | "resume" | "complete" | "duplicate") {
  if (action === "pause") return "Pause";
  if (action === "resume") return "Resume";
  if (action === "complete") return "Complete";
  return "Duplicate";
}

function pacingStatusLabel(status: BudgetHealth["pacing_status"]) {
  const labels: Record<BudgetHealth["pacing_status"], string> = {
    no_budget: "No Budget",
    not_started: "Not Started",
    completed: "Completed",
    over_pacing: "Over Pace",
    under_pacing: "Under Pace",
    on_track: "On Track",
  };
  return labels[status];
}

function pacingStatusClass(status: BudgetHealth["pacing_status"]) {
  if (status === "on_track") return "bg-green-500/15 text-green-300";
  if (status === "over_pacing") return "bg-red-500/15 text-red-300";
  if (status === "under_pacing") return "bg-yellow-500/15 text-yellow-300";
  if (status === "completed") return "bg-blue-500/15 text-blue-300";
  return "bg-white/10 text-gray-300";
}

function performanceStatusLabel(status: BudgetHealth["performance_status"]) {
  const labels: Record<BudgetHealth["performance_status"], string> = {
    learning: "Learning",
    strong: "Strong ROAS",
    profitable: "Profitable",
    needs_conversion: "Needs Conversion",
    watch: "Watch",
  };
  return labels[status];
}

function performanceStatusClass(status: BudgetHealth["performance_status"]) {
  if (status === "strong") return "bg-green-500/15 text-green-300";
  if (status === "profitable") return "bg-blue-500/15 text-blue-300";
  if (status === "needs_conversion" || status === "watch") return "bg-red-500/15 text-red-300";
  return "bg-white/10 text-gray-300";
}

function formatRs(value: number) {
  return `Rs ${Math.round(value || 0).toLocaleString()}`;
}

function formatSignedRs(value: number) {
  const rounded = Math.round(value || 0);
  const prefix = rounded > 0 ? "+" : "";
  return `${prefix}Rs ${rounded.toLocaleString()}`;
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

function ReadinessMetric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-black/25 p-4">
      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-500">
        <Icon className="h-4 w-4 text-orange-400" /> {label}
      </div>
      <p className="mt-3 text-2xl font-black capitalize">{value}</p>
    </div>
  );
}

function BudgetMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/5 bg-black/30 p-4">
      <p className="text-xs font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-2 text-xl font-black">{value}</p>
    </div>
  );
}

function MiniState({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-white/5 bg-black/30 p-3">
      <p className="text-[11px] font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className={`mt-1 text-xs font-black uppercase ${danger ? "text-yellow-300" : "text-green-300"}`}>
        {value}
      </p>
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

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-black uppercase tracking-widest text-gray-500">{label}</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-xl border border-white/10 bg-black/30 p-4 outline-none focus:border-orange-500"
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
