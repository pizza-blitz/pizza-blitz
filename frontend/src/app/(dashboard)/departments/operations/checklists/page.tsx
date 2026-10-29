"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Play,
  Plus,
  Save,
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
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/department-tools";

type TemplateItem = {
  label: string;
  required: boolean;
};

type ChecklistTemplate = {
  id: number;
  name: string;
  description: string | null;
  kind: string;
  active: boolean;
  item_count: number;
  items: TemplateItem[];
};

type RunItem = {
  label: string;
  done: boolean;
  note: string | null;
  completed_at: string | null;
  completed_by: string | null;
};

type ChecklistRun = {
  id: number;
  template_id: number;
  template_name: string;
  run_date: string;
  status: string;
  items: RunItem[];
  done_count: number;
  total_count: number;
  required_remaining: number;
  started_by: string | null;
  completed_by: string | null;
  completed_at: string | null;
  notes: string | null;
};

type ChecklistSummary = {
  templates: number;
  active_templates: number;
  runs_today: number;
  completed_today: number;
  open_runs: number;
  completion_rate: number;
};

type ChecklistPayload = {
  templates: ChecklistTemplate[];
  runs: ChecklistRun[];
  summary: ChecklistSummary;
};

type RunDraft = {
  items: RunItem[];
  notes: string;
};

const CHECKLIST_KINDS = ["opening", "closing", "daily", "weekly"] as const;
type ChecklistKind = (typeof CHECKLIST_KINDS)[number];

type TemplateForm = {
  name: string;
  description: string;
  kind: ChecklistKind;
  items: string;
};

const EMPTY_TEMPLATE_FORM: TemplateForm = {
  name: "",
  description: "",
  kind: "opening",
  items: "",
};

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(getApiUrl(path), {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const errorBody = body as { detail?: string } | null;
    throw new Error(errorBody?.detail || `Request failed (${res.status})`);
  }
  return body as T;
}

