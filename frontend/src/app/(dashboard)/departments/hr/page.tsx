"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  FileWarning,
  Loader2,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type Module = {
  key: string;
  label: string;
  route?: string | null;
  status: string;
};

type Department = {
  id: number;
  key: string;
  name: string;
  description?: string | null;
  color: string;
  status: string;
  external_system?: string | null;
  external_url?: string | null;
  integration_status: string;
  modules: Module[];
  members: { staff_id: string; display_name: string; role: string }[];
};

type Overview = {
  as_of: string;
  workforce: {
    headcount: number;
    active: number;
    onboarding: number;
    notice: number;
    exited: number;
    new_joiners_this_month: number;
    by_employment_type: Record<string, number>;
    by_store: Record<string, number>;
  };
  leave: {
    pending_requests: number;
    approved_days_this_year: number;
    on_leave_today: number;
    earned_leave_liability: number;
  };
  attendance: {
    total: number;
    present: number;
    on_leave: number;
    absent: number;
    not_marked: number;
    attendance_rate: number;
  };
  payroll: {
    latest_run: {
      month: number;
      year: number;
      net_total: number;
      employee_count: number;
    } | null;
    ytd_net: number;
    trend: { label: string; net: number }[];
  };
  onboarding: {
    active_candidates: number;
    joined_total: number;
    conversion_rate: number;
  };
  exits: {
    on_notice: number;
    in_clearance: number;
    settled_this_year: number;
    attrition_rate: number;
  };
  documents: { total: number; expiring_30_days: number; letters_issued: number };
};

