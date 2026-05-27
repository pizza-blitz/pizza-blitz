"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Image,
  Link as LinkIcon,
  Plus,
  RefreshCw,
  Send,
  Share2,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const SOCIAL_API = getApiUrl("/api/v1/restaurant/social");

type PlatformKey = "facebook" | "instagram";
type SocialStatus = "draft" | "scheduled" | "ready" | "published" | "failed";

type SocialPost = {
  id: number;
  title: string;
  message: string;
  link_url?: string | null;
  image_url?: string | null;
  platforms: PlatformKey[];
  status: SocialStatus;
  scheduled_at?: string | null;
  created_at?: string | null;
};

type ProviderStatus = {
  platform: PlatformKey;
  provider: string;
  enabled: boolean;
  configured: boolean;
  unsupported: boolean;
  missing_settings: string[];
  readiness_label?: string;
  credential_checks?: ProviderCredentialCheck[];
  content_requirements?: ContentRequirement[];
  graph_version?: string;
  safe_publish?: {
    dry_run_available: boolean;
    live_publish_blocked: boolean;
    retry_supported: boolean;
  };
  next_action?: string;
};

type ProviderCredentialCheck = {
  key: string;
  label: string;
  configured: boolean;
};

type ContentRequirement = {
  label: string;
  status: string;
  detail: string;
};

type SocialDelivery = {
  id: number;
  platform: PlatformKey;
  provider?: string | null;
  status: "published" | "dry_run" | "failed" | "skipped" | "pending";
  external_id?: string | null;
  error?: string | null;
  dry_run: boolean;
  issue_reason?: "asset" | "provider" | "needs_review" | "none";
  retryable?: boolean;
  recovery_action?: string;
  attempted_at?: string | null;
};

type DeliveryHistory = {
  attempted_count: number;
  published_count: number;
  dry_run_count: number;
  failed_count: number;
  skipped_count: number;
  retryable_count: number;
  provider_issue_count?: number;
  asset_issue_count?: number;
  needs_review_count?: number;
  latest_attempted_at?: string | null;
  deliveries: SocialDelivery[];
};

type AutoPublishPost = {
  id: number;
  title: string;
  status: SocialStatus;
  scheduled_at?: string | null;
  platforms: PlatformKey[];
  eligible: boolean;
  blockers: string[];
};

type AutoPublishStatus = {
  interval_minutes: number;
  due_count: number;
  eligible_count: number;
  blocked_count: number;
  provider_status: Record<PlatformKey, ProviderStatus>;
  due_posts: AutoPublishPost[];
};

type SocialReadiness = {
  generated_at: string;
  providers: Record<PlatformKey, ProviderStatus>;
  schedule: AutoPublishStatus;
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
    latest_attempted_at?: string | null;
  };
  checklist: string[];
  next_action: string;
};

type AutoPostActivationStatus =
  | "live_ready"
  | "partially_ready"
  | "setup_needed"
  | "credentials_needed"
  | "content_blocked"
  | "proof_needed"
  | "recovery_needed"
  | "unsupported";

type AutoPostProof = {
  id: number;
  social_post_id?: number | null;
  platform: PlatformKey;
  provider?: string | null;
  status: SocialDelivery["status"];
  dry_run: boolean;
  external_id?: string | null;
  issue_reason?: SocialDelivery["issue_reason"];
  error?: string | null;
  recovery_action?: string | null;
  attempted_at?: string | null;
};

type AutoPostPlatformControl = {
  platform: PlatformKey;
  provider_status: ProviderStatus;
  activation_status: AutoPostActivationStatus;
  blockers: string[];
  due_count: number;
  eligible_due_count: number;
  blocked_due_count: number;
  counts: {
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
  latest_dry_run?: AutoPostProof | null;
  latest_published?: AutoPostProof | null;
  latest_issue?: AutoPostProof | null;
  next_action: string;
};

type SocialAutoPostMissionControl = {
  generated_at: string;
  summary: {
    overall_status: AutoPostActivationStatus;
    publish_enabled: boolean;
    configured_count: number;
    live_ready_count: number;
    blocked_count: number;
    due_count: number;
    eligible_count: number;
    blocked_due_count: number;
    retryable_count: number;
    next_action: string;
  };
  platforms: AutoPostPlatformControl[];
  controls: ContentRequirement[];
  due_posts: AutoPublishPost[];
  recent_delivery_events: AutoPostProof[];
};

type SocialRetryResult = {
  post: SocialPost;
  dry_run: boolean;
  status_filter: string;
  source_count: number;
  skipped_source_count: number;
  retried_platform_count: number;
  attempted_count: number;
  dry_run_count: number;
  failed_count: number;
  skipped_count: number;
  retryable_count: number;
};

type SocialForm = {
  title: string;
  message: string;
  link_url: string;
  image_url: string;
  platforms: PlatformKey[];
  status: SocialStatus;
  scheduled_at: string;
};

const emptyForm: SocialForm = {
  title: "",
  message: "",
  link_url: "",
  image_url: "",
  platforms: ["facebook", "instagram"],
  status: "ready",
  scheduled_at: "",
};

const platformLabels: Record<PlatformKey, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
};

const emptyAutoPostCounts: AutoPostPlatformControl["counts"] = {
  attempted_count: 0,
  published_count: 0,
  dry_run_count: 0,
  failed_count: 0,
  skipped_count: 0,
  retryable_count: 0,
  provider_issue_count: 0,
  asset_issue_count: 0,
  needs_review_count: 0,
};

