"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Plus,
  Save,
  Thermometer,
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
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  todayIso,
} from "@/components/department-tools";

type AttentionItem = {
  kind: string;
  label: string;
  severity: string;
  due_on: string | null;
};

type QualityOverview = {
  audits_due: number;
  audits_completed_30d: number;
  average_score: number | null;
  open_findings: number;
  temperature_checks_24h: number;
  temperature_breaches_24h: number;
  licences_expiring: number;
  licences_expired: number;
  compliance_score: number | null;
  attention: AttentionItem[];
};

type AuditFinding = {
  label: string;
  severity: string;
  status: string;
  note: string | null;
};

type QualityAudit = {
  id: number;
  title: string;
  audit_type: string;
  auditor: string | null;
  status: string;
  score: number | null;
  max_score: number;
  score_pct: number | null;
  findings: AuditFinding[];
  open_findings: number;
  notes: string | null;
  scheduled_for: string | null;
  completed_at: string | null;
  created_at: string;
};

type AuditSummary = {
  total: number;
  scheduled: number;
  in_progress: number;
  completed: number;
  overdue: number;
  average_score: number | null;
};

type AuditsPayload = {
  items: QualityAudit[];
  summary: AuditSummary;
};

type TemperatureCheck = {
  id: number;
  unit_name: string;
  unit_type: string;
  temperature_c: number;
  status: string;
  recorded_by: string | null;
  recorded_at: string;
  notes: string | null;
};

type TemperatureSummary = {
  checks: number;
  ok: number;
  warning: number;
  breach: number;
  last_recorded_at: string | null;
};

type TemperaturesPayload = {
  items: TemperatureCheck[];
  summary: TemperatureSummary;
};

type Tone = "neutral" | "good" | "warn" | "bad" | "info";

type FindingDraft = {
  label: string;
  severity: string;
  status: string;
  note: string;
};

type AuditForm = {
  title: string;
  audit_type: string;
  scheduled_for: string;
  auditor: string;
  max_score: string;
};

const EMPTY_AUDIT_FORM: AuditForm = {
  title: "",
  audit_type: "hygiene",
  scheduled_for: todayIso(),
  auditor: "",
  max_score: "100",
};

type TemperatureForm = {
  unit_name: string;
  unit_type: string;
  temperature_c: string;
  recorded_by: string;
  notes: string;
};

const EMPTY_TEMPERATURE_FORM: TemperatureForm = {
  unit_name: "",
  unit_type: "fridge",
  temperature_c: "",
  recorded_by: "",
  notes: "",
};

const AUDIT_TYPES = [
  "hygiene",
  "food_safety",
  "equipment",
  "guest_experience",
] as const;
const FINDING_SEVERITIES = ["low", "medium", "high", "critical"] as const;
const FINDING_STATUSES = ["open", "closed"] as const;
const TEMPERATURE_TYPES = ["fridge", "freezer", "hot_holding"] as const;

function labelize(value: string) {
  return value.replace(/_/g, " ");
}

function scoreTone(score: number | null | undefined): Tone {
  const value = score ?? 0;
  if (value >= 90) return "good";
  if (value >= 70) return "warn";
  return value > 0 ? "bad" : "neutral";
}

function severityClass(severity: string) {
  const key = severity.toLowerCase();
  if (key === "critical") return "bg-red-50 text-red-700 border-red-100";
  if (key === "high") return "bg-amber-50 text-amber-700 border-amber-100";
  if (key === "medium") return "bg-blue-50 text-blue-700 border-blue-100";
  return "bg-gray-50 text-gray-600 border-gray-200";
}

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

