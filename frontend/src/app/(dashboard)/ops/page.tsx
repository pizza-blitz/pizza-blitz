"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CreditCard,
  Database,
  Download,
  FileText,
  HardDrive,
  KeyRound,
  Link as LinkIcon,
  ListChecks,
  RefreshCw,
  Route as RouteIcon,
  Rocket,
  ShieldCheck,
  Upload,
  Users,
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

type EnvironmentSecurityPlan = {
  summary: string;
  status: CheckStatus;
  readiness_metrics: ModuleMetric[];
  secret_controls: ProductionDatabaseStep[];
  deployment_env: ProductionDatabaseStep[];
  rotation_drill: ProductionDatabaseStep[];
  blockers: string[];
};

type DeploymentPipelinePlan = {
  summary: string;
  status: CheckStatus;
  readiness_metrics: ModuleMetric[];
  build_gate: ProductionDatabaseStep[];
  release_steps: ProductionDatabaseStep[];
  rollback_checks: ProductionDatabaseStep[];
  production_smoke: ProductionDatabaseStep[];
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
  environment_security_plan?: EnvironmentSecurityPlan;
  deployment_pipeline_plan?: DeploymentPipelinePlan;
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

type DataQualityResource = {
  key: string;
  label: string;
  status: CheckStatus;
  endpoint?: string | null;
  detail: string;
};

type DataQualityReport = {
  generated_at: string;
  score: number;
  status: CheckStatus;
  summary: {
    total_customers: number;
    reachable_customers: number;
    opted_in_customers: number;
    email_ready_customers: number;
    missing_email_customers: number;
    duplicate_phone_groups: number;
    no_order_profile_count: number;
    orders_total: number;
    orders_missing_phone: number;
    daily_sales_rows: number;
    latest_sales_date?: string | null;
    campaign_export_count: number;
  };
  checks: ProductionDatabaseStep[];
  exports: DataQualityResource[];
  imports: DataQualityResource[];
  backup_restore: {
    latest_status: string;
    latest_backup_at?: string | null;
    latest_size_bytes: number;
    freshness: {
      status: CheckStatus;
      latest_backup_at?: string | null;
      detail: string;
    };
    restore_rehearsal: {
      status: CheckStatus;
      detail: string;
    };
  };
  next_actions: string[];
};

type LaunchCriticalRoute = {
  key: string;
  label: string;
  route: string;
  module_key: string;
  proof: string;
  status: CheckStatus;
  score: number;
  detail: string;
  next_action: string;
};

type LaunchProofGate = {
  key: string;
  label: string;
  status: CheckStatus;
  proof: string;
  detail: string;
};

type ReleaseDecision = "ready" | "conditional" | "hold";

type LaunchCandidateReport = {
  generated_at: string;
  status: CheckStatus;
  score: number;
  release_decision: ReleaseDecision;
  summary: {
    critical_routes: number;
    routes_ready: number;
    routes_attention: number;
    routes_blocked: number;
    proof_gates: number;
    launch_blockers: number;
    setup_actions: number;
    module_score: number;
    readiness_score: number;
  };
  critical_routes: LaunchCriticalRoute[];
  proof_gates: LaunchProofGate[];
  hardening_checks: ProductionDatabaseStep[];
  blocker_review: {
    hard_blockers: GoLiveItem[];
    setup_actions: GoLiveItem[];
    deployment_blockers: string[];
    database_blockers: string[];
    security_blockers: string[];
  };
  next_actions: string[];
};

type FinalAcceptanceStep = {
  key: string;
  label: string;
  route: string;
  module_key: string;
  proof: string;
  detail: string;
  status: CheckStatus;
  score: number;
  next_action: string;
};

type FinalAcceptanceLane = {
  key: "admin" | "staff" | "customer";
  title: string;
  owner: string;
  focus: string;
  status: CheckStatus;
  score: number;
  steps: FinalAcceptanceStep[];
};

type FinalAcceptanceReport = {
  generated_at: string;
  status: CheckStatus;
  score: number;
  decision: ReleaseDecision;
  summary: {
    lanes_total: number;
    lanes_ready: number;
    lanes_attention: number;
    lanes_blocked: number;
    steps_total: number;
    proofs_total: number;
    acceptance_gates: number;
    production_blockers: number;
    launch_score: number;
    readiness_score: number;
  };
  lanes: FinalAcceptanceLane[];
  acceptance_gates: LaunchProofGate[];
  blockers: {
    launch_blockers: GoLiveItem[];
    setup_actions: GoLiveItem[];
    deployment_blockers: string[];
    database_blockers: string[];
    security_blockers: string[];
  };
  next_actions: string[];
};

export default function ProductionOpsPage() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [finalAcceptance, setFinalAcceptance] = useState<FinalAcceptanceReport | null>(null);
  const [launchCandidate, setLaunchCandidate] = useState<LaunchCandidateReport | null>(null);
  const [dataQuality, setDataQuality] = useState<DataQualityReport | null>(null);
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
    const [readinessResponse, finalAcceptanceResponse, launchCandidateResponse, dataQualityResponse, backupResponse] = await Promise.all([
      fetchWithAuth(`${OPS_API}/readiness`),
      fetchWithAuth(`${OPS_API}/final-acceptance`),
      fetchWithAuth(`${OPS_API}/launch-candidate`),
      fetchWithAuth(`${OPS_API}/data-quality`),
      fetchWithAuth(`${OPS_API}/backups`),
    ]);
    if (readinessResponse.ok) {
      setReadiness(await readinessResponse.json());
    }
    if (finalAcceptanceResponse.ok) {
      setFinalAcceptance(await finalAcceptanceResponse.json());
    }
    if (launchCandidateResponse.ok) {
      setLaunchCandidate(await launchCandidateResponse.json());
    }
    if (dataQualityResponse.ok) {
      setDataQuality(await dataQualityResponse.json());
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

      {finalAcceptance ? <FinalAcceptanceWalkthroughCommand report={finalAcceptance} /> : null}

      {launchCandidate ? <LaunchCandidateHardeningCommand report={launchCandidate} /> : null}

      {dataQuality ? <DataQualityCommand report={dataQuality} /> : null}

      {readiness?.production_database_plan ? (
        <ProductionDatabaseCommand plan={readiness.production_database_plan} />
      ) : null}

      {readiness?.environment_security_plan ? (
        <EnvironmentSecurityCommand plan={readiness.environment_security_plan} />
      ) : null}

      {readiness?.deployment_pipeline_plan ? (
        <DeploymentPipelineCommand plan={readiness.deployment_pipeline_plan} />
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
          <div id="backup-history" className="rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
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

function FinalAcceptanceWalkthroughCommand({ report }: { report: FinalAcceptanceReport }) {
  const blockerList = [
    ...report.blockers.launch_blockers.map((item) => item.detail || item.label),
    ...report.blockers.deployment_blockers,
    ...report.blockers.database_blockers,
    ...report.blockers.security_blockers,
  ].slice(0, 6);

  return (
    <section
      data-testid="final-acceptance-walkthrough-command"
      className="mb-8 rounded-xl border border-emerald-500/20 bg-[#101512] p-6"
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">Final Acceptance Walkthrough</p>
          <h2 className="mt-2 text-2xl font-black">Final Acceptance Walkthrough Command</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
            Admin, staff/POS and customer walkthrough lanes before the June 20 beta delivery checkpoint.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(report.status)}`}>
            <ShieldCheck className="h-3.5 w-3.5" />
            {report.status}
          </span>
          <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${releaseDecisionClass(report.decision)}`}>
            {report.decision}
          </span>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase text-gray-300">
            {report.score}% ready
          </span>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <DataQualityMetric icon={Users} label="Walkthroughs" value={`${report.summary.lanes_total}`} />
        <DataQualityMetric icon={CheckCircle2} label="Ready Lanes" value={`${report.summary.lanes_ready}`} />
        <DataQualityMetric icon={FileText} label="Proofs" value={`${report.summary.proofs_total}`} />
        <DataQualityMetric icon={AlertTriangle} label="Blockers" value={`${report.summary.production_blockers}`} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        {report.lanes.map((lane) => (
          <div
            key={lane.key}
            data-testid={`${lane.key}-walkthrough-lane`}
            className="rounded-xl border border-white/5 bg-black/25 p-5"
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-widest text-emerald-300">{lane.owner}</p>
                <h3 className="mt-1 break-words text-lg font-black text-white">{lane.title}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-500">{lane.focus}</p>
              </div>
              <StatusBadge status={lane.status} />
            </div>
            <div className="mb-4 grid grid-cols-2 gap-2">
              <SummaryPill label="Score" value={`${lane.score}%`} />
              <SummaryPill label="Steps" value={`${lane.steps.length}`} />
            </div>
            <div className="space-y-3">
              {lane.steps.map((step) => (
                <a
                  key={step.key}
                  href={step.route}
                  className="block rounded-xl border border-white/5 bg-[#111113] p-4 hover:border-emerald-400/40 hover:bg-emerald-500/5"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-black text-white">{step.label}</p>
                      <p className="mt-1 text-xs font-bold text-gray-500">{step.route}</p>
                    </div>
                    <StatusBadge status={step.status} />
                  </div>
                  <p className="break-words text-[11px] font-black leading-4 text-emerald-100">{step.proof}</p>
                  <p className="mt-2 text-sm leading-6 text-gray-500">{step.detail}</p>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div data-testid="final-acceptance-gates" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-7">
          <div className="mb-4 flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-emerald-300" />
            <h3 className="font-black">Acceptance Gates</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {report.acceptance_gates.map((gate) => (
              <div key={gate.key} className="rounded-xl border border-white/5 bg-[#111113] p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <p className="font-black text-white">{gate.label}</p>
                  <StatusBadge status={gate.status} />
                </div>
                <p className="break-words text-[11px] font-black leading-4 text-emerald-100">{gate.proof}</p>
                <p className="mt-2 text-sm leading-6 text-gray-500">{gate.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div data-testid="final-acceptance-decision" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-5">
          <div className="mb-4 flex items-center gap-2">
            <Rocket className="h-5 w-5 text-emerald-300" />
            <h3 className="font-black">Beta Checkpoint Decision</h3>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <SummaryPill label="Launch" value={`${report.summary.launch_score}%`} />
            <SummaryPill label="Readiness" value={`${report.summary.readiness_score}%`} />
          </div>
          <div className="space-y-2">
            {blockerList.length ? (
              blockerList.map((blocker, index) => (
                <p key={`${blocker}-${index}`} className="rounded-lg bg-white/5 px-3 py-2 text-sm font-bold leading-6 text-gray-300">
                  {blocker}
                </p>
              ))
            ) : (
              <p className="rounded-lg bg-white/5 px-3 py-2 text-sm font-bold leading-6 text-gray-300">
                No production blockers are currently listed.
              </p>
            )}
          </div>
        </div>
      </div>

      <div
        data-testid="final-acceptance-next-actions"
        className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-4 md:grid-cols-2"
      >
        {report.next_actions.map((action) => (
          <p key={action} className="flex items-start gap-3 text-sm font-semibold leading-6 text-emerald-50/90">
            <ListChecks className="mt-1 h-4 w-4 shrink-0 text-emerald-300" />
            {action}
          </p>
        ))}
      </div>
    </section>
  );
}

function LaunchCandidateHardeningCommand({ report }: { report: LaunchCandidateReport }) {
  const blockerCount =
    report.blocker_review.hard_blockers.length +
    report.blocker_review.deployment_blockers.length +
    report.blocker_review.database_blockers.length +
    report.blocker_review.security_blockers.length;
  const topBlockers = [
    ...report.blocker_review.hard_blockers.map((item) => item.detail || item.label),
    ...report.blocker_review.deployment_blockers,
    ...report.blocker_review.database_blockers,
    ...report.blocker_review.security_blockers,
  ].slice(0, 6);

  return (
    <section
      data-testid="launch-candidate-hardening-command"
      className="mb-8 rounded-xl border border-violet-500/20 bg-[#121018] p-6"
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">Launch Candidate Hardening</p>
          <h2 className="mt-2 text-2xl font-black">Launch Candidate Hardening Command</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
            Critical route coverage, E2E proof ownership and production blocker review before the final acceptance walkthrough.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(report.status)}`}>
            <ShieldCheck className="h-3.5 w-3.5" />
            {report.status}
          </span>
          <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${releaseDecisionClass(report.release_decision)}`}>
            {report.release_decision}
          </span>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase text-gray-300">
            {report.score}% ready
          </span>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <DataQualityMetric icon={RouteIcon} label="Critical Routes" value={`${report.summary.critical_routes}`} />
        <DataQualityMetric icon={CheckCircle2} label="Routes Ready" value={`${report.summary.routes_ready}`} />
        <DataQualityMetric icon={FileText} label="Proof Gates" value={`${report.summary.proof_gates}`} />
        <DataQualityMetric icon={AlertTriangle} label="Blockers" value={`${blockerCount}`} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div data-testid="critical-route-stability" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-7">
          <div className="mb-4 flex items-center gap-2">
            <RouteIcon className="h-5 w-5 text-violet-300" />
            <h3 className="font-black">Critical Route Stability</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {report.critical_routes.map((route) => (
              <a
                key={route.key}
                href={route.route}
                className="rounded-xl border border-white/5 bg-[#111113] p-4 hover:border-violet-400/40 hover:bg-violet-500/5"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-black text-white">{route.label}</p>
                    <p className="mt-1 text-xs font-bold text-gray-500">{route.route}</p>
                  </div>
                  <StatusBadge status={route.status} />
                </div>
                <div className="mb-3 grid grid-cols-1 gap-2">
                  <div className="rounded-lg bg-white/5 p-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-600">Score</p>
                    <p className="mt-1 text-sm font-black text-violet-200">{route.score}%</p>
                  </div>
                  <div className="rounded-lg bg-white/5 p-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-600">Proof</p>
                    <p className="mt-1 break-words text-[11px] font-black leading-4 text-gray-200">{route.proof}</p>
                  </div>
                </div>
                <p className="text-sm font-semibold leading-6 text-gray-500">{route.next_action}</p>
              </a>
            ))}
          </div>
        </div>

        <div data-testid="e2e-failure-review" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-5">
          <div className="mb-4 flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-violet-300" />
            <h3 className="font-black">E2E Failure Review</h3>
          </div>
          <div className="space-y-3">
            {report.proof_gates.map((gate) => (
              <div key={gate.key} className="rounded-xl border border-white/5 bg-[#111113] p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <p className="font-black text-white">{gate.label}</p>
                  <StatusBadge status={gate.status} />
                </div>
                <p className="break-all text-xs font-black text-violet-200">{gate.proof}</p>
                <p className="mt-2 text-sm leading-6 text-gray-500">{gate.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div data-testid="production-blocker-review" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-6">
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-violet-300" />
            <h3 className="font-black">Production Blocker Review</h3>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <SummaryPill label="Hard" value={`${report.summary.launch_blockers}`} />
            <SummaryPill label="Setup" value={`${report.summary.setup_actions}`} />
          </div>
          <div className="space-y-2">
            {topBlockers.length ? (
              topBlockers.map((blocker, index) => (
                <p key={`${blocker}-${index}`} className="rounded-lg bg-white/5 px-3 py-2 text-sm font-bold leading-6 text-gray-300">
                  {blocker}
                </p>
              ))
            ) : (
              <p className="rounded-lg bg-white/5 px-3 py-2 text-sm font-bold leading-6 text-gray-300">
                No production blockers are currently listed.
              </p>
            )}
          </div>
        </div>

        <div data-testid="launch-release-decision" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-6">
          <div className="mb-4 flex items-center gap-2">
            <Rocket className="h-5 w-5 text-violet-300" />
            <h3 className="font-black">Release Decision</h3>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <SummaryPill label="Module Score" value={`${report.summary.module_score}%`} />
            <SummaryPill label="Readiness" value={`${report.summary.readiness_score}%`} />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {report.hardening_checks.map((check) => (
              <ReadinessStep key={check.key} step={check} />
            ))}
          </div>
        </div>
      </div>

      <div
        data-testid="launch-candidate-next-actions"
        className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-violet-500/10 bg-violet-500/5 p-4 md:grid-cols-2"
      >
        {report.next_actions.map((action) => (
          <p key={action} className="flex items-start gap-3 text-sm font-semibold leading-6 text-violet-50/90">
            <ListChecks className="mt-1 h-4 w-4 shrink-0 text-violet-300" />
            {action}
          </p>
        ))}
      </div>
    </section>
  );
}

function DataQualityCommand({ report }: { report: DataQualityReport }) {
  const customerExport = report.exports.find((item) => item.key === "customers");
  const salesExport = report.exports.find((item) => item.key === "sales");
  const campaignExport = report.exports.find((item) => item.key === "campaign_performance");

  return (
    <section
      data-testid="data-quality-export-command"
      className="mb-8 rounded-xl border border-cyan-500/20 bg-[#101417] p-6"
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">Data Quality And Import/Export</p>
          <h2 className="mt-2 text-2xl font-black">Data Quality and Export Command</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
            Customer cleanup, report exports and backup/restore proof before any production import or bulk data movement.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(report.status)}`}>
            <ShieldCheck className="h-3.5 w-3.5" />
            {report.status}
          </span>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase text-gray-300">
            {report.score}% ready
          </span>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <DataQualityMetric icon={Users} label="Customers" value={`${report.summary.total_customers}`} />
        <DataQualityMetric icon={CheckCircle2} label="Reachable" value={`${report.summary.reachable_customers}`} />
        <DataQualityMetric icon={FileText} label="Sales Rows" value={`${report.summary.daily_sales_rows}`} />
        <DataQualityMetric icon={HardDrive} label="Backup" value={report.backup_restore.latest_status} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <DataQualityPanel
          testId="customer-import-export-checks"
          icon={Users}
          title="Customer Import/Export Checks"
          status={report.checks.find((item) => item.key === "customer_reachability")?.status || "warn"}
          metrics={[
            { label: "Email Ready", value: `${report.summary.email_ready_customers}` },
            { label: "Email Gaps", value: `${report.summary.missing_email_customers}` },
            { label: "Duplicates", value: `${report.summary.duplicate_phone_groups}` },
          ]}
          detail={`${report.summary.no_order_profile_count} profile(s) have no order history yet; ${report.summary.orders_missing_phone} order(s) are missing phone handoff.`}
          primaryHref={apiHref(customerExport?.endpoint)}
          primaryLabel="Download customers"
        />
        <DataQualityPanel
          testId="report-export-checks"
          icon={BarChart3}
          title="Report Export Checks"
          status={report.checks.find((item) => item.key === "report_exports")?.status || "warn"}
          metrics={[
            { label: "Sales Rows", value: `${report.summary.daily_sales_rows}` },
            { label: "Campaigns", value: `${report.summary.campaign_export_count}` },
            { label: "Latest Sale", value: report.summary.latest_sales_date || "none" },
          ]}
          detail={salesExport?.detail || "Sales report export readiness is loading."}
          primaryHref={apiHref(salesExport?.endpoint)}
          primaryLabel="Download sales"
          secondaryHref={apiHref(campaignExport?.endpoint)}
          secondaryLabel="Campaign CSV"
        />
        <DataQualityPanel
          testId="backup-restore-proof-checks"
          icon={HardDrive}
          title="Backup/Restore Proof"
          status={report.backup_restore.freshness.status}
          metrics={[
            { label: "Latest", value: report.backup_restore.latest_status },
            { label: "Size", value: formatBytes(report.backup_restore.latest_size_bytes) },
            { label: "Restore", value: report.backup_restore.restore_rehearsal.status },
          ]}
          detail={report.backup_restore.restore_rehearsal.detail}
          primaryHref="#backup-history"
          primaryLabel="Open backups"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-7">
          <div className="mb-4 flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-cyan-300" />
            <h3 className="font-black">Quality Checks</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {report.checks.map((check) => (
              <ReadinessStep key={check.key} step={check} />
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-5">
          <div className="mb-4 flex items-center gap-2">
            <Upload className="h-5 w-5 text-cyan-300" />
            <h3 className="font-black">Import Readiness</h3>
          </div>
          <div className="space-y-3">
            {report.imports.map((item) => (
              <DataQualityResourceRow key={item.key} item={item} />
            ))}
          </div>
        </div>
      </div>

      <div
        data-testid="data-quality-next-actions"
        className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-cyan-500/10 bg-cyan-500/5 p-4 md:grid-cols-2"
      >
        {report.next_actions.map((action) => (
          <p key={action} className="flex items-start gap-3 text-sm font-semibold leading-6 text-cyan-50/90">
            <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-cyan-300" />
            {action}
          </p>
        ))}
      </div>
    </section>
  );
}

function DataQualityMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-black/25 p-4">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300">
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-2 break-words text-xl font-black text-white">{value}</p>
    </div>
  );
}

function DataQualityPanel({
  testId,
  icon: Icon,
  title,
  status,
  metrics,
  detail,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: {
  testId: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  status: CheckStatus;
  metrics: { label: string; value: string }[];
  detail: string;
  primaryHref?: string | null;
  primaryLabel: string;
  secondaryHref?: string | null;
  secondaryLabel?: string;
}) {
  return (
    <div data-testid={testId} className="rounded-xl border border-white/5 bg-black/25 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-300">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="break-words text-lg font-black text-white">{title}</h3>
            <p className="mt-1 text-xs font-black uppercase tracking-widest text-gray-600">Readiness lane</p>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {metrics.map((metric) => (
          <div key={`${title}-${metric.label}`} className="rounded-lg border border-white/5 bg-white/[0.03] p-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-600">{metric.label}</p>
            <p className="mt-1 break-words text-sm font-black text-gray-200">{metric.value}</p>
          </div>
        ))}
      </div>
      <p className="min-h-16 text-sm font-semibold leading-6 text-gray-500">{detail}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {primaryHref ? (
          <a
            href={primaryHref}
            className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/15"
          >
            <Download className="h-3.5 w-3.5" />
            {primaryLabel}
          </a>
        ) : null}
        {secondaryHref && secondaryLabel ? (
          <a
            href={secondaryHref}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-black text-gray-200 hover:bg-white/10"
          >
            <FileText className="h-3.5 w-3.5" />
            {secondaryLabel}
          </a>
        ) : null}
      </div>
    </div>
  );
}

function DataQualityResourceRow({ item }: { item: DataQualityResource }) {
  return (
    <div className="rounded-xl border border-white/5 bg-[#111113] p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <p className="font-black text-white">{item.label}</p>
        <StatusBadge status={item.status} />
      </div>
      <p className="text-sm leading-6 text-gray-400">{item.detail}</p>
      {item.endpoint ? (
        <p className="mt-2 break-all text-xs font-semibold text-gray-600">{item.endpoint}</p>
      ) : null}
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

function EnvironmentSecurityCommand({ plan }: { plan: EnvironmentSecurityPlan }) {
  return (
    <section
      data-testid="environment-secrets-security-command"
      className="mb-8 rounded-xl border border-sky-500/20 bg-[#111113] p-6"
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-300">Environment And Secrets Security</p>
          <h2 className="mt-2 text-2xl font-black">Environment Secrets Command</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">{plan.summary}</p>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(plan.status)}`}>
          <ShieldCheck className="h-3.5 w-3.5" />
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

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <CommandStepGroup
          icon={KeyRound}
          title="Secret Controls"
          steps={plan.secret_controls}
        />
        <CommandStepGroup
          icon={Rocket}
          title="Deployment Environment"
          steps={plan.deployment_env}
        />
        <CommandStepGroup
          icon={RefreshCw}
          title="Rotation And Recovery Drill"
          steps={plan.rotation_drill}
        />
      </div>

      {plan.blockers.length ? (
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-5">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-300" />
            <h3 className="font-black text-yellow-100">Security Blockers</h3>
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

function DeploymentPipelineCommand({ plan }: { plan: DeploymentPipelinePlan }) {
  return (
    <section
      data-testid="deployment-pipeline-command"
      className="mb-8 rounded-xl border border-emerald-500/20 bg-[#111113] p-6"
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">Deployment Pipeline</p>
          <h2 className="mt-2 text-2xl font-black">Deployment Pipeline Command</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">{plan.summary}</p>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(plan.status)}`}>
          <Rocket className="h-3.5 w-3.5" />
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
        <CommandStepGroup icon={CheckCircle2} title="Build Gate" steps={plan.build_gate} />
        <CommandStepGroup icon={Rocket} title="Release Steps" steps={plan.release_steps} />
        <CommandStepGroup icon={RefreshCw} title="Rollback And Logs" steps={plan.rollback_checks} />
        <CommandStepGroup icon={ShieldCheck} title="Production Smoke" steps={plan.production_smoke} />
      </div>

      {plan.blockers.length ? (
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-5">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-300" />
            <h3 className="font-black text-yellow-100">Deployment Blockers</h3>
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

function CommandStepGroup({
  icon: Icon,
  title,
  steps,
}: {
  icon: typeof KeyRound;
  title: string;
  steps: ProductionDatabaseStep[];
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-black/25 p-5">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-5 w-5 text-sky-300" />
        <h3 className="font-black">{title}</h3>
      </div>
      <div className="space-y-3">
        {steps.map((step) => (
          <ReadinessStep key={step.key} step={step} />
        ))}
      </div>
    </div>
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

function releaseDecisionClass(status: ReleaseDecision) {
  if (status === "ready") return "bg-green-500/15 text-green-300";
  if (status === "hold") return "bg-red-500/15 text-red-300";
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

function apiHref(endpoint?: string | null) {
  return endpoint ? getApiUrl(endpoint) : null;
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
