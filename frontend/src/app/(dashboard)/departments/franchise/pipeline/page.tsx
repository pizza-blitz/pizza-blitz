"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  CalendarClock,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
  TrendingUp,
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
  formatDate,
  formatMoney,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/department-tools";

type FranchiseSite = {
  id: number;
  name: string;
  city: string;
  state?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  stage: string;
  expected_investment: number;
  probability: number;
  weighted_value: number;
  owner_staff_id?: string | null;
  next_step?: string | null;
  next_action_on?: string | null;
  next_action_due?: string | boolean | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type FranchiseSummary = {
  total: number;
  open_sites: number;
  pipeline_value: number;
  weighted_value: number;
  open_count: number;
  won: number;
  conversion_rate: number;
  next_actions_due: number;
};

type FranchiseResponse = {
  items?: FranchiseSite[];
  summary?: FranchiseSummary;
  detail?: string;
};

type SiteDraft = {
  name: string;
  city: string;
  state: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  stage: string;
  expected_investment: string;
  probability: string;
  owner_staff_id: string;
  next_step: string;
  next_action_on: string;
  notes: string;
};

const STAGE_OPTIONS = [
  { key: "lead", label: "Lead" },
  { key: "qualified", label: "Qualified" },
  { key: "site_visit", label: "Site visit" },
  { key: "negotiation", label: "Negotiation" },
  { key: "agreement", label: "Agreement" },
  { key: "construction", label: "Construction" },
  { key: "open", label: "Open" },
  { key: "lost", label: "Lost" },
];

const ACTIVE_STAGES = STAGE_OPTIONS.filter((stage) => stage.key !== "lost");

const STAGE_DOTS: Record<string, string> = {
  lead: "bg-gray-400",
  qualified: "bg-blue-500",
  site_visit: "bg-indigo-500",
  negotiation: "bg-amber-500",
  agreement: "bg-teal-500",
  construction: "bg-orange-500",
  open: "bg-emerald-500",
  lost: "bg-gray-300",
};

function createSiteDraft(): SiteDraft {
  return {
    name: "",
    city: "",
    state: "",
    contact_name: "",
    contact_phone: "",
    contact_email: "",
    stage: "lead",
    expected_investment: "",
    probability: "25",
    owner_staff_id: "",
    next_step: "",
    next_action_on: "",
    notes: "",
  };
}

function stageLabel(stage: string) {
  return (
    STAGE_OPTIONS.find((option) => option.key === stage)?.label ||
    stage.replace(/_/g, " ")
  );
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${Math.round(value * 10) / 10}%`;
}

function FranchiseCard({
  site,
  busy,
  muted = false,
  onStageChange,
}: {
  site: FranchiseSite;
  busy: boolean;
  muted?: boolean;
  onStageChange: (site: FranchiseSite, stage: string) => void;
}) {
  return (
    <article
      data-testid={`franchise-site-${site.id}`}
      className={`rounded-xl border p-3 ${
        muted
          ? "border-gray-200 bg-white/70 opacity-80"
          : "border-gray-100 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-gray-950">{site.name}</p>
          <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-bold text-gray-500">
            <MapPin className="h-3 w-3" />
            {site.city}
            {site.state ? `, ${site.state}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <p className={labelClass}>Investment</p>
          <p className="text-sm font-black text-gray-900">
            {formatMoney(site.expected_investment)}
          </p>
        </div>
        <div className="text-right">
          <p className={labelClass}>Weighted</p>
          <p className="inline-flex items-center gap-1 text-xs font-black text-gray-700">
            <TrendingUp className="h-3.5 w-3.5 text-gray-400" />
            {formatMoney(site.weighted_value)}
          </p>
        </div>
      </div>

      <div className="mt-2">
        <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-gray-400">
          <span>Probability</span>
          <span>{Math.round(clampPercent(site.probability))}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-gray-900"
            style={{ width: `${clampPercent(site.probability)}%` }}
          />
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-gray-50 px-2.5 py-2">
        <p className="text-[11px] font-bold text-gray-700">
          {site.next_step || "No next step recorded"}
        </p>
        <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-gray-400">
          <CalendarClock className="h-3 w-3" />
          {formatDate(site.next_action_on)}
        </p>
      </div>

      <div className="mt-2 space-y-0.5">
        <p className="text-[10px] font-bold text-gray-500">
          {site.contact_name || "No contact yet"}
        </p>
        {site.contact_phone ? (
          <p className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-400">
            <Phone className="h-3 w-3" /> {site.contact_phone}
          </p>
        ) : null}
        {site.contact_email ? (
          <p className="flex items-center gap-1 truncate text-[10px] font-semibold text-gray-400">
            <Mail className="h-3 w-3 shrink-0" />{" "}
            <span className="truncate">{site.contact_email}</span>
          </p>
        ) : null}
      </div>

      <select
        aria-label={`Move ${site.name} to another stage`}
        value={site.stage}
        disabled={busy}
        onChange={(event) => onStageChange(site, event.target.value)}
        className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[10px] font-black uppercase tracking-widest text-gray-600 disabled:opacity-50"
      >
        {STAGE_OPTIONS.map((option) => (
          <option key={option.key} value={option.key}>
            Move to {option.label}
          </option>
        ))}
      </select>
    </article>
  );
}

export default function FranchisePipelinePage() {
  const [sites, setSites] = useState<FranchiseSite[]>([]);
  const [summary, setSummary] = useState<FranchiseSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [busySiteId, setBusySiteId] = useState<number | null>(null);

  const [showAddSite, setShowAddSite] = useState(false);
  const [siteDraft, setSiteDraft] = useState<SiteDraft>(createSiteDraft);
  const [savingSite, setSavingSite] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/company/programs/franchise"),
        { credentials: "include", cache: "no-store" }
      );
      const data = (await response.json()) as FranchiseResponse;
      if (!response.ok) {
        throw new Error(data.detail || "Franchise pipeline failed to load.");
      }
      setSites(data.items ?? []);
      setSummary(data.summary ?? null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Franchise pipeline failed to load."
      );
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const next: Record<string, number> = { all: sites.length };
    STAGE_OPTIONS.forEach((stage) => {
      next[stage.key] = 0;
    });
    sites.forEach((site) => {
      if (next[site.stage] !== undefined) next[site.stage] += 1;
    });
    return next;
  }, [sites]);

  const switchStage = async (site: FranchiseSite, stage: string) => {
    if (stage === site.stage) return;
    setBusySiteId(site.id);
    setError("");
    try {
      const response = await fetch(
        getApiUrl(
          `/api/v1/restaurant/company/programs/franchise/sites/${site.id}`
        ),
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage }),
        }
      );
      const data = (await response.json()) as {
        detail?: string;
        stage?: string;
      };
      if (!response.ok) {
        throw new Error(data.detail || "Stage could not be updated.");
      }
      setNotice(`${site.name} moved to ${stageLabel(data.stage || stage)}.`);
      await load(true);
    } catch (stageError) {
      setError(
        stageError instanceof Error
          ? stageError.message
          : "Stage could not be updated."
      );
    } finally {
      setBusySiteId(null);
    }
  };

  const createSite = async () => {
    const name = siteDraft.name.trim();
    const city = siteDraft.city.trim();
    if (!name || !city) {
      setError("Site name and city are required.");
      return;
    }
    const investment = Number(siteDraft.expected_investment || 0);
    if (!Number.isFinite(investment) || investment < 0) {
      setError("Expected investment must be zero or more.");
      return;
    }
    const probability = Number(siteDraft.probability || 0);
    if (!Number.isFinite(probability) || probability < 0 || probability > 100) {
      setError("Probability must be between 0 and 100.");
      return;
    }

    setSavingSite(true);
    setError("");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/company/programs/franchise/sites"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            city,
            state: siteDraft.state.trim(),
            contact_name: siteDraft.contact_name.trim(),
            contact_phone: siteDraft.contact_phone.trim(),
            contact_email: siteDraft.contact_email.trim(),
            stage: siteDraft.stage,
            expected_investment: investment,
            probability,
            owner_staff_id: siteDraft.owner_staff_id.trim(),
            next_step: siteDraft.next_step.trim(),
            next_action_on: siteDraft.next_action_on || null,
            notes: siteDraft.notes.trim(),
          }),
        }
      );
      const data = (await response.json()) as {
        detail?: string;
        name?: string;
      };
      if (!response.ok) {
        throw new Error(data.detail || "Franchise site could not be created.");
      }
      setNotice(`${data.name || name} added to the franchise pipeline.`);
      setSiteDraft(createSiteDraft());
      setShowAddSite(false);
      await load(true);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Franchise site could not be created."
      );
    } finally {
      setSavingSite(false);
    }
  };

  const allFilter = stageFilter === "all";
  const visibleActiveSites = allFilter
    ? sites.filter((site) => site.stage !== "lost")
    : stageFilter === "lost"
      ? []
      : sites.filter((site) => site.stage === stageFilter);
  const lostSites =
    allFilter || stageFilter === "lost"
      ? sites.filter((site) => site.stage === "lost")
      : [];
  const boardStages = allFilter
    ? ACTIVE_STAGES
    : stageFilter === "lost"
      ? []
      : STAGE_OPTIONS.filter(
          (stage) => stage.key === stageFilter && stage.key !== "lost"
        );
  const totalVisible = visibleActiveSites.length + lostSites.length;
  const showLost = allFilter || stageFilter === "lost";

  return (
    <DepartmentToolShell
      departmentKey="franchise"
      departmentLabel="Franchise"
      title="Franchise pipeline"
      subtitle="Track expansion prospects from first contact through agreement, build and opening."
    >
      <div className="space-y-4">
        <ErrorNote message={error} />
        {notice ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
            {notice}
          </div>
        ) : null}
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Open sites"
          value={summary?.open_sites ?? 0}
          hint={`${summary?.won ?? 0} won so far`}
        />
        <StatCard
          label="Pipeline value"
          value={formatMoney(summary?.pipeline_value ?? 0)}
          hint={`${summary?.total ?? 0} sites in total`}
        />
        <StatCard
          label="Weighted value"
          value={formatMoney(summary?.weighted_value ?? 0)}
          tone="good"
          hint="Probability-adjusted"
        />
        <StatCard
          label="Conversion"
          value={formatPercent(summary?.conversion_rate)}
          tone="info"
          hint={`${summary?.open_count ?? 0} active opportunities`}
        />
        <StatCard
          label="Next actions due"
          value={summary?.next_actions_due ?? 0}
          tone={(summary?.next_actions_due ?? 0) > 0 ? "warn" : "neutral"}
          hint="Follow-ups scheduled"
        />
      </section>

      <Panel
        title="Pipeline board"
        description="Weighted value = expected investment × probability."
        actions={
          <button
            type="button"
            aria-expanded={showAddSite}
            onClick={() => setShowAddSite((previous) => !previous)}
            className={`${secondaryButtonClass} inline-flex items-center gap-1.5`}
          >
            {showAddSite ? (
              <X className="h-3.5 w-3.5" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {showAddSite ? "Close form" : "Add site"}
          </button>
        }
      >
        {showAddSite ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void createSite();
            }}
            className="mb-4 space-y-3 rounded-xl border border-gray-200 bg-gray-50/60 p-4"
          >
            <div className="flex items-center justify-between">
              <p className={labelClass}>New franchise site</p>
              <button
                type="button"
                onClick={() => {
                  setShowAddSite(false);
                  setSiteDraft(createSiteDraft());
                }}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-white hover:text-gray-700"
                aria-label="Close add site form"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className={labelClass}>
                Site name
                <input
                  data-testid="franchise-site-name"
                  value={siteDraft.name}
                  onChange={(event) =>
                    setSiteDraft((previous) => ({
                      ...previous,
                      name: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                  placeholder="Pizza Blitz Indiranagar"
                />
              </label>
              <label className={labelClass}>
                City
                <input
                  value={siteDraft.city}
                  onChange={(event) =>
                    setSiteDraft((previous) => ({
                      ...previous,
                      city: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                  placeholder="Bengaluru"
                />
              </label>
              <label className={labelClass}>
                State
                <input
                  value={siteDraft.state}
                  onChange={(event) =>
                    setSiteDraft((previous) => ({
                      ...previous,
                      state: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                  placeholder="Karnataka"
                />
              </label>
              <label className={labelClass}>
                Contact name
                <input
                  value={siteDraft.contact_name}
                  onChange={(event) =>
                    setSiteDraft((previous) => ({
                      ...previous,
                      contact_name: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className={labelClass}>
                Contact phone
                <input
                  value={siteDraft.contact_phone}
                  onChange={(event) =>
                    setSiteDraft((previous) => ({
                      ...previous,
                      contact_phone: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className={labelClass}>
                Contact email
                <input
                  type="email"
                  value={siteDraft.contact_email}
                  onChange={(event) =>
                    setSiteDraft((previous) => ({
                      ...previous,
                      contact_email: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className={labelClass}>
                Stage
                <select
                  value={siteDraft.stage}
                  onChange={(event) =>
                    setSiteDraft((previous) => ({
                      ...previous,
                      stage: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                >
                  {STAGE_OPTIONS.map((stage) => (
                    <option key={stage.key} value={stage.key}>
                      {stage.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Expected investment (₹)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={siteDraft.expected_investment}
                  onChange={(event) =>
                    setSiteDraft((previous) => ({
                      ...previous,
                      expected_investment: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                  placeholder="2500000"
                />
              </label>
              <label className={labelClass}>
                Probability (%)
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={siteDraft.probability}
                  onChange={(event) =>
                    setSiteDraft((previous) => ({
                      ...previous,
                      probability: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className={labelClass}>
                Owner staff ID
                <input
                  value={siteDraft.owner_staff_id}
                  onChange={(event) =>
                    setSiteDraft((previous) => ({
                      ...previous,
                      owner_staff_id: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                  placeholder="Optional"
                />
              </label>
              <label className={labelClass}>
                Next step
                <input
                  value={siteDraft.next_step}
                  onChange={(event) =>
                    setSiteDraft((previous) => ({
                      ...previous,
                      next_step: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                  placeholder="Share site dossier"
                />
              </label>
              <label className={labelClass}>
                Next action date
                <input
                  type="date"
                  value={siteDraft.next_action_on}
                  onChange={(event) =>
                    setSiteDraft((previous) => ({
                      ...previous,
                      next_action_on: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>
                Notes
                <textarea
                  rows={2}
                  value={siteDraft.notes}
                  onChange={(event) =>
                    setSiteDraft((previous) => ({
                      ...previous,
                      notes: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowAddSite(false);
                  setSiteDraft(createSiteDraft());
                }}
                className={secondaryButtonClass}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingSite}
                className={`${primaryButtonClass} inline-flex items-center gap-1.5`}
              >
                {savingSite ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Building2 className="h-3.5 w-3.5" />
                )}
                Save site
              </button>
            </div>
          </form>
        ) : null}

        <div className="mb-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={stageFilter === "all"}
            onClick={() => setStageFilter("all")}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest ${
              stageFilter === "all"
                ? "border-gray-950 bg-gray-950 text-white"
                : "border-gray-200 bg-white text-gray-500"
            }`}
          >
            All
            <span className="rounded-full bg-white/20 px-1.5 text-[9px]">
              {counts.all ?? 0}
            </span>
          </button>
          {STAGE_OPTIONS.map((stage) => (
            <button
              key={stage.key}
              type="button"
              aria-pressed={stageFilter === stage.key}
              onClick={() => setStageFilter(stage.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest ${
                stageFilter === stage.key
                  ? stage.key === "lost"
                    ? "border-gray-500 bg-gray-500 text-white"
                    : "border-gray-950 bg-gray-950 text-white"
                  : stage.key === "lost"
                    ? "border-gray-200 bg-gray-50 text-gray-400"
                    : "border-gray-200 bg-white text-gray-500"
              }`}
            >
              {stage.label}
              <span
                className={`rounded-full px-1.5 text-[9px] ${
                  stageFilter === stage.key ? "bg-white/20" : "bg-gray-100"
                }`}
              >
                {counts[stage.key] ?? 0}
              </span>
            </button>
          ))}
        </div>

        {isLoading ? (
          <LoadingRow label="Loading franchise pipeline..." />
        ) : sites.length === 0 ? (
          <EmptyState
            title="No franchise sites yet"
            body="Add the first prospect to start building the expansion pipeline."
          />
        ) : (
          <div className="space-y-4">
            {totalVisible === 0 ? (
              <div className="md:hidden">
                <EmptyState
                  title="No sites in this stage"
                  body="Move a prospect here or choose another stage filter."
                />
              </div>
            ) : null}

            {boardStages.length > 0 ? (
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:overflow-x-auto md:pb-2">
                {boardStages.map((stage) => {
                  const stageSites = visibleActiveSites.filter(
                    (site) => site.stage === stage.key
                  );
                  return (
                    <div
                      key={stage.key}
                      data-testid={`franchise-column-${stage.key}`}
                      className={`w-full shrink-0 rounded-xl border border-gray-100 bg-gray-50/50 p-2.5 md:w-[280px] ${
                        stageSites.length === 0 ? "hidden md:block" : ""
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-500">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              STAGE_DOTS[stage.key] || "bg-gray-300"
                            }`}
                          />
                          {stage.label}
                        </p>
                        <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[9px] font-black text-gray-500">
                          {stageSites.length}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {stageSites.map((site) => (
                          <FranchiseCard
                            key={site.id}
                            site={site}
                            busy={busySiteId === site.id}
                            onStageChange={(target, nextStage) =>
                              void switchStage(target, nextStage)
                            }
                          />
                        ))}
                        {stageSites.length === 0 ? (
                          <p className="rounded-lg border border-dashed border-gray-200 px-2 py-4 text-center text-[10px] font-semibold text-gray-400">
                            No sites
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {showLost ? (
              <section
                data-testid="franchise-column-lost"
                className="rounded-xl border border-gray-200 bg-gray-50 p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400">
                    <span className="h-2 w-2 rounded-full bg-gray-300" />
                    Lost
                  </p>
                  <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[9px] font-black text-gray-400">
                    {lostSites.length}
                  </span>
                </div>
                {lostSites.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-gray-200 px-3 py-5 text-center text-[10px] font-semibold text-gray-400">
                    No lost sites.
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {lostSites.map((site) => (
                      <FranchiseCard
                        key={site.id}
                        site={site}
                        muted
                        busy={busySiteId === site.id}
                        onStageChange={(target, nextStage) =>
                          void switchStage(target, nextStage)
                        }
                      />
                    ))}
                  </div>
                )}
              </section>
            ) : null}
          </div>
        )}
      </Panel>
    </DepartmentToolShell>
  );
}
