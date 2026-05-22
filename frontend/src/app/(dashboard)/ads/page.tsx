"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Link as LinkIcon,
  Plus,
  RefreshCw,
  Send,
  Target,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const ADS_API = getApiUrl("/api/v1/restaurant/ads");

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
  attempted_at?: string | null;
};

type LaunchHistory = {
  attempted_count: number;
  launched_count: number;
  dry_run_count: number;
  failed_count: number;
  skipped_count: number;
  launches: AdLaunch[];
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

export default function AdsManagerPage() {
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [summary, setSummary] = useState<AdsSummary | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [launchReadiness, setLaunchReadiness] = useState<LaunchReadiness | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [history, setHistory] = useState<LaunchHistory | null>(null);
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
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState<"dry_run" | "launch" | null>(null);

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === selectedId) || null,
    [campaigns, selectedId]
  );

  useEffect(() => {
    fetchAds();
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
  }, [selectedCampaign]);

  const fetchAds = async () => {
    setLoading(true);
    const [statusResponse, summaryResponse, campaignsResponse, readinessResponse] = await Promise.all([
      fetch(`${ADS_API}/provider-status`),
      fetch(`${ADS_API}/summary`),
      fetch(`${ADS_API}/campaigns`),
      fetch(`${ADS_API}/launch-readiness`),
    ]);
    if (statusResponse.ok) setProviderStatus(await statusResponse.json());
    if (summaryResponse.ok) setSummary(await summaryResponse.json());
    if (readinessResponse.ok) setLaunchReadiness(await readinessResponse.json());
    if (campaignsResponse.ok) {
      const data: AdCampaign[] = await campaignsResponse.json();
      setCampaigns(data);
      const nextSelectedId = selectedId || data[0]?.id || null;
      setSelectedId(nextSelectedId);
      if (nextSelectedId) {
        await fetchLaunches(nextSelectedId);
      } else {
        setHistory(null);
      }
    }
    setLoading(false);
  };

  const fetchLaunches = async (campaignId: number) => {
    const response = await fetch(`${ADS_API}/campaigns/${campaignId}/launches`);
    if (!response.ok) {
      setHistory(null);
      return;
    }
    setHistory(await response.json());
  };

  const selectCampaign = (campaignId: number) => {
    setSelectedId(campaignId);
    fetchLaunches(campaignId);
  };

  const togglePlatform = (platform: PlatformKey) => {
    const platforms = campaignForm.platforms.includes(platform)
      ? campaignForm.platforms.filter((item) => item !== platform)
      : [...campaignForm.platforms, platform];
    setCampaignForm({ ...campaignForm, platforms });
  };

  const saveCampaign = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const response = await fetch(`${ADS_API}/campaigns`, {
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
    const response = await fetch(`${ADS_API}/campaigns/${selectedCampaign.id}/metrics`, {
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
    const response = await fetch(`${ADS_API}/campaigns/${selectedCampaign.id}/launch`, {
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
            onClick={fetchAds}
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
                      {objectiveLabel(selectedCampaign.objective)}
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
                        {history.launched_count} launched / {history.failed_count} failed
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
                            {launch.error || "Ready"}
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
              <Input label="Image URL" value={campaignForm.image_url} onChange={(value) => setCampaignForm({ ...campaignForm, image_url: value })} />
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
