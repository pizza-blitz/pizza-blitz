"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type DepartmentModule = {
  key: string;
  label: string;
  route?: string | null;
  status: string;
  sort_order: number;
};

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
  members: {
    staff_id: string;
    display_name: string;
    role: string;
  }[];
  modules: DepartmentModule[];
};

type Staff = { staff_id: string; display_name: string; is_active: boolean };
type CatalogModule = {
  key: string;
  label: string;
  category: string;
  description: string;
  default_status: string;
};

const INTEGRATION_LABELS: Record<string, string> = {
  not_connected: "Not connected",
  pilot: "Pilot",
  connected: "Connected",
  disabled: "Disabled",
};

export default function DepartmentDetailPage() {
  const params = useParams<{ key: string }>();
  const departmentKey = params.key;
  const [department, setDepartment] = useState<Department | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [catalog, setCatalog] = useState<CatalogModule[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [memberDraft, setMemberDraft] = useState({ staff_id: "", role: "member" });
  const [externalDraft, setExternalDraft] = useState({ url: "", status: "pilot" });
  const [moduleToAdd, setModuleToAdd] = useState("");

  const load = async () => {
    try {
      const [departmentResponse, staffResponse, catalogResponse] = await Promise.all([
        fetch(getApiUrl(`/api/v1/restaurant/departments/${departmentKey}`), {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(getApiUrl("/api/v1/restaurant/departments/staff-catalog"), {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(getApiUrl("/api/v1/restaurant/departments/catalog"), {
          credentials: "include",
          cache: "no-store",
        }),
      ]);
      const departmentData = await departmentResponse.json();
      if (!departmentResponse.ok) {
        throw new Error(departmentData.detail || "Department not found.");
      }
      const staffData = staffResponse.ok ? await staffResponse.json() : { staff: [] };
      const catalogData = catalogResponse.ok
        ? await catalogResponse.json()
        : { modules: [] };
      setDepartment(departmentData);
      setStaff(staffData.staff || []);
      setCatalog(catalogData.modules || []);
      setExternalDraft({
        url: departmentData.external_url || "",
        status: departmentData.integration_status || "pilot",
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Department not found.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setHydrated(true);
    void load();
  }, [departmentKey]);

  const addMember = async () => {
    if (!department || !memberDraft.staff_id) return;
    setBusy("member");
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/departments/${department.id}/members`),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(memberDraft),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Member could not be added.");
      setDepartment(data);
      setMemberDraft({ staff_id: "", role: "member" });
      setMessage("Team member added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Member could not be added.");
    } finally {
      setBusy("");
    }
  };

  const removeMember = async (staffId: string) => {
    if (!department) return;
    setBusy(`remove-${staffId}`);
    try {
      const response = await fetch(
        getApiUrl(
          `/api/v1/restaurant/departments/${department.id}/members/${encodeURIComponent(staffId)}`
        ),
        { method: "DELETE", credentials: "include" }
      );
      if (!response.ok && response.status !== 204) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || "Member could not be removed.");
      }
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Member could not be removed.");
    } finally {
      setBusy("");
    }
  };

  const addModule = async () => {
    if (!department || !moduleToAdd) return;
    setBusy("module");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/departments/${department.id}`),
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modules: [...department.modules.map((module) => module.key), moduleToAdd],
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Module could not be added.");
      setDepartment(data);
      setModuleToAdd("");
      setMessage("Module added to the department.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Module could not be added.");
    } finally {
      setBusy("");
    }
  };

  const saveIntegration = async () => {
    if (!department) return;
    setBusy("integration");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/departments/${department.id}`),
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            external_url: externalDraft.url.trim() || null,
            integration_status: externalDraft.status,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Integration could not be saved.");
      setDepartment(data);
      setMessage("Integration settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Integration could not be saved.");
    } finally {
      setBusy("");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white p-6 text-sm font-bold text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading department...
      </div>
    );
  }

  if (!department) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm font-bold text-red-800">
        {message || "Department not found."}
        <Link href="/departments" className="mt-3 block text-orange-700 underline">
          Back to departments
        </Link>
      </div>
    );
  }

  const activeModuleKeys = new Set(department.modules.map((module) => module.key));
  const availableModules = catalog.filter(
    (module) => !activeModuleKeys.has(module.key)
  );

  return (
    <div
      data-testid="department-detail"
      data-hydrated={hydrated ? "true" : "false"}
      className="space-y-6 animate-in fade-in duration-300"
    >
      <div>
        <Link
          href="/departments"
          className="inline-flex items-center gap-1 text-xs font-black uppercase tracking-widest text-gray-400 hover:text-orange-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All departments
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span
              className="grid h-12 w-12 place-items-center rounded-xl text-white"
              style={{ backgroundColor: department.color }}
            >
              <Building2 className="h-6 w-6" />
            </span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
                Department · {department.key}
              </p>
              <h1
                data-testid="department-name-heading"
                className="text-3xl font-black text-gray-950"
              >
                {department.name}
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-gray-500">
                {department.description || "No description yet."}
              </p>
            </div>
          </div>
          <span className="rounded-full bg-gray-100 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-gray-500">
            {department.status}
          </span>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-900">
          {message}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <section className="rounded-2xl border border-gray-100 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
              <Settings2 className="h-4 w-4 text-orange-600" /> Modules
            </p>
            {availableModules.length > 0 && (
              <div className="flex items-center gap-2">
                <select
                  aria-label="Add module"
                  value={moduleToAdd}
                  onChange={(event) => setModuleToAdd(event.target.value)}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-[10px] font-bold text-gray-600"
                >
                  <option value="">Add module...</option>
                  {availableModules.map((module) => (
                    <option key={module.key} value={module.key}>
                      {module.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void addModule()}
                  disabled={!moduleToAdd || busy === "module"}
                  className="rounded-lg bg-gray-950 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            )}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {department.modules.map((module) => {
              const active = module.status === "active" && module.route;
              const card = (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-black text-gray-900">{module.label}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                        module.status === "active"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {module.status}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] font-semibold text-gray-500">
                    {module.route || "Route not configured"}
                  </p>
                  {active && (
                    <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-black text-orange-700">
                      Open <ArrowUpRight className="h-3 w-3" />
                    </span>
                  )}
                </>
              );
              return active ? (
                <Link
                  key={module.key}
                  href={module.route as string}
                  data-testid={`department-module-${module.key}`}
                  className="rounded-xl border border-gray-100 p-3 hover:border-orange-200 hover:bg-orange-50/30"
                >
                  {card}
                </Link>
              ) : (
                <div
                  key={module.key}
                  data-testid={`department-module-${module.key}`}
                  className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-3"
                >
                  {card}
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-5">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
            <Users className="h-4 w-4 text-orange-600" /> Team
          </p>
          <div className="mt-3 space-y-2">
            {department.members.length ? (
              department.members.map((member) => (
                <div
                  key={member.staff_id}
                  data-testid={`department-member-${member.staff_id}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-black text-gray-900">
                      {member.display_name}
                    </p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      {member.staff_id} · {member.role}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${member.display_name}`}
                    onClick={() => void removeMember(member.staff_id)}
                    disabled={busy === `remove-${member.staff_id}`}
                    className="text-gray-300 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))
            ) : (
              <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-xs font-semibold text-gray-400">
                No one assigned yet.
              </p>
            )}
          </div>

          <div className="mt-4 space-y-2 border-t border-gray-100 pt-3">
            <select
              aria-label="Staff member"
              value={memberDraft.staff_id}
              onChange={(event) =>
                setMemberDraft({ ...memberDraft, staff_id: event.target.value })
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700"
            >
              <option value="">Select staff...</option>
              {staff.map((person) => (
                <option key={person.staff_id} value={person.staff_id}>
                  {person.display_name} ({person.staff_id})
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <select
                aria-label="Member role"
                value={memberDraft.role}
                onChange={(event) =>
                  setMemberDraft({ ...memberDraft, role: event.target.value })
                }
                className="flex-1 rounded-lg border border-gray-200 px-2 py-2 text-xs font-bold text-gray-700"
              >
                <option value="head">Head</option>
                <option value="manager">Manager</option>
                <option value="member">Member</option>
              </select>
              <button
                type="button"
                onClick={() => void addMember()}
                disabled={!memberDraft.staff_id || busy === "member"}
                className="inline-flex items-center gap-1 rounded-lg bg-gray-950 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
          </div>
        </section>
      </div>

      {department.external_system && (
        <section
          data-testid="department-external-system"
          className="rounded-2xl border border-teal-100 bg-teal-50/60 p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-teal-700">
                <ShieldCheck className="h-4 w-4" /> External HR system
              </p>
              <h2 className="mt-1 text-lg font-black text-teal-950">
                {department.external_system}
              </h2>
              <p className="mt-1 max-w-xl text-xs font-semibold leading-5 text-teal-900">
                HR runs as a department here, with payroll and people operations
                delegated to the external HRMS. It is a pilot until credentials, data
                mapping and payroll reconciliation are signed off.
              </p>
            </div>
            <span className="rounded-full bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-teal-800">
              {INTEGRATION_LABELS[department.integration_status] ||
                department.integration_status}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-[10px] font-black uppercase tracking-widest text-teal-700">
              HR portal URL
              <input
                value={externalDraft.url}
                onChange={(event) =>
                  setExternalDraft({ ...externalDraft, url: event.target.value })
                }
                placeholder="https://hr.example.com"
                className="mt-1 block w-full rounded-lg border border-teal-200 bg-white px-3 py-2 font-mono text-xs font-bold text-gray-700"
              />
            </label>
            <label className="text-[10px] font-black uppercase tracking-widest text-teal-700">
              Status
              <select
                value={externalDraft.status}
                onChange={(event) =>
                  setExternalDraft({ ...externalDraft, status: event.target.value })
                }
                className="mt-1 block rounded-lg border border-teal-200 bg-white px-3 py-2 text-xs font-bold text-gray-700"
              >
                <option value="not_connected">Not connected</option>
                <option value="pilot">Pilot</option>
                <option value="connected">Connected</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => void saveIntegration()}
              disabled={busy === "integration"}
              className="rounded-lg bg-teal-800 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
            >
              Save
            </button>
            {department.external_url && (
              <a
                href={department.external_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-teal-800"
              >
                Open HR portal <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          <p className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-teal-800">
            <CheckCircle2 className="h-3.5 w-3.5" /> No fake connection: planned HR
            modules stay disabled until the integration is live.
          </p>
        </section>
      )}
    </div>
  );
}
