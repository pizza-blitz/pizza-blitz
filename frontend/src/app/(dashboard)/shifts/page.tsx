"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Plane,
  RefreshCw,
  Save,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const SHIFTS_API = getApiUrl("/api/v1/restaurant/shifts/");
const ATTENDANCE_API = getApiUrl("/api/v1/restaurant/shifts/attendance-command");
const LEAVE_API = getApiUrl("/api/v1/restaurant/shifts/leave");

const roleOptions = ["Counter / POS", "Kitchen / Oven", "Prep / Packing", "Delivery Rider"];
const leaveTypes = ["CL", "PL", "SL", "LOP"];

type ShiftLog = {
  id: number;
  date: string;
  staff_name: string;
  role?: string | null;
  role_key?: string;
  role_label?: string;
  shift_start?: string | null;
  shift_end?: string | null;
  hours?: number;
  notes?: string | null;
};

type StaffPerformance = {
  staff_name: string;
  days_worked: number;
  avg_revenue_on_shift_days: number;
  best_day_revenue: number;
};

type CoverageRow = {
  key: string;
  label: string;
  required: number;
  present: number;
  missing: number;
  status: "pass" | "fail";
  expected_start: string;
};

type LeaveRecord = {
  id: number;
  staff_name: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number;
  status: string;
  reason?: string | null;
};

type LeaveBalance = {
  staff_name: string;
  cl_used: number;
  pl_used: number;
  sl_used: number;
  cl_remaining: number;
  pl_remaining: number;
  sl_remaining: number;
};

type AttendanceFlag = {
  staff_name: string;
  type: string;
  status: "warn" | "fail";
  detail: string;
};

type AttendanceCommand = {
  date: string;
  overall: "pass" | "warn" | "fail";
  readiness_score: number;
  summary: {
    present_count: number;
    leave_count: number;
    role_requirements: number;
    roles_covered: number;
    missing_role_count: number;
    attendance_flag_count: number;
  };
  coverage: CoverageRow[];
  missing_roles: string[];
  shifts: ShiftLog[];
  active_leave: LeaveRecord[];
  leave_balances: LeaveBalance[];
  attendance_flags: AttendanceFlag[];
  next_actions: string[];
};

function todayIso() {
  return new Date().toISOString().split("T")[0];
}

