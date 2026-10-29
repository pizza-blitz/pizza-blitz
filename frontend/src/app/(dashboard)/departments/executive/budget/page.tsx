"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Plus,
  Save,
  Target,
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
  StatusBadge,
  formatDate,
  formatMoney,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/department-tools";

type Goal = {
  id: number;
  title: string;
  description?: string | null;
  department_key: string;
  owner_staff_id?: string | null;
  metric: string;
  target_value: number;
  current_value: number;
  unit: string;
  progress_pct: number;
  status: string;
  stored_status?: string | null;
  period: string;
  start_date?: string | null;
  end_date?: string | null;
};

type GoalSummary = {
  total: number;
  active: number;
  achieved: number;
  at_risk: number;
  total_target: number;
  total_current: number;
};

type GoalsResponse = {
  items?: Goal[];
  summary?: GoalSummary;
  detail?: string;
};

type GoalDraft = {
  title: string;
  description: string;
  department_key: string;
  metric: string;
  target_value: string;
  current_value: string;
  unit: string;
  period: string;
  start_date: string;
  end_date: string;
};

const DEPARTMENT_OPTIONS = [
  { key: "executive", label: "Executive" },
  { key: "operations", label: "Operations" },
  { key: "kitchen", label: "Kitchen" },
  { key: "supply", label: "Supply" },
  { key: "quality", label: "Quality" },
  { key: "finance", label: "Finance" },
  { key: "hr", label: "HR" },
  { key: "marketing", label: "Marketing" },
  { key: "revenue", label: "Revenue" },
  { key: "technology", label: "Technology" },
  { key: "franchise", label: "Franchise" },
  { key: "training", label: "Training" },
  { key: "facilities", label: "Facilities" },
  { key: "legal", label: "Legal" },
];

const METRIC_OPTIONS = [
  { key: "revenue", label: "Revenue" },
  { key: "orders", label: "Orders" },
  { key: "aov", label: "Average order value" },
  { key: "margin", label: "Margin" },
  { key: "customers", label: "Customers" },
  { key: "training", label: "Training" },
  { key: "other", label: "Other" },
];

const UNIT_OPTIONS = ["₹", "%", "count"];

const PERIOD_OPTIONS = [
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "annual", label: "Annual" },
];

const STATUS_OPTIONS = [
  { key: "active", label: "Active" },
  { key: "achieved", label: "Achieved" },
  { key: "at_risk", label: "At risk" },
  { key: "off_track", label: "Off track" },
];

const PROGRESS_TONES: Record<string, string> = {
  achieved: "bg-emerald-500",
  on_track: "bg-emerald-500",
  at_risk: "bg-amber-500",
  off_track: "bg-red-500",
  active: "bg-blue-600",
};

function createGoalDraft(): GoalDraft {
  return {
    title: "",
    description: "",
    department_key: "executive",
    metric: "revenue",
    target_value: "",
    current_value: "0",
    unit: "₹",
    period: "monthly",
    start_date: "",
    end_date: "",
  };
}

function titleize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatGoalValue(value: number, unit: string) {
  const amount = Number(value || 0);
  if (unit === "₹") return formatMoney(amount);
  if (unit === "%") return `${Math.round(amount * 100) / 100}%`;
  if (unit === "count") {
    return amount.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }
  return `${Math.round(amount * 100) / 100} ${unit}`;
}

function goalProgress(goal: Goal) {
  if (Number.isFinite(goal.progress_pct)) return goal.progress_pct;
  if (!goal.target_value) return 0;
  return (goal.current_value / goal.target_value) * 100;
}

