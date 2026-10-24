"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Loader2,
  LogIn,
  LogOut,
  Pencil,
  Timer,
  Users,
  X,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type Row = {
  employee_id: number;
  employee_code: string;
  full_name: string;
  designation?: string | null;
  store_name?: string | null;
  status: string;
  check_in_at?: string | null;
  check_out_at?: string | null;
  worked_minutes: number;
  note?: string | null;
  record_id?: number | null;
};

type Day = {
  date: string;
  rows: Row[];
  summary: {
    total: number;
    present: number;
    on_leave: number;
    absent: number;
    not_marked: number;
    total_hours: number;
  };
};

const STATUS_LABELS: Record<string, string> = {
  present: "Present",
  remote: "Remote",
  half_day: "Half day",
  on_leave: "On leave",
  leave: "On leave",
  absent: "Absent",
  holiday: "Holiday",
  not_marked: "Not marked",
};

function todayIso() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  return new Date(`${value}Z`).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatHours(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${String(rest).padStart(2, "0")}m`;
}

export default function HRAttendancePage() {
  const [day, setDay] = useState<Day | null>(null);
  const [date, setDate] = useState(todayIso());
  const [hydrated, setHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({
    status: "present",
    check_in_at: "",
    check_out_at: "",
    note: "",
  });

  const load = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/hr/attendance/day?date=${date}`),
        { credentials: "include", cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Attendance failed to load.");
      setDay(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Attendance failed to load.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setHydrated(true);
    void load();
  }, [date]);

  const clock = async (row: Row, action: "clock-in" | "clock-out") => {
    setBusy(`${action}-${row.employee_id}`);
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/hr/attendance/${action}`),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employee_id: row.employee_id }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Attendance action failed.");
      await load();
      setMessage(
        action === "clock-in"
          ? `${row.full_name} clocked in.`
          : `${row.full_name} clocked out.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Attendance action failed.");
    } finally {
      setBusy("");
    }
  };

  const openEdit = (row: Row) => {
    setEditing(row);
    setForm({
      status: row.status === "on_leave" ? "leave" : row.status,
      check_in_at: row.check_in_at ? row.check_in_at.slice(0, 16) : "",
      check_out_at: row.check_out_at ? row.check_out_at.slice(0, 16) : "",
      note: row.note || "",
    });
  };

  const save = async () => {
    if (!editing) return;
    setBusy("save");
    try {
      const response = await fetch(
        getApiUrl(
          `/api/v1/restaurant/hr/attendance/${editing.employee_id}`
        ),
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date,
            status: form.status,
            check_in_at: form.check_in_at || null,
            check_out_at: form.check_out_at || null,
            note: form.note,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Regularisation failed.");
      setEditing(null);
      await load();
      setMessage("Attendance regularised.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Regularisation failed.");
    } finally {
      setBusy("");
    }
  };

  const summaryCards = useMemo(
    () => [
      { label: "Present", value: day?.summary.present ?? 0, icon: CheckCircle2 },
      { label: "On leave", value: day?.summary.on_leave ?? 0, icon: CalendarDays },
      { label: "Absent", value: day?.summary.absent ?? 0, icon: Users },
      { label: "Hours logged", value: day?.summary.total_hours ?? 0, icon: Timer },
    ],
    [day]
  );

  return (
    <div
      data-testid="hr-attendance-page"
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
              HR department · Time
            </p>
            <h1 className="text-3xl font-black text-gray-950">Attendance & time clock</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              Daily clock-in/out, leave-aware roster and HR regularisation. Approved
              leave shows automatically and blocks a clock-in.
            </p>
          </div>
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Date
            <input
              type="date"
              data-testid="attendance-date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="mt-1 block rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-gray-900"
            />
          </label>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-900">
          {message}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-xl border border-gray-100 bg-white p-4">
              <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400">
                <Icon className="h-3.5 w-3.5" /> {card.label}
              </p>
              <p className="mt-1 text-2xl font-black text-gray-950">{card.value}</p>
            </div>
          );
        })}
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
        {isLoading && !day ? (
          <div className="flex items-center gap-2 p-6 text-sm font-bold text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading attendance...
          </div>
        ) : !day?.rows.length ? (
          <p className="px-4 py-10 text-center text-sm font-semibold text-gray-400">
            No active employees. Add people in the People directory first.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">In</th>
                  <th className="px-3 py-2">Out</th>
                  <th className="px-3 py-2">Worked</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {day.rows.map((row) => {
                  const canClockIn =
                    !["present", "remote", "half_day", "on_leave", "leave"].includes(
                      row.status
                    );
                  const canClockOut = Boolean(
                    row.check_in_at && !row.check_out_at
                  );
                  return (
                    <tr
                      key={row.employee_id}
                      data-testid={`attendance-row-${row.employee_id}`}
                      className="border-b border-gray-50 text-sm"
                    >
                      <td className="px-3 py-3">
                        <p className="font-black text-gray-900">{row.full_name}</p>
                        <p className="text-[10px] font-semibold text-gray-400">
                          {row.employee_code}
                          {row.designation ? ` · ${row.designation}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest ${
                            ["present", "remote", "half_day"].includes(row.status)
                              ? "bg-emerald-100 text-emerald-800"
                              : row.status === "on_leave" || row.status === "leave"
                                ? "bg-sky-100 text-sky-800"
                                : row.status === "absent"
                                  ? "bg-red-100 text-red-800"
                                  : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {STATUS_LABELS[row.status] || row.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs font-bold text-gray-600">
                        {formatTime(row.check_in_at)}
                      </td>
                      <td className="px-3 py-3 text-xs font-bold text-gray-600">
                        {formatTime(row.check_out_at)}
                      </td>
                      <td className="px-3 py-3 text-xs font-black text-gray-700">
                        {row.check_out_at
                          ? formatHours(row.worked_minutes)
                          : "—"}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          {canClockIn && (
                            <button
                              type="button"
                              data-testid={`attendance-clock-in-${row.employee_id}`}
                              onClick={() => void clock(row, "clock-in")}
                              disabled={busy === `clock-in-${row.employee_id}`}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-white disabled:opacity-40"
                            >
                              <LogIn className="h-3 w-3" /> In
                            </button>
                          )}
                          {canClockOut && (
                            <button
                              type="button"
                              data-testid={`attendance-clock-out-${row.employee_id}`}
                              onClick={() => void clock(row, "clock-out")}
                              disabled={busy === `clock-out-${row.employee_id}`}
                              className="inline-flex items-center gap-1 rounded-md bg-gray-950 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-white disabled:opacity-40"
                            >
                              <LogOut className="h-3 w-3" /> Out
                            </button>
                          )}
                          <button
                            type="button"
                            data-testid={`attendance-edit-${row.employee_id}`}
                            onClick={() => openEdit(row)}
                            aria-label={`Regularise ${row.full_name}`}
                            className="rounded-md border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div
            data-testid="attendance-form"
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">
                  HR regularisation
                </p>
                <h2 className="mt-1 text-2xl font-black text-gray-950">
                  {editing.full_name}
                </h2>
                <p className="text-xs font-semibold text-gray-400">{date}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label="Close attendance form"
              >
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                Status
                <select
                  data-testid="attendance-status"
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                >
                  <option value="present">Present</option>
                  <option value="remote">Remote</option>
                  <option value="half_day">Half day</option>
                  <option value="leave">On leave</option>
                  <option value="absent">Absent</option>
                  <option value="holiday">Holiday</option>
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Check-in
                  <input
                    type="datetime-local"
                    data-testid="attendance-in"
                    value={form.check_in_at}
                    onChange={(event) =>
                      setForm({ ...form, check_in_at: event.target.value })
                    }
                    className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                  />
                </label>
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Check-out
                  <input
                    type="datetime-local"
                    data-testid="attendance-out"
                    value={form.check_out_at}
                    onChange={(event) =>
                      setForm({ ...form, check_out_at: event.target.value })
                    }
                    className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                  />
                </label>
              </div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                Note
                <input
                  value={form.note}
                  onChange={(event) => setForm({ ...form, note: event.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
            </div>

            <button
              type="button"
              data-testid="attendance-save"
              onClick={() => void save()}
              disabled={busy === "save"}
              className="mt-4 w-full rounded-lg bg-gray-950 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
            >
              Save attendance
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
