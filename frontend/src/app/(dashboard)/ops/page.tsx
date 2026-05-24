"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Database,
  HardDrive,
  KeyRound,
  Link as LinkIcon,
  ListChecks,
  RefreshCw,
  Rocket,
  ShieldCheck,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const OPS_API = getApiUrl("/api/v1/restaurant/ops");
const fetchWithAuth = (url: string, init?: RequestInit) => fetch(url, { ...init, credentials: "include" });

type CheckStatus = "pass" | "warn" | "fail";

type ReadinessCheck = {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
};

type GoLiveItem = {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  missing_settings: string[];
};

type GoLiveSection = {
  key: string;
  title: string;
  description: string;
  items: GoLiveItem[];
};

type ModuleMetric = {
  label: string;
  value: string;
};

type ProductionDatabaseStep = {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
};

type ProductionDatabasePlan = {
  decision: string;
  status: CheckStatus;
  current_backend: string;
  current_path?: string | null;
  target_backend: string;
  target_driver: string;
  readiness_metrics: ModuleMetric[];
  migration_steps: ProductionDatabaseStep[];
  backup_restore_drill: ProductionDatabaseStep[];
  blockers: string[];
};

type LaunchModule = {
  key: string;
  title: string;
  status: CheckStatus;
  score: number;
  route: string;
  detail: string;
  metrics: ModuleMetric[];
  next_actions: string[];
};

type LaunchSummary = {
  modules_total: number;
  modules_ready: number;
  modules_attention: number;
  modules_blocked: number;
  implementation_score: number;
  next_actions: string[];
};

type EnvironmentVariable = {
  name: string;
  required: boolean;
  sensitive: boolean;
  configured: boolean;
  purpose: string;
  value?: string | null;
};

type EnvironmentGroup = {
  key: string;
  title: string;
  variables: EnvironmentVariable[];
};

type EnvironmentSummary = {
  total: number;
  configured: number;
  required_total: number;
  required_configured: number;
  missing_required: string[];
};

type Readiness = {
  environment: string;
  database_backend: string;
  database_path?: string | null;
  backup_dir: string;
  backup_retention_days: number;
  backup_freshness?: {
    status: CheckStatus;
    latest_backup_at?: string | null;
    detail: string;
  };
  payment?: PaymentStatus;
  readiness_score: number;
  production_database_plan?: ProductionDatabasePlan;
  launch_blockers: GoLiveItem[];
  setup_actions: GoLiveItem[];
  go_live_sections: GoLiveSection[];
  launch_summary?: LaunchSummary;
  module_readiness?: LaunchModule[];
  overall: "ready" | "attention" | "blocked";
  failed_checks: number;
  warning_checks: number;
  checks: ReadinessCheck[];
  environment_manifest?: EnvironmentGroup[];
  environment_summary?: EnvironmentSummary;
};

type PaymentStatus = {
  provider: string;
  currency: string;
  return_url: string;
  checkout_configured: boolean;
  webhook_configured: boolean;
  missing_checkout_settings: string[];
  missing_webhook_settings: string[];
  session_endpoint: string;
  webhook_endpoint: string;
  mode: string;
};

type BackupRun = {
  id: number;
  backup_type: string;
  status: string;
  file_path?: string | null;
  size_bytes: number;
  database_backend?: string | null;
  error?: string | null;
  created_at?: string | null;
};

