"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Loader2,
  UserPlus,
  X,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type Task = {
  id: number;
  title: string;
  category: string;
  status: string;
  notes?: string | null;
};

type Candidate = {
  id: number;
  candidate_code: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  designation?: string | null;
  employment_type: string;
  store_id?: number | null;
  store_name?: string | null;
  expected_joining_date?: string | null;
  status: string;
  source?: string | null;
  notes?: string | null;
  employee_id?: number | null;
  task_count: number;
  done_count: number;
  progress: number;
  tasks: Task[];
};

type Summary = {
  total: number;
  documents_pending: number;
  verification: number;
  ready: number;
  joined: number;
  withdrawn: number;
};

type StoreRow = { id: number; name: string };

const EMPTY = {
  full_name: "",
  email: "",
  phone: "",
  designation: "",
  employment_type: "full_time",
  store_id: "",
  expected_joining_date: "",
  source: "",
  notes: "",
};

const STATUS_LABELS: Record<string, string> = {
  documents_pending: "Documents pending",
  verification: "Verification",
  ready: "Ready to join",
  joined: "Joined",
  withdrawn: "Withdrawn",
};

export default function HROnboardingPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [form, setForm] = useState({ ...EMPTY });

  const load = async () => {
    try {
      const [candidateRes, summaryRes, storeRes] = await Promise.all([
        fetch(getApiUrl("/api/v1/restaurant/hr/onboarding/candidates"), {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(getApiUrl("/api/v1/restaurant/hr/onboarding/summary"), {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(getApiUrl("/api/v1/restaurant/stores/"), {
          credentials: "include",
          cache: "no-store",
        }),
      ]);
      const data = await candidateRes.json();
      if (!candidateRes.ok) throw new Error(data.detail || "Onboarding failed to load.");
      setCandidates(data.candidates || []);
      if (summaryRes.ok) setSummary(await summaryRes.json());
      if (storeRes.ok) setStores((await storeRes.json()).stores || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Onboarding failed to load.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setHydrated(true);
    void load();
  }, []);

  const create = async () => {
    if (!form.full_name.trim()) {
      setMessage("Candidate name is required.");
      return;
    }
    setBusy("create");
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/hr/onboarding/candidates"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            store_id: form.store_id ? Number(form.store_id) : null,
            expected_joining_date: form.expected_joining_date || null,
            email: form.email.trim() || null,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Candidate failed.");
      setShowCreate(false);
      setForm({ ...EMPTY });
      await load();
      setSelected(data);
      setMessage(`${data.full_name} added to onboarding.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Candidate failed.");
    } finally {
      setBusy("");
    }
  };

  const refreshCandidate = async (id: number) => {
    const response = await fetch(
      getApiUrl(`/api/v1/restaurant/hr/onboarding/candidates/${id}`),
      { credentials: "include", cache: "no-store" }
    );
    if (response.ok) setSelected(await response.json());
  };

  const toggleTask = async (task: Task) => {
    setBusy(`task-${task.id}`);
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/hr/onboarding/tasks/${task.id}`),
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: task.status === "done" ? "pending" : "done",
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Task failed.");
      if (selected) await refreshCandidate(selected.id);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task failed.");
    } finally {
      setBusy("");
    }
  };

  const setStatus = async (status: string) => {
    if (!selected) return;
    setBusy("status");
    try {
      const response = await fetch(
        getApiUrl(
          `/api/v1/restaurant/hr/onboarding/candidates/${selected.id}`
        ),
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Status failed.");
      setSelected(data);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Status failed.");
    } finally {
      setBusy("");
    }
  };

  const convert = async () => {
    if (!selected) return;
    setBusy("convert");
    try {
      const response = await fetch(
        getApiUrl(
          `/api/v1/restaurant/hr/onboarding/candidates/${selected.id}/convert`
        ),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Conversion failed.");
      setSelected(data.candidate);
      await load();
      setMessage(
        `${data.employee.full_name} joined as ${data.employee.employee_code}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Conversion failed.");
    } finally {
      setBusy("");
    }
  };

  const readyToConvert =
    selected && selected.status !== "joined" && selected.progress === 100;
  const cards = useMemo(
    () => [
      { label: "Candidates", value: summary?.total ?? 0 },
      { label: "Documents pending", value: summary?.documents_pending ?? 0 },
      { label: "Ready to join", value: summary?.ready ?? 0 },
      { label: "Joined", value: summary?.joined ?? 0 },
    ],
    [summary]
  );

  return (
    <div
      data-testid="hr-onboarding-page"
      data-hydrated={hydrated ? "true" : "false"}
      className="space-y-6 animate-in fade-in duration-300"
    >
      <div>
        <Link
          href="/departments/hr"
          className="inline-flex items-center gap-1 text-xs font-black uppercase tracking-widest text-gray-400 hover:text-orange-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> People & HR
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-teal-700">
              HR department · Onboarding
            </p>
            <h1 className="text-3xl font-black text-gray-950">Onboarding pipeline</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              Candidate records, document/verification checklist and conversion to an
              employee only after every task is complete.
            </p>
          </div>
          <button
            type="button"
            data-testid="onboarding-create-open"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-teal-700"
          >
            <UserPlus className="h-4 w-4" /> New candidate
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-900">
          {message}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-gray-100 bg-white p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              {card.label}
            </p>
            <p className="mt-1 text-2xl font-black text-gray-950">{card.value}</p>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
        {isLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm font-bold text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading candidates...
          </div>
        ) : candidates.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm font-semibold text-gray-400">
            No candidates in onboarding yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                  <th className="px-3 py-2">Candidate</th>
                  <th className="px-3 py-2">Designation</th>
                  <th className="px-3 py-2">Joining</th>
                  <th className="px-3 py-2">Checklist</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => (
                  <tr
                    key={candidate.id}
                    data-testid={`onboarding-row-${candidate.candidate_code}`}
                    className="border-b border-gray-50 text-sm"
                  >
                    <td className="px-3 py-3">
                      <p className="font-black text-gray-900">{candidate.full_name}</p>
                      <p className="text-[10px] font-semibold text-gray-400">
                        {candidate.candidate_code}
                        {candidate.email ? ` · ${candidate.email}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-xs font-semibold text-gray-600">
                      {candidate.designation || "—"}
                    </td>
                    <td className="px-3 py-3 text-xs font-semibold text-gray-600">
                      {candidate.expected_joining_date || "—"}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className="h-full rounded-full bg-teal-600"
                            style={{ width: `${candidate.progress}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-bold text-gray-500">
                          {candidate.done_count}/{candidate.task_count}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest ${
                          candidate.status === "joined"
                            ? "bg-emerald-100 text-emerald-800"
                            : candidate.status === "ready"
                              ? "bg-teal-100 text-teal-800"
                              : candidate.status === "withdrawn"
                                ? "bg-gray-100 text-gray-500"
                                : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {STATUS_LABELS[candidate.status] || candidate.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setSelected(candidate)}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-gray-600"
                      >
                        Open <ArrowRight className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div data-testid="onboarding-create-form" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <h2 className="text-2xl font-black text-gray-950">New candidate</h2>
              <button type="button" onClick={() => setShowCreate(false)} aria-label="Close">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 sm:col-span-2">
                Full name
                <input
                  data-testid="onboarding-name"
                  value={form.full_name}
                  onChange={(event) => setForm({ ...form, full_name: event.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                />
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Email
                <input
                  type="email"
                  data-testid="onboarding-email"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Phone
                <input
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Designation
                <input
                  value={form.designation}
                  onChange={(event) => setForm({ ...form, designation: event.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Store
                <select
                  value={form.store_id}
                  onChange={(event) => setForm({ ...form, store_id: event.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                >
                  <option value="">All stores</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Expected joining
                <input
                  type="date"
                  data-testid="onboarding-date"
                  value={form.expected_joining_date}
                  onChange={(event) =>
                    setForm({ ...form, expected_joining_date: event.target.value })
                  }
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                />
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Source
                <input
                  value={form.source}
                  onChange={(event) => setForm({ ...form, source: event.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
            </div>
            <button
              type="button"
              data-testid="onboarding-create-submit"
              onClick={() => void create()}
              disabled={busy === "create"}
              className="mt-4 w-full rounded-lg bg-gray-950 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
            >
              Add candidate
            </button>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div
            data-testid="onboarding-detail"
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">
                  Onboarding · {selected.candidate_code}
                </p>
                <h2 className="text-2xl font-black text-gray-950">
                  {selected.full_name}
                </h2>
                <p className="text-xs font-semibold text-gray-400">
                  {selected.designation || "Candidate"} · {selected.store_name || "All stores"} ·
                  joining {selected.expected_joining_date || "TBD"}
                </p>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close candidate">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-gray-600">
                {STATUS_LABELS[selected.status] || selected.status}
              </span>
              <span className="text-[10px] font-bold text-gray-500">
                {selected.done_count}/{selected.task_count} tasks · {selected.progress}%
              </span>
              {selected.status !== "joined" && (
                <select
                  aria-label="Candidate status"
                  value={selected.status}
                  onChange={(event) => void setStatus(event.target.value)}
                  disabled={busy === "status"}
                  className="ml-auto rounded-lg border border-gray-200 px-2 py-1.5 text-[10px] font-bold text-gray-600"
                >
                  <option value="documents_pending">Documents pending</option>
                  <option value="verification">Verification</option>
                  <option value="ready">Ready to join</option>
                  <option value="withdrawn">Withdrawn</option>
                </select>
              )}
            </div>

            <div className="mt-4">
              <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
                <ClipboardList className="h-4 w-4 text-teal-700" /> Onboarding checklist
              </p>
              <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-100">
                {selected.tasks.map((task) => (
                  <li key={task.id} className="flex items-center gap-3 px-3 py-2.5">
                    <button
                      type="button"
                      data-testid={`onboarding-task-${task.id}`}
                      aria-label={`${task.status === "done" ? "Reopen" : "Complete"} ${task.title}`}
                      onClick={() => void toggleTask(task)}
                      disabled={busy === `task-${task.id}`}
                      className={`grid h-6 w-6 place-items-center rounded-md border ${
                        task.status === "done"
                          ? "border-teal-600 bg-teal-600 text-white"
                          : "border-gray-300 text-transparent"
                      }`}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm font-bold ${
                          task.status === "done"
                            ? "text-gray-400 line-through"
                            : "text-gray-900"
                        }`}
                      >
                        {task.title}
                      </p>
                      <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                        {task.category}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {selected.status === "joined" ? (
              <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3">
                <p className="text-sm font-black text-emerald-900">Employee created</p>
                <Link
                  href="/departments/hr/people"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-emerald-800 underline"
                >
                  Open people directory <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            ) : (
              <button
                type="button"
                data-testid="onboarding-convert"
                onClick={() => void convert()}
                disabled={!readyToConvert || busy === "convert"}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-40"
              >
                <UserPlus className="h-4 w-4" />
                {readyToConvert
                  ? "Convert to employee"
                  : `Complete all ${selected.task_count} tasks to convert`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