function statusClass(status: string) {
  if (status === "pass") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status === "fail") return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  return "border-amber-500/30 bg-amber-500/10 text-amber-100";
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store", credentials: "include" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export default function ShiftLogPage() {
  const [shifts, setShifts] = useState<ShiftLog[]>([]);
  const [performance, setPerformance] = useState<StaffPerformance[]>([]);
  const [attendance, setAttendance] = useState<AttendanceCommand | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [shiftForm, setShiftForm] = useState({
    date: todayIso(),
    staff_name: "",
    role: "Counter / POS",
    shift_start: "11:00",
    shift_end: "19:00",
    notes: "",
  });
  const [leaveForm, setLeaveForm] = useState({
    staff_name: "",
    leave_type: "CL",
    start_date: todayIso(),
    end_date: todayIso(),
    status: "approved",
    reason: "",
  });

  const strongestStaff = useMemo(
    () => performance.slice(0, 4),
    [performance]
  );

  const fetchData = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [shiftRows, performanceRows, attendanceCommand] = await Promise.all([
        readJson<ShiftLog[]>(SHIFTS_API),
        readJson<StaffPerformance[]>(`${SHIFTS_API}performance`),
        readJson<AttendanceCommand>(`${ATTENDANCE_API}?target_date=${shiftForm.date}`),
      ]);
      setShifts(shiftRows);
      setPerformance(performanceRows);
      setAttendance(attendanceCommand);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not refresh attendance.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleShiftSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    const response = await fetch(SHIFTS_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(shiftForm),
    });
    if (!response.ok) {
      setMessage(`Shift log failed: ${response.status}`);
      return;
    }
    setShiftForm((current) => ({ ...current, staff_name: "", notes: "" }));
    await fetchData();
    setMessage("Shift logged.");
  };

  const handleLeaveSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    const response = await fetch(LEAVE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(leaveForm),
    });
    if (!response.ok) {
      setMessage(`Leave log failed: ${response.status}`);
      return;
    }
    setLeaveForm((current) => ({ ...current, staff_name: "", reason: "" }));
    await fetchData();
    setMessage("Leave logged.");
  };

  const summary = attendance?.summary;

  return (
    <div className="min-h-screen bg-[#0b0d10] p-6 text-slate-100 md:p-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-orange-300">
            Employee Software
          </p>
          <h1 className="mt-2 text-3xl font-black">Attendance, CL/PL And Role Coverage</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Daily roster, leave balance and shift risk are now checked together for counter,
            kitchen, prep and delivery staffing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300">
            <CalendarDays className="h-4 w-4 text-orange-300" />
            <input
              type="date"
              value={shiftForm.date}
              onChange={(event) => setShiftForm({ ...shiftForm, date: event.target.value })}
              className="bg-transparent text-sm outline-none"
            />
          </label>
          <button
            type="button"
            onClick={fetchData}
            className="inline-flex items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {message ? (
        <div className="mb-5 rounded-md border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-200">
          {message}
        </div>
      ) : null}

      <section
        data-testid="employee-attendance-command"
        className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-4"
      >
        <div className={`rounded-lg border p-5 ${statusClass(attendance?.overall || "warn")}`}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">Readiness</span>
            <ShieldCheck className="h-5 w-5" />
          </div>
          <p data-testid="attendance-readiness-score" className="mt-4 text-4xl font-black">
            {attendance?.readiness_score ?? 0}%
          </p>
          <p className="mt-2 text-xs uppercase tracking-[0.18em] opacity-80">
            {attendance?.overall || "loading"}
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-sm font-bold">Present Today</span>
            <Users className="h-5 w-5 text-cyan-300" />
          </div>
          <p className="mt-4 text-4xl font-black">{summary?.present_count ?? 0}</p>
          <p className="mt-2 text-sm text-slate-400">Active leave: {summary?.leave_count ?? 0}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-sm font-bold">Roles Covered</span>
            <CheckCircle2 className="h-5 w-5 text-emerald-300" />
          </div>
          <p className="mt-4 text-4xl font-black">
            {summary?.roles_covered ?? 0}/{summary?.role_requirements ?? 4}
          </p>
          <p className="mt-2 text-sm text-slate-400">Missing: {summary?.missing_role_count ?? 0}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-sm font-bold">Flags</span>
            <AlertTriangle className="h-5 w-5 text-amber-300" />
          </div>
          <p className="mt-4 text-4xl font-black">{summary?.attendance_flag_count ?? 0}</p>
          <p className="mt-2 text-sm text-slate-400">Late, short shift or leave conflict</p>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="space-y-6">
          <div className="rounded-lg border border-white/10 bg-[#12161c] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-black">
                <ClipboardList className="h-5 w-5 text-orange-300" />
                Station Coverage
              </h2>
              <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-400">
                {attendance?.date || shiftForm.date}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {(attendance?.coverage || []).map((row) => (
                <div
                  key={row.key}
                  data-testid={`attendance-coverage-${row.key}`}
                  className="rounded-md border border-white/10 bg-white/[0.035] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">{row.label}</p>
                      <p className="mt-1 text-xs text-slate-400">Expected {row.expected_start}</p>
                    </div>
                    <span className={`rounded-md border px-2 py-1 text-xs font-bold ${statusClass(row.status)}`}>
                      {row.present}/{row.required}
                    </span>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full ${row.status === "pass" ? "bg-emerald-400" : "bg-rose-400"}`}
                      style={{ width: `${Math.min(100, (row.present / row.required) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#12161c] p-5">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-black">
              <AlertTriangle className="h-5 w-5 text-amber-300" />
              Attention Queue
            </h2>
            <div data-testid="attendance-next-actions" className="grid gap-3 md:grid-cols-2">
              {(attendance?.attendance_flags || []).map((flag, index) => (
                <div key={`${flag.staff_name}-${flag.type}-${index}`} className="rounded-md border border-amber-500/20 bg-amber-500/10 p-4">
                  <p className="font-bold text-amber-100">{flag.staff_name}</p>
                  <p className="mt-1 text-sm text-amber-100/80">{flag.detail}</p>
                </div>
              ))}
              {(attendance?.next_actions || []).map((action) => (
                <div key={action} className="rounded-md border border-white/10 bg-white/[0.035] p-4 text-sm text-slate-300">
                  {action}
                </div>
              ))}
              {attendance && attendance.attendance_flags.length === 0 && attendance.next_actions.length === 0 ? (
                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                  Coverage is clean for the selected day.
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#12161c] p-5">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-black">
              <Plane className="h-5 w-5 text-cyan-300" />
              CL/PL Balances
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[660px] text-left text-sm">
                <thead className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  <tr>
                    <th className="py-3">Staff</th>
                    <th>CL Used</th>
                    <th>CL Left</th>
                    <th>PL Used</th>
                    <th>PL Left</th>
                    <th>SL Left</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {(attendance?.leave_balances || []).map((row) => (
                    <tr key={row.staff_name} data-testid={`leave-balance-${row.staff_name.replace(/\s+/g, "-").toLowerCase()}`}>
                      <td className="py-3 font-bold">{row.staff_name}</td>
                      <td>{row.cl_used}</td>
                      <td>{row.cl_remaining}</td>
                      <td>{row.pl_used}</td>
                      <td>{row.pl_remaining}</td>
                      <td>{row.sl_remaining}</td>
                    </tr>
                  ))}
                  {attendance && attendance.leave_balances.length === 0 ? (
                    <tr>
                      <td className="py-4 text-slate-400" colSpan={6}>
                        No leave balance records yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-lg border border-white/10 bg-[#12161c] p-5">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-black">
              <Clock3 className="h-5 w-5 text-orange-300" />
              Log Shift
            </h2>
            <form onSubmit={handleShiftSubmit} className="space-y-3">
              <label className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                Staff Name
                <input
                  required
                  value={shiftForm.staff_name}
                  onChange={(event) => setShiftForm({ ...shiftForm, staff_name: event.target.value })}
                  className="mt-2 w-full rounded-md border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white outline-none focus:border-orange-400"
                  placeholder="Employee name"
                />
              </label>
              <label className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                Role
                <select
                  value={shiftForm.role}
                  onChange={(event) => setShiftForm({ ...shiftForm, role: event.target.value })}
                  className="mt-2 w-full rounded-md border border-white/10 bg-[#0b0d10] px-3 py-3 text-sm text-white outline-none focus:border-orange-400"
                >
                  {roleOptions.map((role) => (
                    <option key={role}>{role}</option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                  Start
                  <input
                    type="time"
                    value={shiftForm.shift_start}
                    onChange={(event) => setShiftForm({ ...shiftForm, shift_start: event.target.value })}
                    className="mt-2 w-full rounded-md border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white outline-none focus:border-orange-400"
                  />
                </label>
                <label className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                  End
                  <input
                    type="time"
                    value={shiftForm.shift_end}
                    onChange={(event) => setShiftForm({ ...shiftForm, shift_end: event.target.value })}
                    className="mt-2 w-full rounded-md border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white outline-none focus:border-orange-400"
                  />
                </label>
              </div>
              <textarea
                value={shiftForm.notes}
                onChange={(event) => setShiftForm({ ...shiftForm, notes: event.target.value })}
                className="min-h-[86px] w-full rounded-md border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white outline-none focus:border-orange-400"
                placeholder="Notes"
              />
              <button className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600">
                <Save className="h-4 w-4" />
                Log Shift
              </button>
            </form>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#12161c] p-5">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-black">
              <Plane className="h-5 w-5 text-cyan-300" />
              Log Leave
            </h2>
            <form data-testid="employee-leave-form" onSubmit={handleLeaveSubmit} className="space-y-3">
              <input
                data-testid="leave-staff-name"
                required
                value={leaveForm.staff_name}
                onChange={(event) => setLeaveForm({ ...leaveForm, staff_name: event.target.value })}
                className="w-full rounded-md border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white outline-none focus:border-cyan-300"
                placeholder="Employee name"
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  data-testid="leave-type"
                  value={leaveForm.leave_type}
                  onChange={(event) => setLeaveForm({ ...leaveForm, leave_type: event.target.value })}
                  className="rounded-md border border-white/10 bg-[#0b0d10] px-3 py-3 text-sm text-white outline-none focus:border-cyan-300"
                >
                  {leaveTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
                <select
                  value={leaveForm.status}
                  onChange={(event) => setLeaveForm({ ...leaveForm, status: event.target.value })}
                  className="rounded-md border border-white/10 bg-[#0b0d10] px-3 py-3 text-sm text-white outline-none focus:border-cyan-300"
                >
                  <option>planned</option>
                  <option>approved</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  data-testid="leave-start-date"
                  type="date"
                  value={leaveForm.start_date}
                  onChange={(event) => setLeaveForm({ ...leaveForm, start_date: event.target.value, end_date: event.target.value })}
                  className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white outline-none focus:border-cyan-300"
                />
                <input
                  type="date"
                  value={leaveForm.end_date}
                  onChange={(event) => setLeaveForm({ ...leaveForm, end_date: event.target.value })}
                  className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white outline-none focus:border-cyan-300"
                />
              </div>
              <input
                value={leaveForm.reason}
                onChange={(event) => setLeaveForm({ ...leaveForm, reason: event.target.value })}
                className="w-full rounded-md border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white outline-none focus:border-cyan-300"
                placeholder="Reason"
              />
              <button
                data-testid="leave-submit"
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-cyan-500 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-400"
              >
                <Save className="h-4 w-4" />
                Log Leave
              </button>
            </form>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#12161c] p-5">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-black">
              <User className="h-5 w-5 text-emerald-300" />
              Staff Performance
            </h2>
            <div className="space-y-3">
              {strongestStaff.map((staff) => (
                <div key={staff.staff_name} className="rounded-md border border-white/10 bg-white/[0.035] p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-bold">{staff.staff_name}</p>
                      <p className="text-xs text-slate-400">{staff.days_worked} days worked</p>
                    </div>
                    <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-200">
                      Top roster
                    </span>
                  </div>
                </div>
              ))}
              {strongestStaff.length === 0 ? (
                <p className="text-sm text-slate-400">No staff performance records yet.</p>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#12161c] p-5">
            <h2 className="mb-4 text-lg font-black">Recent Shift Logs</h2>
            <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
              {shifts.slice(0, 12).map((shift) => (
                <div key={shift.id} className="rounded-md border border-white/10 bg-white/[0.035] p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-bold">{shift.staff_name}</p>
                      <p className="text-xs text-slate-400">
                        {shift.role_label || shift.role || "General"} - {shift.date}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-slate-300">
                      {shift.shift_start || "--"}-{shift.shift_end || "--"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
