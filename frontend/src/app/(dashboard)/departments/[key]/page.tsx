"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  Loader2,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";
import {
  KPI_TONES,
  PRIORITY_STYLES,
  formatWorkDate,
  portalIcon,
  titleCase,
  type Approval,
  type CatalogModule,
  type DepartmentWorkspace,
  type Kpi,
  type StaffOption,
  type WorkItem,
} from "@/lib/company";

const INTEGRATION_LABELS: Record<string, string> = {
  not_connected: "Not connected",
  pilot: "Pilot",
  connected: "Connected",
  disabled: "Disabled",
};

function toneClass(tone?: string) {
  return KPI_TONES[tone || "neutral"] || KPI_TONES.neutral;
}

export default function DepartmentDetailPage() {
  const params = useParams<{ key: string }>();
  const departmentKey = params.key;
  const [department, setDepartment] = useState<DepartmentWorkspace | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [memberDraft, setMemberDraft] = useState({
    staff_id: "",
    role: "member",
    title: "",
    department_role_id: "",
  });
  const [externalDraft, setExternalDraft] = useState({ url: "", status: "pilot" });
  const [moduleToAdd, setModuleToAdd] = useState("");
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [roleDraft, setRoleDraft] = useState({
    name: "",
    level: "member",
    permissions: [] as string[],
  });

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/departments/${departmentKey}`),
        { credentials: "include", cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.detail || "This department is not available to your account."
        );
      }
      setDepartment(data);
      setExternalDraft({
        url: data.external_url || "",
        status: data.integration_status || "pilot",
      });
      if (data.access?.is_admin) {
        const staffResponse = await fetch(
          getApiUrl("/api/v1/restaurant/departments/staff-catalog"),
          { credentials: "include", cache: "no-store" }
        );
        if (staffResponse.ok) {
          const staffData = await staffResponse.json();
          setStaff(staffData.staff || []);
        }
      }
      setMessage("");
    } catch (error) {
      setDepartment(null);
      setMessage(
        error instanceof Error ? error.message : "Department not found."
      );
    } finally {
      setIsLoading(false);
    }
  }, [departmentKey]);

  useEffect(() => {
    setHydrated(true);
    void load();
  }, [load]);

  const canManage = Boolean(
    department?.access?.is_admin || department?.access?.can_manage_team
  );
  const canModules = Boolean(
    department?.access?.is_admin || department?.access?.can_manage_modules
  );
  const can = (permission: string) =>
    Boolean(
      department?.access?.is_admin ||
        department?.permissions?.includes(permission)
    );

  const addMember = async () => {
    if (!department || !memberDraft.staff_id.trim()) return;
    setBusy("member");
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/departments/${department.id}/members`),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            staff_id: memberDraft.staff_id.trim(),
            role: memberDraft.role,
            title: memberDraft.title.trim() || null,
            department_role_id: memberDraft.department_role_id
              ? Number(memberDraft.department_role_id)
              : null,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Member could not be added.");
      }
      setDepartment(data);
      setMemberDraft({
        staff_id: "",
        role: "member",
        title: "",
        department_role_id: "",
      });
      setMessage("Team member added with a scoped role.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Member could not be added."
      );
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
          `/api/v1/restaurant/departments/${department.id}/members/${encodeURIComponent(
            staffId
          )}`
        ),
        { method: "DELETE", credentials: "include" }
      );
      if (!response.ok && response.status !== 204) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || "Member could not be removed.");
      }
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Member could not be removed."
      );
    } finally {
      setBusy("");
    }
  };

  const addModule = async () => {
    if (!department || !moduleToAdd) return;
    setBusy("module");
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/departments/${department.id}`),
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modules: [
              ...department.modules
                .filter((module) => module.status !== "archived")
                .map((module) => module.key),
              moduleToAdd,
            ],
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Module could not be added.");
      }
      setDepartment(data);
      setModuleToAdd("");
      setMessage("Module added to the department.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Module could not be added."
      );
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
      if (!response.ok) {
        throw new Error(data.detail || "Integration could not be saved.");
      }
      setDepartment(data);
      setMessage("Integration settings saved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Integration could not be saved."
      );
    } finally {
      setBusy("");
    }
  };

  const createRole = async () => {
    if (!department || roleDraft.name.trim().length < 2) return;
    setBusy("role");
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/departments/${department.id}/roles`),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: roleDraft.name.trim(),
            level: roleDraft.level,
            permissions: roleDraft.permissions,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Role could not be created.");
      }
      setDepartment(data);
      setShowRoleForm(false);
      setRoleDraft({ name: "", level: "member", permissions: [] });
      setMessage("Scoped role created.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Role could not be created."
      );
    } finally {
      setBusy("");
    }
  };

  const deleteRole = async (roleId: number) => {
    if (!department) return;
    setBusy(`role-${roleId}`);
    try {
      const response = await fetch(
        getApiUrl(
          `/api/v1/restaurant/departments/${department.id}/roles/${roleId}`
        ),
        { method: "DELETE", credentials: "include" }
      );
      if (!response.ok && response.status !== 204) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || "Role could not be deleted.");
      }
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Role could not be deleted."
      );
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
  const availableModules = (department.catalog || []).filter(
    (module: CatalogModule) => !activeModuleKeys.has(module.key)
  );
  const needsYou: {
    kind: "task" | "approval";
    id: number;
    title: string;
    detail: string;
    meta: string;
    tone: string;
  }[] = [
    ...department.work_items.map((item: WorkItem) => ({
      kind: "task" as const,
      id: item.id,
      title: item.title,
      detail: item.description || "No description.",
      meta: `${
        item.owner_display_name || "Unassigned"
      } · due ${formatWorkDate(item.due_at)}`,
      tone:
        PRIORITY_STYLES[item.priority] || PRIORITY_STYLES.normal,
    })),
    ...department.approvals.map((approval: Approval) => ({
      kind: "approval" as const,
      id: approval.id,
      title: approval.title,
      detail: approval.note || `${titleCase(approval.kind)} approval request.`,
      meta: `${approval.requested_by || "system"}${
        approval.amount ? ` · Rs ${Number(approval.amount).toLocaleString()}` : ""
      }`,
      tone: "bg-amber-100 text-amber-800",
    })),
  ];

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
                {titleCase(department.kind)} department · {department.key}
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
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                <span>{department.member_count} people</span>
                <span>·</span>
                <span>{department.module_count} modules</span>
                {department.head_display_name && (
                  <>
                    <span>·</span>
                    <span>Head: {department.head_display_name}</span>
                  </>
                )}
                {department.cost_center && (
                  <>
                    <span>·</span>
                    <span>Cost centre {department.cost_center}</span>
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-full bg-gray-100 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-gray-500">
              {department.status}
            </span>
            {department.parent_name && (
              <Link
                href={`/departments/${department.parent_key}`}
                className="text-[10px] font-black uppercase tracking-widest text-orange-700"
              >
                Part of {department.parent_name}
              </Link>
            )}
          </div>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-900">
          {message}
        </div>
      )}

      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {department.kpis.map((kpi: Kpi) => {
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <p className="text-[10px] font-black uppercase tracking-widest opacity-70">
                  {kpi.label}
                </p>
                {kpi.tone === "alert" && (
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                )}
                {kpi.href && <ArrowUpRight className="h-3.5 w-3.5 opacity-60" />}
              </div>
              <p className="mt-2 text-2xl font-black">{kpi.display}</p>
              <p className="mt-1 line-clamp-2 text-[11px] font-semibold opacity-70">
                {kpi.detail || kpi.cadence || "Live signal"}
              </p>
              {kpi.target && (
                <p className="mt-1 text-[9px] font-black uppercase tracking-widest opacity-50">
                  Target {kpi.target}
                </p>
              )}
            </>
          );
          return kpi.href ? (
            <Link
              key={kpi.key}
              href={kpi.href}
              data-testid={`department-kpi-${kpi.key}`}
              className={`rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-sm ${toneClass(
                kpi.tone
              )}`}
            >
              {body}
            </Link>
          ) : (
            <div
              key={kpi.key}
              data-testid={`department-kpi-${kpi.key}`}
              className={`rounded-2xl border p-4 ${toneClass(kpi.tone)}`}
            >
              {body}
            </div>
          );
        })}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <section className="rounded-2xl border border-gray-100 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
              <ClipboardCheck className="h-4 w-4 text-orange-600" /> Needs you
            </p>
            <span
              className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${
                department.needs_you_count
                  ? "bg-red-100 text-red-800"
                  : "bg-emerald-100 text-emerald-800"
              }`}
            >
              {department.needs_you_count} open
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {needsYou.length ? (
              needsYou.slice(0, 10).map((row) => (
                <Link
                  key={`${row.kind}-${row.id}`}
                  href="/work"
                  data-testid={`department-needs-${row.kind}-${row.id}`}
                  className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 px-3 py-2.5 hover:border-orange-200 hover:bg-orange-50/30"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${row.tone}`}
                      >
                        {row.kind === "task" ? "Task" : "Approval"}
                      </span>
                      <p className="truncate text-sm font-black text-gray-900">
                        {row.title}
                      </p>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-[11px] font-semibold text-gray-500">
                      {row.detail}
                    </p>
                    <p className="mt-0.5 text-[10px] font-bold text-gray-400">
                      {row.meta}
                    </p>
                  </div>
                  <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-gray-300" />
                </Link>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 px-3 py-6 text-center">
                <CheckCircle2 className="mx-auto h-5 w-5 text-emerald-500" />
                <p className="mt-1 text-sm font-black text-gray-700">
                  Queue is clear
                </p>
                <p className="text-[11px] font-semibold text-gray-400">
                  Tasks and approvals assigned to this department appear here.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-5">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
            <ShieldCheck className="h-4 w-4 text-orange-600" /> Quick actions
          </p>
          <div className="mt-3 space-y-2">
            {department.quick_actions
              .filter((action) => can(action.permission))
              .map((action) =>
                action.key === "create-task" || action.key === "request-approval" ? (
                  <Link
                    key={action.key}
                    href={`/work?department=${department.key}&new=${
                      action.key === "create-task" ? "task" : "approval"
                    }`}
                    data-testid={`department-action-${action.key}`}
                    className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 px-3 py-2.5 hover:border-orange-200 hover:bg-orange-50/30"
                  >
                    <div>
                      <p className="text-sm font-black text-gray-900">
                        {action.label}
                      </p>
                      <p className="text-[10px] font-semibold text-gray-400">
                        {action.description}
                      </p>
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-gray-300" />
                  </Link>
                ) : (
                  <button
                    key={action.key}
                    type="button"
                    data-testid={`department-action-${action.key}`}
                    onClick={() =>
                      document
                        .getElementById(
                          action.key === "invite-member" ? "department-team" : "department-modules"
                        )
                        ?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                    className="flex w-full items-center justify-between gap-2 rounded-xl border border-gray-100 px-3 py-2.5 text-left hover:border-orange-200 hover:bg-orange-50/30"
                  >
                    <div>
                      <p className="text-sm font-black text-gray-900">
                        {action.label}
                      </p>
                      <p className="text-[10px] font-semibold text-gray-400">
                        {action.description}
                      </p>
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-gray-300" />
                  </button>
                )
              )}
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section
          id="department-modules"
          className="rounded-2xl border border-gray-100 bg-white p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
              <Settings2 className="h-4 w-4 text-orange-600" /> Modules
            </p>
            {canModules && availableModules.length > 0 && (
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
              const Icon = portalIcon(module.icon);
              const open =
                module.status === "active" && Boolean(module.route) && module.can_view;
              const card = (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
                      <p className="text-sm font-black text-gray-900">
                        {module.label}
                      </p>
                    </div>
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
                  {!module.can_view && (
                    <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-amber-700">
                      No access for this account
                    </p>
                  )}
                  {open && (
                    <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-black text-orange-700">
                      Open <ArrowUpRight className="h-3 w-3" />
                    </span>
                  )}
                </>
              );
              return open ? (
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

        <section
          id="department-team"
          className="rounded-2xl border border-gray-100 bg-white p-5"
        >
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
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-gray-900">
                      {member.display_name}
                    </p>
                    <p className="truncate text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      {member.staff_id} · {member.role}
                      {member.department_role_name
                        ? ` · ${member.department_role_name}`
                        : ""}
                    </p>
                    {member.title && (
                      <p className="truncate text-[10px] font-semibold text-gray-500">
                        {member.title}
                      </p>
                    )}
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      aria-label={`Remove ${member.display_name}`}
                      onClick={() => void removeMember(member.staff_id)}
                      disabled={busy === `remove-${member.staff_id}`}
                      className="text-gray-300 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))
            ) : (
              <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-xs font-semibold text-gray-400">
                No one assigned yet.
              </p>
            )}
          </div>

          {canManage && (
            <div className="mt-4 space-y-2 border-t border-gray-100 pt-3">
              {staff.length ? (
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
              ) : (
                <input
                  aria-label="Staff member"
                  value={memberDraft.staff_id}
                  onChange={(event) =>
                    setMemberDraft({ ...memberDraft, staff_id: event.target.value })
                  }
                  placeholder="Staff ID"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700"
                />
              )}
              <input
                aria-label="Member title"
                value={memberDraft.title}
                onChange={(event) =>
                  setMemberDraft({ ...memberDraft, title: event.target.value })
                }
                placeholder="Title (optional)"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700"
              />
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
                <select
                  aria-label="Scoped role"
                  value={memberDraft.department_role_id}
                  onChange={(event) =>
                    setMemberDraft({
                      ...memberDraft,
                      department_role_id: event.target.value,
                    })
                  }
                  className="flex-1 rounded-lg border border-gray-200 px-2 py-2 text-xs font-bold text-gray-700"
                >
                  <option value="">Default role</option>
                  {department.roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void addMember()}
                  disabled={!memberDraft.staff_id.trim() || busy === "member"}
                  className="inline-flex items-center gap-1 rounded-lg bg-gray-950 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-gray-100 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
            <ShieldCheck className="h-4 w-4 text-orange-600" /> Scoped roles
          </p>
          {canManage && (
            <button
              type="button"
              onClick={() => setShowRoleForm((value) => !value)}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-gray-600"
            >
              {showRoleForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {showRoleForm ? "Cancel" : "New role"}
            </button>
          )}
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {department.roles.map((role) => {
            const assigned = department.members.some(
              (member) => member.department_role_id === role.id
            );
            return (
              <div
                key={role.id}
                data-testid={`department-role-${role.key}`}
                className="rounded-xl border border-gray-100 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-gray-900">{role.name}</p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      {role.level} · {role.permissions.length} permissions
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {role.is_default && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-gray-500">
                        default
                      </span>
                    )}
                    {canManage && !role.is_default && !assigned && (
                      <button
                        type="button"
                        aria-label={`Delete ${role.name}`}
                        onClick={() => void deleteRole(role.id)}
                        disabled={busy === `role-${role.id}`}
                        className="text-gray-300 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] font-semibold text-gray-500">
                  {role.description || "No description."}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {role.permissions.slice(0, 4).map((permission) => (
                    <span
                      key={permission}
                      className="rounded-full bg-gray-50 px-2 py-0.5 font-mono text-[9px] font-bold text-gray-500"
                    >
                      {permission}
                    </span>
                  ))}
                  {role.permissions.length > 4 && (
                    <span className="text-[9px] font-bold text-gray-400">
                      +{role.permissions.length - 4}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {showRoleForm && (
          <div className="mt-3 rounded-xl border border-orange-100 bg-orange-50/40 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Role name
                <input
                  value={roleDraft.name}
                  onChange={(event) =>
                    setRoleDraft({ ...roleDraft, name: event.target.value })
                  }
                  placeholder="Shift supervisor"
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                />
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                Level
                <select
                  value={roleDraft.level}
                  onChange={(event) =>
                    setRoleDraft({ ...roleDraft, level: event.target.value })
                  }
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900"
                >
                  <option value="member">Member</option>
                  <option value="manager">Manager</option>
                  <option value="head">Head</option>
                </select>
              </label>
            </div>
            <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
              Permissions
            </p>
            <div className="mt-1 grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {department.permission_keys.map((permission) => (
                <label
                  key={permission}
                  className="flex items-start gap-2 rounded px-1.5 py-1 font-mono text-[10px] font-bold text-gray-600 hover:bg-white"
                >
                  <input
                    type="checkbox"
                    checked={roleDraft.permissions.includes(permission)}
                    onChange={() =>
                      setRoleDraft({
                        ...roleDraft,
                        permissions: roleDraft.permissions.includes(permission)
                          ? roleDraft.permissions.filter(
                              (entry) => entry !== permission
                            )
                          : [...roleDraft.permissions, permission],
                      })
                    }
                    className="mt-0.5"
                  />
                  {permission}
                </label>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => void createRole()}
                disabled={roleDraft.name.trim().length < 2 || busy === "role"}
                className="rounded-lg bg-gray-950 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
              >
                Create role
              </button>
            </div>
          </div>
        )}
      </section>

      {department.children.length > 0 && (
        <section className="rounded-2xl border border-gray-100 bg-white p-5">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
            <Building2 className="h-4 w-4 text-orange-600" /> Sub-departments
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {department.children.map((child) => (
              <Link
                key={child.key}
                href={`/departments/${child.key}`}
                className="rounded-xl border border-gray-100 px-3 py-2.5 hover:border-orange-200 hover:bg-orange-50/30"
              >
                <p className="text-sm font-black text-gray-900">{child.name}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  {titleCase(child.kind)} · {child.module_count} modules
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {department.external_system && (
        <section
          data-testid="department-external-system"
          className="rounded-2xl border border-teal-100 bg-teal-50/60 p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-teal-700">
                <ShieldCheck className="h-4 w-4" /> External system
              </p>
              <h2 className="mt-1 text-lg font-black text-teal-950">
                {department.external_system}
              </h2>
              <p className="mt-1 max-w-xl text-xs font-semibold leading-5 text-teal-900">
                This department runs inside Pizza Blitz while the specialist
                system stays authoritative. The connection is a pilot until
                credentials, data mapping and reconciliation are signed off.
              </p>
            </div>
            <span className="rounded-full bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-teal-800">
              {INTEGRATION_LABELS[department.integration_status] ||
                department.integration_status}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-[10px] font-black uppercase tracking-widest text-teal-700">
              External portal URL
              <input
                value={externalDraft.url}
                onChange={(event) =>
                  setExternalDraft({ ...externalDraft, url: event.target.value })
                }
                disabled={!department.access.is_admin}
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
                disabled={!department.access.is_admin}
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
              disabled={busy === "integration" || !department.access.is_admin}
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
                Open portal <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          <p className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-teal-800">
            <CheckCircle2 className="h-3.5 w-3.5" /> No fake connection: planned
            modules stay disabled until the integration is live.
          </p>
        </section>
      )}
    </div>
  );
}
