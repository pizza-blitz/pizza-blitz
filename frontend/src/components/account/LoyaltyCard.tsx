"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Gift, Sparkles, Star, TrendingUp } from "lucide-react";

type LoyaltyTransaction = {
  points: number;
  type: string;
  note?: string | null;
  created_at?: string | null;
};

type LoyaltySummary = {
  points_balance: number;
  lifetime_points: number;
  tier: string;
  next_tier?: string | null;
  tier_progress_percent: number;
  points_to_next_tier: number;
  referral_code: string;
  referral_bonus_points: number;
  referrals_made: number;
  transactions: LoyaltyTransaction[];
};

function transactionLabel(type: string) {
  if (type === "earn") return "Points earned";
  if (type === "referral_bonus") return "Referral bonus";
  if (type === "referral_joined") return "Welcome bonus";
  return type.replace(/_/g, " ");
}

export default function LoyaltyCard() {
  const [summary, setSummary] = useState<LoyaltySummary | null>(null);
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/customer-loyalty", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((data) => {
        if (active && data && typeof data.points_balance === "number") {
          setSummary(data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const copyCode = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary.referral_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (isLoading || !summary) return null;

  return (
    <section
      data-testid="loyalty-card"
      className="rounded-xl border border-orange-100 bg-gradient-to-br from-orange-50 to-white p-6 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-orange-700">
            <Sparkles className="h-4 w-4" /> Slice Club
          </p>
          <h2 className="mt-1 text-2xl font-black text-gray-950">
            <span data-testid="loyalty-points">{summary.points_balance}</span> points
          </h2>
          <p className="mt-1 text-sm font-semibold text-gray-500">
            {summary.tier}
            {summary.next_tier
              ? ` · ${summary.points_to_next_tier} points to ${summary.next_tier}`
              : " · top tier"}
          </p>
        </div>
        <div className="rounded-xl bg-white px-4 py-3 text-right shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Lifetime
          </p>
          <p className="mt-0.5 text-xl font-black text-gray-950">
            {summary.lifetime_points}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-gray-400">
          <span>{summary.tier}</span>
          <span>{summary.next_tier || "Top tier"}</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-orange-100">
          <div
            className="h-full rounded-full bg-orange-500"
            style={{ width: `${summary.tier_progress_percent}%` }}
          />
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-orange-100 bg-white p-4">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
            <Gift className="h-3.5 w-3.5 text-orange-600" /> Your referral code
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p
              data-testid="loyalty-referral-code"
              className="text-lg font-black tracking-[0.15em] text-gray-950"
            >
              {summary.referral_code}
            </p>
            <button
              type="button"
              onClick={copyCode}
              aria-label="Copy referral code"
              className="grid h-10 w-10 place-items-center rounded-lg bg-orange-50 text-orange-700 hover:bg-orange-100"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1 text-[11px] font-semibold text-gray-500">
            Friends get {summary.referral_bonus_points} points on their first order — so do you.
          </p>
        </div>
        <div className="rounded-lg border border-orange-100 bg-white p-4">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
            <Star className="h-3.5 w-3.5 text-orange-600" /> Referrals
          </p>
          <p className="mt-2 text-2xl font-black text-gray-950">
            {summary.referrals_made}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-gray-500">
            Earn 1 point for every ₹1 spent when an order is completed.
          </p>
        </div>
      </div>

      {summary.transactions.length > 0 && (
        <div className="mt-5">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
            <TrendingUp className="h-3.5 w-3.5" /> Recent activity
          </p>
          <ul className="mt-2 divide-y divide-orange-100 rounded-lg border border-orange-100 bg-white">
            {summary.transactions.slice(0, 5).map((transaction, index) => (
              <li
                key={`${transaction.type}-${transaction.created_at || index}`}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="font-bold text-gray-800">
                  {transactionLabel(transaction.type)}
                  {transaction.note ? (
                    <span className="ml-2 text-xs font-semibold text-gray-400">
                      {transaction.note}
                    </span>
                  ) : null}
                </span>
                <span className="font-black text-orange-700">+{transaction.points}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
