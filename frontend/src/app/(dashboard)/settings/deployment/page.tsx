"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

type Check = {
  key: string;
  label: string;
  status: "ready" | "warn" | "blocked";
  detail: string;
  action?: string;
};

type Checklist = {
  environment: string;
  database: string;
  public_url: string;
  checks: Check[];
  summary: {
    ready: number;
    warnings: number;
    blocked: number;
    status: string;
    total: number;
  };
  verification_commands: string[];
};

const STATUS_META = {
  ready: {
    label: "Ready",
    className: "bg-emerald-100 text-emerald-800",
    icon: CheckCircle2,
  },
  warn: {
    label: "Attention",
    className: "bg-amber-100 text-amber-800",
    icon: AlertTriangle,
  },
  blocked: {
    label: "Blocked",
    className: "bg-red-100 text-red-800",
    icon: XCircle,
  },
};

export default function DeploymentPage() {
  const [data, setData] = useState<Checklist | null>(null);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    void (async () => {
      try {
        const response = await fetch(
          getApiUrl("/api/v1/restaurant/ops/deployment-checklist"),
          { credentials: "include", cache: "no-store" }
        );
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || "Checklist failed.");
        setData(payload);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Checklist failed.");
      }
    })();
  }, []);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      setMessage("Clipboard is unavailable in this browser.");
    }
  };

  return (
    <div
      data-testid="deployment-page"
      data-hydrated={hydrated ? "true" : "false"}
      className="mx-auto max-w-5xl space-y-6 animate-in fade-in duration-300"
    >
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-xs font-black uppercase tracking-widest text-gray-400 hover:text-orange-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to settings
        </Link>
        <h1 className="mt-2 flex items-center gap-3 text-3xl font-black text-gray-950">
          <ClipboardCheck className="h-7 w-7 text-orange-600" /> Deployment readiness
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          The exact gates to clear before routing production traffic.
        </p>
      </div>

      {message && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {message}
        </div>
      )}

      {!data ? (
        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white p-6 text-sm font-bold text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Checking deployment gates...
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-gray-100 bg-white p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Environment
              </p>
              <p className="mt-1 text-2xl font-black capitalize text-gray-950">
                {data.environment}
              </p>
              <p className="mt-1 text-[11px] font-semibold text-gray-500">
                {data.database}
              </p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Ready
              </p>
              <p className="mt-1 text-2xl font-black text-emerald-700">
                {data.summary.ready}/{data.summary.total}
              </p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Attention
              </p>
              <p className="mt-1 text-2xl font-black text-amber-700">
                {data.summary.warnings}
              </p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Blocked
              </p>
              <p className="mt-1 text-2xl font-black text-red-700">
                {data.summary.blocked}
              </p>
            </div>
          </section>

          <section
            data-testid="deployment-checks"
            className="overflow-hidden rounded-2xl border border-gray-100 bg-white"
          >
            {data.checks.map((check) => {
              const meta = STATUS_META[check.status];
              const Icon = meta.icon;
              return (
                <div
                  key={check.key}
                  data-testid={`deployment-check-${check.key}`}
                  className="flex flex-col gap-2 border-b border-gray-100 px-4 py-3 last:border-0 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest ${meta.className}`}>
                      <Icon className="mr-1 inline h-3 w-3" />
                      {meta.label}
                    </span>
                    <div>
                      <p className="text-sm font-black text-gray-900">{check.label}</p>
                      <p className="text-[11px] font-semibold text-gray-500">
                        {check.detail}
                      </p>
                      {check.action && (
                        <p className="mt-1 text-[11px] font-bold text-orange-700">
                          {check.action}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-gray-300">
                    {check.key}
                  </span>
                </div>
              );
            })}
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-5">
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
              <ShieldCheck className="h-4 w-4 text-orange-600" /> Verification commands
            </p>
            <div className="mt-3 space-y-2">
              {data.verification_commands.map((command) => (
                <div
                  key={command}
                  className="flex items-center gap-2 rounded-lg bg-gray-950 px-3 py-2"
                >
                  <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[11px] font-bold text-gray-200">
                    {command}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copy(command)}
                    aria-label={`Copy command ${command}`}
                    className="text-gray-400 hover:text-white"
                  >
                    {copied === command ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
