"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  Loader2,
  Plus,
  Users,
  X,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type LeaveType = {
  id: number;
  code: string;
  name: string;
  paid: boolean;
  annual_quota: number;
  color: string;
};

type LeaveRequest = {
  id: number;
  employee_id: number;
  employee_name: string;
  employee_code: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  days: number;
  reason?: string | null;
  status: string;
  decision_note?: string | null;
};

type Balance = {
  leave_type: LeaveType;
  entitled: number;
  used: number;
  remaining: number;
};

type BalanceRow = {
  employee_id: number;
  employee_code: string;
  full_name: string;
  designation?: string | null;
  balances: Balance[];
};

type Holiday = {
  id: number;
  name: string;
  date: string;
  store_name?: string | null;
  notes?: string | null;
};

type Employee = { id: number; full_name: string; employee_code: string };
type Summary = {
  pending_requests: number;
  approved_days: number;
  on_leave_today: number;
  total_requests: number;
};

type Tab = "requests" | "balances" | "holidays" | "types";

export default function HRLeavePage() {
  const year = new Date().getFullYear();
  const [tab, setTab] = useState<Tab>("requests");
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [showRequest, setShowRequest] = useState(false);
  const [showHoliday, setShowHoliday] = useState(false);
  const [showType, setShowType] = useState(false);
  const [requestForm, setRequestForm] = useState({
    employee_id: "",
    leave_type_id: "",
    start_date: "",
    end_date: "",
    reason: "",
  });
  const [holidayForm, setHolidayForm] = useState({ name: "", date: "", notes: "" });
  const [typeForm, setTypeForm] = useState({
    code: "",
    name: "",
    annual_quota: "12",
    paid: true,
  });

  const load = async () => {
    try {
      const [requestRes, typeRes, balanceRes, holidayRes, employeeRes, summaryRes] =
        await Promise.all([
          fetch(getApiUrl("/api/v1/restaurant/hr/leave/requests"), {
            credentials: "include",
            cache: "no-store",
          }),
          fetch(getApiUrl("/api/v1/restaurant/hr/leave/types"), {
            credentials: "include",
            cache: "no-store",
          }),
          fetch(getApiUrl(`/api/v1/restaurant/hr/leave/balances?year=${year}`), {
            credentials: "include",
            cache: "no-store",
          }),
          fetch(getApiUrl("/api/v1/restaurant/hr/leave/holidays"), {
            credentials: "include",
            cache: "no-store",
          }),
          fetch(getApiUrl("/api/v1/restaurant/hr/employees"), {
            credentials: "include",
            cache: "no-store",
          }),
          fetch(getApiUrl(`/api/v1/restaurant/hr/leave/summary?year=${year}`), {
            credentials: "include",
            cache: "no-store",
          }),
        ]);
      const requestData = await requestRes.json();
      if (!requestRes.ok) throw new Error(requestData.detail || "Leave failed to load.");
      setRequests(requestData.requests || []);
      if (typeRes.ok) setTypes((await typeRes.json()).types || []);
      if (balanceRes.ok) setBalances((await balanceRes.json()).employees || []);
      if (holidayRes.ok) setHolidays((await holidayRes.json()).holidays || []);
      if (employeeRes.ok) setEmployees((await employeeRes.json()).employees || []);
      if (summaryRes.ok) setSummary(await summaryRes.json());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Leave failed to load.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setHydrated(true);
    void load();
  }, []);

  const activeEmployees = useMemo(
    () => employees.filter((row) => !("status" in row) || true),
    [employees]
  );

  const createRequest = async () => {
    setBusy("saving");
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/hr/leave/requests"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employee_id: Number(requestForm.employee_id),
            leave_type_id: Number(requestForm.leave_type_id),
            start_date: requestForm.start_date,
            end_date: requestForm.end_date,
            reason: requestForm.reason.trim() || null,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Leave request failed.");
      setShowRequest(false);
      setRequestForm({
        employee_id: "",
        leave_type_id: "",
        start_date: "",
        end_date: "",
        reason: "",
      });
      await load();
      setMessage("Leave request submitted for approval.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Leave request failed.");
    } finally {
      setBusy("");
    }
  };

  const decide = async (request: LeaveRequest, decision: "approved" | "rejected") => {
    setBusy(`request-${request.id}`);
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl(
          `/api/v1/restaurant/hr/leave/requests/${request.id}/decision`
        ),
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Decision failed.");
      await load();
      setMessage(`Leave ${decision} for ${request.employee_name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Decision failed.");
    } finally {
      setBusy("");
    }
  };

  const cancel = async (request: LeaveRequest) => {
    setBusy(`request-${request.id}`);
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/hr/leave/requests/${request.id}/cancel`),
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: "Cancelled from HR" }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Cancellation failed.");
      await load();
      setMessage("Leave request cancelled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Cancellation failed.");
    } finally {
      setBusy("");
    }
  };

  const addHoliday = async () => {
    setBusy("saving");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/hr/leave/holidays"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(holidayForm),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Holiday failed.");
      setShowHoliday(false);
      setHolidayForm({ name: "", date: "", notes: "" });
      await load();
      setMessage("Holiday added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Holiday failed.");
    } finally {
      setBusy("");
    }
  };

  const addType = async () => {
    setBusy("saving");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/hr/leave/types"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: typeForm.code,
            name: typeForm.name,
            annual_quota: Number(typeForm.annual_quota || 0),
            paid: typeForm.paid,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Leave type failed.");
      setShowType(false);
      setTypeForm({ code: "", name: "", annual_quota: "12", paid: true });
      await load();
      setMessage("Leave type added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Leave type failed.");
    } finally {
      setBusy("");
    }
  };

  const statusTone = (status: string) =>
    status === "approved"
      ? "bg-emerald-100 text-emerald-800"
      : status === "rejected"
        ? "bg-red-100 text-red-800"
        : status === "cancelled"
          ? "bg-gray-100 text-gray-500"
          : "bg-amber-100 text-amber-800";

  return (
    <div
      data-testid="hr-leave-page"
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
              HR department · Time off
            </p>
            <h1 className="text-3xl font-black text-gray-950">Leave & holidays</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              Requests, approvals, balances, holiday calendar and leave types.
              Balances are per employee and year; approvals reserve the days.
            </p>
          </div>
          {tab === "requests" && (
            <button
              type="button"
              data-testid="leave-request-open"
              onClick={() => {
                setRequestForm({
                  ...requestForm,
                  employee_id: requestForm.employee_id || String(activeEmployees[0]?.id || ""),
                  leave_type_id:
                    requestForm.leave_type_id || String(types[0]?.id || ""),
                });
                setShowRequest(true);
              }}
              disabled={isLoading || !types.length || !employees.length}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-teal-700 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" /> New leave request
            </button>
          )}
          {tab === "holidays" && (
            <button
              type="button"
              onClick={() => setShowHoliday(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-teal-700"
            >
              <Plus className="h-4 w-4" /> Add holiday
            </button>
          )}
          {tab === "types" && (
            <button
              type="button"
              onClick={() => setShowType(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-teal-700"
            >
              <Plus className="h-4 w-4" /> Add leave type
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-900">
          {message}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Pending", value: summary?.pending_requests ?? 0, icon: Clock },
          { label: "Approved days", value: summary?.approved_days ?? 0, icon: CalendarDays },
          { label: "On leave today", value: summary?.on_leave_today ?? 0, icon: Users },
          { label: "Requests", value: summary?.total_requests ?? 0, icon: CheckCircle2 },
        ].map((card) => {
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

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["requests", "Requests"],
            ["balances", "Balances"],
            ["holidays", "Holidays"],
            ["types", "Leave types"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            data-testid={`leave-tab-${key}`}
            onClick={() => setTab(key)}
            className={`rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest ${
              tab === key
                ? "bg-gray-950 text-white"
                : "border border-gray-200 bg-white text-gray-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white p-6 text-sm font-bold text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading leave...
        </div>
      ) : tab === "requests" ? (
        <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
          {requests.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm font-semibold text-gray-400">
              No leave requests yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                    <th className="px-3 py-2">Employee</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Dates</th>
                    <th className="px-3 py-2">Days</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => (
                    <tr
                      key={request.id}
                      data-testid={`leave-request-${request.id}`}
                      className="border-b border-gray-50 text-sm"
                    >
                      <td className="px-3 py-3">
                        <p className="font-black text-gray-900">{request.employee_name}</p>
                        <p className="text-[10px] font-semibold text-gray-400">
                          {request.employee_code}
                        </p>
                      </td>
                      <td className="px-3 py-3 font-semibold text-gray-600">
                        <span
                          className="mr-1 inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: request.leave_type.color }}
                        />
                        {request.leave_type.name}
                      </td>
                      <td className="px-3 py-3 text-xs font-semibold text-gray-600">
                        {request.start_date} → {request.end_date}
                      </td>
                      <td className="px-3 py-3 font-black text-gray-700">{request.days}</td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest ${statusTone(request.status)}`}>
                          {request.status}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {request.status === "pending" ? (
                          <div className="flex gap-1">
                            <button
                              type="button"
                              data-testid={`leave-approve-${request.id}`}
                              onClick={() => void decide(request, "approved")}
                              disabled={busy === `request-${request.id}`}
                              className="rounded-md bg-emerald-600 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-white disabled:opacity-40"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => void decide(request, "rejected")}
                              disabled={busy === `request-${request.id}`}
                              className="rounded-md border border-gray-200 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-gray-500 disabled:opacity-40"
                            >
                              Reject
                            </button>
                          </div>
                        ) : request.status === "approved" ? (
                          <button
                            type="button"
                            onClick={() => void cancel(request)}
                            className="text-[9px] font-black uppercase tracking-widest text-red-600"
                          >
                            Cancel
                          </button>
                        ) : (
                          <span className="text-[10px] font-semibold text-gray-400">
                            {request.decision_note || "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : tab === "balances" ? (
        <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                  <th className="px-3 py-2">Employee</th>
                  {types.map((type) => (
                    <th key={type.id} className="px-3 py-2">
                      {type.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {balances.map((row) => (
                  <tr key={row.employee_id} className="border-b border-gray-50 text-sm">
                    <td className="px-3 py-3">
                      <p className="font-black text-gray-900">{row.full_name}</p>
                      <p className="text-[10px] font-semibold text-gray-400">
                        {row.employee_code}
                      </p>
                    </td>
                    {types.map((type) => {
                      const balance = row.balances.find(
                        (entry) => entry.leave_type.id === type.id
                      );
                      return (
                        <td key={type.id} className="px-3 py-3 text-xs font-bold text-gray-600">
                          {balance ? `${balance.remaining} / ${balance.entitled}` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : tab === "holidays" ? (
        <section className="rounded-2xl border border-gray-100 bg-white p-4">
          {holidays.length === 0 ? (
            <p className="py-8 text-center text-sm font-semibold text-gray-400">
              No holidays added.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {holidays.map((holiday) => (
                <li key={holiday.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-black text-gray-900">{holiday.name}</p>
                    <p className="text-[10px] font-semibold text-gray-400">
                      {holiday.date} {holiday.store_name ? `· ${holiday.store_name}` : "· All stores"}
                    </p>
                  </div>
                  <span className="rounded-full bg-teal-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-teal-700">
                    Holiday
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="rounded-2xl border border-gray-100 bg-white p-4">
          <ul className="divide-y divide-gray-100">
            {types.map((type) => (
              <li key={type.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: type.color }} />
                  <div>
                    <p className="text-sm font-black text-gray-900">{type.name}</p>
                    <p className="text-[10px] font-semibold text-gray-400">
                      {type.paid ? "Paid" : "Unpaid"} · {type.annual_quota} days/year
                    </p>
                  </div>
                </div>
                <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-gray-300">
                  {type.code}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showRequest && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div data-testid="leave-request-form" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <h2 className="text-2xl font-black text-gray-950">New leave request</h2>
              <button type="button" onClick={() => setShowRequest(false)} aria-label="Close">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                Employee
                <select
                  data-testid="leave-employee"
                  value={requestForm.employee_id}
                  onChange={(event) => setRequestForm({ ...requestForm, employee_id: event.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                >
                  <option value="">Select employee</option>
                  {activeEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.full_name} ({employee.employee_code})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                Leave type
                <select
                  data-testid="leave-type"
                  value={requestForm.leave_type_id}
                  onChange={(event) => setRequestForm({ ...requestForm, leave_type_id: event.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                >
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                  From
                  <input
                    type="date"
                    data-testid="leave-start"
                    value={requestForm.start_date}
                    onChange={(event) => setRequestForm({ ...requestForm, start_date: event.target.value })}
                    className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                  />
                </label>
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                  To
                  <input
                    type="date"
                    data-testid="leave-end"
                    value={requestForm.end_date}
                    onChange={(event) => setRequestForm({ ...requestForm, end_date: event.target.value })}
                    className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                  />
                </label>
              </div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400">
                Reason
                <textarea
                  rows={2}
                  value={requestForm.reason}
                  onChange={(event) => setRequestForm({ ...requestForm, reason: event.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
            </div>
            <button
              type="button"
              data-testid="leave-request-submit"
              onClick={() => void createRequest()}
              disabled={Boolean(busy)}
              className="mt-4 w-full rounded-lg bg-gray-950 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
            >
              Submit request
            </button>
          </div>
        </div>
      )}

      {showHoliday && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="text-2xl font-black text-gray-950">Add holiday</h2>
            <input
              value={holidayForm.name}
              onChange={(event) => setHolidayForm({ ...holidayForm, name: event.target.value })}
              placeholder="Holiday name"
              className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold"
            />
            <input
              type="date"
              value={holidayForm.date}
              onChange={(event) => setHolidayForm({ ...holidayForm, date: event.target.value })}
              className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold"
            />
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setShowHoliday(false)} className="flex-1 rounded-lg border border-gray-200 py-2 text-xs font-black uppercase text-gray-500">
                Cancel
              </button>
              <button type="button" onClick={() => void addHoliday()} disabled={Boolean(busy)} className="flex-1 rounded-lg bg-gray-950 py-2 text-xs font-black uppercase text-white disabled:opacity-50">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {showType && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="text-2xl font-black text-gray-950">Add leave type</h2>
            <input value={typeForm.name} onChange={(event) => setTypeForm({ ...typeForm, name: event.target.value })} placeholder="Name" className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold" />
            <input value={typeForm.code} onChange={(event) => setTypeForm({ ...typeForm, code: event.target.value })} placeholder="code" className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm font-bold" />
            <input value={typeForm.annual_quota} onChange={(event) => setTypeForm({ ...typeForm, annual_quota: event.target.value })} type="number" placeholder="Annual quota" className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold" />
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setShowType(false)} className="flex-1 rounded-lg border border-gray-200 py-2 text-xs font-black uppercase text-gray-500">
                Cancel
              </button>
              <button type="button" onClick={() => void addType()} disabled={Boolean(busy)} className="flex-1 rounded-lg bg-gray-950 py-2 text-xs font-black uppercase text-white disabled:opacity-50">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
