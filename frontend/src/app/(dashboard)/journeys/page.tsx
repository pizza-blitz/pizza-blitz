"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Workflow,
  XCircle,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const API = getApiUrl("/api/v1/restaurant/journeys");
const TEMPLATES_API = getApiUrl("/api/v1/restaurant/messaging/templates");

type Step = {
  type: "delay" | "condition" | "branch" | "stop" | "send";
  hours: number;
  channel: string;
  subject: string;
  body: string;
  field?: string;
  operator?: string;
  value?: number;
  variant?: string;
  true_step?: number;
  false_step?: number;
};
type EnrollmentEvent = {
  id: number;
  step_index: number;
  step_type: string;
  status: string;
  detail?: string | null;
  created_at?: string | null;
};
type Enrollment = {
  id: number;
  trigger_ref: string;
  status: string;
  current_step: number;
  contact?: string | null;
  context: Record<string, unknown>;
  events: EnrollmentEvent[];
  created_at?: string | null;
};
type Journey = {
  id: number;
  name: string;
  description?: string | null;
  trigger: string;
  trigger_label: string;
  status: string;
  steps: Step[];
  enrollment_count: number;
  completed_count: number;
  attributed_revenue: number;
  revenue_per_enrollment: number;
  touch_attribution: {
    model: string;
    window_days: number;
    sent_events: number;
    unique_customers: number;
    converted_customers: number;
    conversion_rate_percent: number;
    orders_attributed: number;
    revenue: number;
    revenue_per_customer: number;
    channels: {
      channel: string;
      sends: number;
      converted_customers: number;
      revenue: number;
    }[];
    engagement: {
      touches: number;
      click_count: number;
      clicked: number;
      click_rate_percent: number;
      open_count: number;
      opened: number;
      open_rate_percent: number;
    };
    steps: {
      step_index: number;
      channel: string;
      sends: number;
      clicks: number;
      opens: number;
      converted_customers: number;
      revenue: number;
    }[];
    step_models: {
      first_touch: StepCredit[];
      last_touch: StepCredit[];
      linear: StepCredit[];
    };
    best_step: StepCredit | null;
    note: string;
  };
  max_sends_per_customer: number;
  frequency_window_hours: number;
  holdout_percent: number;
  holdout_count: number;
  treated_count: number;
  holdout_experiment: {
    enabled: boolean;
    holdout_percent: number;
    treated: {
      customers: number;
      converted: number;
      conversion_rate: number;
      revenue: number;
    };
    holdout: {
      customers: number;
      converted: number;
      conversion_rate: number;
      revenue: number;
    };
    lift_percent: number;
    incremental_revenue: number;
    note: string;
  };
  variants: {
    variant: string;
    enrollments: number;
    completed: number;
    revenue: number;
  }[];
  recent_enrollments: Enrollment[];
};
type Template = { id: number; name: string; channel: string; body: string; subject?: string | null };

type StepCredit = {
  step_index: number;
  channel: string;
  credit_revenue: number;
  conversions: number;
};

const defaultSteps = (): Step[] => [
  { type: "delay", hours: 0, channel: "whatsapp", subject: "", body: "" },
  { type: "send", hours: 0, channel: "whatsapp", subject: "", body: "", variant: "" },
];

const statusTone = (status: string) => {
  if (status === "completed" || status === "sent") return "bg-emerald-100 text-emerald-800";
  if (status === "failed") return "bg-red-100 text-red-700";
  if (status === "skipped") return "bg-amber-100 text-amber-800";
  return "bg-gray-100 text-gray-600";
};

