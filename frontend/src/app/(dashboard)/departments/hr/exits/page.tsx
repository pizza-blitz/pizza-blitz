"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDollarSign,
  Loader2,
  LogOut,
  ShieldCheck,
  X,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type Clearance = {
  id: number;
  title: string;
  department: string;
  status: string;
  notes?: string | null;
};

type ExitRow = {
  id: number;
  employee_id: number;
  employee_code: string;
  employee_name: string;
  designation?: string | null;
  exit_type: string;
  status: string;
  resignation_date: string;
  last_working_date: string;
  notice_days: number;
  reason?: string | null;
  clearance_total: number;
  clearance_done: number;
  clearance: Clearance[];
  settlement?: Settlement;
  settled_at?: string | null;
  preview?: Settlement;
};

type Settlement = {
  monthly_gross: number;
  pending_salary: number;
  earned_leave_days: number;
  leave_encashment: number;
  service_years: number;
  gratuity: number;
  notice_days_served: number;
  notice_shortfall_days: number;
  notice_recovery: number;
  net_settlement: number;
  notes: string[];
};

type Employee = { id: number; employee_code: string; full_name: string; status: string };
type Summary = {
  total: number;
  notice: number;
  clearance: number;
  settled: number;
  cancelled: number;
};

const money = (value: number) =>
  `Rs ${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const STATUS_TONE: Record<string, string> = {
  notice: "bg-amber-100 text-amber-800",
  clearance: "bg-sky-100 text-sky-800",
  settled: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-gray-100 text-gray-500",
  initiated: "bg-gray-100 text-gray-600",
};

export default function HRExitsPage() {
  const [exits, setExits] = useState<ExitRow[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [selected, setSelected] = useState<ExitRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    employee_id: "",
    exit_type: "resignation",
    resignation_date: "",
    last_working_date: "",
    notice_days: "30",
    reason: "",
  });

  const load = async () => {
    try {
      const [exitRes, employeeRes, summaryRes] = await Promise.all([
        fetch(getApiUrl("/api/v1/restaurant/hr/exits"), {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(getApiUrl("/api/v1/restaurant/hr/employees"), {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(getApiUrl("/api/v1/restaurant/hr/exits/summary"), {
          credentials: "include",
          cache: "no-store",
        }),
      ]);
      const data = await exitRes.json();
      if (!exitRes.ok) throw new Error(data.detail || "Exits failed to load.");
      setExits(data.exits || []);
      if (employeeRes.ok) {
        setEmployees(
          (await employeeRes.json()).employees.filter(
            (employee: Employee) => employee.status !== "exited"
          )
        );
      }
      if (summaryRes.ok) setSummary(await summaryRes.json());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Exits failed to load.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setHydrated(true);
    void load();
  }, []);

  const openDetail = async (row: ExitRow) => {
    setBusy(`open-${row.id}`);
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/hr/exits/${row.id}`),
        { credentials: "include", cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Exit failed to load.");
      setSelected(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Exit failed to load.");
    } finally {
      setBusy("");
    }
  };

  const create = async () => {
    if (!form.employee_id || !form.resignation_date || !form.last_working_date) {
      setMessage("Choose an employee and both dates.");
      return;
    }
    setBusy("create");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/hr/exits"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            employee_id: Number(form.employee_id),
            notice_days: Number(form.notice_days || 0),
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Exit failed.");
      setShowCreate(false);
      await load();
      setSelected(data);
      setMessage("Exit record created. Complete the clearance checklist.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Exit failed.");
    } finally {
      setBusy("");
    }
  };

  const toggleClearance = async (task: Clearance) => {
    setBusy(`task-${task.id}`);
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/hr/exits/clearance/${task.id}`),
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: task.status === "cleared" ? "pending" : "cleared",
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Clearance failed.");
      if (selected) await openDetail(selected);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Clearance failed.");
    } finally {
      setBusy("");
    }
  };

  const settle = async (force = false) => {
    if (!selected) return;
    setBusy("settle");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/hr/exits/${selected.id}/settle`),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Settlement failed.");
      setSelected({ ...data, preview: data.settlement });
      await load();
      setMessage("Exit settled. Employee and POS access are deactivated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Settlement failed.");
    } finally {
      setBusy("");
    }
  };

  const cancel = async () => {
    if (!selected) return;
    setBusy("cancel");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/hr/exits/${selected.id}/cancel`),
        { method: "POST", credentials: "include" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Cancellation failed.");
      setSelected(data);
      await load();
      setMessage("Exit cancelled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Cancellation failed.");
    } finally {
      setBusy("");
    }
  };

  const cards = useMemo(
    () => [
      { label: "Exit records", value: summary?.total ?? 0 },
      { label: "On notice", value: summary?.notice ?? 0 },
      { label: "In clearance", value: summary?.clearance ?? 0 },
      { label: "Settled", value: summary?.settled ?? 0 },
    ],
    [summary]
  );

  const settlement = selected?.settlement || selected?.preview;
  const allCleared =
    selected && selected.clearance.every((task) => task.status === "cleared");

  return (
    <div
      data-testid="hr-exits-page"
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
              HR department · Offboarding
            </p>
            <h1 className="text-3xl font-black text-gray-950">Exits & settlement</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              Resignation/termination, clearance checklist and final-settlement estimate.
              Settling exits the employee and revokes linked POS access.
            </p>
          </div>
          <button
            type="button"
            data-testid="exit-create-open"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-teal-700"
          >
            <LogOut className="h-4 w-4" /> Start exit
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
            <Loader2 className="h-5 w-5 animate-spin" /> Loading exits...
          </div>
        ) : exits.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm font-semibold text-gray-400">
            No exit records yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Last working</th>
                  <th className="px-3 py-2">Clearance</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {exits.map((row) => (
                  <tr
                    key={row.id}
                    data-testid={`exit-row-${row.id}`}
                    className="border-b border-gray-50 text-sm"
                  >
                    <td className="px-3 py-3">
                      <p className="font-black text-gray-900">{row.employee_name}</p>
                      <p className="text-[10px] font-semibold text-gray-400">
                        {row.employee_code}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-xs font-bold capitalize text-gray-600">
                      {row.exit_type}
                    </td>
                    <td className="px-3 py-3 text-xs font-semibold text-gray-600">
                      {row.last_working_date}
                    </td>
                    <td className="px-3 py-3 text-xs font-bold text-gray-600">
                      {row.clearance_done}/{row.clearance_total}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest ${
                          STATUS_TONE[row.status] || "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void openDetail(row)}
                        disabled={busy === `open-${row.id}`}
                        className="rounded-md bg-gray-950 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-white"
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
      </section>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div data-testid="exit-create-form" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <h2 className="text-2xl font-black text-gray-950">Start an exit</h2>
              <button type="button" onClick={() => setShowCreate(false)} aria-label="Close">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                Employee
                <select
                  data-testid="exit-employee"
                  value={form.employee_id}
                  onChange={(event) => setForm({ ...form, employee_id: event.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                >
                  <option value="">Select employee</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.full_name} ({employee.employee_code})
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Type
                  <select
                    value={form.exit_type}
                    onChange={(event) => setForm({ ...form, exit_type: event.target.value })}
                    className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                  >
                    <option value="resignation">Resignation</option>
                    <option value="termination">Termination</option>
                    <option value="absconding">Absconding</option>
                    <option value="retirement">Retirement</option>
                  </select>
                </label>
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Notice days
                  <input
                    type="number"
                    min="0"
                    max="180"
                    value={form.notice_days}
                    onChange={(event) => setForm({ ...form, notice_days: event.target.value })}
                    className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                  />
                </label>
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Resignation date
                  <input
                    type="date"
                    data-testid="exit-resignation"
                    value={form.resignation_date}
                    onChange={(event) =>
                      setForm({ ...form, resignation_date: event.target.value })
                    }
                    className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                  />
                </label>
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Last working date
                  <input
                    type="date"
                    data-testid="exit-last-working"
                    value={form.last_working_date}
                    onChange={(event) =>
                      setForm({ ...form, last_working_date: event.target.value })
                    }
                    className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                  />
                </label>
              </div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                Reason
                <textarea
                  rows={2}
                  value={form.reason}
                  onChange={(event) => setForm({ ...form, reason: event.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
            </div>
            <button
              type="button"
              data-testid="exit-create-submit"
              onClick={() => void create()}
              disabled={busy === "create"}
              className="mt-4 w-full rounded-lg bg-gray-950 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
            >
              Create exit record
            </button>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-3 sm:items-center">
          <div
            data-testid="exit-detail"
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">
                  Exit · {selected.status}
                </p>
                <h2 className="text-2xl font-black text-gray-950">
                  {selected.employee_name}
                </h2>
                <p className="text-xs font-semibold text-gray-400">
                  {selected.employee_code} · {selected.exit_type} · LWD{" "}
                  {selected.last_working_date}
                </p>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close exit">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {selected.status !== "settled" && selected.status !== "cancelled" && (
                <>
                  <button
                    type="button"
                    data-testid="exit-settle"
                    onClick={() => void settle(false)}
                    disabled={!allCleared || busy === "settle"}
                    className="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Settle exit
                  </button>
                  <button
                    type="button"
                    onClick={() => void cancel()}
                    disabled={busy === "cancel"}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-500"
                  >
                    Cancel exit
                  </button>
                </>
              )}
              {selected.status === "settled" && (
                <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-800">
                  Settled & access revoked
                </span>
              )}
            </div>

            <div className="mt-4">
              <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
                <ShieldCheck className="h-4 w-4 text-teal-700" /> Clearance
              </p>
              <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-100">
                {selected.clearance.map((task) => (
                  <li key={task.id} className="flex items-center gap-3 px-3 py-2.5">
                    <button
                      type="button"
                      data-testid={`exit-clearance-${task.id}`}
                      onClick={() => void toggleClearance(task)}
                      disabled={busy === `task-${task.id}` || selected.status === "settled"}
                      className={`grid h-6 w-6 place-items-center rounded-md border ${
                        task.status === "cleared"
                          ? "border-teal-600 bg-teal-600 text-white"
                          : "border-gray-300 text-transparent"
                      }`}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm font-bold ${
                          task.status === "cleared"
                            ? "text-gray-400 line-through"
                            : "text-gray-900"
                        }`}
                      >
                        {task.title}
                      </p>
                      <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                        {task.department}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {settlement && (
              <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50/60 p-4">
                <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
                  <CircleDollarSign className="h-4 w-4 text-teal-700" /> Settlement preview
                </p>
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  {[
                    ["Pending salary", settlement.pending_salary],
                    ["Leave encashment", settlement.leave_encashment],
                    ["Gratuity", settlement.gratuity],
                    ["Notice recovery", -settlement.notice_recovery],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="flex justify-between text-gray-600">
                      <span>{label}</span>
                      <span className="font-bold">{money(Number(value))}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-gray-200 pt-3">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-500">
                    Net settlement
                  </span>
                  <span className="text-2xl font-black text-teal-900">
                    {money(settlement.net_settlement)}
                  </span>
                </div>
                <p className="mt-2 text-[10px] font-semibold leading-4 text-gray-400">
                  {settlement.notes?.[0]}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
