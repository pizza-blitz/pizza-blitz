"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import MediaPicker from "@/components/media-picker";
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Film,
  Image as ImageIcon,
  Loader2,
  Plus,
  Send,
  X,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const CALENDAR_API = getApiUrl("/api/v1/restaurant/marketing/calendar");
const SOCIAL_API = getApiUrl("/api/v1/restaurant/social/posts");

type CalendarItem = {
  id: string;
  kind: "social" | "campaign" | "ad";
  channel: string;
  title: string;
  status: string;
  date: string;
  time?: string | null;
  end_date?: string | null;
  route: string;
  reference_id: number;
  platforms: string[];
  media_type?: string | null;
  image_url?: string | null;
  video_url?: string | null;
};
type CalendarPayload = {
  year: number;
  month: number;
  start_date: string;
  end_date: string;
  items: CalendarItem[];
  counts: { social: number; campaigns: number; ads: number };
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const kindTone = (kind: string) => {
  if (kind === "social") return "bg-orange-100 text-orange-800 border-orange-200";
  if (kind === "campaign") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  return "bg-sky-100 text-sky-800 border-sky-200";
};

const kindIcon = (item: CalendarItem) => {
  if (item.kind === "ad") return Send;
  if (item.media_type === "reel" || item.media_type === "video") return Film;
  if (item.kind === "campaign") return CalendarDays;
  return ImageIcon;
};

export default function MarketingHubPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [payload, setPayload] = useState<CalendarPayload | null>(null);
  const [filter, setFilter] = useState<"all" | "social" | "campaign" | "ad">("all");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    message: "",
    media_type: "reel",
    image_url: "",
    video_url: "",
    scheduled_at: "",
    platforms: ["instagram"],
  });

  const load = async (targetYear = year, targetMonth = month) => {
    setLoading(true);
    try {
      const response = await fetch(`${CALENDAR_API}?year=${targetYear}&month=${targetMonth}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Calendar failed to load.");
      setPayload(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Calendar failed to load.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setHydrated(true);
    void load();
  }, []);

  const changeMonth = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1);
    const nextYear = next.getFullYear();
    const nextMonth = next.getMonth() + 1;
    setYear(nextYear);
    setMonth(nextMonth);
    void load(nextYear, nextMonth);
  };

  const items = useMemo(() => {
    if (!payload) return [];
    return filter === "all"
      ? payload.items
      : payload.items.filter((item) => item.kind === filter);
  }, [payload, filter]);

  const firstWeekday = new Date(year, month - 1, 1).getDay(); // Sunday = 0
  const leading = (firstWeekday + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells = Array.from({ length: leading + daysInMonth }, (_, index) =>
    index < leading ? null : index - leading + 1
  );

  const composerValid =
    draft.title.trim() &&
    draft.message.trim() &&
    (draft.media_type === "image"
      ? Boolean(draft.image_url)
      : Boolean(draft.video_url)) &&
    draft.scheduled_at;

  const createPost = async () => {
    if (!composerValid) {
      setMessage("Add a title, copy, creative and schedule.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(SOCIAL_API, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          message: draft.message,
          media_type: draft.media_type,
          image_url: draft.media_type === "image" ? draft.image_url : null,
          cover_image_url: draft.media_type === "image" ? null : draft.image_url || null,
          video_url: draft.media_type === "image" ? null : draft.video_url,
          platforms: draft.platforms,
          status: "scheduled",
          scheduled_at: new Date(draft.scheduled_at).toISOString(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Content could not be scheduled.");
      setShowComposer(false);
      setDraft({
        title: "",
        message: "",
        media_type: "reel",
        image_url: "",
        video_url: "",
        scheduled_at: "",
        platforms: ["instagram"],
      });
      await load();
      setMessage(`Scheduled ${data.post.title} for ${new Date(data.post.scheduled_at).toLocaleString("en-IN")}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Content could not be scheduled.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="marketing-hub-page"
      data-hydrated={hydrated ? "true" : "false"}
      className="space-y-5 animate-in fade-in duration-300"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
            Marketing · calendar
          </p>
          <h1 className="text-3xl font-black text-gray-950">Marketing Hub</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            One calendar for social posts, reels, campaigns and ads. Schedule a reel, see the
            month at a glance, then open the owning module.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowComposer(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600"
          >
            <Plus className="h-4 w-4" /> Schedule content
          </button>
        </div>
      </div>

      {message && (
        <p className="rounded-xl border border-gray-100 bg-white px-4 py-3 text-xs font-bold text-gray-700">
          {message}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => changeMonth(-1)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-gray-200 text-gray-500"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="min-w-[170px] text-center text-lg font-black text-gray-900">
            {MONTHS[month - 1]} {year}
          </h2>
          <button
            type="button"
            onClick={() => changeMonth(1)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-gray-200 text-gray-500"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            ["all", "All"],
            ["social", "Social"],
            ["campaign", "Campaigns"],
            ["ad", "Ads"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value as typeof filter)}
              className={`rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-widest ${
                filter === value
                  ? "bg-gray-950 text-white"
                  : "border border-gray-200 text-gray-600"
              }`}
            >
              {label}
            </button>
          ))}
          <span className="ml-2 self-center text-[10px] font-bold text-gray-400">
            {payload?.counts.social || 0} social · {payload?.counts.campaigns || 0} campaigns ·{" "}
            {payload?.counts.ads || 0} ads
          </span>
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
        <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="px-2 py-2 text-center text-[9px] font-black uppercase tracking-widest text-gray-400"
            >
              {day}
            </div>
          ))}
        </div>
        {loading ? (
          <div className="flex items-center gap-2 p-10 text-sm font-bold text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading calendar...
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {cells.map((day, index) => {
              const dateKey = day
                ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
                : "";
              const dayItems = day
                ? items.filter((item) => item.date === dateKey)
                : [];
              const isToday =
                day === now.getDate() &&
                month === now.getMonth() + 1 &&
                year === now.getFullYear();
              return (
                <div
                  key={`${day ?? "blank"}-${index}`}
                  data-testid={day ? `marketing-day-${dateKey}` : undefined}
                  className={`min-h-[110px] border-b border-r border-gray-50 p-1.5 ${
                    day ? "bg-white" : "bg-gray-50/60"
                  }`}
                >
                  {day && (
                    <>
                      <span
                        className={`inline-grid h-6 w-6 place-items-center rounded-full text-[10px] font-black ${
                          isToday ? "bg-orange-600 text-white" : "text-gray-400"
                        }`}
                      >
                        {day}
                      </span>
                      <div className="mt-1 space-y-1">
                        {dayItems.slice(0, 3).map((item) => {
                          const Icon = kindIcon(item);
                          return (
                            <Link
                              key={item.id}
                              href={item.route}
                              data-testid={`marketing-item-${item.id}`}
                              className={`block truncate rounded-md border px-1.5 py-1 text-[9px] font-bold ${kindTone(item.kind)}`}
                              title={`${item.kind} · ${item.title} · ${item.status}`}
                            >
                              <span className="inline-flex items-center gap-1">
                                <Icon className="h-2.5 w-2.5" />
                                {item.title}
                              </span>
                            </Link>
                          );
                        })}
                        {dayItems.length > 3 && (
                          <p className="pl-1 text-[8px] font-bold text-gray-400">
                            +{dayItems.length - 3} more
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-gray-100 bg-white p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
            Upcoming this month
          </p>
          <div className="mt-3 space-y-2">
            {items.length === 0 ? (
              <p className="text-sm font-semibold text-gray-400">Nothing scheduled.</p>
            ) : (
              items.slice(0, 8).map((item) => {
                const Icon = kindIcon(item);
                return (
                  <Link
                    key={item.id}
                    href={item.route}
                    className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 hover:border-orange-200"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0 text-orange-600" />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-black text-gray-800">
                          {item.title}
                        </span>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">
                          {item.kind} · {item.status} · {item.date}
                        </span>
                      </span>
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-gray-300" />
                  </Link>
                );
              })
            )}
          </div>
        </section>
        <section className="rounded-2xl border border-gray-100 bg-white p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
            Channel shortcuts
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {[
              ["Social publishing", "/social", "Image, video and reel posts"],
              ["Campaigns", "/promotions", "Coupons and send queues"],
              ["Ad campaigns", "/ads", "Budgets, pacing and launch"],
              ["Journeys", "/journeys", "Triggered lifecycle flows"],
            ].map(([label, href, detail]) => (
              <Link
                key={href}
                href={href}
                className="rounded-xl border border-gray-100 p-3 hover:border-orange-200"
              >
                <p className="text-xs font-black text-gray-800">{label}</p>
                <p className="mt-0.5 text-[10px] font-semibold text-gray-400">{detail}</p>
              </Link>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Calendar items are read from the owning modules; publishing still uses provider
            readiness.
          </div>
        </section>
      </div>

      {showComposer && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-orange-600">
                  Schedule content
                </p>
                <h2 className="text-2xl font-black text-gray-950">Reel or post</h2>
              </div>
              <button
                type="button"
                aria-label="Close composer"
                onClick={() => setShowComposer(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500">
                Title
                <input
                  data-testid="marketing-title"
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                />
              </label>
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500">
                Caption
                <textarea
                  data-testid="marketing-message"
                  rows={3}
                  value={draft.message}
                  onChange={(event) => setDraft({ ...draft, message: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  Type
                  <select
                    data-testid="marketing-media-type"
                    value={draft.media_type}
                    onChange={(event) =>
                      setDraft({ ...draft, media_type: event.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                  >
                    <option value="reel">Instagram reel</option>
                    <option value="video">Video post</option>
                    <option value="image">Image post</option>
                  </select>
                </label>
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  Schedule
                  <input
                    data-testid="marketing-schedule"
                    type="datetime-local"
                    value={draft.scheduled_at}
                    onChange={(event) =>
                      setDraft({ ...draft, scheduled_at: event.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                  />
                </label>
              </div>
              {draft.media_type === "image" ? (
                <MediaPicker
                  label="Post image"
                  value={draft.image_url}
                  onChange={(url) => setDraft({ ...draft, image_url: url })}
                  testId="marketing-image"
                  helpText="Pick an image from Media Studio."
                />
              ) : (
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500">
                  Public video URL
                  <input
                    data-testid="marketing-video-url"
                    value={draft.video_url}
                    onChange={(event) => setDraft({ ...draft, video_url: event.target.value })}
                    placeholder="https://cdn.example.com/reel.mp4"
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                  />
                </label>
              )}
              {draft.media_type !== "image" && (
                <MediaPicker
                  label="Reel cover"
                  value={draft.image_url}
                  onChange={(url) => setDraft({ ...draft, image_url: url })}
                  testId="marketing-cover"
                  helpText="Optional Instagram cover image."
                />
              )}
              <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
                Platforms
                <select
                  value={draft.platforms[0] || "instagram"}
                  onChange={(event) =>
                    setDraft({ ...draft, platforms: [event.target.value] })
                  }
                  className="rounded-lg border border-gray-200 px-2 py-1 text-[10px] font-bold text-gray-700"
                >
                  <option value="instagram">Instagram</option>
                  <option value="facebook">Facebook</option>
                </select>
              </label>
              <button
                type="button"
                data-testid="marketing-create"
                onClick={() => void createPost()}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Schedule content
              </button>
              <p className="text-[10px] font-semibold text-gray-400">
                Publishing still depends on Settings → Providers. A scheduled post is visible
                on the calendar immediately.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