export default function JourneysPage() {
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [triggers, setTriggers] = useState<Record<string, string>>({});
  const [templates, setTemplates] = useState<Template[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [draft, setDraft] = useState({
    name: "",
    description: "",
    trigger: "order_completed",
    status: "draft",
    steps: defaultSteps(),
    max_sends_per_customer: 0,
    frequency_window_hours: 24,
    holdout_percent: 0,
  });

  const load = async () => {
    const [journeysRes, triggersRes, templatesRes] = await Promise.all([
      fetch(API, { credentials: "include", cache: "no-store" }),
      fetch(`${API}/triggers`, { credentials: "include", cache: "no-store" }),
      fetch(TEMPLATES_API, { credentials: "include", cache: "no-store" }),
    ]);
    const journeyData = await journeysRes.json();
    if (!journeysRes.ok) throw new Error(journeyData.detail || "Journeys failed to load.");
    setJourneys(journeyData.journeys || []);
    if (triggersRes.ok) setTriggers((await triggersRes.json()).triggers || {});
    if (templatesRes.ok) setTemplates((await templatesRes.json()).templates || []);
  };

  useEffect(() => {
    setHydrated(true);
    void load().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Journeys failed to load.")
    );
  }, []);

  const updateStep = (index: number, patch: Partial<Step>) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) =>
        stepIndex === index ? { ...step, ...patch } : step
      ),
    }));
  };

  const create = async () => {
    if (!draft.name.trim()) {
      setMessage("Give the journey a name.");
      return;
    }
    if (!draft.steps.some((step) => step.type === "send" && step.body.trim())) {
      setMessage("Add at least one send step with a message body.");
      return;
    }
    setBusy("create");
    setMessage("");
    try {
      const response = await fetch(API, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Journey could not be saved.");
      setShowForm(false);
      setDraft({
        name: "",
        description: "",
        trigger: "order_completed",
        status: "draft",
        steps: defaultSteps(),
        max_sends_per_customer: 0,
        frequency_window_hours: 24,
        holdout_percent: 0,
      });
      await load();
      setMessage(`Journey ${data.journey.name} saved.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Journey could not be saved.");
    } finally {
      setBusy("");
    }
  };

  const updateStatus = async (journey: Journey, status: string) => {
    setBusy(`status-${journey.id}`);
    try {
      const response = await fetch(`${API}/${journey.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Journey status failed.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Journey status failed.");
    } finally {
      setBusy("");
    }
  };

  const runDue = async () => {
    setBusy("run");
    setMessage("");
    try {
      const response = await fetch(`${API}/run-due`, {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Journey run failed.");
      await load();
      setMessage(
        `Journey runner processed ${data.processed} enrollment(s), completed ${data.completed}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Journey run failed.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div
      data-testid="journeys-page"
      data-hydrated={hydrated ? "true" : "false"}
      className="space-y-5 animate-in fade-in duration-300"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
            Marketing · automation
          </p>
          <h1 className="text-3xl font-black text-gray-950">Journeys</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Trigger a sequence from a completed order, a delivered order, low feedback or a
            manual enrollment. Delays and sends run through the durable runner.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void runDue()}
            disabled={busy === "run"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-gray-600"
          >
            {busy === "run" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Run due now
          </button>
          <button
            type="button"
            data-testid="journey-new"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600"
          >
            <Plus className="h-4 w-4" /> New journey
          </button>
        </div>
      </div>

      {message && (
        <p className="rounded-xl border border-gray-100 bg-white px-4 py-3 text-xs font-bold text-gray-700">
          {message}
        </p>
      )}

      {showForm && (
        <section className="rounded-2xl border border-orange-100 bg-white p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-orange-600">
                New journey
              </p>
              <h2 className="text-2xl font-black text-gray-950">Build a sequence</h2>
            </div>
            <button
              type="button"
              aria-label="Close journey form"
              onClick={() => setShowForm(false)}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
            >
              <XCircle className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Name
              <input
                data-testid="journey-name"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
              />
            </label>
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Trigger
              <select
                data-testid="journey-trigger"
                value={draft.trigger}
                onChange={(event) => setDraft({ ...draft, trigger: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
              >
                {Object.entries(triggers).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 md:col-span-2">
              Description
              <input
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
              />
            </label>
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Max sends per customer
              <input
                type="number"
                min={0}
                max={50}
                value={draft.max_sends_per_customer}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    max_sends_per_customer: Number(event.target.value),
                  })
                }
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
              />
            </label>
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Within hours
              <input
                type="number"
                min={1}
                max={720}
                value={draft.frequency_window_hours}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    frequency_window_hours: Number(event.target.value),
                  })
                }
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
              />
            </label>
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Holdout %
              <input
                type="number"
                min={0}
                max={100}
                value={draft.holdout_percent}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    holdout_percent: Math.max(
                      0,
                      Math.min(100, Number(event.target.value))
                    ),
                  })
                }
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
              />
            </label>
            <p className="text-[10px] font-semibold text-gray-400 md:col-span-2">
              0 = no cap. Caps count successful journey sends across all journeys for the same
              customer. Use variant A/B on send steps for a 50/50 creative test.
            </p>
          </div>

          <div className="mt-4 space-y-2">
            {draft.steps.map((step, index) => (
              <div
                key={`${step.type}-${index}`}
                className="rounded-xl border border-gray-100 bg-gray-50/60 p-3"
              >
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                    Step {index + 1} · {step.type}
                  </p>
                  <button
                    type="button"
                    aria-label={`Remove step ${index + 1}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        steps: draft.steps.filter((_, stepIndex) => stepIndex !== index),
                      })
                    }
                    className="text-gray-400 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {step.type === "delay" ? (
                  <label className="mt-2 block text-[10px] font-black uppercase tracking-widest text-gray-400">
                    Wait hours
                    <input
                      type="number"
                      min={0}
                      max={720}
                      value={step.hours}
                      onChange={(event) =>
                        updateStep(index, { hours: Number(event.target.value) })
                      }
                      className="mt-1 w-32 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                    />
                  </label>
                ) : step.type === "branch" ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 md:grid-cols-4">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      If order total
                      <select
                        value={step.operator || ">="}
                        onChange={(event) =>
                          updateStep(index, { operator: event.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm font-semibold text-gray-800"
                      >
                        {[">=", ">", "<=", "<", "==", "!="].map((operator) => (
                          <option key={operator} value={operator}>
                            {operator}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      Value
                      <input
                        type="number"
                        value={step.value ?? 0}
                        onChange={(event) =>
                          updateStep(index, { value: Number(event.target.value) })
                        }
                        className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm font-semibold text-gray-800"
                      />
                    </label>
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      If true → step
                      <input
                        type="number"
                        min={1}
                        value={(step.true_step ?? 0) + 1}
                        onChange={(event) =>
                          updateStep(index, {
                            true_step: Math.max(0, Number(event.target.value) - 1),
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm font-semibold text-gray-800"
                      />
                    </label>
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      If false → step
                      <input
                        type="number"
                        min={1}
                        value={(step.false_step ?? 0) + 1}
                        onChange={(event) =>
                          updateStep(index, {
                            false_step: Math.max(0, Number(event.target.value) - 1),
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm font-semibold text-gray-800"
                      />
                    </label>
                  </div>
                ) : step.type === "stop" ? (
                  <p className="mt-2 rounded-lg bg-gray-100 px-2 py-1.5 text-[10px] font-bold text-gray-500">
                    Ends this path. Use a stop at the end of each branch path so execution
                    does not continue into the next path.
                  </p>
                ) : step.type === "condition" ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_100px_100px]">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      Field
                      <select
                        value={step.field || "order_total"}
                        onChange={(event) =>
                          updateStep(index, { field: event.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                      >
                        <option value="order_total">Order total</option>
                      </select>
                    </label>
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      Operator
                      <select
                        value={step.operator || ">="}
                        onChange={(event) =>
                          updateStep(index, { operator: event.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm font-semibold text-gray-800"
                      >
                        {[">=", ">", "<=", "<", "==", "!="].map((operator) => (
                          <option key={operator} value={operator}>
                            {operator}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      Value
                      <input
                        type="number"
                        value={step.value ?? 0}
                        onChange={(event) =>
                          updateStep(index, { value: Number(event.target.value) })
                        }
                        className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm font-semibold text-gray-800"
                      />
                    </label>
                  </div>
                ) : (
                  <div className="mt-2 grid gap-2 md:grid-cols-[130px_130px_1fr]">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      Channel
                      <select
                        value={step.channel}
                        onChange={(event) =>
                          updateStep(index, { channel: event.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                      >
                        <option value="whatsapp">WhatsApp</option>
                        <option value="sms">SMS</option>
                        <option value="email">Email</option>
                        <option value="instagram">Instagram</option>
                      </select>
                    </label>
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      Variant
                      <select
                        value={step.variant || ""}
                        onChange={(event) =>
                          updateStep(index, { variant: event.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                      >
                        <option value="">All contacts</option>
                        <option value="A">A</option>
                        <option value="B">B</option>
                      </select>
                    </label>
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      Message
                      <div className="mt-1 flex gap-2">
                        {templates.filter((template) => template.channel === step.channel).length > 0 && (
                          <select
                            value=""
                            onChange={(event) => {
                              const template = templates.find(
                                (row) => String(row.id) === event.target.value
                              );
                              if (template) {
                                updateStep(index, {
                                  body: template.body,
                                  subject: template.subject || "",
                                });
                              }
                            }}
                            className="w-36 rounded-lg border border-gray-200 px-2 py-2 text-xs font-bold text-gray-600"
                          >
                            <option value="">Template...</option>
                            {templates
                              .filter((template) => template.channel === step.channel)
                              .map((template) => (
                                <option key={template.id} value={template.id}>
                                  {template.name}
                                </option>
                              ))}
                          </select>
                        )}
                        <input
                          data-testid={`journey-step-body-${index}`}
                          value={step.body}
                          onChange={(event) =>
                            updateStep(index, { body: event.target.value })
                          }
                          placeholder="Message body"
                          className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                        />
                      </div>
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  steps: [
                    ...draft.steps,
                    { type: "delay", hours: 24, channel: "whatsapp", subject: "", body: "" },
                  ],
                })
              }
              className="rounded-lg border border-gray-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-600"
            >
              + Delay
            </button>
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  steps: [
                    ...draft.steps,
                    {
                      type: "condition",
                      hours: 0,
                      channel: "whatsapp",
                      subject: "",
                      body: "",
                      field: "order_total",
                      operator: ">=",
                      value: 500,
                    },
                  ],
                })
              }
              className="rounded-lg border border-gray-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-600"
            >
              + Condition
            </button>
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  steps: [
                    ...draft.steps,
                    {
                      type: "branch",
                      hours: 0,
                      channel: "whatsapp",
                      subject: "",
                      body: "",
                      field: "order_total",
                      operator: ">=",
                      value: 500,
                      true_step: 0,
                      false_step: 0,
                    },
                  ],
                })
              }
              className="rounded-lg border border-gray-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-600"
            >
              + Branch
            </button>
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  steps: [
                    ...draft.steps,
                    { type: "stop", hours: 0, channel: "whatsapp", subject: "", body: "" },
                  ],
                })
              }
              className="rounded-lg border border-gray-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-600"
            >
              + Stop
            </button>
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  steps: [
                    ...draft.steps,
                    { type: "send", hours: 0, channel: "whatsapp", subject: "", body: "" },
                  ],
                })
              }
              className="rounded-lg border border-gray-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-600"
            >
              + Send
            </button>
            <select
              value={draft.status}
              onChange={(event) => setDraft({ ...draft, status: event.target.value })}
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600"
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
            </select>
            <button
              type="button"
              data-testid="journey-save"
              onClick={() => void create()}
              disabled={busy === "create"}
              className="rounded-lg bg-orange-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
            >
              Save journey
            </button>
          </div>
        </section>
      )}

      {journeys.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center">
          <Workflow className="mx-auto h-9 w-9 text-gray-300" />
          <h2 className="mt-3 text-lg font-black text-gray-800">No journeys yet</h2>
          <p className="mt-1 text-sm font-semibold text-gray-500">
            Build a sequence to thank, review-request or win back customers automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {journeys.map((journey) => (
            <section
              key={journey.id}
              data-testid={`journey-${journey.id}`}
              className="rounded-2xl border border-gray-100 bg-white p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-black text-gray-950">{journey.name}</h2>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                      journey.status === "active"
                        ? "bg-emerald-100 text-emerald-800"
                        : journey.status === "paused"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-gray-100 text-gray-500"
                    }`}>
                      {journey.status}
                    </span>
                    <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-orange-700">
                      {journey.trigger_label}
                    </span>
                  </div>
                  {journey.description && (
                    <p className="mt-1 text-xs font-semibold text-gray-500">{journey.description}</p>
                  )}
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    {journey.enrollment_count} enrolled · {journey.completed_count} completed ·{" "}
                    Rs {Number(journey.attributed_revenue || 0).toLocaleString("en-IN")} attributed
                    {journey.max_sends_per_customer
                      ? ` · cap ${journey.max_sends_per_customer}/${journey.frequency_window_hours}h`
                      : ""}
                    {journey.holdout_percent
                      ? ` · ${journey.holdout_count} holdout / ${journey.treated_count} treated`
                      : ""}
                  </p>
                  {journey.holdout_percent > 0 && (
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-sky-700">
                      Treated {journey.holdout_experiment.treated.conversion_rate}% vs holdout{" "}
                      {journey.holdout_experiment.holdout.conversion_rate}% · lift{" "}
                      {journey.holdout_experiment.lift_percent}% · incremental Rs{" "}
                      {Number(
                        journey.holdout_experiment.incremental_revenue || 0
                      ).toLocaleString("en-IN")}
                    </p>
                  )}
                  <p
                    data-testid={`journey-attribution-${journey.id}`}
                    className="mt-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700"
                  >
                    {journey.touch_attribution.sent_events} sends ·{" "}
                    {journey.touch_attribution.engagement.click_count} clicks ·{" "}
                    {journey.touch_attribution.engagement.open_count} opens ·{" "}
                    {journey.touch_attribution.converted_customers}/
                    {journey.touch_attribution.unique_customers} converted (
                    {journey.touch_attribution.conversion_rate_percent}%) · Rs{" "}
                    {Number(journey.touch_attribution.revenue || 0).toLocaleString("en-IN")} in
                    journey orders
                  </p>
                  <p
                    data-testid={`journey-step-models-${journey.id}`}
                    className="mt-1 text-[10px] font-bold text-gray-500"
                  >
                    {journey.touch_attribution.best_step
                      ? `Best step ${journey.touch_attribution.best_step.step_index + 1} · ${
                          journey.touch_attribution.best_step.channel
                        } · Rs ${Number(
                          journey.touch_attribution.best_step.credit_revenue || 0
                        ).toLocaleString("en-IN")} · ${
                          journey.touch_attribution.best_step.conversions
                        } conversion(s)`
                      : "No step credit yet"}
                  </p>
                  {journey.variants.length > 0 && (
                    <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                      {journey.variants.map((variant) => (
                        <div
                          key={variant.variant}
                          className="rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1.5"
                        >
                          <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">
                            Variant {variant.variant}
                          </p>
                          <p className="text-[10px] font-bold text-gray-600">
                            {variant.enrollments} enrolled · {variant.completed} completed · Rs{" "}
                            {Number(variant.revenue || 0).toLocaleString("en-IN")}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-1.5">
                  {journey.status === "active" ? (
                    <button
                      type="button"
                      onClick={() => void updateStatus(journey, "paused")}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-gray-600"
                    >
                      <Pause className="h-3 w-3" /> Pause
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void updateStatus(journey, "active")}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-emerald-700"
                    >
                      <Play className="h-3 w-3" /> Activate
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded(expanded === journey.id ? null : journey.id)
                    }
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-gray-600"
                  >
                    {expanded === journey.id ? "Hide runs" : "View runs"}
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {journey.steps.map((step, index) => (
                  <span
                    key={`${journey.id}-${index}`}
                    className="rounded-lg bg-gray-50 px-2.5 py-1.5 text-[10px] font-bold text-gray-600"
                  >
                    {step.type === "delay"
                      ? `Wait ${step.hours}h`
                      : step.type === "branch"
                        ? `If total ${step.operator || ">="} ${step.value ?? 0} → ${(step.true_step ?? 0) + 1} / ${(step.false_step ?? 0) + 1}`
                        : step.type === "stop"
                          ? "Stop path"
                          : step.type === "condition"
                            ? `If ${step.field || "order_total"} ${step.operator || ">="} ${step.value ?? 0}`
                            : `Send ${step.channel}${step.variant ? ` · ${step.variant}` : ""}`}
                  </span>
                ))}
              </div>

              {expanded === journey.id && (
                <div className="mt-4 space-y-2 border-t border-gray-100 pt-3">
                  {journey.recent_enrollments.length === 0 ? (
                    <p className="text-xs font-semibold text-gray-400">
                      No enrollments yet. Complete an order or use Manual enrollment.
                    </p>
                  ) : (
                    journey.recent_enrollments.map((enrollment) => (
                      <div
                        key={enrollment.id}
                        data-testid={`journey-enrollment-${enrollment.id}`}
                        className="rounded-xl border border-gray-100 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-black text-gray-800">
                            {enrollment.contact || enrollment.trigger_ref}
                          </p>
                          <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${statusTone(enrollment.status)}`}>
                            {enrollment.status}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[10px] font-semibold text-gray-400">
                          {enrollment.trigger_ref}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {enrollment.events.map((event) => (
                            <span
                              key={event.id}
                              title={event.detail || undefined}
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold ${statusTone(event.status)}`}
                            >
                              {event.status === "sent" || event.status === "completed" ? (
                                <CheckCircle2 className="h-2.5 w-2.5" />
                              ) : event.status === "failed" || event.status === "skipped" ? (
                                <XCircle className="h-2.5 w-2.5" />
                              ) : (
                                <Clock3 className="h-2.5 w-2.5" />
                              )}
                              step {event.step_index + 1} · {event.step_type} · {event.status}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
