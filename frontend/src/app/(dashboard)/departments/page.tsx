"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ListChecks,
  Loader2,
  Plus,
  Settings2,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";
import {
  KPI_TONES,
  type DepartmentAccess,
  type Kpi,
  type Scorecard,
} from "@/lib/company";

type Department = {
  id: number;
  key: string;
  name: string;
  description?: string | null;
  color: string;
  icon: string;
  status: string;
  external_system?: string | null;
  external_url?: string | null;
  integration_status: string;
  member_count: number;
  module_count: number;
};

type Module = {
  key: string;
  label: string;
  category: string;
  description: string;
  default_status: string;
};

const COLOR_CHOICES = ["#f97316", "#0f766e", "#2563eb", "#7c3aed", "#db2777", "#475569"];

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [catalog, setCatalog] = useState<Module[]>([]);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [access, setAccess] = useState<DepartmentAccess | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    key: "",
    description: "",
    color: COLOR_CHOICES[0],
    modules: ["overview"] as string[],
    external_system: "",
  });

  const load = async () => {
    try {
      const [response, scorecardResponse, accessResponse] = await Promise.all([
        fetch(getApiUrl("/api/v1/restaurant/departments/"), {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(getApiUrl("/api/v1/restaurant/departments/scorecard"), {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(getApiUrl("/api/v1/restaurant/departments/access"), {
          credentials: "include",
          cache: "no-store",
        }),
      ]);
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Departments failed to load.");
      setDepartments(data.departments || []);
      setCatalog(data.catalog || []);
      if (scorecardResponse.ok) {
        setScorecard(await scorecardResponse.json());
      }
      if (accessResponse.ok) setAccess(await accessResponse.json());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Departments failed to load.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setHydrated(true);
    void load();
  }, []);

  const toggleModule = (key: string) => {
    setForm((current) => ({
      ...current,
      modules: current.modules.includes(key)
        ? current.modules.filter((entry) => entry !== key)
        : [...current.modules, key],
    }));
  };

  const createDepartment = async () => {
    if (!form.name.trim()) {
      setMessage("Give the department a name.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/departments/"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            key: form.key.trim() || undefined,
            description: form.description.trim() || null,
            color: form.color,
            modules: form.modules.length ? form.modules : ["overview"],
            external_system: form.external_system.trim() || null,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Department could not be created.");
      setShowCreate(false);
      setForm({
        name: "",
        key: "",
        description: "",
        color: COLOR_CHOICES[0],
        modules: ["overview"],
        external_system: "",
      });
      await load();
      setMessage(`${data.name} is ready. Add its team and modules.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Department could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const grouped = catalog.reduce<Record<string, Module[]>>((acc, module) => {
    acc[module.category] = [...(acc[module.category] || []), module];
    return acc;
  }, {});

  return (
    <div
      data-testid="departments-page"
      data-hydrated={hydrated ? "true" : "false"}
      className="space-y-6 animate-in fade-in duration-300"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
            <Building2 className="h-4 w-4" /> Admin domain
          </p>
          <h1 className="mt-1 text-3xl font-black text-gray-950">Departments</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Each department owns a curated set of modules and staff. HR is a department,
            not a separate product; future departments are created from this registry.
          </p>
        </div>
        {(!access || access.is_admin) && (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/work"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-widest text-gray-700 hover:border-orange-300"
            >
              <ListChecks className="h-4 w-4" /> My work
            </Link>
            <button
              type="button"
              data-testid="department-create-open"
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600"
            >
              <Plus className="h-4 w-4" /> New department
            </button>
          </div>
        )}
      </div>

      {access && !access.is_admin && departments.length === 0 && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          Your account is not assigned to a department yet. Ask an admin to add
          you to a team and assign a scoped role.
        </div>
      )}

      {scorecard && scorecard.departments.length > 0 && (
        <section data-testid="company-scorecard" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
                <Sparkles className="h-4 w-4" /> Company scorecard
              </p>
              <h2 className="mt-1 text-xl font-black text-gray-950">
                Every department at a glance
              </h2>
            </div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
              <span className="rounded-full bg-white px-3 py-1.5 text-gray-500">
                Generated {scorecard.generated_at}
              </span>
              <span
                className={`rounded-full px-3 py-1.5 ${
                  scorecard.attention_total
                    ? "bg-red-100 text-red-800"
                    : "bg-emerald-100 text-emerald-800"
                }`}
              >
                {scorecard.attention_total
                  ? `${scorecard.attention_total} attention signal${
                      scorecard.attention_total === 1 ? "" : "s"
                    }`
                  : "All clear"}
              </span>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {scorecard.departments.map((row) => {
              const primary: Kpi | null = row.primary || null;
              return (
                <Link
                  key={row.key}
                  href={`/departments/${row.key}`}
                  data-testid={`scorecard-department-${row.key}`}
                  className={`rounded-2xl border p-3.5 transition hover:-translate-y-0.5 hover:shadow-sm ${
                    KPI_TONES[primary?.tone || "neutral"] ||
                    KPI_TONES.neutral
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: row.color }}
                      />
                      <p className="truncate text-sm font-black">{row.name}</p>
                    </div>
                    {row.attention_count ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-red-700">
                        <AlertTriangle className="h-3 w-3" />
                        {row.attention_count}
                      </span>
                    ) : (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                    )}
                  </div>
                  <p className="mt-2 text-2xl font-black">
                    {primary?.display || "No signal"}
                  </p>
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-70">
                    {primary?.label || "KPI pending"}
                  </p>
                  <p className="mt-1 line-clamp-2 text-[11px] font-semibold opacity-70">
                    {primary?.detail || "Open the workspace for the full queue."}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {message && (
        <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-900">
          {message}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white p-6 text-sm font-bold text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading departments...
        </div>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {departments.map((department) => (
            <Link
              key={department.id}
              href={`/departments/${department.key}`}
              data-testid={`department-card-${department.key}`}
              className="group rounded-2xl border border-gray-100 bg-white p-5 transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-lg"
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  className="grid h-11 w-11 place-items-center rounded-xl text-white"
                  style={{ backgroundColor: department.color }}
                >
                  <Building2 className="h-5 w-5" />
                </span>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-gray-500">
                  {department.status}
                </span>
              </div>
              <h2 className="mt-4 text-xl font-black text-gray-950">{department.name}</h2>
              <p className="mt-1 line-clamp-2 min-h-10 text-xs font-semibold leading-5 text-gray-500">
                {department.description || "No description yet."}
              </p>
              <div className="mt-4 flex flex-wrap gap-3 text-[10px] font-black uppercase tracking-widest text-gray-400">
                <span className="inline-flex items-center gap-1">
                  <Settings2 className="h-3.5 w-3.5" /> {department.module_count} modules
                </span>
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" /> {department.member_count} people
                </span>
              </div>
              {department.external_system && (
                <p className="mt-4 rounded-lg bg-teal-50 px-3 py-2 text-[10px] font-black text-teal-800">
                  {department.external_system} · {department.integration_status}
                </p>
              )}
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-black text-orange-700">
                Open department <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          ))}
        </section>
      )}

      <section className="rounded-2xl border border-dashed border-gray-200 bg-white/70 p-5">
        <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
          <Sparkles className="h-4 w-4 text-orange-600" /> How this stays extensible
        </p>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-gray-600">
          Create a department, pick modules from the shared catalogue, and add staff.
          The department detail is generated from the same registry, so a new business
          unit does not need a new table, page or permission model.
        </p>
      </section>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div
            data-testid="department-create-modal"
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-orange-600">
                  New business unit
                </p>
                <h2 className="mt-1 text-2xl font-black text-gray-950">Create a department</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                aria-label="Close department form"
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Name
                <input
                  data-testid="department-name"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Finance & Compliance"
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-bold text-gray-900"
                />
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Key (optional)
                <input
                  value={form.key}
                  onChange={(event) => setForm({ ...form, key: event.target.value })}
                  placeholder="finance"
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2.5 font-mono text-sm font-bold text-gray-900"
                />
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 sm:col-span-2">
                Description
                <input
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  placeholder="What this department owns"
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-900"
                />
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 sm:col-span-2">
                External system (optional)
                <input
                  value={form.external_system}
                  onChange={(event) =>
                    setForm({ ...form, external_system: event.target.value })
                  }
                  placeholder="e.g. Euron Open HRMS"
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-900"
                />
              </label>
            </div>

            <div className="mt-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Colour
              </p>
              <div className="mt-2 flex gap-2">
                {COLOR_CHOICES.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Colour ${color}`}
                    onClick={() => setForm({ ...form, color })}
                    className={`h-8 w-8 rounded-full border-2 ${
                      form.color === color ? "border-gray-950" : "border-transparent"
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <div className="mt-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Modules
              </p>
              <div className="mt-2 max-h-56 space-y-3 overflow-y-auto rounded-xl border border-gray-100 p-3">
                {Object.entries(grouped).map(([category, modules]) => (
                  <div key={category}>
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                      {category}
                    </p>
                    <div className="mt-1 grid gap-1 sm:grid-cols-2">
                      {modules.map((module) => (
                        <label
                          key={module.key}
                          className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          <input
                            type="checkbox"
                            checked={form.modules.includes(module.key)}
                            onChange={() => toggleModule(module.key)}
                            className="mt-0.5"
                          />
                          <span>
                            {module.label}
                            {module.default_status === "planned" && (
                              <span className="ml-1 text-[9px] font-black text-amber-600">
                                planned
                              </span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-gray-200 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-gray-500"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="department-create-submit"
                onClick={() => void createDepartment()}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Create department
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
