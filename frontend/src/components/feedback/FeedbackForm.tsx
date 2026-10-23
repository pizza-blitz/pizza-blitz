"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Star } from "lucide-react";
import { getApiUrl } from "@/lib/api";

const TAGS = ["Fast delivery", "Hot food", "Great value", "Friendly staff"];

export default function FeedbackForm({
  orderId,
  phone,
}: {
  orderId: number;
  phone: string;
}) {
  const [existing, setExisting] = useState<{ rating: number } | null>(null);
  const [rating, setRating] = useState(0);
  const [nps, setNps] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch(
      getApiUrl(
        `/api/v1/restaurant/feedback/${orderId}?phone=${encodeURIComponent(phone)}`
      ),
      { cache: "no-store" }
    )
      .then(async (response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active && data) setExisting(data);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orderId, phone]);

  const submit = async () => {
    if (rating < 1 || nps === null) {
      setMessage("Choose a star rating and a 0–10 score.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/feedback/${orderId}`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone,
            rating,
            nps,
            comment: comment.trim() || null,
            tags,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Feedback could not be saved.");
      setExisting({ rating: data.rating });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Feedback could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return null;
  if (existing) {
    return (
      <div
        data-testid="feedback-thanks"
        className="mt-5 rounded-lg border border-emerald-100 bg-emerald-50 p-4 text-center"
      >
        <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600" />
        <p className="mt-2 text-sm font-black text-emerald-900">
          Thanks for rating this order {existing.rating}/5
        </p>
        <p className="text-xs font-semibold text-emerald-800">
          Your feedback helps the kitchen and delivery team improve.
        </p>
      </div>
    );
  }

  return (
    <section
      data-testid="feedback-form"
      className="mt-5 rounded-lg border border-slate-200 bg-white p-4"
    >
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
        Rate this order
      </p>
      <div className="mt-2 flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            data-testid={`feedback-rating-${star}`}
            aria-label={`${star} star rating`}
            onClick={() => setRating(star)}
            className={star <= rating ? "text-amber-500" : "text-gray-300"}
          >
            <Star className="h-7 w-7" fill={star <= rating ? "currentColor" : "none"} />
          </button>
        ))}
      </div>

      <p className="mt-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
        How likely are you to recommend Pizza Blitz?
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {Array.from({ length: 11 }, (_, index) => index).map((score) => (
          <button
            key={score}
            type="button"
            data-testid={`feedback-nps-${score}`}
            onClick={() => setNps(score)}
            className={`h-9 w-9 rounded-lg border text-xs font-black ${
              nps === score
                ? "border-orange-600 bg-orange-600 text-white"
                : "border-gray-200 text-gray-600"
            }`}
          >
            {score}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {TAGS.map((tag) => {
          const active = tags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              onClick={() =>
                setTags((current) =>
                  active ? current.filter((entry) => entry !== tag) : [...current, tag]
                )
              }
              className={`rounded-full border px-3 py-1.5 text-[10px] font-black ${
                active
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-gray-200 text-gray-500"
              }`}
            >
              {tag}
            </button>
          );
        })}
      </div>

      <textarea
        data-testid="feedback-comment"
        aria-label="Feedback comment"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Anything we should know? (optional)"
        rows={2}
        className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
      />

      {message && (
        <p className="mt-2 text-xs font-bold text-red-700">{message}</p>
      )}

      <button
        type="button"
        data-testid="feedback-submit"
        onClick={submit}
        disabled={busy}
        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600 disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CheckCircle2 className="h-4 w-4" />
        )}
        Submit feedback
      </button>
    </section>
  );
}
