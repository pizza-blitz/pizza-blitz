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
};

type SocialDelivery = {
  id: number;
  platform: PlatformKey;
  provider?: string | null;
  status: "published" | "dry_run" | "failed" | "skipped" | "pending";
  external_id?: string | null;
  error?: string | null;
  dry_run: boolean;
  attempted_at?: string | null;
};

type DeliveryHistory = {
  attempted_count: number;
  published_count: number;
  dry_run_count: number;
  failed_count: number;
  skipped_count: number;
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

export default function SocialPublishingPage() {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [providerStatus, setProviderStatus] = useState<Record<PlatformKey, ProviderStatus> | null>(null);
  const [autoPublishStatus, setAutoPublishStatus] = useState<AutoPublishStatus | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [history, setHistory] = useState<DeliveryHistory | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [showAdd, setShowAdd] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState<"dry_run" | "publish" | null>(null);
  const [autoPublishing, setAutoPublishing] = useState(false);

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedId) || null,
    [posts, selectedId]
  );

  useEffect(() => {
    fetchSocial();
  }, []);

  const fetchSocial = async () => {
    setLoading(true);
    const [statusResponse, postsResponse, autoResponse] = await Promise.all([
      fetch(`${SOCIAL_API}/provider-status`),
      fetch(`${SOCIAL_API}/posts`),
      fetch(`${SOCIAL_API}/auto-publish/status`),
    ]);
    if (statusResponse.ok) {
      setProviderStatus(await statusResponse.json());
    }
    if (autoResponse.ok) {
      setAutoPublishStatus(await autoResponse.json());
    }
    if (postsResponse.ok) {
      const data: SocialPost[] = await postsResponse.json();
      setPosts(data);
      const nextSelectedId = selectedId || data[0]?.id || null;
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
    const response = await fetch(`${SOCIAL_API}/posts/${postId}/deliveries`);
    if (!response.ok) {
      setHistory(null);
      return;
    }
    setHistory(await response.json());
  };

  const selectPost = (postId: number) => {
    setSelectedId(postId);
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
            onClick={fetchSocial}
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
                  </div>
                </div>

                <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Detail label="Status" value={selectedPost.status} />
                  <Detail label="Platforms" value={`${selectedPost.platforms.length}`} />
                  <Detail label="Published" value={`${history?.published_count || 0}`} />
                  <Detail label="Failed" value={`${history?.failed_count || 0}`} />
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
                            {delivery.external_id || delivery.error || "Ready"}
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

function SocialProviderCard({
  platform,
  status,
}: {
  platform: PlatformKey;
  status?: ProviderStatus;
}) {
  const Icon = platform === "instagram" ? Image : Share2;
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
          {ready ? "Auto-post available" : "Missing setup"}
        </div>
        <p className="text-sm font-semibold leading-6 text-gray-400">
          {ready
            ? `${platformLabels[platform]} can publish through ${status?.provider}.`
            : status?.missing_settings?.join(", ") || "Provider status is loading."}
          {platform === "instagram" ? " Instagram also requires an image URL on each post." : ""}
        </p>
      </div>
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
