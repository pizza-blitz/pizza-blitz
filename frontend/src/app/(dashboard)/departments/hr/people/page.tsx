"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  Loader2,
  Pencil,
  Plus,
  Search,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type Employee = {
  id: number;
  employee_code: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  designation?: string | null;
  employment_type: string;
  status: string;
  joining_date?: string | null;
  store_id?: number | null;
  store_name?: string | null;
  staff_id?: string | null;
  reports_to?: string | null;
  notes?: string | null;
  external_system?: string | null;
  external_id?: string | null;
};

type Summary = {
  total: number;
  active: number;
  onboarding: number;
  notice: number;
  exited: number;
  linked_pos_staff: number;
};

type StoreRow = { id: number; name: string };
type StaffRow = { staff_id: string; display_name: string; is_active: boolean };

const EMPTY_FORM = {
  employee_code: "",
  full_name: "",
  email: "",
  phone: "",
  designation: "",
  employment_type: "full_time",
  status: "active",
  joining_date: "",
  store_id: "",
  staff_id: "",
  reports_to: "",
  notes: "",
};

export default function HRPeoplePage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = async () => {
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (statusFilter) params.set("status", statusFilter);
      if (typeFilter) params.set("employment_type", typeFilter);
      const [employeeResponse, summaryResponse, storeResponse, staffResponse] =
        await Promise.all([
          fetch(getApiUrl(`/api/v1/restaurant/hr/employees?${params}`), {
            credentials: "include",
            cache: "no-store",
          }),
          fetch(getApiUrl("/api/v1/restaurant/hr/summary"), {
            credentials: "include",
            cache: "no-store",
          }),
          fetch(getApiUrl("/api/v1/restaurant/stores/"), {
            credentials: "include",
            cache: "no-store",
          }),
          fetch(getApiUrl("/api/v1/restaurant/departments/staff-catalog"), {
            credentials: "include",
            cache: "no-store",
          }),
        ]);
      const employeeData = await employeeResponse.json();
      if (!employeeResponse.ok) {
        throw new Error(employeeData.detail || "People directory failed to load.");
      }
      setEmployees(employeeData.employees || []);
      if (summaryResponse.ok) setSummary(await summaryResponse.json());
      if (storeResponse.ok) {
        const storeData = await storeResponse.json();
        setStores(storeData.stores || []);
      }
      if (staffResponse.ok) {
        const staffData = await staffResponse.json();
        setStaff(staffData.staff || []);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "People directory failed to load.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setHydrated(true);
    void load();
  }, [statusFilter, typeFilter]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (employee: Employee) => {
    setEditing(employee);
    setForm({
      employee_code: employee.employee_code,
      full_name: employee.full_name,
      email: employee.email || "",
      phone: employee.phone || "",
      designation: employee.designation || "",
      employment_type: employee.employment_type,
      status: employee.status,
      joining_date: employee.joining_date || "",
      store_id: employee.store_id ? String(employee.store_id) : "",
      staff_id: employee.staff_id || "",
      reports_to: employee.reports_to || "",
      notes: employee.notes || "",
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.full_name.trim()) {
      setMessage("Full name is required.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const body = {
        ...form,
        store_id: form.store_id ? Number(form.store_id) : null,
        joining_date: form.joining_date || null,
        staff_id: form.staff_id || null,
      };
      const response = await fetch(
        getApiUrl(
          editing
            ? `/api/v1/restaurant/hr/employees/${editing.id}`
            : "/api/v1/restaurant/hr/employees"
        ),
        {
          method: editing ? "PATCH" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Employee could not be saved.");
      setShowForm(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      await load();
      setMessage(`${data.full_name} saved to the people directory.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Employee could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const cards = useMemo(
    () => [
      { label: "Headcount", value: summary?.total ?? 0, icon: Users },
      { label: "Active", value: summary?.active ?? 0, icon: BadgeCheck },
      { label: "Onboarding", value: summary?.onboarding ?? 0, icon: UserRound },
      { label: "Linked POS", value: summary?.linked_pos_staff ?? 0, icon: BadgeCheck },
    ],
    [summary]
  );

  return (
    <div
      data-testid="hr-people-page"
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
              HR department · People
            </p>
            <h1 className="text-3xl font-black text-gray-950">People directory</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              Employee records, employment status and the link to POS staff access.
              This is the local mirror the Euron HRMS pilot will sync against.
            </p>
          </div>
          <button
            type="button"
            data-testid="hr-employee-create-open"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-teal-700"
          >
            <Plus className="h-4 w-4" /> Add employee
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-900">
          {message}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
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

      <section className="rounded-2xl border border-gray-100 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              aria-label="Search employees"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void load();
              }}
              placeholder="Search name, code, email or designation"
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm font-semibold text-gray-900"
            />
          </div>
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="onboarding">Onboarding</option>
            <option value="notice">Notice</option>
            <option value="exited">Exited</option>
          </select>
          <select
            aria-label="Filter by employment type"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600"
          >
            <option value="">All types</option>
            <option value="full_time">Full time</option>
            <option value="part_time">Part time</option>
            <option value="contract">Contract</option>
            <option value="intern">Intern</option>
          </select>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-gray-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-600"
          >
            Search
          </button>
        </div>

        {isLoading ? (
          <div className="mt-4 flex items-center gap-2 text-sm font-bold text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading people...
          </div>
        ) : employees.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center">
            <UserRound className="mx-auto h-7 w-7 text-gray-300" />
            <p className="mt-2 text-sm font-black text-gray-500">No employees yet</p>
            <p className="text-xs font-semibold text-gray-400">
              Add the first person to the HR department.
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                  <th className="px-2 py-2">Person</th>
                  <th className="px-2 py-2">Designation</th>
                  <th className="px-2 py-2">Store</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">POS link</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr
                    key={employee.id}
                    data-testid={`hr-employee-row-${employee.employee_code}`}
                    className="border-b border-gray-50 text-sm"
                  >
                    <td className="px-2 py-3">
                      <p className="font-black text-gray-900">{employee.full_name}</p>
                      <p className="text-[10px] font-semibold text-gray-400">
                        {employee.employee_code}
                        {employee.email ? ` · ${employee.email}` : ""}
                      </p>
                    </td>
                    <td className="px-2 py-3 font-semibold text-gray-600">
                      {employee.designation || "—"}
                    </td>
                    <td className="px-2 py-3 font-semibold text-gray-600">
                      {employee.store_name || "All stores"}
                    </td>
                    <td className="px-2 py-3 text-xs font-bold capitalize text-gray-500">
                      {employee.employment_type.replace("_", " ")}
                    </td>
                    <td className="px-2 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest ${
                          employee.status === "active"
                            ? "bg-emerald-100 text-emerald-800"
                            : employee.status === "exited"
                              ? "bg-gray-100 text-gray-500"
                              : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {employee.status}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-xs font-bold text-gray-500">
                      {employee.staff_id || "Not linked"}
                    </td>
                    <td className="px-2 py-3 text-right">
                      <button
                        type="button"
                        aria-label={`Edit ${employee.full_name}`}
                        onClick={() => openEdit(employee)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div
            data-testid="hr-employee-form"
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">
                  {editing ? "Update employee" : "New HR employee"}
                </p>
                <h2 className="mt-1 text-2xl font-black text-gray-950">
                  {editing ? editing.full_name : "Add to the people directory"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                aria-label="Close employee form"
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Full name
                <input
                  data-testid="hr-employee-name"
                  value={form.full_name}
                  onChange={(event) => setForm({ ...form, full_name: event.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                />
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Employee code
                <input
                  data-testid="hr-employee-code"
                  value={form.employee_code}
                  onChange={(event) => setForm({ ...form, employee_code: event.target.value })}
                  placeholder="Auto-generated if blank"
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm font-bold text-gray-900"
                />
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Email
                <input
                  type="email"
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
                  placeholder="Kitchen Lead"
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Joining date
                <input
                  type="date"
                  value={form.joining_date}
                  onChange={(event) => setForm({ ...form, joining_date: event.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Employment type
                <select
                  value={form.employment_type}
                  onChange={(event) =>
                    setForm({ ...form, employment_type: event.target.value })
                  }
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                >
                  <option value="full_time">Full time</option>
                  <option value="part_time">Part time</option>
                  <option value="contract">Contract</option>
                  <option value="intern">Intern</option>
                </select>
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Status
                <select
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                >
                  <option value="active">Active</option>
                  <option value="onboarding">Onboarding</option>
                  <option value="notice">Notice</option>
                  <option value="exited">Exited</option>
                </select>
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
                Link POS staff credential
                <select
                  value={form.staff_id}
                  onChange={(event) => setForm({ ...form, staff_id: event.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                >
                  <option value="">No POS access</option>
                  {staff.map((person) => (
                    <option key={person.staff_id} value={person.staff_id}>
                      {person.display_name} ({person.staff_id})
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 sm:col-span-2">
                Reports to
                <input
                  value={form.reports_to}
                  onChange={(event) => setForm({ ...form, reports_to: event.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 sm:col-span-2">
                Notes
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900"
                />
              </label>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-gray-200 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-gray-500"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="hr-employee-save"
                onClick={() => void save()}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                Save employee
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
