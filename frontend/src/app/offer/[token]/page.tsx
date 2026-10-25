"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Download, Loader2, XCircle } from "lucide-react";
import { getApiUrl } from "@/lib/api";

type Offer = {
  candidate_name: string;
  job_title: string;
  department?: string | null;
  location?: string | null;
  employment_type?: string | null;
  offered_salary?: number | null;
  joining_date?: string | null;
  status: "sent" | "accepted" | "declined" | "expired";
  expires_at?: string | null;
  signed_name?: string | null;
  countersigned_by?: string | null;
  countersigned_at?: string | null;
};

const money = (value: number | null | undefined) =>
  value == null
    ? "As discussed"
    : `Rs ${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })} per month`;

export default function PublicOfferPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token || "";
  const [offer, setOffer] = useState<Offer | null>(null);
  const [error, setError] = useState("");
  const [signedName, setSignedName] = useState("");
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState<"accept" | "decline">("accept");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const response = await fetch(
          getApiUrl(`/api/v1/restaurant/careers/offers/${token}`),
          { cache: "no-store" }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || "Offer could not be loaded.");
        setOffer(data.offer);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Offer could not be loaded.");
      }
    })();
  }, [token]);

  const respond = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/careers/offers/${token}/respond`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, signed_name: signedName, note }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Offer response failed.");
      setMessage(data.message);
      setOffer((current) =>
        current
          ? {
              ...current,
              status: decision === "accept" ? "accepted" : "declined",
              signed_name: signedName,
            }
          : current
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Offer response failed.");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-20">
        <div className="rounded-3xl border border-red-100 bg-white p-8 text-center shadow-sm">
          <XCircle className="mx-auto h-10 w-10 text-red-500" />
          <h1 className="mt-4 text-2xl font-black text-gray-950">Offer unavailable</h1>
          <p className="mt-2 text-sm font-semibold text-gray-500">{error}</p>
        </div>
      </main>
    );
  }

  if (!offer) {
    return (
      <main className="flex min-h-screen items-center justify-center gap-2 text-sm font-bold text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading your offer...
      </main>
    );
  }

  const open = offer.status === "sent";

  return (
    <main className="min-h-screen bg-[#f7f2e9] px-4 py-10 text-[#17130f]">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e64a19] text-sm font-black text-white">
              PB
            </span>
            <div>
              <p className="text-sm font-black tracking-tight">Pizza Blitz</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a7a6a]">
                People team
              </p>
            </div>
          </div>
          <a
            href={getApiUrl(`/api/v1/restaurant/careers/offers/${token}/pdf`)}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#17130f]/15 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest"
          >
            <Download className="h-3.5 w-3.5" /> PDF
          </a>
        </header>

        <section
          data-testid="public-offer"
          className="mt-6 rounded-3xl border border-[#17130f]/10 bg-white p-7 shadow-[0_20px_60px_-40px_rgba(23,19,15,0.6)] md:p-10"
        >
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e64a19]">
            Offer of employment
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">
            {offer.job_title}
          </h1>
          <p className="mt-2 text-sm font-semibold text-[#6d5f52]">
            For {offer.candidate_name}
            {offer.department ? ` · ${offer.department}` : ""}
            {offer.location ? ` · ${offer.location}` : ""}
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-[#faf6ef] p-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-[#8a7a6a]">
                Monthly gross
              </p>
              <p className="mt-1 text-sm font-black">{money(offer.offered_salary)}</p>
            </div>
            <div className="rounded-2xl bg-[#faf6ef] p-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-[#8a7a6a]">
                Joining
              </p>
              <p className="mt-1 text-sm font-black">
                {offer.joining_date
                  ? new Date(offer.joining_date).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })
                  : "To be confirmed"}
              </p>
            </div>
            <div className="rounded-2xl bg-[#faf6ef] p-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-[#8a7a6a]">
                Respond by
              </p>
              <p className="mt-1 text-sm font-black">
                {offer.expires_at
                  ? new Date(offer.expires_at).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })
                  : "—"}
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-2 text-sm font-medium leading-6 text-[#4c4138]">
            <p>
              We are delighted to offer you this role at Pizza Blitz. Your experience and
              approach to hospitality stood out, and we look forward to welcoming you to the
              team.
            </p>
            <p>
              This offer is subject to document verification and completion of onboarding
              formalities. Employment terms, leave, attendance and payroll follow the Pizza
              Blitz people policies shared during onboarding.
            </p>
          </div>

          {offer.countersigned_by && (
            <p className="mt-4 rounded-xl border border-[#17130f]/10 bg-[#faf6ef] px-3 py-2 text-[11px] font-bold text-[#4c4138]">
              Countersigned for Pizza Blitz by {offer.countersigned_by}
              {offer.countersigned_at
                ? ` on ${new Date(offer.countersigned_at).toLocaleDateString("en-IN")}`
                : ""}
              .
            </p>
          )}

          {message && (
            <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
              {message}
            </p>
          )}

          {open ? (
            <form onSubmit={respond} className="mt-7 border-t border-[#17130f]/10 pt-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
                Your response
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDecision("accept")}
                  className={`rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest ${
                    decision === "accept"
                      ? "bg-[#17130f] text-white"
                      : "border border-[#17130f]/15 bg-white"
                  }`}
                >
                  Accept offer
                </button>
                <button
                  type="button"
                  onClick={() => setDecision("decline")}
                  className={`rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest ${
                    decision === "decline"
                      ? "bg-red-600 text-white"
                      : "border border-[#17130f]/15 bg-white"
                  }`}
                >
                  Decline
                </button>
              </div>
              <label className="mt-3 block text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
                Full name (electronic signature)
                <input
                  data-testid="offer-signed-name"
                  value={signedName}
                  onChange={(event) => setSignedName(event.target.value)}
                  required
                  minLength={2}
                  className="mt-1 w-full rounded-xl border border-[#17130f]/15 px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#e64a19]"
                  placeholder="Type your full name"
                />
              </label>
              <label className="mt-3 block text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
                Note (optional)
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-[#17130f]/15 px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#e64a19]"
                  placeholder="Anything the people team should know"
                />
              </label>
              <button
                type="submit"
                data-testid="offer-submit"
                disabled={busy}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#e64a19] px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {decision === "accept" ? "Accept this offer" : "Decline this offer"}
              </button>
            </form>
          ) : (
            <div className="mt-6 rounded-2xl bg-[#faf6ef] px-4 py-3 text-sm font-bold text-[#4c4138]">
              {offer.status === "accepted"
                ? `Offer accepted${offer.signed_name ? ` by ${offer.signed_name}` : ""}. The people team will contact you about onboarding.`
                : offer.status === "declined"
                  ? "This offer was declined. Thank you for your time."
                  : "This offer link has expired. Contact the people team for a new letter."}
            </div>
          )}
        </section>
        <p className="mt-4 text-center text-[10px] font-semibold text-[#8a7a6a]">
          Secure offer link · Do not forward this page
        </p>
      </div>
    </main>
  );
}