export default function ExecutiveBudgetPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [summary, setSummary] = useState<GoalSummary | null>(null);
  const [periodFilter, setPeriodFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [goalDraft, setGoalDraft] = useState<GoalDraft>(createGoalDraft);
  const [savingGoal, setSavingGoal] = useState(false);

  const [progressDrafts, setProgressDrafts] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      try {
        const params = new URLSearchParams();
        if (periodFilter) params.set("period", periodFilter);
        if (statusFilter) params.set("status", statusFilter);
        const query = params.toString();
        const response = await fetch(
          getApiUrl(
            `/api/v1/restaurant/company/programs/goals${query ? `?${query}` : ""}`
          ),
          { credentials: "include", cache: "no-store" }
        );
        const data = (await response.json()) as GoalsResponse;
        if (!response.ok) {
          throw new Error(data.detail || "Goals failed to load.");
        }
        setGoals(data.items ?? []);
        setSummary(data.summary ?? null);
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : "Goals failed to load."
        );
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [periodFilter, statusFilter]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const updateProgress = async (goal: Goal) => {
    const raw = progressDrafts[goal.id];
    const value = raw === undefined ? goal.current_value : Number(raw);
    if (raw !== undefined && raw.trim() === "") {
      setError("Enter a progress value before saving.");
      return;
    }
    if (!Number.isFinite(value) || value < 0) {
      setError("Progress must be a number zero or greater.");
      return;
    }
    setSavingId(goal.id);
    setError("");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/company/programs/goals/${goal.id}`),
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ current_value: Math.round(value * 100) / 100 }),
        }
      );
      const data = (await response.json()) as { detail?: string };
      if (!response.ok) {
        throw new Error(data.detail || "Goal progress could not be updated.");
      }
      setProgressDrafts((previous) => {
        const next = { ...previous };
        delete next[goal.id];
        return next;
      });
      setNotice(`Progress updated for "${goal.title}".`);
      await load(true);
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Goal progress could not be updated."
      );
    } finally {
      setSavingId(null);
    }
  };

  const createGoal = async () => {
    const title = goalDraft.title.trim();
    if (!title) {
      setError("Goal title is required.");
      return;
    }
    const targetValue = Number(goalDraft.target_value);
    if (
      goalDraft.target_value.trim() === "" ||
      !Number.isFinite(targetValue) ||
      targetValue < 0
    ) {
      setError("Target value must be zero or greater.");
      return;
    }
    const currentValue = Number(goalDraft.current_value || 0);
    if (!Number.isFinite(currentValue) || currentValue < 0) {
      setError("Current value must be zero or greater.");
      return;
    }
    if (
      goalDraft.start_date &&
      goalDraft.end_date &&
      goalDraft.end_date < goalDraft.start_date
    ) {
      setError("End date cannot be before the start date.");
      return;
    }

    setSavingGoal(true);
    setError("");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/company/programs/goals"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            description: goalDraft.description.trim(),
            department_key: goalDraft.department_key,
            metric: goalDraft.metric,
            target_value: targetValue,
            current_value: currentValue,
            unit: goalDraft.unit,
            period: goalDraft.period,
            start_date: goalDraft.start_date || null,
            end_date: goalDraft.end_date || null,
          }),
        }
      );
      const data = (await response.json()) as {
        detail?: string;
        title?: string;
      };
      if (!response.ok) {
        throw new Error(data.detail || "Goal could not be created.");
      }
      setNotice(`"${data.title || title}" added to department goals.`);
      setGoalDraft(createGoalDraft());
      setShowForm(false);
      await load(true);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Goal could not be created."
      );
    } finally {
      setSavingGoal(false);
    }
  };

  return (
    <DepartmentToolShell
      departmentKey="executive"
      departmentLabel="Executive"
      title="Budget & goals"
      subtitle="Set department targets, keep progress current and watch the goals that need attention."
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
          label="Active goals"
          value={summary?.active ?? 0}
          hint={`${summary?.total ?? 0} goals in view`}
        />
        <StatCard
          label="Achieved"
          value={summary?.achieved ?? 0}
          tone="good"
          hint="Targets met"
        />
        <StatCard
          label="At risk"
          value={summary?.at_risk ?? 0}
          tone={(summary?.at_risk ?? 0) > 0 ? "warn" : "neutral"}
          hint="Needs attention"
        />
        <StatCard
          label="Total target"
          value={formatMoney(summary?.total_target ?? 0)}
          hint="Across matched goals"
        />
        <StatCard
          label="Total current"
          value={formatMoney(summary?.total_current ?? 0)}
          tone="info"
          hint="Progress recorded"
        />
      </section>

      <Panel
        title="Department goals"
        description="Goals are department targets, not live analytics."
        actions={
          <button
            type="button"
            aria-expanded={showForm}
            onClick={() => setShowForm((previous) => !previous)}
            className={`${secondaryButtonClass} inline-flex items-center gap-1.5`}
          >
            {showForm ? (
              <X className="h-3.5 w-3.5" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {showForm ? "Close form" : "New goal"}
          </button>
        }
      >
        {showForm ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void createGoal();
            }}
            className="mb-4 space-y-3 rounded-xl border border-gray-200 bg-gray-50/60 p-4"
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className={`${labelClass} sm:col-span-2`}>
                Goal title
                <input
                  data-testid="goal-title"
                  value={goalDraft.title}
                  onChange={(event) =>
                    setGoalDraft((previous) => ({
                      ...previous,
                      title: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                  placeholder="Grow quarterly revenue to ₹1.2 crore"
                />
              </label>
              <label className={labelClass}>
                Department
                <select
                  value={goalDraft.department_key}
                  onChange={(event) =>
                    setGoalDraft((previous) => ({
                      ...previous,
                      department_key: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                >
                  {DEPARTMENT_OPTIONS.map((department) => (
                    <option key={department.key} value={department.key}>
                      {department.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>
                Description
                <textarea
                  rows={2}
                  value={goalDraft.description}
                  onChange={(event) =>
                    setGoalDraft((previous) => ({
                      ...previous,
                      description: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                  placeholder="What this target covers and how progress is measured."
                />
              </label>
              <label className={labelClass}>
                Metric
                <select
                  value={goalDraft.metric}
                  onChange={(event) =>
                    setGoalDraft((previous) => ({
                      ...previous,
                      metric: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                >
                  {METRIC_OPTIONS.map((metric) => (
                    <option key={metric.key} value={metric.key}>
                      {metric.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Unit
                <select
                  value={goalDraft.unit}
                  onChange={(event) =>
                    setGoalDraft((previous) => ({
                      ...previous,
                      unit: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                >
                  {UNIT_OPTIONS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit === "count" ? "Count" : unit}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Period
                <select
                  value={goalDraft.period}
                  onChange={(event) =>
                    setGoalDraft((previous) => ({
                      ...previous,
                      period: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                >
                  {PERIOD_OPTIONS.map((period) => (
                    <option key={period.key} value={period.key}>
                      {period.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Target
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={goalDraft.target_value}
                  onChange={(event) =>
                    setGoalDraft((previous) => ({
                      ...previous,
                      target_value: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className={labelClass}>
                Current
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={goalDraft.current_value}
                  onChange={(event) =>
                    setGoalDraft((previous) => ({
                      ...previous,
                      current_value: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className={labelClass}>
                Start date
                <input
                  type="date"
                  value={goalDraft.start_date}
                  onChange={(event) =>
                    setGoalDraft((previous) => ({
                      ...previous,
                      start_date: event.target.value,
                    }))
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className={labelClass}>
                End date
                <input
                  type="date"
                  value={goalDraft.end_date}
                  onChange={(event) =>
                    setGoalDraft((previous) => ({
                      ...previous,
                      end_date: event.target.value,
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
                  setShowForm(false);
                  setGoalDraft(createGoalDraft());
                }}
                className={secondaryButtonClass}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingGoal}
                className={`${primaryButtonClass} inline-flex items-center gap-1.5`}
              >
                {savingGoal ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Target className="h-3.5 w-3.5" />
                )}
                Create goal
              </button>
            </div>
          </form>
        ) : null}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter by period"
            value={periodFilter}
            onChange={(event) => setPeriodFilter(event.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600"
          >
            <option value="">All periods</option>
            {PERIOD_OPTIONS.map((period) => (
              <option key={period.key} value={period.key}>
                {period.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status.key} value={status.key}>
                {status.label}
              </option>
            ))}
          </select>
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            {goals.length} shown
          </span>
        </div>

        {isLoading ? (
          <LoadingRow label="Loading goals..." />
        ) : goals.length === 0 ? (
          <EmptyState
            title="No goals match these filters"
            body="Create a department goal or widen the period and status filters."
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {goals.map((goal) => {
              const progress = goalProgress(goal);
              const barWidth = Math.min(100, Math.max(0, progress));
              return (
                <article
                  key={goal.id}
                  data-testid={`goal-row-${goal.id}`}
                  className="rounded-xl border border-gray-100 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={labelClass}>
                        {titleize(goal.department_key)} · {titleize(goal.period)}
                      </p>
                      <h3 className="mt-1 text-sm font-black text-gray-950">
                        {goal.title}
                      </h3>
                      {goal.description ? (
                        <p className="mt-1 text-xs font-semibold text-gray-500">
                          {goal.description}
                        </p>
                      ) : null}
                    </div>
                    <StatusBadge label={goal.status} />
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <p className={labelClass}>Current</p>
                      <p className="text-lg font-black text-gray-950">
                        {formatGoalValue(goal.current_value, goal.unit)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={labelClass}>Target</p>
                      <p className="text-sm font-black text-gray-600">
                        {formatGoalValue(goal.target_value, goal.unit)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-2">
                    <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-gray-400">
                      <span>{titleize(goal.metric)}</span>
                      <span>{Math.round(progress * 10) / 10}% of target</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className={`h-full rounded-full ${
                          PROGRESS_TONES[goal.status] || "bg-gray-900"
                        }`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] font-semibold text-gray-400">
                    <span className="inline-flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" />
                      {goal.owner_staff_id
                        ? `Owner ${goal.owner_staff_id}`
                        : "No owner assigned"}
                    </span>
                    <span>
                      {formatDate(goal.start_date)} → {formatDate(goal.end_date)}
                    </span>
                  </div>

                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void updateProgress(goal);
                    }}
                    className="mt-3 flex items-end gap-2 rounded-lg border border-gray-100 bg-gray-50 p-2.5"
                  >
                    <label className={`${labelClass} flex-1`}>
                      Update progress
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        aria-label={`Update progress for ${goal.title}`}
                        value={
                          progressDrafts[goal.id] ?? String(goal.current_value)
                        }
                        onChange={(event) =>
                          setProgressDrafts((previous) => ({
                            ...previous,
                            [goal.id]: event.target.value,
                          }))
                        }
                        className={`${inputClass} mt-1 py-1.5`}
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={
                        savingId === goal.id || savingId !== null
                      }
                      className={`${primaryButtonClass} inline-flex items-center gap-1.5`}
                    >
                      {savingId === goal.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                      Save
                    </button>
                  </form>
                </article>
              );
            })}
          </div>
        )}
      </Panel>
    </DepartmentToolShell>
  );
}