export default function OperationsChecklistsPage() {
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [runs, setRuns] = useState<ChecklistRun[]>([]);
  const [summary, setSummary] = useState<ChecklistSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [openRunId, setOpenRunId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, RunDraft>>({});
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [templateForm, setTemplateForm] =
    useState<TemplateForm>(EMPTY_TEMPLATE_FORM);

  const load = async (): Promise<ChecklistPayload | null> => {
    try {
      const data = await apiRequest<ChecklistPayload>(
        "/api/v1/restaurant/company/operations/checklists?limit=30"
      );
      setTemplates(data.templates || []);
      setRuns(data.runs || []);
      setSummary(data.summary || null);
      setMessage("");
      return data;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Checklists failed to load."
      );
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draftFor = (run: ChecklistRun): RunDraft =>
    drafts[run.id] ?? {
      items: run.items.map((item) => ({ ...item })),
      notes: run.notes || "",
    };

  const updateDraft = (
    run: ChecklistRun,
    updater: (current: RunDraft) => RunDraft
  ) => {
    setDrafts((previous) => {
      const current = previous[run.id] ?? {
        items: run.items.map((item) => ({ ...item })),
        notes: run.notes || "",
      };
      return { ...previous, [run.id]: updater(current) };
    });
  };

  const startRun = async (template: ChecklistTemplate) => {
    setBusyKey(`template-${template.id}`);
    setMessage("");
    setNotice("");
    try {
      const created = await apiRequest<{ id?: number } | null>(
        "/api/v1/restaurant/company/operations/checklists/runs",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template_id: template.id }),
        }
      );
      const data = await load();
      const fallback = data?.runs.find(
        (run) => run.template_id === template.id
      );
      const targetId =
        typeof created?.id === "number" ? created.id : fallback?.id;
      if (targetId) {
        setOpenRunId(targetId);
        setDrafts((previous) => {
          const next = { ...previous };
          delete next[targetId];
          return next;
        });
      }
      setNotice(`${template.name} run started.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Checklist run could not start."
      );
    } finally {
      setBusyKey("");
    }
  };

  const createTemplate = async () => {
    const name = templateForm.name.trim();
    if (!name) {
      setMessage("Template name is required.");
      return;
    }
    const items = templateForm.items
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) =>
        line.startsWith("*")
          ? { label: line.slice(1).trim(), required: true }
          : { label: line, required: false }
      )
      .filter((item) => item.label.length > 0);
    if (items.length === 0) {
      setMessage("Add at least one checklist item, one per line.");
      return;
    }
    setBusyKey("create-template");
    setMessage("");
    setNotice("");
    try {
      await apiRequest<unknown>(
        "/api/v1/restaurant/company/operations/checklists/templates",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            description: templateForm.description.trim() || null,
            kind: templateForm.kind,
            items,
          }),
        }
      );
      setTemplateForm(EMPTY_TEMPLATE_FORM);
      setShowTemplateForm(false);
      await load();
      setNotice(`${name} template created.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Template could not be saved."
      );
    } finally {
      setBusyKey("");
    }
  };

  const saveRun = async (run: ChecklistRun) => {
    const draft = draftFor(run);
    const template = templates.find((row) => row.id === run.template_id);
    const requiredMissing = template
      ? template.items.some(
          (templateItem) =>
            templateItem.required &&
            !draft.items.some(
              (item) => item.label === templateItem.label && item.done
            )
        )
      : draft.items.some((item) => !item.done);
    setBusyKey(`run-${run.id}`);
    setMessage("");
    setNotice("");
    try {
      await apiRequest<unknown>(
        `/api/v1/restaurant/company/operations/checklists/runs/${run.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: draft.items.map(({ label, done, note }) => ({
              label,
              done,
              note: note || null,
            })),
            status: requiredMissing ? "in_progress" : "completed",
            notes: draft.notes || null,
          }),
        }
      );
      setDrafts((previous) => {
        const next = { ...previous };
        delete next[run.id];
        return next;
      });
      await load();
      setNotice(`${run.template_name} progress saved.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Progress could not be saved."
      );
    } finally {
      setBusyKey("");
    }
  };

  const toggleRun = (run: ChecklistRun) => {
    setOpenRunId((previous) => (previous === run.id ? null : run.id));
  };

  return (
    <DepartmentToolShell
      departmentKey="operations"
      departmentLabel="Operations"
      title="Daily checklists"
      subtitle="Run opening, closing and recurring checks with item-level sign-off and required-item tracking."
    >
      <div data-testid="checklists-page" className="space-y-6">
        <ErrorNote message={message} />
        {notice ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
            {notice}
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Templates"
            value={summary?.templates ?? 0}
            hint={`${summary?.active_templates ?? 0} active`}
          />
          <StatCard
            label="Runs today"
            value={summary?.runs_today ?? 0}
            hint={`${summary?.open_runs ?? 0} still open`}
            tone="info"
          />
          <StatCard
            label="Completed today"
            value={summary?.completed_today ?? 0}
            tone="good"
          />
          <StatCard
            label="Completion rate"
            value={`${Math.round(summary?.completion_rate ?? 0)}%`}
            hint="Across recent runs"
            tone="neutral"
          />
        </section>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Panel
              title="Start a checklist"
              description="Launch a live run from any active template."
            >
              {isLoading ? (
                <LoadingRow label="Loading checklists..." />
              ) : templates.length === 0 ? (
                <EmptyState
                  title="No checklist templates yet"
                  body="Create an opening, closing or weekly template to start your first run."
                />
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {templates.map((template) => (
                    <article
                      key={template.id}
                      data-testid={`checklist-template-${template.id}`}
                      className="flex h-full flex-col rounded-xl border border-gray-100 bg-gray-50/60 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-black text-gray-900">
                            {template.name}
                          </p>
                          <p className="mt-1 text-[10px] font-semibold text-gray-400">
                            {template.item_count} items
                          </p>
                        </div>
                        <StatusBadge label={template.active ? "active" : "inactive"} />
                      </div>
                      {template.description ? (
                        <p className="mt-2 line-clamp-2 text-xs font-semibold text-gray-500">
                          {template.description}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-gray-500">
                          {template.kind}
                        </span>
                        {template.items?.some((item) => item.required) ? (
                          <span className="text-[9px] font-black uppercase tracking-widest text-amber-600">
                            Required items
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        data-testid={`checklist-start-${template.id}`}
                        onClick={() => void startRun(template)}
                        disabled={
                          busyKey === `template-${template.id}` || !template.active
                        }
                        className={`${primaryButtonClass} mt-3 inline-flex w-full items-center justify-center gap-1.5`}
                      >
                        {busyKey === `template-${template.id}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                        Start
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <Panel
            title="Create template"
            description="One item per line. Prefix with * to make an item required."
            actions={
              <button
                type="button"
                data-testid="checklist-create-template-toggle"
                onClick={() => setShowTemplateForm((previous) => !previous)}
                className={`${secondaryButtonClass} inline-flex items-center gap-1.5`}
              >
                {showTemplateForm ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                {showTemplateForm ? "Hide" : "Create template"}
              </button>
            }
          >
            {showTemplateForm ? (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createTemplate();
                }}
              >
                <label className="block">
                  <span className={labelClass}>Name</span>
                  <input
                    value={templateForm.name}
                    onChange={(event) =>
                      setTemplateForm({
                        ...templateForm,
                        name: event.target.value,
                      })
                    }
                    placeholder="Kitchen opening"
                    className={`${inputClass} mt-1`}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>Kind</span>
                  <select
                    value={templateForm.kind}
                    onChange={(event) =>
                      setTemplateForm({
                        ...templateForm,
                        kind: event.target.value as ChecklistKind,
                      })
                    }
                    className={`${inputClass} mt-1`}
                  >
                    {CHECKLIST_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind.charAt(0).toUpperCase() + kind.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={labelClass}>Description</span>
                  <input
                    value={templateForm.description}
                    onChange={(event) =>
                      setTemplateForm({
                        ...templateForm,
                        description: event.target.value,
                      })
                    }
                    placeholder="Optional context for the team"
                    className={`${inputClass} mt-1`}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>Items</span>
                  <textarea
                    rows={6}
                    value={templateForm.items}
                    onChange={(event) =>
                      setTemplateForm({
                        ...templateForm,
                        items: event.target.value,
                      })
                    }
                    placeholder={"* Check fridge temperatures\nSanitise prep counters\nCheck gas line"}
                    className={`${inputClass} mt-1 font-mono text-xs`}
                  />
                </label>
                <p className="text-[10px] font-semibold text-gray-400">
                  A run stays open until every required item is checked. Notes
                  can be added to any item during the run.
                </p>
                <button
                  type="submit"
                  disabled={busyKey === "create-template"}
                  className={`${primaryButtonClass} inline-flex w-full items-center justify-center gap-1.5`}
                >
                  {busyKey === "create-template" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Create template
                </button>
              </form>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center">
                <p className="text-sm font-black text-gray-500">
                  Build a reusable routine
                </p>
                <p className="mt-1 text-xs font-semibold text-gray-400">
                  Required items are marked with a leading *.
                </p>
              </div>
            )}
          </Panel>
        </div>

        <Panel
          title="Runs"
          description="Latest checklist runs. Open one to tick items and add notes."
        >
          {isLoading ? (
            <LoadingRow label="Loading runs..." />
          ) : runs.length === 0 ? (
            <EmptyState
              title="No checklist runs yet"
              body="Start a template above to create the first run for the team."
            />
          ) : (
            <div className="space-y-3">
              {runs.map((run) => {
                const isOpen = openRunId === run.id;
                const draft = draftFor(run);
                const template = templates.find(
                  (row) => row.id === run.template_id
                );
                const requiredLabels = new Set(
                  (template?.items || [])
                    .filter((item) => item.required)
                    .map((item) => item.label)
                );
                const progress =
                  run.total_count > 0
                    ? Math.round((run.done_count / run.total_count) * 100)
                    : 0;
                return (
                  <article
                    key={run.id}
                    data-testid={`checklist-run-${run.id}`}
                    className="rounded-xl border border-gray-100 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => toggleRun(run)}
                        aria-expanded={isOpen}
                        data-testid={`checklist-toggle-${run.id}`}
                        className="text-left"
                      >
                        <p className="text-sm font-black text-gray-900">
                          {run.template_name}
                        </p>
                        <p className="mt-0.5 text-[10px] font-semibold text-gray-400">
                          {formatDate(run.run_date)}
                          {run.started_by ? ` · started by ${run.started_by}` : ""}
                        </p>
                      </button>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge label={run.status} />
                        {run.required_remaining === 0 &&
                        run.status !== "completed" ? (
                          <StatusBadge label="completed" />
                        ) : null}
                        {run.required_remaining > 0 ? (
                          <span className="text-[9px] font-black uppercase tracking-widest text-amber-600">
                            {run.required_remaining} required left
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[10px] font-bold text-gray-500">
                        <span>
                          {run.done_count}/{run.total_count} done
                        </span>
                        <span>{progress}%</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className={`h-full rounded-full ${
                            run.required_remaining === 0
                              ? "bg-emerald-500"
                              : "bg-gray-900"
                          }`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    {run.required_remaining === 0 && run.completed_at ? (
                      <p className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Completed{" "}
                        {formatDate(run.completed_at)}
                        {run.completed_by ? ` by ${run.completed_by}` : ""}
                      </p>
                    ) : null}

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => toggleRun(run)}
                        className={`${secondaryButtonClass} inline-flex items-center gap-1.5`}
                      >
                        {isOpen ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                        {isOpen ? "Hide items" : "Open checklist"}
                      </button>
                      {isOpen ? (
                        <button
                          type="button"
                          data-testid={`checklist-save-${run.id}`}
                          onClick={() => void saveRun(run)}
                          disabled={busyKey === `run-${run.id}`}
                          className={`${primaryButtonClass} inline-flex items-center gap-1.5`}
                        >
                          {busyKey === `run-${run.id}` ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          Save progress
                        </button>
                      ) : null}
                    </div>

                    {isOpen ? (
                      <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
                        <div className="space-y-2">
                          {draft.items.map((item, index) => (
                            <div
                              key={`${run.id}-${index}-${item.label}`}
                              className="rounded-lg bg-gray-50/70 p-2"
                            >
                              <label className="flex items-start gap-2">
                                <input
                                  type="checkbox"
                                  checked={item.done}
                                  onChange={(event) =>
                                    updateDraft(run, (current) => ({
                                      ...current,
                                      items: current.items.map(
                                        (row, rowIndex) =>
                                          rowIndex === index
                                            ? {
                                                ...row,
                                                done: event.target.checked,
                                              }
                                            : row
                                      ),
                                    }))
                                  }
                                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                                />
                                <span className="text-sm font-bold text-gray-800">
                                  {item.label}
                                  {requiredLabels.has(item.label) ? (
                                    <span className="ml-1.5 text-[9px] font-black uppercase tracking-widest text-amber-600">
                                      Required
                                    </span>
                                  ) : null}
                                  {item.done && item.completed_by ? (
                                    <span className="ml-1.5 text-[9px] font-semibold text-gray-400">
                                      completed by {item.completed_by}
                                    </span>
                                  ) : null}
                                </span>
                              </label>
                              <input
                                value={item.note || ""}
                                onChange={(event) =>
                                  updateDraft(run, (current) => ({
                                    ...current,
                                    items: current.items.map((row, rowIndex) =>
                                      rowIndex === index
                                        ? { ...row, note: event.target.value }
                                        : row
                                    ),
                                  }))
                                }
                                placeholder="Note (optional)"
                                className="mt-2 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-semibold text-gray-700 outline-none focus:border-gray-400"
                              />
                            </div>
                          ))}
                        </div>
                        <label className="block">
                          <span className={labelClass}>Run notes</span>
                          <textarea
                            rows={2}
                            value={draft.notes}
                            onChange={(event) =>
                              updateDraft(run, (current) => ({
                                ...current,
                                notes: event.target.value,
                              }))
                            }
                            placeholder="Shift notes, handover details or exceptions"
                            className={`${inputClass} mt-1`}
                          />
                        </label>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </DepartmentToolShell>
  );
}