const missionFallbackControls: ContentRequirement[] = [
  {
    label: "Secret-safe Meta tokens",
    status: "checked",
    detail: "The portal only reports configured or missing settings; token values are never exposed.",
  },
  {
    label: "Due-post gate",
    status: "enforced",
    detail: "Only ready or scheduled posts whose scheduled_at time has arrived enter the auto-post queue.",
  },
  {
    label: "Instagram asset gate",
    status: "enforced",
    detail: "Instagram posts remain blocked until a public image URL is attached.",
  },
  {
    label: "Dry-run recovery",
    status: "available",
    detail: "Failed or skipped delivery attempts can be retried safely before live publishing.",
  },
];

export default function SocialPublishingPage() {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [providerStatus, setProviderStatus] = useState<Record<PlatformKey, ProviderStatus> | null>(null);
  const [autoPublishStatus, setAutoPublishStatus] = useState<AutoPublishStatus | null>(null);
  const [socialReadiness, setSocialReadiness] = useState<SocialReadiness | null>(null);
  const [missionControl, setMissionControl] = useState<SocialAutoPostMissionControl | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [history, setHistory] = useState<DeliveryHistory | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [showAdd, setShowAdd] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState<"dry_run" | "publish" | null>(null);
  const [autoPublishing, setAutoPublishing] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedId) || null,
    [posts, selectedId]
  );

  useEffect(() => {
    const postParam = new URLSearchParams(window.location.search).get("post");
    const requestedPostId = postParam ? Number(postParam) : null;
    fetchSocial(
      typeof requestedPostId === "number" && Number.isFinite(requestedPostId)
        ? requestedPostId
        : null
    );
  }, []);

  const fetchSocial = async (preferredPostId?: number | null) => {
    setLoading(true);
    const [statusResponse, postsResponse, autoResponse, readinessResponse, missionResponse] = await Promise.all([
      fetch(`${SOCIAL_API}/provider-status`, { credentials: "include" }),
      fetch(`${SOCIAL_API}/posts`, { credentials: "include" }),
      fetch(`${SOCIAL_API}/auto-publish/status`, { credentials: "include" }),
      fetch(`${SOCIAL_API}/readiness`, { credentials: "include" }),
      fetch(`${SOCIAL_API}/auto-post/mission-control`, { credentials: "include" }),
    ]);
    if (statusResponse.ok) {
      setProviderStatus(await statusResponse.json());
    }
    if (autoResponse.ok) {
      setAutoPublishStatus(await autoResponse.json());
    }
    if (readinessResponse.ok) {
      setSocialReadiness(await readinessResponse.json());
    } else {
      setSocialReadiness(null);
    }
    if (missionResponse.ok) {
      setMissionControl(await missionResponse.json());
    } else {
      setMissionControl(null);
    }
    if (postsResponse.ok) {
      const data: SocialPost[] = await postsResponse.json();
      setPosts(data);
      const preferredExists = preferredPostId
        ? data.some((post) => post.id === preferredPostId)
        : false;
      const currentExists = selectedId ? data.some((post) => post.id === selectedId) : false;
      let nextSelectedId: number | null = data[0]?.id || null;
      if (preferredExists && preferredPostId) {
        nextSelectedId = preferredPostId;
      } else if (currentExists && selectedId) {
        nextSelectedId = selectedId;
      }
      setSelectedId(nextSelectedId);
      if (nextSelectedId) {
        await fetchDeliveries(nextSelectedId);
      } else {
        setHistory(null);
      }
    }
    setLoading(false);
  };

  const runAutoPublish = async () => {
    if (!autoPublishStatus?.eligible_count) {
      setMessage("No due social posts are eligible for auto-publishing.");
      return;
    }
    const confirmed = window.confirm("Run auto-publish now for due social posts?");
    if (!confirmed) return;

    setAutoPublishing(true);
    const response = await fetch(`${SOCIAL_API}/auto-publish/run`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 20 }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.detail || "Auto-publish run failed.");
      setAutoPublishing(false);
      return;
    }
    setMessage(
      `Auto-publish checked ${data.attempted_post_count} due post${data.attempted_post_count === 1 ? "" : "s"}: ${data.published_post_count} published, ${data.blocked_post_count} blocked.`
    );
    await fetchSocial();
    setAutoPublishing(false);
  };

  const fetchDeliveries = async (postId: number) => {
    const response = await fetch(`${SOCIAL_API}/posts/${postId}/deliveries`, {
      credentials: "include",
    });
    if (!response.ok) {
      setHistory(null);
      return;
    }
    setHistory(await response.json());
  };

  const selectPost = (postId: number) => {
    setSelectedId(postId);
    setSelectedPostParam(postId);
    fetchDeliveries(postId);
  };

  const togglePlatform = (platform: PlatformKey) => {
    const platforms = formData.platforms.includes(platform)
      ? formData.platforms.filter((item) => item !== platform)
      : [...formData.platforms, platform];
    setFormData({ ...formData, platforms });
  };

  const savePost = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const response = await fetch(`${SOCIAL_API}/posts`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...formData,
        link_url: formData.link_url || null,
        image_url: formData.image_url || null,
        scheduled_at: formData.scheduled_at ? new Date(formData.scheduled_at).toISOString() : null,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.detail || "Social post could not be saved.");
      return;
    }
    setMessage(`Saved social post ${data.post.title}.`);
    setShowAdd(false);
    setFormData(emptyForm);
    await fetchSocial();
    selectPost(data.post.id);
  };

  const publishPost = async (dryRun: boolean) => {
    if (!selectedPost) return;
    if (!dryRun) {
      const confirmed = window.confirm(`Publish ${selectedPost.title} to selected social channels?`);
      if (!confirmed) return;
    }
    setPublishing(dryRun ? "dry_run" : "publish");
    const response = await fetch(`${SOCIAL_API}/posts/${selectedPost.id}/publish`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dry_run: dryRun }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.detail || "Social publish failed.");
      setPublishing(null);
      return;
    }
    setMessage(
      dryRun
        ? `Dry run checked ${data.attempted_count} platform${data.attempted_count === 1 ? "" : "s"}.`
        : `Publish finished: ${data.published_count} published, ${data.skipped_count} skipped, ${data.failed_count} failed.`
    );
    await fetchSocial();
    await fetchDeliveries(selectedPost.id);
    setPublishing(null);
  };

  const retryDeliveryIssues = async () => {
    if (!selectedPost) return;
    setRetrying(true);
    const response = await fetch(`${SOCIAL_API}/posts/${selectedPost.id}/deliveries/retry`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dry_run: true, status: "needs_attention", limit: 20 }),
    });
    const data: SocialRetryResult | { detail?: string } = await response.json();
    if (!response.ok) {
      setMessage("detail" in data && data.detail ? data.detail : "Social delivery retry failed.");
      setRetrying(false);
      return;
    }
    const retryData = data as SocialRetryResult;
    setMessage(
      `Retry dry-run checked ${retryData.retried_platform_count} platform${retryData.retried_platform_count === 1 ? "" : "s"} from ${retryData.source_count} delivery issue${retryData.source_count === 1 ? "" : "s"}.`
    );
    await fetchSocial(selectedPost.id);
    await fetchDeliveries(selectedPost.id);
    setRetrying(false);
  };

  const missionDuePosts =
    missionControl?.due_posts || autoPublishStatus?.due_posts || socialReadiness?.schedule.due_posts || [];
  const missionPlatforms =
    missionControl?.platforms ||
    (["facebook", "instagram"] as PlatformKey[]).map((platform) => {
      const status =
        socialReadiness?.providers?.[platform] ||
        autoPublishStatus?.provider_status?.[platform] ||
        providerStatus?.[platform] ||
        fallbackProviderStatus(platform);
      const platformDuePosts = missionDuePosts.filter((post) => post.platforms.includes(platform));
      const blockedDueCount = platformDuePosts.filter((post) => !post.eligible).length;
      const activationStatus: AutoPostActivationStatus = status.unsupported
        ? "unsupported"
        : blockedDueCount
          ? "content_blocked"
          : status.configured
            ? "proof_needed"
            : "credentials_needed";

      return {
        platform,
        provider_status: status,
        activation_status: activationStatus,
        blockers: blockedDueCount
          ? ["Blocked due-post content"]
          : status.configured
            ? ["Dry-run proof missing"]
            : status.missing_settings,
        due_count: platformDuePosts.length,
        eligible_due_count: platformDuePosts.filter((post) => post.eligible).length,
        blocked_due_count: blockedDueCount,
        counts: emptyAutoPostCounts,
        latest_dry_run: null,
        latest_published: null,
        latest_issue: null,
        next_action: status.next_action || "Refresh mission control before live auto-posting.",
      };
    });
  const missionSummary =
    missionControl?.summary || {
      overall_status: missionPlatforms.some((platform) => platform.provider_status.configured)
        ? ("partially_ready" as AutoPostActivationStatus)
        : ("setup_needed" as AutoPostActivationStatus),
      publish_enabled: Boolean(missionPlatforms.some((platform) => platform.provider_status.enabled)),
      configured_count: missionPlatforms.filter((platform) => platform.provider_status.configured).length,
      live_ready_count: missionPlatforms.filter((platform) => platform.activation_status === "live_ready").length,
      blocked_count: missionPlatforms.filter((platform) => platform.activation_status !== "live_ready").length,
      due_count: missionDuePosts.length,
      eligible_count: missionDuePosts.filter((post) => post.eligible).length,
      blocked_due_count: missionDuePosts.filter((post) => !post.eligible).length,
      retryable_count: socialReadiness?.audit.retryable_count || 0,
      next_action: socialReadiness?.next_action || "Loading social auto-post audit.",
    };
  const missionControls = missionControl?.controls || missionFallbackControls;

  return (
    <div className="min-h-screen bg-[#0a0a0b] p-8 text-white">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-orange-400 underline decoration-orange-500/20 underline-offset-8">
            Social Publishing
          </h1>
          <p className="mt-3 text-sm text-gray-500">
            Draft posts, push offers, and track social delivery attempts.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => fetchSocial()}
            className="flex items-center gap-2 rounded-xl bg-white/5 px-4 py-3 font-bold text-white hover:bg-white/10"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 rounded-xl bg-white px-5 py-3 font-bold text-black hover:bg-orange-500 hover:text-white"
          >
            <Plus className="h-4 w-4" /> New Post
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-6 rounded-xl border border-orange-500/20 bg-orange-500/10 px-5 py-3 text-sm text-orange-100">
          {message}
        </div>
      )}

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-4">
        <Metric label="Posts" value={posts.length} icon={Share2} />
        <Metric
          label="Published"
          value={posts.filter((post) => post.status === "published").length}
          icon={CheckCircle2}
        />
        <Metric
          label="Facebook"
          value={providerLabel(providerStatus?.facebook)}
          icon={Share2}
        />
        <Metric
          label="Instagram"
          value={providerLabel(providerStatus?.instagram)}
          icon={Image}
        />
      </div>

      <section
        data-testid="social-autopost-mission-control"
        className="mb-8 rounded-xl border border-sky-500/10 bg-[#111115] p-6"
      >
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-sky-300">
              Social Auto-Post Mission Control
            </p>
            <h2 className="mt-1 text-xl font-black">Due-post gates, Meta provider proof and recovery</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
              One place to see whether Facebook and Instagram can safely auto-publish, which due posts are blocked, and what action clears the next blocker.
            </p>
          </div>
          <span
            className={`rounded-full px-4 py-2 text-xs font-black uppercase ${autoPostActivationClass(
              missionSummary.overall_status
            )}`}
          >
            {autoPostActivationLabel(missionSummary.overall_status)}
          </span>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
          <AutoMetric label="Live Ready" value={missionSummary.live_ready_count} icon={CheckCircle2} />
          <AutoMetric label="Due" value={missionSummary.due_count} icon={Clock} />
          <AutoMetric label="Eligible" value={missionSummary.eligible_count} icon={Send} />
          <AutoMetric label="Blocked" value={missionSummary.blocked_due_count || missionSummary.blocked_count} icon={AlertTriangle} />
          <AutoMetric label="Retryable" value={missionSummary.retryable_count} icon={RefreshCw} />
        </div>

        <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-4">
          {missionControls.map((control) => (
            <div key={`mission-control-${control.label}`} className="rounded-xl border border-white/5 bg-black/25 p-4">
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
          <div className="xl:col-span-7">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {missionPlatforms.map((platformControl) => {
                const Icon = platformControl.platform === "instagram" ? Image : Share2;
                return (
                  <div
                    key={`autopost-platform-${platformControl.platform}`}
                    data-testid={`autopost-platform-${platformControl.platform}`}
                    className="rounded-xl border border-white/5 bg-black/25 p-5"
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-300">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-black">{platformLabels[platformControl.platform]}</p>
                          <p className="mt-1 text-xs font-semibold text-gray-500">
                            {platformControl.provider_status.provider || "checking provider"}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-black uppercase ${autoPostActivationClass(
                          platformControl.activation_status
                        )}`}
                      >
                        {autoPostActivationLabel(platformControl.activation_status)}
                      </span>
                    </div>

                    <div className="mb-4 grid grid-cols-3 gap-2">
                      <Detail label="Due" value={String(platformControl.due_count)} />
                      <Detail label="Eligible" value={String(platformControl.eligible_due_count)} />
                      <Detail label="Blocked" value={String(platformControl.blocked_due_count)} />
                    </div>

                    <div className="space-y-3">
                      <AutoPostProofRow
                        label="Dry-run proof"
                        proof={platformControl.latest_dry_run}
                        empty="Run a dry-run proof for this platform."
                      />
                      <AutoPostProofRow
                        label="Live proof"
                        proof={platformControl.latest_published}
                        empty="No live publish proof recorded yet."
                      />
                      <AutoPostProofRow
                        label="Latest issue"
                        proof={platformControl.latest_issue}
                        empty="No current delivery issue."
                      />
                    </div>

                    <div className="mt-4 rounded-lg border border-white/5 bg-white/[0.03] p-3">
                      <p className="text-xs font-black uppercase tracking-widest text-gray-500">Blockers</p>
                      <p className="mt-2 text-sm font-semibold leading-6 text-gray-400">
                        {platformControl.blockers.length ? platformControl.blockers.join(", ") : "No active blockers."}
                      </p>
                    </div>
                    <p className="mt-4 text-xs font-bold leading-5 text-sky-100">{platformControl.next_action}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div data-testid="autopost-due-lane" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-sky-300">Due-Post Lane</p>
                <h3 className="mt-1 text-lg font-black">Next posts auto-publish will inspect</h3>
              </div>
              <Clock className="h-5 w-5 text-sky-300" />
            </div>
            <div className="space-y-2">
              {missionDuePosts.slice(0, 4).map((post) => (
                <div
                  key={`mission-due-${post.id}`}
                  data-testid={`autopost-due-post-${post.id}`}
                  className="rounded-lg border border-white/5 bg-white/[0.03] p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="font-black text-white">{post.title}</p>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-black uppercase ${
                        post.eligible ? "bg-green-500/15 text-green-300" : "bg-yellow-500/15 text-yellow-300"
                      }`}
                    >
                      {post.eligible ? "eligible" : "blocked"}
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-gray-500">{formatDateTime(post.scheduled_at)}</p>
                  <p className="mt-2 text-sm leading-6 text-gray-400">
                    {post.eligible
                      ? post.platforms.map((platform) => platformLabels[platform]).join(", ")
                      : post.blockers.join(", ")}
                  </p>
                </div>
              ))}
              {!missionDuePosts.length && (
                <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-sm font-semibold text-gray-500">
                  No social posts are due for auto-publish right now.
                </div>
              )}
            </div>
            <p className="mt-4 text-xs font-bold leading-5 text-orange-200">{missionSummary.next_action}</p>
          </div>
        </div>
      </section>

      <section
        data-testid="social-readiness-command"
        className="mb-8 rounded-xl border border-orange-500/10 bg-[#1a1a1c] p-6"
      >
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-orange-400">
              Social Publishing Readiness
            </p>
            <h2 className="mt-1 text-xl font-black">Token setup, schedule blockers and delivery retry audit</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
              Meta tokens stay hidden, but the readiness checks show what is configured, which scheduled posts are blocked and which deliveries can be retried.
            </p>
          </div>
          <span className="rounded-full bg-sky-500/10 px-4 py-2 text-xs font-black uppercase text-sky-200">
            Graph {socialReadiness?.providers.facebook.graph_version || providerStatus?.facebook?.graph_version || "checking"}
          </span>
        </div>

        <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(["facebook", "instagram"] as PlatformKey[]).map((platform) => (
            <SocialProviderCard
              key={`readiness-${platform}`}
              platform={platform}
              status={socialReadiness?.providers?.[platform] || providerStatus?.[platform]}
            />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-7">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-orange-400">Schedule / Retry Queue</p>
                <h3 className="mt-1 text-lg font-black">Due posts and operational blockers</h3>
              </div>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase text-gray-300">
                Every {socialReadiness?.schedule.interval_minutes || autoPublishStatus?.interval_minutes || 5} min
              </span>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <AutoMetric label="Due" value={socialReadiness?.schedule.due_count || 0} icon={Clock} />
              <AutoMetric label="Eligible" value={socialReadiness?.schedule.eligible_count || 0} icon={CheckCircle2} />
              <AutoMetric label="Blocked" value={socialReadiness?.schedule.blocked_count || 0} icon={AlertTriangle} />
              <AutoMetric label="Retryable" value={socialReadiness?.audit.retryable_count || 0} icon={RefreshCw} />
            </div>
            <div className="space-y-2">
              {(socialReadiness?.schedule.due_posts || autoPublishStatus?.due_posts || []).slice(0, 3).map((post) => (
                <div key={`readiness-due-${post.id}`} className="grid grid-cols-1 gap-3 rounded-lg border border-white/5 bg-white/[0.03] p-3 text-sm md:grid-cols-12">
                  <div className="md:col-span-4">
                    <p className="font-black text-white">{post.title}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {post.scheduled_at ? new Date(post.scheduled_at).toLocaleString() : "No schedule"}
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${post.eligible ? "bg-green-500/15 text-green-300" : "bg-yellow-500/15 text-yellow-300"}`}>
                      {post.eligible ? "eligible" : "blocked"}
                    </span>
                  </div>
                  <p className="text-gray-400 md:col-span-6">
                    {post.eligible ? post.platforms.map((platform) => platformLabels[platform]).join(", ") : post.blockers.join(", ")}
                  </p>
                </div>
              ))}
              {!(socialReadiness?.schedule.due_posts || autoPublishStatus?.due_posts || []).length && (
                <div className="rounded-lg border border-dashed border-white/10 p-5 text-center text-sm font-semibold text-gray-500">
                  No scheduled posts are due right now.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-orange-400">Delivery Audit</p>
                <h3 className="mt-1 text-lg font-black">Provider and asset issues</h3>
              </div>
              <AlertTriangle className="h-5 w-5 text-orange-300" />
            </div>
            <div className="mb-4 grid grid-cols-2 gap-3">
              <AutoMetric label="Attempts" value={socialReadiness?.audit.attempted_count || 0} icon={Send} />
              <AutoMetric label="Dry Runs" value={socialReadiness?.audit.dry_run_count || 0} icon={CheckCircle2} />
              <AutoMetric label="Provider" value={socialReadiness?.audit.provider_issue_count || 0} icon={Share2} />
              <AutoMetric label="Assets" value={socialReadiness?.audit.asset_issue_count || 0} icon={Image} />
            </div>
            <div className="space-y-2">
              {(socialReadiness?.checklist || ["Token setup is loading.", "Schedule queue is loading.", "Retry audit is loading."]).map((item) => (
                <div key={item} className="rounded-lg border border-white/5 bg-white/[0.03] p-3 text-sm font-semibold leading-6 text-gray-400">
                  {item}
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs font-bold leading-5 text-orange-200">
              {socialReadiness?.next_action || "Refresh social readiness before publishing."}
            </p>
          </div>
        </div>
      </section>

      <section className="mb-8 rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-black">Auto-Posting Console</h2>
            <p className="mt-1 text-sm text-gray-500">
              Scheduled social posts are checked every {autoPublishStatus?.interval_minutes || 5} minutes and only publish when Meta credentials are ready.
            </p>
          </div>
          <button
            onClick={runAutoPublish}
            disabled={autoPublishing || !autoPublishStatus?.eligible_count}
            title={
              autoPublishStatus?.eligible_count
                ? "Run due social posts now"
                : "No eligible due posts or provider setup is incomplete"
            }
            className="flex items-center gap-2 rounded-xl bg-white px-5 py-3 font-bold text-black hover:bg-orange-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {autoPublishing ? "Running" : "Run Due Posts"}
          </button>
        </div>

        <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <AutoMetric label="Due Posts" value={autoPublishStatus?.due_count || 0} icon={Clock} />
          <AutoMetric label="Eligible" value={autoPublishStatus?.eligible_count || 0} icon={CheckCircle2} />
          <AutoMetric label="Blocked" value={autoPublishStatus?.blocked_count || 0} icon={AlertTriangle} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(["facebook", "instagram"] as PlatformKey[]).map((platform) => (
            <SocialProviderCard
              key={platform}
              platform={platform}
              status={autoPublishStatus?.provider_status?.[platform] || providerStatus?.[platform]}
            />
          ))}
        </div>

        {autoPublishStatus?.due_posts.length ? (
          <div className="mt-5 rounded-xl border border-white/5 bg-black/25 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="font-black">Due Queue</h3>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase text-gray-400">
                {autoPublishStatus.due_posts.length} due
              </span>
            </div>
            <div className="space-y-2">
              {autoPublishStatus.due_posts.slice(0, 4).map((post) => (
                <div key={`auto-${post.id}`} className="grid grid-cols-1 gap-3 rounded-lg border border-white/5 bg-black/30 p-3 text-sm md:grid-cols-12">
                  <div className="md:col-span-4">
                    <p className="font-bold text-white">{post.title}</p>
                    <p className="text-xs text-gray-500">
                      {post.scheduled_at ? new Date(post.scheduled_at).toLocaleString() : "No schedule"}
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${post.eligible ? "bg-green-500/15 text-green-300" : "bg-yellow-500/15 text-yellow-300"}`}>
                      {post.eligible ? "eligible" : "blocked"}
                    </span>
                  </div>
                  <div className="text-gray-400 md:col-span-6">
                    {post.eligible ? post.platforms.map((platform) => platformLabels[platform]).join(", ") : post.blockers.join(", ")}
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
              <h2 className="text-lg font-black">Post Queue</h2>
              <span className="rounded-full bg-black/30 px-3 py-1 text-xs font-black uppercase tracking-widest text-gray-500">
                {posts.length} total
              </span>
            </div>
            <div className="space-y-3">
              {posts.map((post) => (
                <button
                  key={post.id}
                  onClick={() => selectPost(post.id)}
                  className={`w-full rounded-xl border p-4 text-left transition ${
                    selectedId === post.id
                      ? "border-orange-500 bg-orange-500/10"
                      : "border-white/5 bg-black/25 hover:border-white/20"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-black">{post.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-gray-500">{post.message}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${statusClass(post.status)}`}>
                      {post.status}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-400">
                    {post.platforms.map((platform) => (
                      <Pill key={platform} icon={platform === "instagram" ? Image : Share2} value={platformLabels[platform]} />
                    ))}
                    {post.link_url && <Pill icon={LinkIcon} value="Link" />}
                    {post.scheduled_at && <Pill icon={Calendar} value={new Date(post.scheduled_at).toLocaleString()} />}
                  </div>
                </button>
              ))}
              {!posts.length && (
                <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-gray-500">
                  No social posts yet.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="xl:col-span-7">
          <div className="rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
            {selectedPost ? (
              <>
                <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-orange-400">
                      Post #{selectedPost.id} |{" "}
                      {selectedPost.platforms.map((platform) => platformLabels[platform]).join(" + ")}
                    </p>
                    <h2 className="mt-2 text-2xl font-black">{selectedPost.title}</h2>
                    <p className="mt-3 text-sm leading-6 text-gray-300">{selectedPost.message}</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => publishPost(true)}
                      disabled={publishing !== null}
                      className="flex items-center gap-2 rounded-xl bg-white/10 px-5 py-3 font-bold text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Dry Run
                    </button>
                    <button
                      onClick={() => publishPost(false)}
                      disabled={publishing !== null || !canPublishSelected(selectedPost, providerStatus)}
                      title={publishButtonTitle(selectedPost, providerStatus)}
                      className="flex items-center gap-2 rounded-xl bg-white px-5 py-3 font-bold text-black hover:bg-orange-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Send className="h-4 w-4" /> Publish
                    </button>
                    <button
                      data-testid="retry-social-delivery-issues"
                      onClick={retryDeliveryIssues}
                      disabled={retrying || !(history?.retryable_count || 0)}
                      title={history?.retryable_count ? "Retry failed or skipped social delivery issues in dry-run mode" : "No retryable delivery issues"}
                      className="flex items-center gap-2 rounded-xl bg-white/10 px-5 py-3 font-bold text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw className={`h-4 w-4 ${retrying ? "animate-spin" : ""}`} /> Retry Issues
                    </button>
                  </div>
                </div>

                <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Detail label="Status" value={selectedPost.status} />
                  <Detail label="Platforms" value={`${selectedPost.platforms.length}`} />
                  <Detail label="Published" value={`${history?.published_count || 0}`} />
                  <Detail label="Failed" value={`${history?.failed_count || 0}`} />
                </div>

                <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
                  <AutoMetric label="Attempts" value={history?.attempted_count || 0} icon={Send} />
                  <AutoMetric label="Dry Runs" value={history?.dry_run_count || 0} icon={CheckCircle2} />
                  <AutoMetric label="Retryable" value={history?.retryable_count || 0} icon={RefreshCw} />
                  <AutoMetric label="Provider" value={history?.provider_issue_count || 0} icon={Share2} />
                  <AutoMetric label="Assets" value={history?.asset_issue_count || 0} icon={Image} />
                </div>

                <div className="mb-6 rounded-xl border border-white/5 bg-black/25 p-5">
                  <p className="mb-2 text-xs font-black uppercase tracking-widest text-gray-500">
                    Assets
                  </p>
                  <div className="space-y-2 text-sm text-gray-300">
                    <p className="break-all">{selectedPost.link_url || "No link attached"}</p>
                    <p className="break-all">{selectedPost.image_url || "No image URL attached"}</p>
                  </div>
                </div>

                {history?.deliveries.length ? (
                  <div className="rounded-xl border border-white/5 bg-black/25 p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3 className="font-black">Recent Delivery Attempts</h3>
                      <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase text-gray-400">
                        {history.published_count} published / {history.failed_count} failed
                      </span>
                    </div>
                    <div className="space-y-2">
                      {history.deliveries.slice(0, 8).map((delivery) => (
                        <div
                          key={delivery.id}
                          className="grid grid-cols-1 gap-3 rounded-lg border border-white/5 bg-black/30 p-3 text-sm md:grid-cols-12"
                        >
                          <div className="md:col-span-3">
                            <p className="font-bold text-white">{platformLabels[delivery.platform]}</p>
                            <p className="text-xs text-gray-500">{delivery.provider || "No provider"}</p>
                          </div>
                          <div className="md:col-span-2">
                            <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${deliveryStatusClass(delivery.status)}`}>
                              {delivery.status}
                            </span>
                          </div>
                          <div className="text-gray-500 md:col-span-3">
                            {delivery.attempted_at ? new Date(delivery.attempted_at).toLocaleString() : "Not attempted"}
                          </div>
                          <div className="break-all text-gray-400 md:col-span-4">
                            <p>{delivery.external_id || delivery.error || "Ready"}</p>
                            <p className="mt-1 text-xs leading-5 text-gray-600">
                              {delivery.recovery_action || "No recovery action needed."}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-gray-500">
                    No delivery attempts yet.
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 p-12 text-center text-gray-500">
                Select or create a social post.
              </div>
            )}
          </div>
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={savePost}
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-white/10 bg-[#1a1a1c] p-8"
          >
            <div className="mb-6 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xl font-black">
                <Share2 className="h-5 w-5 text-orange-400" /> Social Post
              </h2>
              <button type="button" onClick={() => setShowAdd(false)} className="text-gray-500 hover:text-white">
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input
                label="Title"
                value={formData.title}
                onChange={(value) => setFormData({ ...formData, title: value })}
                required
              />
              <Select
                label="Status"
                value={formData.status}
                options={[
                  { value: "draft", label: "Draft" },
                  { value: "ready", label: "Ready" },
                  { value: "scheduled", label: "Scheduled" },
                ]}
                onChange={(value) => setFormData({ ...formData, status: value as SocialStatus })}
              />
              <Input
                label="Link URL"
                value={formData.link_url}
                onChange={(value) => setFormData({ ...formData, link_url: value })}
              />
              <Input
                label="Image URL"
                value={formData.image_url}
                onChange={(value) => setFormData({ ...formData, image_url: value })}
              />
              <Input
                label="Schedule"
                type="datetime-local"
                value={formData.scheduled_at}
                onChange={(value) => setFormData({ ...formData, scheduled_at: value })}
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
                        formData.platforms.includes(platform)
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
              <span className="text-xs font-black uppercase tracking-widest text-gray-500">Message</span>
              <textarea
                value={formData.message}
                onChange={(event) => setFormData({ ...formData, message: event.target.value })}
                rows={5}
                className="w-full rounded-xl border border-white/10 bg-black/30 p-4 outline-none focus:border-orange-500"
                required
              />
            </label>

            <button className="mt-6 w-full rounded-xl bg-orange-500 py-4 font-black text-white hover:bg-orange-600">
              Save Post
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function providerLabel(status?: ProviderStatus) {
  if (!status) return "Checking";
  return status.configured ? "Ready" : "Setup needed";
}

function fallbackProviderStatus(platform: PlatformKey): ProviderStatus {
  return {
    platform,
    provider: platform === "instagram" ? "meta-instagram" : "meta-facebook",
    enabled: false,
    configured: false,
    unsupported: false,
    missing_settings:
      platform === "instagram"
        ? ["SOCIAL_PUBLISH_ENABLED", "INSTAGRAM_BUSINESS_ACCOUNT_ID", "INSTAGRAM_ACCESS_TOKEN"]
        : ["SOCIAL_PUBLISH_ENABLED", "FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_ACCESS_TOKEN"],
    readiness_label: "Checking setup",
    credential_checks: [],
    content_requirements: missionFallbackControls,
    next_action: `Configure ${platformLabels[platform]} provider settings, then run a dry-run proof.`,
  };
}

function setSelectedPostParam(postId: number) {
  const url = new URL(window.location.href);
  url.searchParams.set("post", String(postId));
  window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
}

function SocialProviderCard({
  platform,
  status,
}: {
  platform: PlatformKey;
  status?: ProviderStatus;
}) {
  const Icon = platform === "instagram" ? Image : Share2;
  const ready = Boolean(status?.configured);
  const credentialChecks = status?.credential_checks || [];
  const contentRequirements = status?.content_requirements || [];

  return (
    <div data-testid={`social-provider-${platform}`} className="rounded-xl border border-white/5 bg-black/25 p-5">
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
            <p className="font-black">{platformLabels[platform]}</p>
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
          {ready ? "Auto-post available" : "Missing setup"}
        </div>
        <p className="text-sm font-semibold leading-6 text-gray-400">
          {ready
            ? `${platformLabels[platform]} can publish through ${status?.provider}.`
            : status?.missing_settings?.join(", ") || "Provider status is loading."}
          {platform === "instagram" ? " Instagram also requires an image URL on each post." : ""}
        </p>
      </div>

      <div className="mt-4 space-y-2">
        {credentialChecks.map((check) => (
          <div key={`${platform}-${check.key}`} className="flex items-center justify-between gap-3 text-xs font-semibold">
            <span className="text-gray-500">{check.label}</span>
            <span className={check.configured ? "text-green-300" : "text-yellow-300"}>
              {check.configured ? "ready" : "missing"}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-white/5 bg-white/[0.03] p-3">
        <p className="text-xs font-black uppercase tracking-widest text-gray-500">Content Requirements</p>
        <div className="mt-3 space-y-2">
          {(contentRequirements.length ? contentRequirements : [{ label: "Provider content checks", status: "loading", detail: "Refresh readiness to load platform requirements." }]).map((requirement) => (
            <div key={`${platform}-${requirement.label}`}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-black text-white">{requirement.label}</p>
                <span className="text-xs font-black uppercase text-sky-300">{requirement.status}</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-gray-500">{requirement.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4 text-xs font-semibold leading-5 text-gray-500">
        {status?.next_action || "Refresh readiness before publishing."}
      </p>
    </div>
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return "No schedule";
  return new Date(value).toLocaleString();
}

function autoPostActivationLabel(status?: AutoPostActivationStatus) {
  if (status === "live_ready") return "Live ready";
  if (status === "partially_ready") return "Partially ready";
  if (status === "setup_needed") return "Setup needed";
  if (status === "credentials_needed") return "Credentials needed";
  if (status === "content_blocked") return "Content blocked";
  if (status === "proof_needed") return "Proof needed";
  if (status === "recovery_needed") return "Recovery needed";
  if (status === "unsupported") return "Unsupported";
  return "Checking";
}

function autoPostActivationClass(status?: AutoPostActivationStatus) {
  if (status === "live_ready") return "bg-green-500/15 text-green-300";
  if (status === "partially_ready" || status === "proof_needed") return "bg-blue-500/15 text-blue-300";
  if (status === "content_blocked" || status === "recovery_needed") return "bg-yellow-500/15 text-yellow-300";
  if (status === "credentials_needed" || status === "setup_needed") return "bg-orange-500/15 text-orange-300";
  if (status === "unsupported") return "bg-red-500/15 text-red-300";
  return "bg-white/10 text-gray-300";
}

function AutoPostProofRow({
  label,
  proof,
  empty,
}: {
  label: string;
  proof?: AutoPostProof | null;
  empty: string;
}) {
  return (
    <div className="rounded-lg border border-white/5 bg-black/30 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-widest text-gray-500">{label}</p>
        {proof ? (
          <span className={`rounded-full px-2 py-1 text-[11px] font-black uppercase ${deliveryStatusClass(proof.status)}`}>
            {proof.status}
          </span>
        ) : (
          <span className="rounded-full bg-white/10 px-2 py-1 text-[11px] font-black uppercase text-gray-400">
            waiting
          </span>
        )}
      </div>
      {proof ? (
        <>
          <p className="text-sm font-semibold leading-6 text-gray-300">
            {proof.provider || platformLabels[proof.platform]} {proof.dry_run ? "dry-run" : "live"} attempt
            {proof.external_id ? ` | ${proof.external_id}` : ""}
          </p>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            {proof.recovery_action || proof.error || proof.issue_reason || formatDateTime(proof.attempted_at)}
          </p>
        </>
      ) : (
        <p className="text-sm font-semibold leading-6 text-gray-500">{empty}</p>
      )}
    </div>
  );
}

function canPublishSelected(post: SocialPost, statuses: Record<PlatformKey, ProviderStatus> | null) {
  if (!statuses) return false;
  return post.platforms.every((platform) => statuses[platform]?.configured);
}

function publishButtonTitle(post: SocialPost | null, statuses: Record<PlatformKey, ProviderStatus> | null) {
  if (!post || !statuses) return "Checking provider status";
  const missing = post.platforms.flatMap((platform) => statuses[platform]?.missing_settings || []);
  return missing.length ? `Missing: ${missing.join(", ")}` : "Publish social post";
}

function statusClass(status: SocialStatus) {
  if (status === "published") return "bg-green-500/15 text-green-300";
  if (status === "failed") return "bg-red-500/15 text-red-300";
  if (status === "scheduled") return "bg-blue-500/15 text-blue-300";
  if (status === "ready") return "bg-orange-500/15 text-orange-300";
  return "bg-white/10 text-gray-300";
}

function deliveryStatusClass(status: SocialDelivery["status"]) {
  if (status === "published") return "bg-green-500/15 text-green-300";
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

function AutoMetric({
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
      <p className="mt-3 text-2xl font-black">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-black/25 p-4">
      <p className="text-xs font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-2 font-black capitalize">{value}</p>
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
