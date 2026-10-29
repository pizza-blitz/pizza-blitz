"use client";

import { useEffect, useState } from "react";
import {
  Ban,
  Check,
  Copy,
  Gift,
  Loader2,
  Plus,
  RotateCw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";
import {
  DepartmentToolShell,
  EmptyState,
  ErrorNote,
  LoadingRow,
  Panel,
  StatCard,
  StatusBadge,
  formatDate,
  formatMoney,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  todayIso,
} from "@/components/department-tools";

type GiftCard = {
  id: number;
  code: string;
  initial_balance: number;
  balance: number;
  currency: string;
  status: string;
  stored_status?: string | null;
  customer_phone?: string | null;
  note?: string | null;
  issued_by?: string | null;
  issued_at?: string | null;
  expires_on?: string | null;
  created_at?: string | null;
};

type GiftCardSummary = {
  active_cards: number;
  outstanding_balance: number;
  issued_value_this_month: number;
  redeemed_this_month: number;
  expired_cards: number;
};

type GiftCardTransaction = {
  id: number;
  gift_card_id: number;
  order_id?: number | null;
  kind: string;
  amount: number;
  balance_after: number;
  reference?: string | null;
  note?: string | null;
  created_by?: string | null;
  created_at?: string | null;
};

type GiftCardDetail = {
  card: GiftCard;
  transactions: GiftCardTransaction[];
};

type GiftCardValidation = {
  valid: boolean;
  code: string;
  balance: number;
  status: string;
  expires_on?: string | null;
  message?: string | null;
};

type GiftCardListResponse = {
  items: GiftCard[];
  summary: GiftCardSummary | null;
};

type GiftCardCreateResponse = GiftCard & { card?: GiftCard };

const EMPTY_ISSUE_FORM = {
  initial_balance: "",
  customer_phone: "",
  note: "",
  expires_on: "",
};

function errorDetail(payload: unknown, fallback: string) {
  if (typeof payload === "object" && payload !== null) {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return fallback;
}

export default function GiftCardsPage() {
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [summary, setSummary] = useState<GiftCardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [issueForm, setIssueForm] = useState(EMPTY_ISSUE_FORM);
  const [issuing, setIssuing] = useState(false);
  const [issuedCard, setIssuedCard] = useState<GiftCard | null>(null);
  const [copied, setCopied] = useState(false);

  const [activeCard, setActiveCard] = useState<GiftCard | null>(null);
  const [detail, setDetail] = useState<GiftCardDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailNotice, setDetailNotice] = useState("");
  const [reloadForm, setReloadForm] = useState({ amount: "", note: "" });
  const [reloadBusy, setReloadBusy] = useState(false);
  const [voidNote, setVoidNote] = useState("");
  const [voidBusy, setVoidBusy] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<number | null>(null);

  const [checkCode, setCheckCode] = useState("");
  const [checkResult, setCheckResult] = useState<GiftCardValidation | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");

  const load = async () => {
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (query.trim()) params.set("query", query.trim());
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/gift-cards?${params.toString()}`),
        { credentials: "include", cache: "no-store" }
      );
      const data: unknown = await response.json();
      if (!response.ok) {
        throw new Error(errorDetail(data, "Gift cards failed to load."));
      }
      const payload = data as GiftCardListResponse;
      setCards(payload.items ?? []);
      setSummary(payload.summary ?? null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Gift cards failed to load."
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // The status filter is the only server-side filter that applies immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const copyCode = async (code: string) => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard is unavailable.");
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setError("Could not copy the code. Copy it manually before sharing.");
    }
  };

  const issueCard = async () => {
    const amount = Number(issueForm.initial_balance);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a gift card amount greater than zero.");
      return;
    }
    setIssuing(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(getApiUrl("/api/v1/restaurant/gift-cards"), {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initial_balance: amount,
          customer_phone: issueForm.customer_phone.trim() || null,
          note: issueForm.note.trim() || null,
          expires_on: issueForm.expires_on || null,
        }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        throw new Error(errorDetail(data, "The gift card could not be issued."));
      }
      const payload = data as GiftCardCreateResponse;
      const created = payload.card ?? payload;
      if (!created.code) {
        throw new Error("The gift card was created but no code was returned.");
      }
      setIssuedCard(created);
      setCopied(false);
      setIssueForm(EMPTY_ISSUE_FORM);
      setMessage("Gift card issued. Share the code below with the customer.");
      await load();
    } catch (issueError) {
      setError(
        issueError instanceof Error
          ? issueError.message
          : "The gift card could not be issued."
      );
    } finally {
      setIssuing(false);
    }
  };

  const fetchDetail = async (id: number) => {
    setDetailLoading(true);
    setDetailError("");
    try {
      const response = await fetch(getApiUrl(`/api/v1/restaurant/gift-cards/${id}`), {
        credentials: "include",
        cache: "no-store",
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        throw new Error(errorDetail(data, "Gift card detail failed to load."));
      }
      setDetail(data as GiftCardDetail);
      setReloadForm({ amount: "", note: "" });
      setVoidNote("");
    } catch (loadError) {
      setDetailError(
        loadError instanceof Error
          ? loadError.message
          : "Gift card detail failed to load."
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const openDetail = (card: GiftCard) => {
    setActiveCard(card);
    setDetail(null);
    setDetailNotice("");
    setDetailError("");
    setVoidNote("");
    void fetchDetail(card.id);
  };

  const closeDetail = () => {
    setActiveCard(null);
    setDetail(null);
    setDetailError("");
    setDetailNotice("");
  };

  const reloadCard = async () => {
    if (!activeCard) return;
    const amount = Number(reloadForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setDetailError("Enter a reload amount greater than zero.");
      return;
    }
    setReloadBusy(true);
    setDetailError("");
    setDetailNotice("");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/gift-cards/${activeCard.id}/reload`),
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount,
            note: reloadForm.note.trim() || null,
          }),
        }
      );
      const data: unknown = await response.json();
      if (!response.ok) {
        throw new Error(errorDetail(data, "The card could not be reloaded."));
      }
      await Promise.all([fetchDetail(activeCard.id), load()]);
      setDetailNotice("Balance reloaded.");
    } catch (reloadError) {
      setDetailError(
        reloadError instanceof Error
          ? reloadError.message
          : "The card could not be reloaded."
      );
    } finally {
      setReloadBusy(false);
    }
  };

  const voidCard = async (card: GiftCard, note: string) => {
    if (
      !window.confirm(
        `Void gift card ${card.code}? The remaining balance will no longer be redeemable.`
      )
    ) {
      return;
    }
    setRowBusyId(card.id);
    setVoidBusy(true);
    setError("");
    setDetailError("");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/gift-cards/${card.id}/void`),
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: note.trim() || null }),
        }
      );
      const data: unknown = await response.json();
      if (!response.ok) {
        throw new Error(errorDetail(data, "The gift card could not be voided."));
      }
      setMessage(`Gift card ${card.code} voided.`);
      setVoidNote("");
      await load();
      if (activeCard?.id === card.id) {
        await fetchDetail(card.id);
        setDetailNotice("Gift card voided.");
      }
    } catch (voidError) {
      const text =
        voidError instanceof Error
          ? voidError.message
          : "The gift card could not be voided.";
      setError(text);
      setDetailError(text);
    } finally {
      setRowBusyId(null);
      setVoidBusy(false);
    }
  };

  const checkGiftCard = async () => {
    const code = checkCode.trim();
    if (!code) {
      setCheckError("Enter a gift card code to check.");
      return;
    }
    setChecking(true);
    setCheckError("");
    setCheckResult(null);
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/gift-cards/public/validate/${encodeURIComponent(code)}`),
        { credentials: "include", cache: "no-store" }
      );
      const data: unknown = await response.json();
      if (!response.ok) {
        throw new Error(errorDetail(data, "The card could not be checked."));
      }
      setCheckResult(data as GiftCardValidation);
    } catch (checkLoadError) {
      setCheckError(
        checkLoadError instanceof Error
          ? checkLoadError.message
          : "The card could not be checked."
      );
    } finally {
      setChecking(false);
    }
  };

  const openCard = detail?.card ?? activeCard;

  return (
    <DepartmentToolShell
      departmentKey="revenue"
      departmentLabel="Revenue"
      title="Loyalty & gift cards"
      subtitle="Issue stored-value gift cards, track outstanding balances and validate bearer codes without guessing at the register."
    >
      <div data-testid="gift-cards-page" className="space-y-5">
        <ErrorNote message={error} />

        {message ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            {message}
          </div>
        ) : null}

        {issuedCard ? (
          <section
            data-testid="gift-card-issued"
            className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-white p-2 text-emerald-700">
                  <Gift className="h-5 w-5" />
                </span>
                <div>
                  <p className={labelClass}>Gift card issued</p>
                  <p
                    data-testid="gift-card-code"
                    className="mt-1 font-mono text-2xl font-black tracking-[0.18em] text-emerald-950"
                  >
                    {issuedCard.code}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-emerald-800">
                    {formatMoney(issuedCard.balance)} available
                    {issuedCard.expires_on
                      ? ` · expires ${formatDate(issuedCard.expires_on)}`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="gift-card-copy"
                  onClick={() => void copyCode(issuedCard.code)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-900 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-emerald-800"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy code"}
                </button>
                <button
                  type="button"
                  aria-label="Dismiss issued gift card"
                  onClick={() => setIssuedCard(null)}
                  className="rounded-lg p-1.5 text-emerald-700 hover:bg-emerald-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <p className="mt-3 flex items-start gap-2 text-[11px] font-semibold text-emerald-900">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              The code is the bearer value. Anyone holding it can spend the balance, so share it
              only with the customer.
            </p>
          </section>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Active cards"
            value={summary?.active_cards ?? 0}
            hint={`${summary?.expired_cards ?? 0} expired`}
            tone="good"
          />
          <StatCard
            label="Outstanding balance"
            value={formatMoney(summary?.outstanding_balance ?? 0)}
            hint="Liability across live cards"
          />
          <StatCard
            label="Issued this month"
            value={formatMoney(summary?.issued_value_this_month ?? 0)}
          />
          <StatCard
            label="Redeemed this month"
            value={formatMoney(summary?.redeemed_this_month ?? 0)}
            tone="info"
          />
        </section>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Panel
              title="Issue gift card"
              description="The generated code is the only bearer credential. There is no PIN."
            >
              <form
                data-testid="gift-card-issue-form"
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void issueCard();
                }}
              >
                <label className={labelClass}>
                  Amount (₹)
                  <input
                    data-testid="gift-card-amount"
                    type="number"
                    min="1"
                    step="0.01"
                    required
                    value={issueForm.initial_balance}
                    onChange={(event) =>
                      setIssueForm({ ...issueForm, initial_balance: event.target.value })
                    }
                    placeholder="1000"
                    className={`mt-1 ${inputClass}`}
                  />
                </label>
                <label className={labelClass}>
                  Customer phone
                  <input
                    data-testid="gift-card-phone"
                    type="tel"
                    value={issueForm.customer_phone}
                    onChange={(event) =>
                      setIssueForm({ ...issueForm, customer_phone: event.target.value })
                    }
                    placeholder="Optional contact number"
                    className={`mt-1 ${inputClass}`}
                  />
                </label>
                <label className={labelClass}>
                  Expiry date
                  <input
                    data-testid="gift-card-expiry"
                    type="date"
                    min={todayIso()}
                    value={issueForm.expires_on}
                    onChange={(event) =>
                      setIssueForm({ ...issueForm, expires_on: event.target.value })
                    }
                    className={`mt-1 ${inputClass}`}
                  />
                </label>
                <label className={labelClass}>
                  Note
                  <input
                    data-testid="gift-card-note"
                    value={issueForm.note}
                    onChange={(event) =>
                      setIssueForm({ ...issueForm, note: event.target.value })
                    }
                    placeholder="Occasion, campaign or reference"
                    className={`mt-1 ${inputClass}`}
                  />
                </label>
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    data-testid="gift-card-issue"
                    disabled={issuing}
                    className={`inline-flex items-center gap-2 ${primaryButtonClass}`}
                  >
                    {issuing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Issue gift card
                  </button>
                </div>
              </form>
            </Panel>
          </div>

          <Panel
            title="Check a card"
            description="Public balance lookup. This does not redeem or change the card."
          >
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void checkGiftCard();
              }}
            >
              <input
                data-testid="gift-card-check-code"
                aria-label="Gift card code to check"
                value={checkCode}
                onChange={(event) => setCheckCode(event.target.value)}
                placeholder="GC-XXXX-XXXX"
                className={`${inputClass} font-mono uppercase`}
              />
              <button type="submit" disabled={checking} className={primaryButtonClass}>
                {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
              </button>
            </form>
            <div className="mt-3">
              <ErrorNote message={checkError} />
            </div>
            {checkResult ? (
              <div
                data-testid="gift-card-validate-result"
                className={`mt-3 rounded-xl border p-3 ${
                  checkResult.valid
                    ? "border-emerald-100 bg-emerald-50"
                    : "border-amber-100 bg-amber-50"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs font-black text-gray-800">
                    {checkResult.code}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <StatusBadge label={checkResult.valid ? "valid" : "invalid"} />
                    <StatusBadge label={checkResult.status} />
                  </div>
                </div>
                <p className="mt-2 text-xl font-black text-gray-950">
                  {formatMoney(checkResult.balance)}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  Balance
                  {checkResult.expires_on
                    ? ` · expires ${formatDate(checkResult.expires_on)}`
                    : ""}
                </p>
                {checkResult.message ? (
                  <p className="mt-2 text-xs font-semibold text-gray-600">
                    {checkResult.message}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-[11px] font-semibold text-gray-400">
                Enter a code to see its live balance and status.
              </p>
            )}
          </Panel>
        </div>

        <Panel
          title="Gift card register"
          description="Search by code or customer phone. Balances always come from the card ledger."
        >
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                aria-label="Search gift cards by code or phone"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void load();
                }}
                placeholder="Search code or customer phone"
                className={`${inputClass} pl-9`}
              />
            </div>
            <select
              aria-label="Filter gift cards by status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="depleted">Depleted</option>
              <option value="expired">Expired</option>
              <option value="void">Void</option>
            </select>
            <button
              type="button"
              onClick={() => void load()}
              disabled={isLoading}
              className={`inline-flex items-center gap-1.5 ${secondaryButtonClass}`}
            >
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
              Search
            </button>
          </div>

          {isLoading ? (
            <LoadingRow label="Loading gift cards..." />
          ) : cards.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="No gift cards found"
                body="Issue the first card, or widen the search and status filters."
              />
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                    <th className="px-2 py-2">Code</th>
                    <th className="px-2 py-2">Balance</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Phone</th>
                    <th className="px-2 py-2">Issued</th>
                    <th className="px-2 py-2">Expiry</th>
                    <th className="px-2 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map((card) => (
                    <tr
                      key={card.id}
                      data-testid={`gift-card-row-${card.code}`}
                      className="border-b border-gray-50 text-sm"
                    >
                      <td className="px-2 py-3">
                        <p className="font-mono font-black text-gray-900">{card.code}</p>
                        {card.note ? (
                          <p className="max-w-[200px] truncate text-[10px] font-semibold text-gray-400">
                            {card.note}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-2 py-3">
                        <p className="font-black text-gray-900">{formatMoney(card.balance)}</p>
                        <p className="text-[10px] font-semibold text-gray-400">
                          of {formatMoney(card.initial_balance)}
                        </p>
                      </td>
                      <td className="px-2 py-3">
                        <StatusBadge label={card.status} />
                      </td>
                      <td className="px-2 py-3 text-xs font-semibold text-gray-600">
                        {card.customer_phone || "—"}
                      </td>
                      <td className="px-2 py-3 text-xs font-semibold text-gray-600">
                        {formatDate(card.issued_at || card.created_at)}
                      </td>
                      <td className="px-2 py-3 text-xs font-semibold text-gray-600">
                        {formatDate(card.expires_on)}
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openDetail(card)}
                            className={secondaryButtonClass}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => openDetail(card)}
                            className={`inline-flex items-center gap-1 ${secondaryButtonClass}`}
                          >
                            <RotateCw className="h-3 w-3" /> Reload
                          </button>
                          <button
                            type="button"
                            disabled={rowBusyId === card.id || card.status === "void"}
                            onClick={() => void voidCard(card, "Voided from gift card register")}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-600 hover:border-red-200 disabled:opacity-40"
                          >
                            {rowBusyId === card.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Ban className="h-3 w-3" />
                            )}
                            Void
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {openCard ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-2 sm:items-center sm:p-4">
            <div
              data-testid="gift-card-detail"
              role="dialog"
              aria-modal="true"
              aria-label={`Gift card ${openCard.code}`}
              className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl sm:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className={labelClass}>Gift card</p>
                  <h2 className="mt-1 font-mono text-2xl font-black tracking-wider text-gray-950">
                    {openCard.code}
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusBadge label={openCard.status} />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      Expires {formatDate(openCard.expires_on)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Close gift card detail"
                  onClick={closeDetail}
                  className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-4 grid gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3 sm:grid-cols-3">
                <div>
                  <p className={labelClass}>Balance</p>
                  <p className="mt-1 text-2xl font-black text-gray-950">
                    {formatMoney(detail?.card.balance ?? openCard.balance)}
                  </p>
                </div>
                <div>
                  <p className={labelClass}>Initial value</p>
                  <p className="mt-1 text-sm font-black text-gray-700">
                    {formatMoney(detail?.card.initial_balance ?? openCard.initial_balance)}
                  </p>
                </div>
                <div>
                  <p className={labelClass}>Customer</p>
                  <p className="mt-1 text-sm font-semibold text-gray-700">
                    {(detail?.card.customer_phone ?? openCard.customer_phone) || "No phone on file"}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[11px] font-semibold text-gray-500">
                <span>Issued {formatDate(openCard.issued_at || openCard.created_at)}</span>
                <span>By {openCard.issued_by || "—"}</span>
                {openCard.note ? <span>Note: {openCard.note}</span> : null}
              </div>

              <div className="mt-3">
                <ErrorNote message={detailError} />
              </div>
              {detailNotice ? (
                <p className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                  {detailNotice}
                </p>
              ) : null}

              {detailLoading && !detail ? (
                <LoadingRow label="Loading card activity..." />
              ) : (
                <>
                  <div className="mt-4 overflow-x-auto">
                    <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
                      Transaction history
                    </h3>
                    {detail && detail.transactions.length > 0 ? (
                      <table className="min-w-full text-left">
                        <thead>
                          <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                            <th className="px-2 py-2">When</th>
                            <th className="px-2 py-2">Kind</th>
                            <th className="px-2 py-2">Amount</th>
                            <th className="px-2 py-2">Balance after</th>
                            <th className="px-2 py-2">Reference</th>
                            <th className="px-2 py-2">By</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.transactions.map((transaction) => (
                            <tr
                              key={transaction.id}
                              className="border-b border-gray-50 text-xs"
                            >
                              <td className="px-2 py-2 font-semibold text-gray-600">
                                {formatDate(transaction.created_at)}
                              </td>
                              <td className="px-2 py-2">
                                <StatusBadge label={transaction.kind} />
                              </td>
                              <td className="px-2 py-2 font-black text-gray-800">
                                {formatMoney(transaction.amount)}
                              </td>
                              <td className="px-2 py-2 font-semibold text-gray-600">
                                {formatMoney(transaction.balance_after)}
                              </td>
                              <td className="px-2 py-2 text-gray-500">
                                {transaction.reference ||
                                  (transaction.order_id ? `Order #${transaction.order_id}` : "—")}
                                {transaction.note ? (
                                  <span className="block text-[10px] text-gray-400">
                                    {transaction.note}
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-2 py-2 text-gray-500">
                                {transaction.created_by || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <EmptyState
                        title="No activity yet"
                        body="Issues, reloads, redemptions and voids will appear here."
                      />
                    )}
                  </div>

                  {openCard.status === "active" ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <form
                        className="rounded-xl border border-gray-100 p-3"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void reloadCard();
                        }}
                      >
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                          Reload balance
                        </p>
                        <label className={`mt-2 block ${labelClass}`}>
                          Amount (₹)
                          <input
                            type="number"
                            min="1"
                            step="0.01"
                            value={reloadForm.amount}
                            onChange={(event) =>
                              setReloadForm({ ...reloadForm, amount: event.target.value })
                            }
                            className={`mt-1 ${inputClass}`}
                          />
                        </label>
                        <label className={`mt-2 block ${labelClass}`}>
                          Note
                          <input
                            value={reloadForm.note}
                            onChange={(event) =>
                              setReloadForm({ ...reloadForm, note: event.target.value })
                            }
                            placeholder="Payment reference"
                            className={`mt-1 ${inputClass}`}
                          />
                        </label>
                        <button
                          type="submit"
                          disabled={reloadBusy}
                          className={`mt-3 inline-flex items-center gap-1.5 ${primaryButtonClass}`}
                        >
                          {reloadBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCw className="h-3.5 w-3.5" />
                          )}
                          Reload card
                        </button>
                      </form>

                      <div className="rounded-xl border border-red-100 bg-red-50/50 p-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-red-500">
                          Void card
                        </p>
                        <p className="mt-1 text-[11px] font-semibold text-red-800">
                          Voiding is permanent and forfeits the remaining balance.
                        </p>
                        <label className={`mt-2 block ${labelClass}`}>
                          Reason
                          <input
                            value={voidNote}
                            onChange={(event) => setVoidNote(event.target.value)}
                            placeholder="Why is this card being voided?"
                            className={`mt-1 ${inputClass}`}
                          />
                        </label>
                        <button
                          type="button"
                          disabled={voidBusy}
                          onClick={() => void voidCard(openCard, voidNote)}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {voidBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Ban className="h-3.5 w-3.5" />
                          )}
                          Void card
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-4 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] font-semibold text-gray-500">
                      This card is {openCard.status}; reload and void actions are unavailable.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </DepartmentToolShell>
  );
}
