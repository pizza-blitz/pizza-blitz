"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  X,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type Salary = {
  id: number;
  basic: number;
  hra: number;
  allowances: number;
  other_deductions: number;
  tds: number;
  pf_enabled: boolean;
  esi_enabled: boolean;
  professional_tax: number;
  monthly_gross: number;
};

type SalaryRow = {
  employee_id: number;
  employee_code: string;
  full_name: string;
  designation?: string | null;
  structure: Salary | null;
};

type Payslip = {
  id: number;
  employee_id: number;
  employee_code: string;
  employee_name: string;
  designation?: string | null;
  days_in_month: number;
  paid_days: number;
  basic: number;
  hra: number;
  allowances: number;
  gross: number;
  pf_employee: number;
  esi_employee: number;
  professional_tax: number;
  tds: number;
  other_deductions: number;
  total_deductions: number;
  net: number;
  employer_pf: number;
  employer_esi: number;
  breakdown: { earnings?: { label: string; amount: number }[]; deductions?: { label: string; amount: number }[] };
};

type PayRun = {
  id: number;
  month: number;
  year: number;
  status: string;
  employee_count: number;
  gross_total: number;
  deductions_total: number;
  net_total: number;
  employer_cost: number;
  finalized_at?: string | null;
  payslips?: Payslip[];
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const money = (value: number) =>
  `Rs ${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const EMPTY_SALARY = {
  basic: "30000",
  hra: "12000",
  allowances: "8000",
  other_deductions: "0",
  tds: "0",
  professional_tax: "200",
  pf_enabled: true,
  esi_enabled: true,
};

export default function HRPayrollPage() {
  const now = new Date();
  const [tab, setTab] = useState<"runs" | "salaries">("runs");
  const [salaries, setSalaries] = useState<SalaryRow[]>([]);
  const [runs, setRuns] = useState<PayRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<PayRun | null>(null);
  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [hydrated, setHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<SalaryRow | null>(null);
  const [form, setForm] = useState({ ...EMPTY_SALARY });

  const load = async () => {
    try {
      const [salaryRes, runRes] = await Promise.all([
        fetch(getApiUrl("/api/v1/restaurant/hr/payroll/salary-structures"), {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(getApiUrl("/api/v1/restaurant/hr/payroll/runs"), {
          credentials: "include",
          cache: "no-store",
        }),
      ]);
      const salaryData = await salaryRes.json();
      if (!salaryRes.ok) throw new Error(salaryData.detail || "Payroll failed to load.");
      setSalaries(salaryData.employees || []);
      if (runRes.ok) setRuns((await runRes.json()).runs || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payroll failed to load.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setHydrated(true);
    void load();
  }, []);

  const generate = async () => {
    setBusy("generate");
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/hr/payroll/runs"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ month, year }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Pay run failed.");
      setSelectedRun(data.run);
      setRuns((current) => [data.run, ...current]);
      setMessage(
        `Draft pay run created for ${MONTHS[data.run.month - 1]} ${data.run.year}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pay run failed.");
    } finally {
      setBusy("");
    }
  };

  const openRun = async (run: PayRun) => {
    setBusy(`run-${run.id}`);
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/hr/payroll/runs/${run.id}`),
        { credentials: "include", cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Pay run failed to load.");
      setSelectedRun(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pay run failed to load.");
    } finally {
      setBusy("");
    }
  };

  const recalculate = async () => {
    if (!selectedRun) return;
    setBusy("recalculate");
    try {
      const response = await fetch(
        getApiUrl(
          `/api/v1/restaurant/hr/payroll/runs/${selectedRun.id}/recalculate`
        ),
        { method: "POST", credentials: "include" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Recalculation failed.");
      setSelectedRun(data.run);
      await load();
      setMessage("Draft pay run recalculated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Recalculation failed.");
    } finally {
      setBusy("");
    }
  };

  const finalize = async () => {
    if (!selectedRun) return;
    setBusy("finalize");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/hr/payroll/runs/${selectedRun.id}/finalize`),
        { method: "POST", credentials: "include" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Finalization failed.");
      setSelectedRun(data);
      await load();
      setMessage("Pay run finalized. Payslips are locked.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Finalization failed.");
    } finally {
      setBusy("");
    }
  };

  const openSalary = (row: SalaryRow) => {
    setEditing(row);
    setForm(
      row.structure
        ? {
            basic: String(row.structure.basic),
            hra: String(row.structure.hra),
            allowances: String(row.structure.allowances),
            other_deductions: String(row.structure.other_deductions),
            tds: String(row.structure.tds),
            professional_tax: String(row.structure.professional_tax),
            pf_enabled: row.structure.pf_enabled,
            esi_enabled: row.structure.esi_enabled,
          }
        : { ...EMPTY_SALARY }
    );
  };

  const saveSalary = async () => {
    if (!editing) return;
    setBusy("salary");
    try {
      const response = await fetch(
        getApiUrl(
          `/api/v1/restaurant/hr/payroll/salary-structures/${editing.employee_id}`
        ),
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            basic: Number(form.basic || 0),
            hra: Number(form.hra || 0),
            allowances: Number(form.allowances || 0),
            other_deductions: Number(form.other_deductions || 0),
            tds: Number(form.tds || 0),
            professional_tax: Number(form.professional_tax || 0),
            pf_enabled: form.pf_enabled,
            esi_enabled: form.esi_enabled,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Salary failed.");
      setEditing(null);
      await load();
      setMessage(`Salary saved for ${editing.full_name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Salary failed.");
    } finally {
      setBusy("");
    }
  };

  const totals = useMemo(
    () =>
      runs.reduce(
        (acc, run) => ({
          net: acc.net + run.net_total,
          gross: acc.gross + run.gross_total,
        }),
        { net: 0, gross: 0 }
      ),
    [runs]
  );

  return (
    <div
      data-testid="hr-payroll-page"
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
        <div className="mt-2">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-teal-700">
            HR department · Pay
          </p>
          <h1 className="text-3xl font-black text-gray-950">Payroll & payslips</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            Monthly salary structures, attendance-aware pay runs, PF/ESI/professional-tax
            deductions and printable payslips. Amounts are records, not bank payouts.
          </p>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-900">
          {message}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          data-testid="payroll-tab-runs"
          onClick={() => setTab("runs")}
          className={`rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest ${
            tab === "runs" ? "bg-gray-950 text-white" : "border border-gray-200 bg-white text-gray-500"
          }`}
        >
          Pay runs
        </button>
        <button
          type="button"
          data-testid="payroll-tab-salaries"
          onClick={() => setTab("salaries")}
          className={`rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest ${
            tab === "salaries" ? "bg-gray-950 text-white" : "border border-gray-200 bg-white text-gray-500"
          }`}
        >
          Salary structures
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white p-6 text-sm font-bold text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading payroll...
        </div>
      ) : tab === "salaries" ? (
        <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2">Basic</th>
                  <th className="px-3 py-2">HRA</th>
                  <th className="px-3 py-2">Allowances</th>
                  <th className="px-3 py-2">Monthly gross</th>
                  <th className="px-3 py-2">PF/ESI</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {salaries.map((row) => (
                  <tr
                    key={row.employee_id}
                    className="border-b border-gray-50 text-sm"
                  >
                    <td className="px-3 py-3">
                      <p className="font-black text-gray-900">{row.full_name}</p>
                      <p className="text-[10px] font-semibold text-gray-400">
                        {row.employee_code}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-xs font-bold text-gray-600">
                      {row.structure ? money(row.structure.basic) : "—"}
                    </td>
                    <td className="px-3 py-3 text-xs font-bold text-gray-600">
                      {row.structure ? money(row.structure.hra) : "—"}
                    </td>
                    <td className="px-3 py-3 text-xs font-bold text-gray-600">
                      {row.structure ? money(row.structure.allowances) : "—"}
                    </td>
                    <td className="px-3 py-3 text-xs font-black text-gray-900">
                      {row.structure ? money(row.structure.monthly_gross) : "Not set"}
                    </td>
                    <td className="px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      {row.structure
                        ? `${row.structure.pf_enabled ? "PF" : "No PF"} · ${
                            row.structure.esi_enabled ? "ESI" : "No ESI"
                          }`
                        : "—"}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openSalary(row)}
                        aria-label={`Edit salary for ${row.full_name}`}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-gray-100 bg-white p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Pay runs
              </p>
              <p className="mt-1 text-2xl font-black text-gray-950">{runs.length}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Latest gross
              </p>
              <p className="mt-1 text-2xl font-black text-gray-950">
                {money(runs[0]?.gross_total || 0)}
              </p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Latest net
              </p>
              <p className="mt-1 text-2xl font-black text-teal-700">
                {money(runs[0]?.net_total || 0)}
              </p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                All-time net
              </p>
              <p className="mt-1 text-2xl font-black text-gray-950">
                {money(totals.net)}
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-4">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Month
                <select
                  data-testid="payroll-month"
                  value={month}
                  onChange={(event) => setMonth(Number(event.target.value))}
                  className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                >
                  {MONTHS.map((label, index) => (
                    <option key={label} value={index + 1}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Year
                <input
                  type="number"
                  value={year}
                  onChange={(event) => setYear(Number(event.target.value))}
                  className="mt-1 block w-28 rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                />
              </label>
              <button
                type="button"
                data-testid="payroll-generate"
                onClick={() => void generate()}
                disabled={busy === "generate"}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
              >
                {busy === "generate" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Generate draft
              </button>
              <span className="text-[10px] font-semibold text-gray-400">
                PF 12% of basic capped at Rs 15,000 · ESI only up to Rs 21,000 gross ·
                professional tax is a configurable flat amount.
              </span>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
            {runs.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm font-semibold text-gray-400">
                No pay runs yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                      <th className="px-3 py-2">Period</th>
                      <th className="px-3 py-2">Employees</th>
                      <th className="px-3 py-2">Gross</th>
                      <th className="px-3 py-2">Deductions</th>
                      <th className="px-3 py-2">Net</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr
                        key={run.id}
                        data-testid={`payroll-run-${run.id}`}
                        className="border-b border-gray-50 text-sm"
                      >
                        <td className="px-3 py-3 font-black text-gray-900">
                          {MONTHS[run.month - 1]} {run.year}
                        </td>
                        <td className="px-3 py-3 text-xs font-bold text-gray-600">
                          {run.employee_count}
                        </td>
                        <td className="px-3 py-3 text-xs font-bold text-gray-600">
                          {money(run.gross_total)}
                        </td>
                        <td className="px-3 py-3 text-xs font-bold text-red-600">
                          {money(run.deductions_total)}
                        </td>
                        <td className="px-3 py-3 text-xs font-black text-teal-700">
                          {money(run.net_total)}
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest ${
                              run.status === "finalized"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {run.status}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => void openRun(run)}
                            disabled={busy === `run-${run.id}`}
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
        </>
      )}

      {selectedRun && (
        <section
          data-testid="payroll-run-detail"
          className="rounded-2xl border border-gray-100 bg-white p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">
                Pay run · {selectedRun.status}
              </p>
              <h2 className="text-2xl font-black text-gray-950">
                {MONTHS[selectedRun.month - 1]} {selectedRun.year}
              </h2>
              <p className="mt-1 text-xs font-semibold text-gray-500">
                {selectedRun.employee_count} employees · net {money(selectedRun.net_total)} ·
                employer cost {money(selectedRun.employer_cost)}
              </p>
            </div>
            <div className="flex gap-2">
              {selectedRun.status === "draft" && (
                <>
                  <button
                    type="button"
                    data-testid="payroll-recalculate"
                    onClick={() => void recalculate()}
                    disabled={busy === "recalculate"}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-600 disabled:opacity-40"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Recalculate
                  </button>
                  <button
                    type="button"
                    data-testid="payroll-finalize"
                    onClick={() => void finalize()}
                    disabled={busy === "finalize"}
                    className="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Finalize
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setSelectedRun(null)}
                aria-label="Close pay run"
                className="rounded-lg border border-gray-200 p-2 text-gray-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2">Paid days</th>
                  <th className="px-3 py-2">Gross</th>
                  <th className="px-3 py-2">Deductions</th>
                  <th className="px-3 py-2">Net</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {(selectedRun.payslips || []).map((row) => (
                  <tr key={row.id} className="border-b border-gray-50 text-sm">
                    <td className="px-3 py-3">
                      <p className="font-black text-gray-900">{row.employee_name}</p>
                      <p className="text-[10px] font-semibold text-gray-400">
                        {row.employee_code}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-xs font-bold text-gray-600">
                      {row.paid_days} / {row.days_in_month}
                    </td>
                    <td className="px-3 py-3 text-xs font-bold text-gray-600">
                      {money(row.gross)}
                    </td>
                    <td className="px-3 py-3 text-xs font-bold text-red-600">
                      {money(row.total_deductions)}
                    </td>
                    <td className="px-3 py-3 text-xs font-black text-teal-700">
                      {money(row.net)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        data-testid={`payroll-payslip-${row.id}`}
                        onClick={() => setPayslip(row)}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-gray-600"
                      >
                        <FileText className="h-3 w-3" /> Payslip
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div data-testid="salary-form" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">
                  Salary structure
                </p>
                <h2 className="mt-1 text-2xl font-black text-gray-950">
                  {editing.full_name}
                </h2>
              </div>
              <button type="button" onClick={() => setEditing(null)} aria-label="Close salary form">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["basic", "Basic"],
                  ["hra", "HRA"],
                  ["allowances", "Allowances"],
                  ["other_deductions", "Other deductions"],
                  ["tds", "Monthly TDS"],
                  ["professional_tax", "Professional tax"],
                ] as [keyof typeof EMPTY_SALARY, string][]
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="text-[10px] font-black uppercase tracking-widest text-gray-400"
                >
                  {label}
                  <input
                    type="number"
                    min="0"
                    value={String(form[key])}
                    onChange={(event) =>
                      setForm({ ...form, [key]: event.target.value })
                    }
                    className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-xs font-bold text-gray-600">
                <input
                  type="checkbox"
                  checked={form.pf_enabled}
                  onChange={(event) =>
                    setForm({ ...form, pf_enabled: event.target.checked })
                  }
                />
                Provident Fund
              </label>
              <label className="flex items-center gap-2 text-xs font-bold text-gray-600">
                <input
                  type="checkbox"
                  checked={form.esi_enabled}
                  onChange={(event) =>
                    setForm({ ...form, esi_enabled: event.target.checked })
                  }
                />
                ESI
              </label>
            </div>
            <button
              type="button"
              data-testid="salary-save"
              onClick={() => void saveSalary()}
              disabled={busy === "salary"}
              className="mt-4 w-full rounded-lg bg-gray-950 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
            >
              Save salary structure
            </button>
          </div>
        </div>
      )}

      {payslip && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-3 sm:items-center">
          <div
            data-testid="payslip-modal"
            className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">
                  Payslip
                </p>
                <h2 className="text-2xl font-black text-gray-950">
                  {payslip.employee_name}
                </h2>
                <p className="text-xs font-semibold text-gray-400">
                  {payslip.employee_code} · {payslip.designation || "Employee"}
                </p>
              </div>
              <button type="button" onClick={() => setPayslip(null)} aria-label="Close payslip">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>

            <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600">
              {selectedRun ? `${MONTHS[selectedRun.month - 1]} ${selectedRun.year}` : ""} ·
              Paid days {payslip.paid_days} / {payslip.days_in_month}
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Earnings
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {(payslip.breakdown.earnings || []).map((line) => (
                    <li key={line.label} className="flex justify-between text-gray-700">
                      <span>{line.label}</span>
                      <span className="font-bold">{money(line.amount)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between border-t border-gray-200 pt-1 font-black text-gray-950">
                    <span>Gross</span>
                    <span>{money(payslip.gross)}</span>
                  </li>
                </ul>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Deductions
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {(payslip.breakdown.deductions || []).map((line) => (
                    <li key={line.label} className="flex justify-between text-gray-700">
                      <span>{line.label}</span>
                      <span className="font-bold">{money(line.amount)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between border-t border-gray-200 pt-1 font-black text-gray-950">
                    <span>Total</span>
                    <span>{money(payslip.total_deductions)}</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="mt-4 rounded-xl bg-teal-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">
                Net pay
              </p>
              <p className="text-3xl font-black text-teal-900">{money(payslip.net)}</p>
              <p className="mt-1 text-[10px] font-semibold text-teal-800">
                Employer PF {money(payslip.employer_pf)} · Employer ESI{" "}
                {money(payslip.employer_esi)}
              </p>
            </div>

            <button
              type="button"
              onClick={() => window.print()}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 py-2.5 text-xs font-black uppercase tracking-widest text-gray-700"
            >
              <Printer className="h-4 w-4" /> Print payslip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