export default function QualityAuditsPage() {
  const [tab, setTab] = useState<"audits" | "temperatures">("audits");
  const [overview, setOverview] = useState<QualityOverview | null>(null);
  const [audits, setAudits] = useState<QualityAudit[]>([]);
  const [auditSummary, setAuditSummary] = useState<AuditSummary | null>(null);
  const [temperatures, setTemperatures] = useState<TemperatureCheck[]>([]);
  const [temperatureSummary, setTemperatureSummary] =
    useState<TemperatureSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [showAuditForm, setShowAuditForm] = useState(false);
  const [auditForm, setAuditForm] = useState<AuditForm>(EMPTY_AUDIT_FORM);
  const [selectedAuditId, setSelectedAuditId] = useState<number | null>(null);
  const [scoreDraft, setScoreDraft] = useState("");
  const [findingsDraft, setFindingsDraft] = useState<FindingDraft[]>([]);
  const [auditNotes, setAuditNotes] = useState("");
  const [temperatureForm, setTemperatureForm] = useState<TemperatureForm>(
    EMPTY_TEMPERATURE_FORM
  );

  const selectedAudit =
    audits.find((audit) => audit.id === selectedAuditId) || null;

  const loadOverview = async () => {
    try {
      const data = await apiRequest<QualityOverview>(
        "/api/v1/restaurant/company/quality/overview"
      );
      setOverview(data);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Quality overview failed to load."
      );
    }
  };

  const loadAudits = async () => {
    try {
      const data = await apiRequest<AuditsPayload>(
        "/api/v1/restaurant/company/quality/audits"
      );
      setAudits(data.items || []);
      setAuditSummary(data.summary || null);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Audits failed to load."
      );
    }
  };

  const loadTemperatures = async () => {
    try {
      const data = await apiRequest<TemperaturesPayload>(
        "/api/v1/restaurant/company/quality/temperatures?days=7"
      );
      setTemperatures(data.items || []);
      setTemperatureSummary(data.summary || null);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Temperature log failed to load."
      );
    }
  };

  const loadAll = async () => {
    await Promise.all([loadOverview(), loadAudits(), loadTemperatures()]);
    setIsLoading(false);
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createAudit = async () => {
    const title = auditForm.title.trim();
    if (!title) {
      setMessage("Audit title is required.");
      return;
    }
    if (!auditForm.scheduled_for) {
      setMessage("Choose a scheduled date for the audit.");
      return;
    }
    const maxScore = Number(auditForm.max_score);
    if (!Number.isFinite(maxScore) || maxScore <= 0) {
      setMessage("Max score must be greater than zero.");
      return;
    }
    setBusyKey("create-audit");
    setMessage("");
    setNotice("");
    try {
      await apiRequest<unknown>("/api/v1/restaurant/company/quality/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          audit_type: auditForm.audit_type,
          scheduled_for: auditForm.scheduled_for,
          auditor: auditForm.auditor.trim() || null,
          max_score: maxScore,
        }),
      });
      setShowAuditForm(false);
      setAuditForm({ ...EMPTY_AUDIT_FORM, scheduled_for: todayIso() });
      await Promise.all([loadAudits(), loadOverview()]);
      setNotice(`${title} audit scheduled.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Audit could not be created."
      );
    } finally {
      setBusyKey("");
    }
  };

  const openAuditPanel = (audit: QualityAudit) => {
    setSelectedAuditId(audit.id);
    setScoreDraft(audit.score === null ? "" : String(audit.score));
    setFindingsDraft(
      audit.findings.map((finding) => ({
        label: finding.label,
        severity: finding.severity,
        status: finding.status,
        note: finding.note || "",
      }))
    );
    setAuditNotes(audit.notes || "");
    setMessage("");
    setNotice("");
  };

  const parseScore = (maxScore: number): number | null | undefined => {
    if (scoreDraft.trim() === "") return null;
    const value = Number(scoreDraft);
    if (!Number.isFinite(value) || value < 0 || value > maxScore) {
      return undefined;
    }
    return value;
  };

  const saveAudit = async () => {
    if (!selectedAudit) return;
    const scoreValue = parseScore(selectedAudit.max_score);
    if (scoreValue === undefined) {
      setMessage(`Score must be between 0 and ${selectedAudit.max_score}.`);
      return;
    }
    setBusyKey(`audit-${selectedAudit.id}`);
    setMessage("");
    setNotice("");
    try {
      await apiRequest<unknown>(
        `/api/v1/restaurant/company/quality/audits/${selectedAudit.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "in_progress",
            score: scoreValue,
            findings: findingsDraft
              .filter((finding) => finding.label.trim().length > 0)
              .map((finding) => ({
                label: finding.label.trim(),
                severity: finding.severity,
                status: finding.status,
                note: finding.note.trim() || null,
              })),
            notes: auditNotes.trim() || null,
          }),
        }
      );
      await Promise.all([loadAudits(), loadOverview()]);
      setNotice(`${selectedAudit.title} scoring saved.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Audit could not be saved."
      );
    } finally {
      setBusyKey("");
    }
  };

  const completeAudit = async () => {
    if (!selectedAudit) return;
    setBusyKey(`audit-${selectedAudit.id}`);
    setMessage("");
    setNotice("");
    try {
      await apiRequest<unknown>(
        `/api/v1/restaurant/company/quality/audits/${selectedAudit.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "completed" }),
        }
      );
      await Promise.all([loadAudits(), loadOverview()]);
      setNotice(`${selectedAudit.title} marked complete.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Audit could not be completed."
      );
    } finally {
      setBusyKey("");
    }
  };

  const addTemperature = async () => {
    const unitName = temperatureForm.unit_name.trim();
    if (!unitName) {
      setMessage("Temperature unit name is required.");
      return;
    }
    const temperature = Number(temperatureForm.temperature_c);
    if (
      !temperatureForm.temperature_c.trim() ||
      !Number.isFinite(temperature)
    ) {
      setMessage("Enter a valid temperature in °C.");
      return;
    }
    setBusyKey("temperature");
    setMessage("");
    setNotice("");
    try {
      await apiRequest<unknown>("/api/v1/restaurant/company/quality/temperatures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unit_name: unitName,
          unit_type: temperatureForm.unit_type,
          temperature_c: temperature,
          recorded_by: temperatureForm.recorded_by.trim() || null,
          notes: temperatureForm.notes.trim() || null,
        }),
      });
      setTemperatureForm(EMPTY_TEMPERATURE_FORM);
      await Promise.all([loadTemperatures(), loadOverview()]);
      setNotice(`Temperature recorded for ${unitName}.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Temperature could not be recorded."
      );
    } finally {
      setBusyKey("");
    }
  };

  const updateFinding = (
    index: number,
    field: keyof FindingDraft,
    value: string
  ) => {
    setFindingsDraft((previous) =>
      previous.map((finding, rowIndex) =>
        rowIndex === index ? { ...finding, [field]: value } : finding
      )
    );
  };

  const attention = overview?.attention || [];

  return (
    <DepartmentToolShell
      departmentKey="quality"
      departmentLabel="Quality"
      title="Audits & food safety"
      subtitle="Schedule audits, capture findings and keep daily temperature checks visible for the quality team."
    >
      <div data-testid="audits-page" className="space-y-6">
        <ErrorNote message={message} />
        {notice ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
            {notice}
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard
            label="Compliance score"
            value={`${Math.round(overview?.compliance_score ?? 0)}%`}
            hint="Latest quality snapshot"
            tone={scoreTone(overview?.compliance_score)}
          />
          <StatCard
            label="Audits due"
            value={overview?.audits_due ?? 0}
            hint={`${auditSummary?.overdue ?? 0} overdue`}
            tone={(overview?.audits_due ?? 0) > 0 ? "warn" : "neutral"}
          />
          <StatCard
            label="Average score"
            value={`${Math.round(overview?.average_score ?? 0)}%`}
            hint={`${overview?.audits_completed_30d ?? 0} completed in 30 days`}
            tone={scoreTone(overview?.average_score)}
          />
          <StatCard
            label="Open findings"
            value={overview?.open_findings ?? 0}
            tone={(overview?.open_findings ?? 0) > 0 ? "bad" : "good"}
          />
          <StatCard
            label="Breaches (24h)"
            value={overview?.temperature_breaches_24h ?? 0}
            hint={`${overview?.temperature_checks_24h ?? 0} checks logged`}
            tone={
              (overview?.temperature_breaches_24h ?? 0) > 0 ? "bad" : "good"
            }
          />
        </section>

        {attention.length > 0 ? (
          <Panel
            title="Needs attention"
            description="Upcoming and overdue compliance items across quality."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {attention.map((item, index) => (
                <div
                  key={`${item.kind}-${item.label}-${index}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2"
                >
                  <div>
                    <p className="text-xs font-black text-gray-800">
                      {item.label}
                    </p>
                    <p className="text-[10px] font-semibold capitalize text-gray-400">
                      {labelize(item.kind)}
                      {item.due_on ? ` · due ${formatDate(item.due_on)}` : ""}
                    </p>
                  </div>
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${severityClass(
                      item.severity
                    )}`}
                  >
                    {item.severity}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        ) : null}

        <div className="flex w-fit flex-wrap items-center gap-1 rounded-xl border border-gray-200 bg-white p-1">
          <button
            type="button"
            data-testid="quality-tab-audits"
            onClick={() => setTab("audits")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest ${
              tab === "audits"
                ? "bg-gray-950 text-white"
                : "text-gray-500 hover:bg-gray-50"
            }`}
          >
            <ClipboardCheck className="h-3.5 w-3.5" /> Audits
          </button>
          <button
            type="button"
            data-testid="quality-tab-temperatures"
            onClick={() => setTab("temperatures")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest ${
              tab === "temperatures"
                ? "bg-gray-950 text-white"
                : "text-gray-500 hover:bg-gray-50"
            }`}
          >
            <Thermometer className="h-3.5 w-3.5" /> Temperature log
          </button>
        </div>

        {tab === "audits" ? (
          <>
            {showAuditForm ? (
              <Panel
                title="Schedule audit"
                description="Create a scheduled audit with its maximum score."
                actions={
                  <button
                    type="button"
                    aria-label="Close audit form"
                    onClick={() => setShowAuditForm(false)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                }
              >
                <form
                  data-testid="audit-create-form"
                  className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createAudit();
                  }}
                >
                  <label className="block">
                    <span className={labelClass}>Title</span>
                    <input
                      data-testid="audit-create-title"
                      value={auditForm.title}
                      onChange={(event) =>
                        setAuditForm({ ...auditForm, title: event.target.value })
                      }
                      placeholder="Weekly kitchen hygiene audit"
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                  <label className="block">
                    <span className={labelClass}>Type</span>
                    <select
                      value={auditForm.audit_type}
                      onChange={(event) =>
                        setAuditForm({
                          ...auditForm,
                          audit_type: event.target.value,
                        })
                      }
                      className={`${inputClass} mt-1`}
                    >
                      {AUDIT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {labelize(type)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={labelClass}>Scheduled for</span>
                    <input
                      type="date"
                      value={auditForm.scheduled_for}
                      onChange={(event) =>
                        setAuditForm({
                          ...auditForm,
                          scheduled_for: event.target.value,
                        })
                      }
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                  <label className="block">
                    <span className={labelClass}>Auditor</span>
                    <input
                      value={auditForm.auditor}
                      onChange={(event) =>
                        setAuditForm({
                          ...auditForm,
                          auditor: event.target.value,
                        })
                      }
                      placeholder="Internal or external auditor"
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                  <label className="block">
                    <span className={labelClass}>Max score</span>
                    <input
                      type="number"
                      min={1}
                      value={auditForm.max_score}
                      onChange={(event) =>
                        setAuditForm({
                          ...auditForm,
                          max_score: event.target.value,
                        })
                      }
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                  <div className="flex items-end justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAuditForm(false)}
                      className={secondaryButtonClass}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      data-testid="audit-create-save"
                      disabled={busyKey === "create-audit"}
                      className={`${primaryButtonClass} inline-flex items-center gap-1.5`}
                    >
                      {busyKey === "create-audit" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      Schedule audit
                    </button>
                  </div>
                </form>
              </Panel>
            ) : null}

            <Panel
              title="Audits"
              description="Scheduled, in-progress and completed quality audits."
              actions={
                <button
                  type="button"
                  data-testid="audit-create-open"
                  onClick={() => {
                    setShowAuditForm(true);
                    setMessage("");
                    setNotice("");
                  }}
                  className={`${primaryButtonClass} inline-flex items-center gap-1.5`}
                >
                  <Plus className="h-3.5 w-3.5" /> Schedule audit
                </button>
              }
            >
              {isLoading ? (
                <LoadingRow label="Loading audits..." />
              ) : audits.length === 0 ? (
                <EmptyState
                  title="No audits yet"
                  body="Schedule the first hygiene or food safety audit to start scoring."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left">
                    <thead>
                      <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                        <th className="px-2 py-2">Audit</th>
                        <th className="px-2 py-2">Scheduled</th>
                        <th className="px-2 py-2">Auditor</th>
                        <th className="px-2 py-2">Status</th>
                        <th className="px-2 py-2">Score</th>
                        <th className="px-2 py-2">Open findings</th>
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {audits.map((audit) => (
                        <tr
                          key={audit.id}
                          data-testid={`audit-row-${audit.id}`}
                          className={`border-b border-gray-50 text-sm ${
                            audit.status === "overdue" ? "bg-amber-50/40" : ""
                          }`}
                        >
                          <td className="px-2 py-3">
                            <p className="font-black text-gray-900">
                              {audit.title}
                            </p>
                            <p className="text-[10px] font-semibold capitalize text-gray-400">
                              {labelize(audit.audit_type)}
                            </p>
                          </td>
                          <td className="px-2 py-3 text-xs font-bold text-gray-600">
                            {formatDate(audit.scheduled_for)}
                          </td>
                          <td className="px-2 py-3 text-xs font-bold text-gray-600">
                            {audit.auditor || "Unassigned"}
                          </td>
                          <td className="px-2 py-3">
                            <StatusBadge label={audit.status} />
                          </td>
                          <td className="px-2 py-3">
                            <p className="text-xs font-black text-gray-700">
                              {audit.score === null
                                ? "—"
                                : `${audit.score}/${audit.max_score}`}
                            </p>
                            {audit.score_pct !== null ? (
                              <p className="text-[10px] font-semibold text-gray-400">
                                {Math.round(audit.score_pct)}%
                              </p>
                            ) : null}
                          </td>
                          <td className="px-2 py-3">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                                audit.open_findings > 0
                                  ? "bg-red-50 text-red-700"
                                  : "bg-emerald-50 text-emerald-700"
                              }`}
                            >
                              {audit.open_findings} open
                            </span>
                          </td>
                          <td className="px-2 py-3 text-right">
                            <button
                              type="button"
                              data-testid={`audit-open-${audit.id}`}
                              onClick={() => openAuditPanel(audit)}
                              className={secondaryButtonClass}
                            >
                              Open
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            {selectedAudit ? (
              <Panel
                title="Scoring panel"
                description={`${selectedAudit.title} · ${labelize(
                  selectedAudit.audit_type
                )} · ${formatDate(selectedAudit.scheduled_for)}`}
                actions={
                  <button
                    type="button"
                    aria-label="Close scoring panel"
                    onClick={() => setSelectedAuditId(null)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                }
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <StatusBadge label={selectedAudit.status} />
                  <span className="text-[10px] font-bold text-gray-400">
                    Auditor: {selectedAudit.auditor || "Unassigned"}
                  </span>
                  <span className="text-[10px] font-bold text-gray-400">
                    Max score: {selectedAudit.max_score}
                  </span>
                </div>

                <div className="grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
                  <label className="block">
                    <span className={labelClass}>Score</span>
                    <input
                      data-testid="audit-score"
                      type="number"
                      min={0}
                      max={selectedAudit.max_score}
                      step="0.5"
                      value={scoreDraft}
                      onChange={(event) => setScoreDraft(event.target.value)}
                      placeholder="0"
                      className={`${inputClass} mt-1`}
                    />
                    <span className="mt-1 block text-[10px] font-semibold text-gray-400">
                      Between 0 and {selectedAudit.max_score}
                    </span>
                  </label>
                  <label className="block">
                    <span className={labelClass}>Audit notes</span>
                    <textarea
                      rows={3}
                      value={auditNotes}
                      onChange={(event) => setAuditNotes(event.target.value)}
                      placeholder="Context, evidence or follow-up actions"
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <p className={labelClass}>Findings</p>
                    <button
                      type="button"
                      onClick={() =>
                        setFindingsDraft((previous) => [
                          ...previous,
                          {
                            label: "",
                            severity: "medium",
                            status: "open",
                            note: "",
                          },
                        ])
                      }
                      className={`${secondaryButtonClass} inline-flex items-center gap-1`}
                    >
                      <Plus className="h-3 w-3" /> Add finding
                    </button>
                  </div>

                  {findingsDraft.length === 0 ? (
                    <div className="mt-2">
                      <EmptyState
                        title="No findings recorded"
                        body="Add a finding if the audit uncovered anything that needs follow-up."
                      />
                    </div>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {findingsDraft.map((finding, index) => (
                        <div
                          key={index}
                          className="grid gap-2 rounded-lg border border-gray-100 bg-gray-50/60 p-2 sm:grid-cols-2 lg:grid-cols-[1.4fr_0.8fr_0.8fr_1.4fr_auto]"
                        >
                          <input
                            value={finding.label}
                            onChange={(event) =>
                              updateFinding(index, "label", event.target.value)
                            }
                            placeholder="Finding"
                            aria-label={`Finding ${index + 1} label`}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-semibold text-gray-800 outline-none focus:border-gray-400"
                          />
                          <select
                            value={finding.severity}
                            onChange={(event) =>
                              updateFinding(
                                index,
                                "severity",
                                event.target.value
                              )
                            }
                            aria-label={`Finding ${index + 1} severity`}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-bold text-gray-700"
                          >
                            {FINDING_SEVERITIES.map((severity) => (
                              <option key={severity} value={severity}>
                                {severity}
                              </option>
                            ))}
                          </select>
                          <select
                            value={finding.status}
                            onChange={(event) =>
                              updateFinding(index, "status", event.target.value)
                            }
                            aria-label={`Finding ${index + 1} status`}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-bold text-gray-700"
                          >
                            {FINDING_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                          <input
                            value={finding.note}
                            onChange={(event) =>
                              updateFinding(index, "note", event.target.value)
                            }
                            placeholder="Note (optional)"
                            aria-label={`Finding ${index + 1} note`}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-semibold text-gray-800 outline-none focus:border-gray-400"
                          />
                          <button
                            type="button"
                            aria-label={`Remove finding ${index + 1}`}
                            onClick={() =>
                              setFindingsDraft((previous) =>
                                previous.filter(
                                  (_finding, rowIndex) => rowIndex !== index
                                )
                              )
                            }
                            className="justify-self-end rounded-lg p-1.5 text-gray-400 hover:bg-white hover:text-red-600"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    data-testid="audit-save"
                    onClick={() => void saveAudit()}
                    disabled={busyKey === `audit-${selectedAudit.id}`}
                    className={`${primaryButtonClass} inline-flex items-center gap-1.5`}
                  >
                    {busyKey === `audit-${selectedAudit.id}` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    Save scoring
                  </button>
                  <button
                    type="button"
                    data-testid="audit-complete"
                    onClick={() => void completeAudit()}
                    disabled={
                      busyKey === `audit-${selectedAudit.id}` ||
                      selectedAudit.status === "completed"
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Mark complete
                  </button>
                </div>
              </Panel>
            ) : null}
          </>
        ) : (
          <>
            <Panel
              title="Record temperature"
              description="Log fridge, freezer and hot-holding checks as they happen."
            >
              <form
                data-testid="temperature-form"
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addTemperature();
                }}
              >
                <label className="block lg:col-span-1">
                  <span className={labelClass}>Unit name</span>
                  <input
                    data-testid="temperature-unit"
                    value={temperatureForm.unit_name}
                    onChange={(event) =>
                      setTemperatureForm({
                        ...temperatureForm,
                        unit_name: event.target.value,
                      })
                    }
                    placeholder="Walk-in fridge 1"
                    className={`${inputClass} mt-1`}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>Unit type</span>
                  <select
                    value={temperatureForm.unit_type}
                    onChange={(event) =>
                      setTemperatureForm({
                        ...temperatureForm,
                        unit_type: event.target.value,
                      })
                    }
                    className={`${inputClass} mt-1`}
                  >
                    {TEMPERATURE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {labelize(type)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={labelClass}>Temperature (°C)</span>
                  <input
                    data-testid="temperature-value"
                    type="number"
                    step="0.1"
                    value={temperatureForm.temperature_c}
                    onChange={(event) =>
                      setTemperatureForm({
                        ...temperatureForm,
                        temperature_c: event.target.value,
                      })
                    }
                    placeholder="4.0"
                    className={`${inputClass} mt-1`}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>Recorded by</span>
                  <input
                    value={temperatureForm.recorded_by}
                    onChange={(event) =>
                      setTemperatureForm({
                        ...temperatureForm,
                        recorded_by: event.target.value,
                      })
                    }
                    placeholder="Staff name"
                    className={`${inputClass} mt-1`}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>Notes</span>
                  <input
                    value={temperatureForm.notes}
                    onChange={(event) =>
                      setTemperatureForm({
                        ...temperatureForm,
                        notes: event.target.value,
                      })
                    }
                    placeholder="Optional"
                    className={`${inputClass} mt-1`}
                  />
                </label>
                <div className="flex justify-end sm:col-span-2 lg:col-span-5">
                  <button
                    type="submit"
                    data-testid="temperature-save"
                    disabled={busyKey === "temperature"}
                    className={`${primaryButtonClass} inline-flex items-center gap-1.5`}
                  >
                    {busyKey === "temperature" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Thermometer className="h-3.5 w-3.5" />
                    )}
                    Record check
                  </button>
                </div>
              </form>
            </Panel>

            <Panel
              title="Recent temperature checks"
              description={
                temperatureSummary
                  ? `${temperatureSummary.checks} checks in 7 days · ${temperatureSummary.ok} ok · ${temperatureSummary.warning} warning · ${temperatureSummary.breach} breach`
                  : "Fridge, freezer and hot-holding readings from the last seven days."
              }
              actions={
                <button
                  type="button"
                  onClick={() => void loadTemperatures()}
                  className={secondaryButtonClass}
                >
                  Refresh
                </button>
              }
            >
              {isLoading ? (
                <LoadingRow label="Loading temperature checks..." />
              ) : temperatures.length === 0 ? (
                <EmptyState
                  title="No temperature checks yet"
                  body="Record the first fridge or hot-holding reading to start the log."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left">
                    <thead>
                      <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                        <th className="px-2 py-2">Recorded</th>
                        <th className="px-2 py-2">Unit</th>
                        <th className="px-2 py-2">Reading</th>
                        <th className="px-2 py-2">Status</th>
                        <th className="px-2 py-2">Recorded by</th>
                        <th className="px-2 py-2">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {temperatures.map((check) => (
                        <tr
                          key={check.id}
                          data-testid={`temperature-row-${check.id}`}
                          className={`border-b border-gray-50 text-sm ${
                            check.status === "breach" ? "bg-red-50/70" : ""
                          }`}
                        >
                          <td className="px-2 py-3 text-xs font-bold text-gray-600">
                            {formatDate(check.recorded_at)}
                          </td>
                          <td className="px-2 py-3">
                            <p className="font-black text-gray-900">
                              {check.unit_name}
                            </p>
                            <p className="text-[10px] font-semibold capitalize text-gray-400">
                              {labelize(check.unit_type)}
                            </p>
                          </td>
                          <td
                            className={`px-2 py-3 text-sm font-black ${
                              check.status === "breach"
                                ? "text-red-700"
                                : "text-gray-800"
                            }`}
                          >
                            {check.temperature_c}°C
                          </td>
                          <td className="px-2 py-3">
                            <StatusBadge label={check.status} />
                          </td>
                          <td className="px-2 py-3 text-xs font-bold text-gray-600">
                            {check.recorded_by || "—"}
                          </td>
                          <td className="px-2 py-3 text-xs font-semibold text-gray-500">
                            {check.notes || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </>
        )}
      </div>
    </DepartmentToolShell>
  );
}
