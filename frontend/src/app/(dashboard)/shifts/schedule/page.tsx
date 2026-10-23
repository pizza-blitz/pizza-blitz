"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type ScheduledShift = {
  id: number;
  staff_name: string;
  role?: string | null;
  date: string;
  start_time: string;
  end_time: string;
  hours: number;
  hourly_rate: number;
  labour_cost: number;
  status: string;
  notes?: string | null;
};

type ScheduleData = {
  start_date: string;
  end_date: string;
  shifts: ScheduledShift[];
  summary: { shift_count: number; hours: number; labour_cost: number };
};

type LabourDay = {
  date: string;
  scheduled_hours: number;
  labour_cost: number;
  sales: number;
  labour_percent: number;
};

type LabourSummary = {
  totals: {
    scheduled_hours: number;
    labour_cost: number;
    sales: number;
    labour_percent: number;
    shift_count: number;
  };
  days: LabourDay[];
  roles: { role: string; hours: number; labour_cost: number }[];
};

function businessToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function mondayOf(dateString: string) {
  const date = new Date(`${dateString}T12:00:00Z`);
  const weekday = date.getUTCDay() === 0 ? 6 : date.getUTCDay() - 1;
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function money(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

export default function SchedulePage() {
  const today = businessToday();
  const [weekStart, setWeekStart] = useState(mondayOf(today));
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [labour, setLabour] = useState<LabourSummary | null>(null);
  const [form, setForm] = useState({
    staff_name: "",
    role: "Counter / POS",
    date: today,
    start_time: "11:00",
    end_time: "19:00",
    hourly_rate: 180,
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const weekEnd = addDays(weekStart, 6);

  const load = useCallback(async () => {
    const [scheduleResponse, labourResponse] = await Promise.all([
      fetch(
        getApiUrl(
          `/api/v1/restaurant/shifts/schedule?start_date=${weekStart}&end_date=${weekEnd}`
        ),
        { credentials: "include", cache: "no-store" }
      ),
      fetch(
        getApiUrl(
          `/api/v1/restaurant/shifts/labour-summary?start_date=${weekStart}&end_date=${weekEnd}`
        ),
        { credentials: "include", cache: "no-store" }
      ),
    ]);
    const scheduleData = await scheduleResponse.json().catch(() => ({}));
    const labourData = await labourResponse.json().catch(() => ({}));
    if (scheduleResponse.ok) setSchedule(scheduleData);
    else setMessage(scheduleData.detail || "Schedule could not be loaded.");
    if (labourResponse.ok) setLabour(labourData);
  }, [weekStart, weekEnd]);

  useEffect(() => {
    setHydrated(true);
    void load();
  }, [load]);

  const create = async () => {
    setBusy("create");
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/shifts/schedule"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            hourly_rate: Number(form.hourly_rate) || 0,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Shift could not be created.");
      setMessage(`${data.staff_name} scheduled for ${data.date} (${data.hours}h).`);
      setForm((current) => ({ ...current, staff_name: "" }));
      setWeekStart(mondayOf(form.date));
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Shift could not be created.");
    } finally {
      setBusy("");
    }
  };

  const updateStatus = async (shift: ScheduledShift, status: string) => {
    setBusy(`shift-${shift.id}`);
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/shifts/schedule/${shift.id}`),
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Shift could not be updated.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Shift could not be updated.");
    } finally {
      setBusy("");
    }
  };

  const remove = async (shift: ScheduledShift) => {
    setBusy(`shift-${shift.id}`);
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/shifts/schedule/${shift.id}`),
        { method: "DELETE", credentials: "include" }
      );
      if (!response.ok) throw new Error("Shift could not be deleted.");
      setMessage("Scheduled shift removed.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Shift could not be deleted.");
    } finally {
      setBusy("");
    }
  };

  const grouped = (schedule?.shifts || []).reduce<Record<string, ScheduledShift[]>>(
    (groups, shift) => {
      groups[shift.date] = [...(groups[shift.date] || []), shift];
      return groups;
    },
    {}
  );

  return (
    <div
      data-testid="schedule-page"
      data-hydrated={hydrated ? "true" : "false"}
      className="space-y-6 animate-in fade-in duration-300"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/shifts"
            className="inline-flex items-center gap-1 text-xs font-black uppercase tracking-widest text-gray-400 hover:text-orange-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to shift log
          </Link>
          <h1 className="mt-2 flex items-center gap-3 text-3xl font-black text-gray-950">
            <CalendarClock className="h-7 w-7 text-orange-600" /> Schedule & labour
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Plan the week, estimate wage cost and compare it with sales.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-600"
          >
            Previous week
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(mondayOf(today))}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-600"
          >
            This week
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-600"
          >
            Next week
          </button>
          <button
            type="button"
            data-testid="schedule-refresh"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-600"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      <p className="text-xs font-bold uppercase tracking-widest text-gray-400">
        Week of {weekStart} to {weekEnd}
      </p>

      {message && (
        <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-900">
          {message}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Scheduled hours
          </p>
          <p data-testid="labour-hours" className="mt-1 text-2xl font-black text-gray-950">
            {labour?.totals.scheduled_hours || 0}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-gray-500">
            {labour?.totals.shift_count || 0} shifts
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Labour cost
          </p>
          <p data-testid="labour-cost" className="mt-1 text-2xl font-black text-gray-950">
            {money(labour?.totals.labour_cost || 0)}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-gray-500">
            Based on hourly rates
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Sales this week
          </p>
          <p data-testid="labour-sales" className="mt-1 text-2xl font-black text-emerald-700">
            {money(labour?.totals.sales || 0)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Labour %
          </p>
          <p data-testid="labour-percent" className="mt-1 text-2xl font-black text-orange-700">
            {labour?.totals.labour_percent || 0}%
          </p>
          <p className="mt-1 text-[11px] font-semibold text-gray-500">
            Target under 30%
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-orange-600">
          <Plus className="h-4 w-4" /> Add a scheduled shift
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Staff
            <input
              data-testid="schedule-staff"
              aria-label="Scheduled staff name"
              value={form.staff_name}
              onChange={(event) =>
                setForm((current) => ({ ...current, staff_name: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
            />
          </label>
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Role
            <select
              data-testid="schedule-role"
              aria-label="Scheduled role"
              value={form.role}
              onChange={(event) =>
                setForm((current) => ({ ...current, role: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm font-bold text-gray-900"
            >
              <option>Counter / POS</option>
              <option>Kitchen / Oven</option>
              <option>Prep / Packing</option>
              <option>Delivery Rider</option>
            </select>
          </label>
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Date
            <input
              type="date"
              aria-label="Scheduled shift date"
              value={form.date}
              onChange={(event) =>
                setForm((current) => ({ ...current, date: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm font-bold text-gray-900"
            />
          </label>
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Start
            <input
              type="time"
              aria-label="Scheduled shift start"
              value={form.start_time}
              onChange={(event) =>
                setForm((current) => ({ ...current, start_time: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm font-bold text-gray-900"
            />
          </label>
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            End
            <input
              type="time"
              aria-label="Scheduled shift end"
              value={form.end_time}
              onChange={(event) =>
                setForm((current) => ({ ...current, end_time: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm font-bold text-gray-900"
            />
          </label>
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
            Hourly rate
            <input
              data-testid="schedule-rate"
              aria-label="Scheduled hourly rate"
              type="number"
              min={0}
              value={form.hourly_rate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  hourly_rate: Number(event.target.value) || 0,
                }))
              }
              className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm font-bold text-gray-900"
            />
          </label>
        </div>
        <button
          type="button"
          data-testid="schedule-create"
          onClick={create}
          disabled={busy === "create" || form.staff_name.trim().length < 2}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {busy === "create" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Schedule shift
        </button>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="rounded-2xl border border-gray-100 bg-white p-5">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
            <Users className="h-4 w-4 text-orange-600" /> Week roster
          </p>
          {Object.keys(grouped).length ? (
            <div className="mt-3 space-y-4">
              {Object.entries(grouped).map(([date, shifts]) => (
                <div key={date}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                    {date}
                  </p>
                  <div className="mt-1 space-y-1.5">
                    {shifts.map((shift) => (
                      <div
                        key={shift.id}
                        data-testid={`scheduled-shift-${shift.id}`}
                        className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                          shift.status === "cancelled"
                            ? "border-gray-100 bg-gray-50 opacity-60"
                            : "border-gray-100 bg-white"
                        }`}
                      >
                        <div>
                          <p className="text-sm font-black text-gray-900">
                            {shift.staff_name}
                            <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                              {shift.role || "General"}
                            </span>
                          </p>
                          <p className="text-[11px] font-semibold text-gray-500">
                            {shift.start_time}–{shift.end_time} · {shift.hours}h ·{" "}
                            {money(shift.labour_cost)} ·{" "}
                            <span className="uppercase">{shift.status}</span>
                          </p>
                        </div>
                        <div className="flex gap-1">
                          {shift.status !== "confirmed" && shift.status !== "cancelled" && (
                            <button
                              type="button"
                              onClick={() => void updateStatus(shift, "confirmed")}
                              disabled={busy === `shift-${shift.id}`}
                              aria-label={`Confirm ${shift.staff_name}`}
                              className="grid h-8 w-8 place-items-center rounded-lg text-emerald-700 hover:bg-emerald-50"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void remove(shift)}
                            disabled={busy === `shift-${shift.id}`}
                            aria-label={`Delete ${shift.staff_name}`}
                            className="grid h-8 w-8 place-items-center rounded-lg text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-gray-200 px-3 py-6 text-center text-sm font-semibold text-gray-400">
              No shifts scheduled for this week.
            </p>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-100 bg-white p-5">
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
              <Clock3 className="h-4 w-4 text-orange-600" /> Daily labour vs sales
            </p>
            <div className="mt-3 space-y-2">
              {(labour?.days || []).length ? (
                labour?.days.map((day) => (
                  <div
                    key={day.date}
                    className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs"
                  >
                    <span className="font-bold text-gray-700">{day.date}</span>
                    <span className="font-black text-gray-900">
                      {money(day.labour_cost)}
                    </span>
                    <span className="font-semibold text-gray-500">
                      {day.labour_percent}%
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm font-semibold text-gray-400">No labour data.</p>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-orange-100 bg-orange-50 p-5">
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-orange-700">
              <TrendingUp className="h-4 w-4" /> Role cost
            </p>
            <div className="mt-3 space-y-2">
              {(labour?.roles || []).map((role) => (
                <div key={role.role} className="flex justify-between text-xs font-bold text-orange-900">
                  <span>{role.role}</span>
                  <span>{role.hours}h · {money(role.labour_cost)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
