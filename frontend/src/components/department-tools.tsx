"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

export const inputClass =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 outline-none focus:border-gray-400";
export const labelClass =
  "text-[10px] font-black uppercase tracking-widest text-gray-400";
export const primaryButtonClass =
  "rounded-lg bg-gray-950 px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-gray-800 disabled:opacity-50";
export const secondaryButtonClass =
  "rounded-lg border border-gray-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-600 hover:border-gray-300 disabled:opacity-50";

export function DepartmentToolShell({
  departmentKey,
  departmentLabel,
  title,
  subtitle,
  children,
}: {
  departmentKey: string;
  departmentLabel: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12">
      <div>
        <Link
          href={`/departments/${departmentKey}`}
          className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {departmentLabel}
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-gray-950">
              {title}
            </h1>
            <p className="mt-1 max-w-2xl text-sm font-semibold text-gray-500">
              {subtitle}
            </p>
          </div>
          <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
            {departmentLabel}
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}

const TONES: Record<string, string> = {
  neutral: "text-gray-700",
  good: "text-emerald-600",
  warn: "text-amber-600",
  bad: "text-red-600",
  info: "text-blue-600",
};

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: keyof typeof TONES;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <p className={labelClass}>{label}</p>
      <p className={`mt-1 text-2xl font-black ${TONES[tone] || TONES.neutral}`}>
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[10px] font-semibold text-gray-400">{hint}</p>
      ) : null}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-gray-950">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-[11px] font-semibold text-gray-400">
              {description}
            </p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center">
      <p className="text-sm font-black text-gray-500">{title}</p>
      <p className="mt-1 text-xs font-semibold text-gray-400">{body}</p>
    </div>
  );
}

const STATUS_TONES: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-100",
  valid: "bg-emerald-50 text-emerald-700 border-emerald-100",
  ok: "bg-emerald-50 text-emerald-700 border-emerald-100",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-100",
  done: "bg-emerald-50 text-emerald-700 border-emerald-100",
  operational: "bg-emerald-50 text-emerald-700 border-emerald-100",
  passed: "bg-emerald-50 text-emerald-700 border-emerald-100",
  on_track: "bg-emerald-50 text-emerald-700 border-emerald-100",
  warning: "bg-amber-50 text-amber-700 border-amber-100",
  due_soon: "bg-amber-50 text-amber-700 border-amber-100",
  at_risk: "bg-amber-50 text-amber-700 border-amber-100",
  in_progress: "bg-blue-50 text-blue-700 border-blue-100",
  scheduled: "bg-blue-50 text-blue-700 border-blue-100",
  open: "bg-amber-50 text-amber-700 border-amber-100",
  pending: "bg-amber-50 text-amber-700 border-amber-100",
  breach: "bg-red-50 text-red-700 border-red-100",
  expired: "bg-red-50 text-red-700 border-red-100",
  missing: "bg-red-50 text-red-700 border-red-100",
  off_track: "bg-red-50 text-red-700 border-red-100",
  cancelled: "bg-gray-100 text-gray-500 border-gray-200",
  void: "bg-gray-100 text-gray-500 border-gray-200",
  inactive: "bg-gray-100 text-gray-500 border-gray-200",
};

export function StatusBadge({ label }: { label: string }) {
  const key = label.toLowerCase().replace(/\s+/g, "_");
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${
        STATUS_TONES[key] || "bg-gray-50 text-gray-600 border-gray-200"
      }`}
    >
      {label.replace(/_/g, " ")}
    </span>
  );
}

export function LoadingRow({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm font-bold text-gray-400">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {message}
    </div>
  );
}

export function formatMoney(value: number | string | null | undefined) {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: amount % 1 ? 2 : 0,
  })}`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