export default function ProductionOpsPage() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [backups, setBackups] = useState<BackupRun[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);

  const latestBackup = useMemo(() => backups[0] || null, [backups]);

  useEffect(() => {
    fetchOps();
  }, []);

  const fetchOps = async () => {
    setLoading(true);
    const [readinessResponse, backupResponse] = await Promise.all([
      fetchWithAuth(`${OPS_API}/readiness`),
      fetchWithAuth(`${OPS_API}/backups`),
    ]);
    if (readinessResponse.ok) {
      setReadiness(await readinessResponse.json());
    }
    if (backupResponse.ok) {
      const data = await backupResponse.json();
      setBackups(data.backups || []);
    }
    setLoading(false);
  };

  const createBackup = async () => {
    setCreatingBackup(true);
    const response = await fetchWithAuth(`${OPS_API}/backups/create`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.detail || "Backup could not be created.");
      setCreatingBackup(false);
      return;
    }
    const backup: BackupRun = data.backup;
    setMessage(
      backup.status === "success"
        ? `Backup created: ${formatBytes(backup.size_bytes)}`
        : backup.error || `Backup status: ${backup.status}`
    );
    await fetchOps();
    setCreatingBackup(false);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0b] p-8 text-white">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-orange-400 underline decoration-orange-500/20 underline-offset-8">
            Production Ops
          </h1>
          <p className="mt-3 text-sm text-gray-500">
            Database, backups, deployment readiness, and environment security.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={fetchOps}
            className="flex items-center gap-2 rounded-xl bg-white/5 px-4 py-3 font-bold text-white hover:bg-white/10"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button
            onClick={createBackup}
            disabled={creatingBackup}
            className="flex items-center gap-2 rounded-xl bg-white px-5 py-3 font-bold text-black hover:bg-orange-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <HardDrive className="h-4 w-4" /> Create Backup
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-6 rounded-xl border border-orange-500/20 bg-orange-500/10 px-5 py-3 text-sm text-orange-100">
          {message}
        </div>
      )}

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
        <Metric
          label="Go-Live Score"
          value={readiness ? `${readiness.readiness_score}%` : "checking"}
          icon={ShieldCheck}
        />
        <Metric
          label="Readiness"
          value={readiness?.overall || "checking"}
          icon={readiness?.overall === "blocked" ? AlertTriangle : ShieldCheck}
        />
        <Metric label="Database" value={readiness?.database_backend || "checking"} icon={Database} />
        <Metric
          label="Env Required"
          value={
            readiness?.environment_summary
              ? `${readiness.environment_summary.required_configured}/${readiness.environment_summary.required_total}`
              : "checking"
          }
          icon={KeyRound}
        />
        <Metric
          label="Payments"
          value={readiness?.payment?.provider || "checking"}
          icon={CreditCard}
        />
        <Metric
          label="Latest Backup"
          value={latestBackup ? latestBackup.status : "none"}
          icon={HardDrive}
        />
      </div>

      {readiness?.production_database_plan ? (
        <ProductionDatabaseCommand plan={readiness.production_database_plan} />
      ) : null}

      {readiness?.module_readiness?.length ? (
        <section className="mb-8 rounded-xl border border-white/5 bg-[#111113] p-6">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-400">Launch Control Matrix</p>
              <h2 className="mt-2 text-2xl font-black">Module Maturity Across the Restaurant Portal</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
                One owner-facing view of what is built, what has real data, and which operational setup actions remain.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <SummaryPill label="Score" value={`${readiness.launch_summary?.implementation_score || 0}%`} />
              <SummaryPill label="Ready" value={`${readiness.launch_summary?.modules_ready || 0}`} />
              <SummaryPill label="Attention" value={`${readiness.launch_summary?.modules_attention || 0}`} />
            </div>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-4">
            {readiness.module_readiness.map((module) => (
              <LaunchModuleCard key={module.key} module={module} />
            ))}
          </div>

          <div className="rounded-xl border border-orange-500/20 bg-orange-500/10 p-5">
            <div className="mb-3 flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-orange-300" />
              <h3 className="font-black text-orange-100">Next Launch Actions</h3>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {(readiness.launch_summary?.next_actions || []).map((action) => (
                <p key={action} className="rounded-lg bg-black/25 px-3 py-2 text-sm font-bold text-orange-50">
                  {action}
                </p>
              ))}
              {!readiness.launch_summary?.next_actions?.length && (
                <p className="rounded-lg bg-black/25 px-3 py-2 text-sm font-bold text-orange-50">
                  Keep running weekly proof checks and backup reviews.
                </p>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {readiness && (
        <section className="mb-8 space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black">Production Go-Live Checklist</h2>
              <p className="mt-2 text-sm text-gray-500">
                Launch blockers, missing environment variables, and deployment readiness sections.
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-[#1a1a1c] px-5 py-4 text-right">
              <p className="text-xs font-black uppercase tracking-widest text-gray-500">Current Score</p>
              <p className="mt-1 text-3xl font-black text-orange-400">{readiness.readiness_score}%</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-5">
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-300" />
                <h3 className="font-black">Launch Blockers</h3>
              </div>
              <p className="text-3xl font-black text-red-200">{readiness.launch_blockers.length}</p>
              <p className="mt-2 text-sm leading-6 text-red-100/80">
                {readiness.launch_blockers[0]?.detail || "No hard blockers in the current environment."}
              </p>
            </div>

            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-5">
              <div className="mb-3 flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-yellow-300" />
                <h3 className="font-black">Setup Actions</h3>
              </div>
              <p className="text-3xl font-black text-yellow-100">{readiness.setup_actions.length}</p>
              <p className="mt-2 text-sm leading-6 text-yellow-100/80">
                {readiness.setup_actions[0]?.label || "No setup actions are pending."}
              </p>
            </div>

            <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-5">
              <div className="mb-3 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-300" />
                <h3 className="font-black">Backup Freshness</h3>
              </div>
              <p className="text-lg font-black capitalize text-green-100">
                {readiness.backup_freshness?.status || "checking"}
              </p>
              <p className="mt-2 text-sm leading-6 text-green-100/80">
                {readiness.backup_freshness?.detail || "Backup freshness is loading."}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {readiness.go_live_sections.map((section) => (
              <div key={section.key} className="rounded-xl border border-white/5 bg-[#1a1a1c] p-5">
                <div className="mb-4">
                  <h3 className="font-black">{section.title}</h3>
                  <p className="mt-1 text-sm text-gray-500">{section.description}</p>
                </div>
                <div className="space-y-3">
                  {section.items.map((item) => (
                    <div key={item.key} className="rounded-xl border border-white/5 bg-black/25 p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <p className="font-black">{item.label}</p>
                        <StatusBadge status={item.status} />
                      </div>
                      <p className="text-sm leading-6 text-gray-400">{item.detail}</p>
                      {item.missing_settings.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.missing_settings.slice(0, 5).map((setting) => (
                            <span
                              key={`${item.key}-${setting}`}
                              className="rounded-md bg-white/5 px-2 py-1 text-xs font-bold text-gray-300"
                            >
                              {setting}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {readiness.environment_manifest?.length ? (
            <div className="rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="text-xl font-black">Environment Inventory</h2>
                  <p className="mt-2 text-sm text-gray-500">
                    Required variables, secret storage status, and launch configuration without exposing secret values.
                  </p>
                </div>
                <span className="rounded-full bg-black/30 px-3 py-1 text-xs font-black uppercase text-gray-400">
                  {readiness.environment_summary?.configured || 0}/{readiness.environment_summary?.total || 0} configured
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {readiness.environment_manifest.map((group) => (
                  <div key={group.key} className="rounded-xl border border-white/5 bg-black/25 p-4">
                    <h3 className="mb-4 font-black">{group.title}</h3>
                    <div className="space-y-2">
                      {group.variables.map((variable) => (
                        <div
                          key={`${group.key}-${variable.name}`}
                          className="grid grid-cols-1 gap-3 rounded-lg border border-white/5 bg-black/25 p-3 text-sm md:grid-cols-12"
                        >
                          <div className="md:col-span-4">
                            <p className="font-black text-white">{variable.name}</p>
                            <p className="mt-1 text-xs text-gray-500">{variable.required ? "Required" : "Optional"}</p>
                          </div>
                          <div className="md:col-span-2">
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-black uppercase ${
                                statusClass(variable.configured ? "pass" : variable.required ? "fail" : "warn")
                              }`}
                            >
                              {variable.configured ? "set" : "missing"}
                            </span>
                          </div>
                          <div className="text-gray-400 md:col-span-6">
                            <p>{variable.sensitive ? "Secret value hidden" : variable.value || variable.purpose}</p>
                            <p className="mt-1 text-xs text-gray-500">{variable.purpose}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <div className="rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-black">Readiness Checks</h2>
              <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${overallClass(readiness?.overall)}`}>
                {readiness?.overall || "checking"}
              </span>
            </div>
            <div className="space-y-3">
              {(readiness?.checks || []).map((check) => (
                <div
                  key={check.key}
                  className="grid grid-cols-1 gap-4 rounded-xl border border-white/5 bg-black/25 p-4 md:grid-cols-12"
                >
                  <div className="md:col-span-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(check.status)}`}>
                      {check.status}
                    </span>
                  </div>
                  <div className="md:col-span-4">
                    <p className="font-black">{check.label}</p>
                    <p className="mt-1 text-xs text-gray-500">{check.key}</p>
                  </div>
                  <p className="text-sm leading-6 text-gray-400 md:col-span-5">{check.detail}</p>
                </div>
              ))}
              {!readiness?.checks.length && (
                <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-gray-500">
                  No readiness data loaded.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="xl:col-span-5">
          <div className="mb-6 rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="text-lg font-black">Payment Gateway</h2>
              <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${
                readiness?.payment?.checkout_configured && readiness?.payment?.webhook_configured
                  ? "bg-green-500/15 text-green-300"
                  : "bg-yellow-500/15 text-yellow-300"
              }`}>
                {readiness?.payment?.checkout_configured && readiness?.payment?.webhook_configured
                  ? "ready"
                  : "setup needed"}
              </span>
            </div>

            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <GatewayTile
                icon={CreditCard}
                label="Checkout"
                value={readiness?.payment?.checkout_configured ? "Configured" : "Missing"}
                ok={Boolean(readiness?.payment?.checkout_configured)}
              />
              <GatewayTile
                icon={KeyRound}
                label="Webhook"
                value={readiness?.payment?.webhook_configured ? "Configured" : "Missing"}
                ok={Boolean(readiness?.payment?.webhook_configured)}
              />
            </div>

            <div className="space-y-3">
              <Detail label="Provider" value={readiness?.payment?.provider || "checking"} />
              <Detail label="Currency" value={readiness?.payment?.currency || "checking"} />
              <Detail label="Return URL" value={readiness?.payment?.return_url || "checking"} />
              <Detail
                label="Session Endpoint"
                value={readiness?.payment?.session_endpoint || "checking"}
              />
              <Detail
                label="Webhook Endpoint"
                value={readiness?.payment?.webhook_endpoint || "checking"}
              />
            </div>

            {readiness?.payment &&
              (!readiness.payment.checkout_configured || !readiness.payment.webhook_configured) && (
                <div className="mt-4 rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-4">
                  <p className="mb-2 flex items-center gap-2 text-sm font-black text-yellow-200">
                    <LinkIcon className="h-4 w-4" /> Missing payment configuration
                  </p>
                  <p className="text-sm leading-6 text-yellow-100/80">
                    {[...readiness.payment.missing_checkout_settings, ...readiness.payment.missing_webhook_settings].join(", ") || "No missing settings listed."}
                  </p>
                </div>
              )}
          </div>

          <div className="mb-6 rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
            <h2 className="mb-4 text-lg font-black">Deployment Context</h2>
            <div className="space-y-3">
              <Detail label="Environment" value={readiness?.environment || "checking"} />
              <Detail label="Backup Retention" value={`${readiness?.backup_retention_days || 0} days`} />
              <Detail label="Backup Directory" value={readiness?.backup_dir || "checking"} />
              <Detail label="Database Path" value={readiness?.database_path || "managed or in-memory"} />
            </div>
          </div>

          <div className="rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-black">Backup History</h2>
              <span className="rounded-full bg-black/30 px-3 py-1 text-xs font-black uppercase tracking-widest text-gray-500">
                {backups.length} runs
              </span>
            </div>
            <div className="space-y-3">
              {backups.map((backup) => (
                <div key={backup.id} className="rounded-xl border border-white/5 bg-black/25 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${backupStatusClass(backup.status)}`}>
                      {backup.status}
                    </span>
                    <span className="text-xs text-gray-500">
                      {backup.created_at ? new Date(backup.created_at).toLocaleString() : "No time"}
                    </span>
                  </div>
                  <p className="break-all text-sm text-gray-300">{backup.file_path || backup.error || "No file"}</p>
                  <p className="mt-2 text-xs text-gray-500">
                    {backup.database_backend || backup.backup_type} | {formatBytes(backup.size_bytes)}
                  </p>
                </div>
              ))}
              {!backups.length && (
                <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-gray-500">
                  No backup runs yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-24 rounded-xl border border-white/5 bg-black/25 px-4 py-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-white">{value}</p>
    </div>
  );
}

function ProductionDatabaseCommand({ plan }: { plan: ProductionDatabasePlan }) {
  return (
    <section
      data-testid="production-database-path-command"
      className="mb-8 rounded-xl border border-orange-500/20 bg-[#111113] p-6"
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-400">Production Database Path</p>
          <h2 className="mt-2 text-2xl font-black">Production Database Path Command</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">{plan.decision}</p>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(plan.status)}`}>
          <Database className="h-3.5 w-3.5" />
          {plan.status}
        </span>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {plan.readiness_metrics.map((metric) => (
          <div key={metric.label} className="rounded-xl border border-white/5 bg-black/25 p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{metric.label}</p>
            <p className="mt-2 break-words text-xl font-black text-white">{metric.value}</p>
          </div>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-white/5 bg-black/25 p-5">
          <div className="mb-4 flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-orange-300" />
            <h3 className="font-black">Migration Checklist</h3>
          </div>
          <div className="space-y-3">
            {plan.migration_steps.map((step) => (
              <ReadinessStep key={step.key} step={step} />
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/5 bg-black/25 p-5">
          <div className="mb-4 flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-orange-300" />
            <h3 className="font-black">Backup And Restore Drill</h3>
          </div>
          <div className="space-y-3">
            {plan.backup_restore_drill.map((step) => (
              <ReadinessStep key={step.key} step={step} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Detail label="Target Backend" value={`${plan.target_backend} (${plan.target_driver})`} />
        <Detail label="Current Backend" value={plan.current_backend} />
        <Detail label="Current Database Path" value={plan.current_path || "managed or in-memory"} />
      </div>

      {plan.blockers.length ? (
        <div className="mt-6 rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-5">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-300" />
            <h3 className="font-black text-yellow-100">Current Blockers</h3>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {plan.blockers.map((blocker) => (
              <p key={blocker} className="rounded-lg bg-black/25 px-3 py-2 text-sm font-bold leading-6 text-yellow-50">
                {blocker}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ReadinessStep({ step }: { step: ProductionDatabaseStep }) {
  return (
    <div className="rounded-xl border border-white/5 bg-[#111113] p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <p className="font-black text-white">{step.label}</p>
        <StatusBadge status={step.status} />
      </div>
      <p className="text-sm leading-6 text-gray-400">{step.detail}</p>
    </div>
  );
}

function LaunchModuleCard({ module }: { module: LaunchModule }) {
  return (
    <div className="flex min-h-[280px] flex-col rounded-xl border border-white/5 bg-black/25 p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-300">
          <Rocket className="h-5 w-5" />
        </div>
        <StatusBadge status={module.status} />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-black text-white">{module.title}</p>
        <p className="mt-2 text-sm leading-6 text-gray-500">{module.detail}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-white/5 bg-[#111113] p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Score</p>
          <p className="mt-1 text-xl font-black text-orange-300">{module.score}%</p>
        </div>
        <div className="rounded-lg border border-white/5 bg-[#111113] p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Route</p>
          <p className="mt-1 truncate text-sm font-black text-gray-200">{module.route}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2">
        {module.metrics.slice(0, 3).map((metric) => (
          <div key={`${module.key}-${metric.label}`} className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2">
            <span className="text-xs font-bold text-gray-400">{metric.label}</span>
            <span className="text-xs font-black text-white">{metric.value}</span>
          </div>
        ))}
      </div>

      <div className="mt-auto pt-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Next</p>
        <p className="mt-2 text-sm font-bold leading-6 text-gray-300">
          {module.next_actions[0] || "Continue regular proof checks."}
        </p>
      </div>
    </div>
  );
}

function overallClass(status?: Readiness["overall"]) {
  if (status === "ready") return "bg-green-500/15 text-green-300";
  if (status === "blocked") return "bg-red-500/15 text-red-300";
  return "bg-yellow-500/15 text-yellow-300";
}

function statusClass(status: CheckStatus) {
  if (status === "pass") return "bg-green-500/15 text-green-300";
  if (status === "fail") return "bg-red-500/15 text-red-300";
  return "bg-yellow-500/15 text-yellow-300";
}

function backupStatusClass(status: string) {
  if (status === "success") return "bg-green-500/15 text-green-300";
  if (status === "failed") return "bg-red-500/15 text-red-300";
  if (status === "skipped" || status === "external_required") return "bg-yellow-500/15 text-yellow-300";
  return "bg-white/10 text-gray-300";
}

function StatusBadge({ status }: { status: CheckStatus }) {
  const Icon = status === "pass" ? CheckCircle2 : AlertTriangle;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(status)}`}>
      <Icon className="h-3.5 w-3.5" />
      {status}
    </span>
  );
}

function formatBytes(value: number) {
  if (!value) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-[#1a1a1c] p-5">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-400">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-xs font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-black capitalize">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-black/25 p-4">
      <p className="text-xs font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-2 break-all text-sm font-bold text-gray-200">{value}</p>
    </div>
  );
}

function GatewayTile({
  icon: Icon,
  label,
  value,
  ok,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-black/25 p-4">
      <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${
        ok ? "bg-green-500/15 text-green-300" : "bg-yellow-500/15 text-yellow-300"
      }`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-xs font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-2 font-black">{value}</p>
    </div>
  );
}
