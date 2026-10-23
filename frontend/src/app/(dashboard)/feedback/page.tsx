"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  MessageSquareHeart,
  Star,
  ThumbsUp,
  Users,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type Feedback = {
  order_id: number;
  rating: number;
  nps: number;
  comment?: string | null;
  tags: string[];
  created_at?: string | null;
};

type Summary = {
  days: number;
  feedback_count: number;
  eligible_orders: number;
  response_rate: number;
  nps: number;
  promoters: number;
  detractors: number;
  average_rating: number;
  rating_distribution: Record<string, number>;
  top_tags: { tag: string; count: number }[];
  recent: Feedback[];
  low_ratings: Feedback[];
};

export default function FeedbackPage() {
  const [data, setData] = useState<Summary | null>(null);
  const [days, setDays] = useState(30);
  const [message, setMessage] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    void (async () => {
      try {
        const response = await fetch(
          getApiUrl(`/api/v1/restaurant/feedback/summary?days=${days}`),
          { credentials: "include", cache: "no-store" }
        );
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || "Feedback failed to load.");
        setData(payload);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Feedback failed to load.");
      }
    })();
  }, [days]);

  const maxRating = data
    ? Math.max(1, ...Object.values(data.rating_distribution))
    : 1;

  return (
    <div
      data-testid="feedback-page"
      data-hydrated={hydrated ? "true" : "false"}
      className="space-y-6 animate-in fade-in duration-300"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
            <MessageSquareHeart className="h-4 w-4" /> Customer voice
          </p>
          <h1 className="mt-1 text-3xl font-black text-gray-950">Feedback & NPS</h1>
          <p className="mt-1 text-sm text-gray-500">
            Post-order ratings, recommendation scores and what guests are saying.
          </p>
        </div>
        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
          Window
          <select
            aria-label="Feedback window"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="mt-1 block rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-gray-900"
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
      </div>

      {message && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {message}
        </div>
      )}

      {!data ? (
        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white p-6 text-sm font-bold text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading feedback...
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-gray-100 bg-white p-4">
              <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400">
                <ThumbsUp className="h-3.5 w-3.5" /> NPS
              </p>
              <p
                data-testid="feedback-nps-score"
                className={`mt-1 text-3xl font-black ${
                  data.nps >= 50
                    ? "text-emerald-700"
                    : data.nps >= 0
                      ? "text-amber-700"
                      : "text-red-700"
                }`}
              >
                {data.nps}
              </p>
              <p className="mt-1 text-[11px] font-semibold text-gray-500">
                {data.promoters} promoters · {data.detractors} detractors
              </p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4">
              <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400">
                <Star className="h-3.5 w-3.5" /> Avg rating
              </p>
              <p className="mt-1 text-3xl font-black text-gray-950">
                {data.average_rating}
                <span className="text-base text-gray-400">/5</span>
              </p>
              <p className="mt-1 text-[11px] font-semibold text-gray-500">
                {data.feedback_count} responses
              </p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4">
              <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400">
                <Users className="h-3.5 w-3.5" /> Response rate
              </p>
              <p className="mt-1 text-3xl font-black text-gray-950">
                {data.response_rate}%
              </p>
              <p className="mt-1 text-[11px] font-semibold text-gray-500">
                {data.eligible_orders} completed orders
              </p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4">
              <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400">
                <AlertTriangle className="h-3.5 w-3.5" /> Low ratings
              </p>
              <p className="mt-1 text-3xl font-black text-red-700">
                {data.low_ratings.length}
              </p>
              <p className="mt-1 text-[11px] font-semibold text-gray-500">
                1–3 stars to follow up
              </p>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-100 bg-white p-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Rating distribution
              </p>
              <div className="mt-3 space-y-2">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = data.rating_distribution[String(star)] || 0;
                  return (
                    <div key={star} className="flex items-center gap-2">
                      <span className="w-10 text-xs font-black text-gray-600">
                        {star}★
                      </span>
                      <div className="h-3 flex-1 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-amber-400"
                          style={{ width: `${(count / maxRating) * 100}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-xs font-bold text-gray-500">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                What guests mention
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {data.top_tags.length ? (
                  data.top_tags.map((tag) => (
                    <span
                      key={tag.tag}
                      className="rounded-full bg-orange-50 px-3 py-1.5 text-xs font-black text-orange-800"
                    >
                      {tag.tag} · {tag.count}
                    </span>
                  ))
                ) : (
                  <p className="text-sm font-semibold text-gray-400">
                    No tags yet. Guests can tag fast delivery, hot food, value and staff.
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-gray-100 bg-white p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Recent feedback
            </p>
            {data.recent.length ? (
              <ul className="mt-3 divide-y divide-gray-100">
                {data.recent.map((row) => (
                  <li key={row.order_id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-black text-gray-900">
                        Order #{row.order_id} · {row.rating}★ · NPS {row.nps}
                      </p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                        {row.created_at
                          ? new Date(row.created_at).toLocaleDateString()
                          : ""}
                      </p>
                    </div>
                    {row.comment && (
                      <p className="mt-1 text-sm font-semibold text-gray-600">
                        “{row.comment}”
                      </p>
                    )}
                    {row.tags.length > 0 && (
                      <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-orange-700">
                        {row.tags.join(" · ")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 rounded-lg border border-dashed border-gray-200 px-3 py-6 text-center text-sm font-semibold text-gray-400">
                No feedback in this window.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