const money = (value: number) =>
  `Rs ${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const MODULE_PERMISSIONS: Record<string, string> = {
  overview: "hr.view",
  people: "hr.people",
  leave: "hr.leave",
  attendance: "hr.attendance",
  payroll: "hr.payroll",
  recruitment: "hr.recruitment",
  onboarding: "hr.onboarding",
  documents: "hr.documents",
  exits: "hr.exits",
};

export default function HRDepartmentPage() {
  const [department, setDepartment] = useState<Department | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [access, setAccess] = useState<{
    is_admin: boolean;
    is_hr_member: boolean;
    permissions: Record<string, boolean>;
  } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setHydrated(true);
    void (async () => {
      try {
        const [departmentResponse, overviewResponse, accessResponse] =
          await Promise.all([
            fetch(getApiUrl("/api/v1/restaurant/departments/hr"), {
              credentials: "include",
              cache: "no-store",
            }),
            fetch(getApiUrl("/api/v1/restaurant/hr/overview"), {
              credentials: "include",
              cache: "no-store",
            }),
            fetch(getApiUrl("/api/v1/restaurant/hr/access"), {
              credentials: "include",
              cache: "no-store",
            }),
          ]);
        const departmentData = await departmentResponse.json();
        if (!departmentResponse.ok) {
          throw new Error(departmentData.detail || "HR department is unavailable.");
        }
        setDepartment(departmentData);
        if (overviewResponse.ok) setOverview(await overviewResponse.json());
        if (accessResponse.ok) setAccess(await accessResponse.json());
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "HR department is unavailable.");
      }
    })();
  }, []);

  if (message) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-sm font-bold text-red-800">
        {message}
      </div>
    );
  }

  if (!department || !overview) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white p-6 text-sm font-bold text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading HR command center...
      </div>
    );
  }

  const canAdmin = access?.is_admin ?? true;
  const allowed = (key: string) => {
    if (canAdmin) return true;
    const permission = MODULE_PERMISSIONS[key];
    return permission ? Boolean(access?.permissions?.[permission]) : true;
  };

  const cards = [
    {
      label: "Headcount",
      value: overview.workforce.headcount,
      detail: `${overview.workforce.new_joiners_this_month} joined this month`,
      icon: Users,
      tone: "text-gray-950",
    },
    {
      label: "Present today",
      value: overview.attendance.present,
      detail: `${overview.attendance.attendance_rate}% attendance`,
      icon: Clock3,
      tone: "text-emerald-700",
    },
    {
      label: "On leave today",
      value: overview.leave.on_leave_today,
      detail: `${overview.leave.pending_requests} pending requests`,
      icon: CalendarDays,
      tone: "text-sky-700",
    },
    {
      label: "Latest payroll",
      value: overview.payroll.latest_run
        ? money(overview.payroll.latest_run.net_total)
        : "Not run",
      detail: overview.payroll.latest_run
        ? `${overview.payroll.latest_run.month}/${overview.payroll.latest_run.year} · ${overview.payroll.latest_run.employee_count} employees`
        : "Generate the first pay run",
      icon: CircleDollarSign,
      tone: "text-teal-700",
    },
    {
      label: "Onboarding",
      value: overview.onboarding.active_candidates,
      detail: `${overview.onboarding.conversion_rate}% conversion`,
      icon: UserPlus,
      tone: "text-amber-700",
    },
    {
      label: "Attrition (12m)",
      value: `${overview.exits.attrition_rate}%`,
      detail: `${overview.exits.on_notice} on notice · ${overview.exits.in_clearance} in clearance`,
      icon: BriefcaseBusiness,
      tone: "text-red-700",
    },
    {
      label: "Leave liability",
      value: money(overview.leave.earned_leave_liability),
      detail: `${overview.leave.approved_days_this_year} approved days this year`,
      icon: CalendarDays,
      tone: "text-gray-950",
    },
    {
      label: "Documents",
      value: overview.documents.total,
      detail: `${overview.documents.expiring_30_days} expiring soon`,
      icon: FileWarning,
      tone: "text-orange-700",
    },
  ];

  const maxTrend = Math.max(1, ...overview.payroll.trend.map((row) => row.net));

  return (
    <div
      data-testid="department-detail"
      data-hydrated={hydrated ? "true" : "false"}
      className="space-y-6 animate-in fade-in duration-300"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span
            className="grid h-12 w-12 place-items-center rounded-xl text-white"
            style={{ backgroundColor: department.color }}
          >
            <ShieldCheck className="h-6 w-6" />
          </span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-teal-700">
              Department · HR command center
            </p>
            <h1
              data-testid="department-name-heading"
              className="text-3xl font-black text-gray-950"
            >
              {department.name}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              {department.description || "People, payroll and compliance at a glance."}
            </p>
          </div>
        </div>
        <div className="text-right">
          <span className="rounded-full bg-teal-100 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-teal-800">
            {department.status}
          </span>
          <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">
            As of {overview.as_of}
          </p>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              data-testid={`hr-metric-${card.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              className="rounded-xl border border-gray-100 bg-white p-4"
            >
              <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400">
                <Icon className="h-3.5 w-3.5" /> {card.label}
              </p>
              <p className={`mt-1 text-2xl font-black ${card.tone}`}>{card.value}</p>
              <p className="mt-1 text-[10px] font-semibold text-gray-500">{card.detail}</p>
            </div>
          );
        })}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-gray-100 bg-white p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
            Workforce mix
          </p>
          <div className="mt-3 space-y-2">
            {Object.entries(overview.workforce.by_employment_type).map(([type, count]) => (
              <div key={type} className="flex items-center justify-between text-sm">
                <span className="font-semibold capitalize text-gray-600">
                  {type.replace("_", " ")}
                </span>
                <span className="font-black text-gray-900">{count}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-gray-100 pt-3">
            {Object.entries(overview.workforce.by_store).map(([store, count]) => (
              <div key={store} className="flex items-center justify-between py-1 text-xs">
                <span className="font-semibold text-gray-500">{store}</span>
                <span className="font-bold text-gray-700">{count}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
            Payroll trend
          </p>
          {overview.payroll.trend.length === 0 ? (
            <p className="mt-4 text-sm font-semibold text-gray-400">
              No finalized pay runs yet.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {overview.payroll.trend.map((row) => (
                <div key={row.label} className="flex items-center gap-2">
                  <span className="w-12 text-[10px] font-bold text-gray-500">
                    {row.label}
                  </span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-teal-600"
                      style={{ width: `${Math.max(2, (row.net / maxTrend) * 100)}%` }}
                    />
                  </div>
                  <span className="w-20 text-right text-[10px] font-bold text-gray-600">
                    {money(row.net)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-4 text-[10px] font-semibold text-gray-400">
            YTD net payroll: <span className="font-black text-gray-700">{money(overview.payroll.ytd_net)}</span>
          </p>
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
            Time & compliance
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {[
              ["Present", overview.attendance.present],
              ["Remote", 0],
              ["On leave", overview.attendance.on_leave],
              ["Absent", overview.attendance.absent],
              ["Not marked", overview.attendance.not_marked],
              ["Letters", overview.documents.letters_issued],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg bg-gray-50 px-3 py-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                  {label}
                </p>
                <p className="font-black text-gray-900">{value}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] font-semibold text-gray-400">
            {overview.exits.settled_this_year} exits settled this year ·{" "}
            {overview.onboarding.joined_total} onboarding conversions
          </p>
        </section>
      </div>

      <section className="rounded-2xl border border-gray-100 bg-white p-5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
            HR modules
          </p>
          {department.members.length > 0 && (
            <p className="text-[10px] font-semibold text-gray-400">
              Team: {department.members.map((member) => member.display_name).join(", ")}
            </p>
          )}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {department.modules.map((module) => {
            const permitted = allowed(module.key);
            const active = module.status === "active" && module.route && permitted;
            const card = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-black text-gray-900">{module.label}</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                      !permitted
                        ? "bg-amber-100 text-amber-800"
                        : module.status === "active"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {permitted ? module.status : "no access"}
                  </span>
                </div>
                <p className="mt-1 text-[10px] font-semibold text-gray-400">
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
                HR runs as a department here. The external HRMS remains available for the
                pilot; no data is synced until its connection is live.
              </p>
            </div>
            <span className="rounded-full bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-teal-800">
              {department.integration_status}
            </span>
          </div>
          {department.external_url && (
            <a
              href={department.external_url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-teal-800"
            >
              Open HR portal <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          )}
        </section>
      )}
    </div>
  );
}
