"use client";

import { type ChangeEvent, useEffect, useMemo, useState } from "react";
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
const CUSTOMER_CSV_VALIDATE_API = getApiUrl("/api/v1/restaurant/customers/import/validate");
const OPS_FETCH_TIMEOUT_MS = 45000;
const fetchWithAuth = (url: string, init?: RequestInit) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), OPS_FETCH_TIMEOUT_MS);
  return fetch(url, {
    ...init,
    credentials: "include",
    signal: init?.signal || controller.signal,
  }).finally(() => window.clearTimeout(timeout));
};

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

type RestoreRehearsalCommand = {
  status: CheckStatus;
  summary: {
    backup_status: CheckStatus;
    restore_status: CheckStatus;
    evidence_ready: boolean;
    requirements_total: number;
    requirements_ready: number;
    retention_days: number;
  };
  detail: string;
  evidence_requirements: ProductionDatabaseStep[];
  last_proof?: BackupRun | null;
  recorder: {
    proof_type: string;
    reference_hint: string;
    notes_template: string[];
  };
};

type LiveDeploymentCheck = ProductionDatabaseStep & {
  url?: string;
  evidence?: Record<string, string | number | boolean | null | undefined>;
};

type LiveDeploymentCommand = {
  key: string;
  title: string;
  status: CheckStatus;
  score: number;
  detail: string;
  base_url: string;
  last_checked_at?: string | null;
  checks: LiveDeploymentCheck[];
  run_endpoint: string;
  next_actions: string[];
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

type RestaurantReadyRequirement = {
  key: string;
  label: string;
  status: CheckStatus;
  score: number;
  route: string;
  evidence: string;
  next_action: string;
};

type RestaurantReadyAudit = {
  generated_at: string;
  status: CheckStatus;
  score: number;
  summary: {
    requirements_total: number;
    requirements_ready: number;
    requirements_attention: number;
    requirements_blocked: number;
    target: string;
  };
  requirements: RestaurantReadyRequirement[];
  next_actions: string[];
};

type ExternalReadinessGate = {
  key: string;
  label: string;
  status: CheckStatus;
  route: string;
  detail: string;
  next_action: string;
};

type ReadinessSummary = {
  overall: "ready" | "attention" | "blocked";
  go_live_score: number;
  implementation_score: number;
  restaurant_ready_score: number;
  modules: {
    total: number;
    ready: number;
    attention: number;
    blocked: number;
  };
  requirements: {
    total: number;
    ready: number;
    attention: number;
    blocked: number;
  };
  external_gates: ExternalReadinessGate[];
  external_gate_count: number;
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
  logical_backup_proof?: LogicalBackupProof;
  restore_rehearsal?: {
    status: CheckStatus;
    latest_restore_at?: string | null;
    detail: string;
  };
  payment?: PaymentStatus;
  readiness_score: number;
  production_database_plan?: ProductionDatabasePlan;
  environment_security_plan?: EnvironmentSecurityPlan;
  deployment_pipeline_plan?: DeploymentPipelinePlan;
  live_deployment_command?: LiveDeploymentCommand;
  restore_rehearsal_command?: RestoreRehearsalCommand;
  launch_blockers: GoLiveItem[];
  setup_actions: GoLiveItem[];
  go_live_sections: GoLiveSection[];
  launch_summary?: LaunchSummary;
  module_readiness?: LaunchModule[];
  restaurant_ready_audit?: RestaurantReadyAudit;
  readiness_summary?: ReadinessSummary;
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

type LogicalBackupProof = {
  status: CheckStatus;
  latest_proof_at?: string | null;
  checksum?: string | null;
  detail: string;
};

type DataQualityResource = {
  key: string;
  label: string;
  status: CheckStatus;
  endpoint?: string | null;
  detail: string;
};

type CustomerCsvDryRunResult = {
  dry_run: boolean;
  writes_performed: number;
  ready_for_review: boolean;
  summary: {
    rows_total: number;
    rows_valid: number;
    rows_invalid: number;
    duplicate_phone_groups: number;
    existing_customer_matches: number;
    new_customer_candidates: number;
  };
  rollback_plan: string;
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

type BetaDeliveryReport = {
  generated_at: string;
  status: CheckStatus;
  score: number;
  decision: ReleaseDecision;
  summary: {
    proofs_total: number;
    proofs_ready: number;
    proofs_attention: number;
    proofs_blocked: number;
    known_gaps: number;
    production_steps: number;
    readiness_score: number;
    final_acceptance_score: number;
  };
  proof_queue: LaunchProofGate[];
  known_gaps: ProductionDatabaseStep[];
  production_plan: ProductionDatabaseStep[];
  handoff: {
    title: string;
    status: ReleaseDecision;
    detail: string;
  };
  next_actions: string[];
};

type ProductionLaunchStep = {
  key: string;
  label: string;
  status: CheckStatus;
  owner?: string;
  detail: string;
  proof?: string;
  missing_settings?: string[];
};

type ProductionLaunchLane = {
  key: "live_credentials" | "managed_database" | "backup_restore" | "deployment_secrets" | "production_smoke";
  title: string;
  status: CheckStatus;
  owner: string;
  detail: string;
  steps: ProductionLaunchStep[];
};

type ProductionLaunchReport = {
  generated_at: string;
  status: CheckStatus;
  score: number;
  decision: ReleaseDecision;
  summary: {
    lanes_total: number;
    lanes_ready: number;
    integration_steps: number;
    live_credentials_ready: string;
    required_env: string;
    production_blockers: number;
    readiness_score: number;
    beta_score: number;
  };
  lanes: ProductionLaunchLane[];
  blockers: ProductionDatabaseStep[];
  execution_plan: ProductionLaunchStep[];
  handoff: {
    title: string;
    status: ReleaseDecision;
    detail: string;
  };
  next_actions: string[];
};

type LiveEnvironmentStep = {
  key: string;
  label: string;
  status: CheckStatus;
  owner: string;
  command: string;
  proof: string;
  detail: string;
};

type LiveEnvironmentPhase = {
  key: "credential_cutover" | "database_migration" | "secret_sync" | "restore_rehearsal" | "public_host_smoke";
  title: string;
  status: CheckStatus;
  owner: string;
  goal: string;
  steps: LiveEnvironmentStep[];
};

type LiveEnvironmentEvidence = {
  key: string;
  label: string;
  status: CheckStatus;
  proof: string;
  artifact: string;
  detail: string;
};

type LiveEnvironmentWindow = {
  key: string;
  title: string;
  status: CheckStatus;
  window: string;
  detail: string;
};

type LiveEnvironmentReport = {
  generated_at: string;
  status: CheckStatus;
  score: number;
  decision: ReleaseDecision;
  summary: {
    phases_total: number;
    phases_ready: number;
    actions_total: number;
    evidence_total: number;
    live_blockers: number;
    required_env: string;
    production_launch_score: number;
    readiness_score: number;
  };
  phases: LiveEnvironmentPhase[];
  cutover_windows: LiveEnvironmentWindow[];
  evidence: LiveEnvironmentEvidence[];
  blockers: ProductionDatabaseStep[];
  go_no_go: {
    title: string;
    status: ReleaseDecision;
    detail: string;
    required_signoffs: string[];
  };
  next_actions: string[];
};

type CredentialActivationProvider = {
  key: string;
  label: string;
  provider: string;
  status: CheckStatus;
  channel: string;
  configured: boolean;
  missing_settings: string[];
  proof: string;
  detail: string;
};

type CredentialActivationLane = {
  key: "payment_gateway" | "messaging_channels" | "social_publishing" | "ad_campaign_sync";
  title: string;
  status: CheckStatus;
  owner: string;
  detail: string;
  providers: CredentialActivationProvider[];
};

type CredentialActivationSmokeStep = {
  key: string;
  label: string;
  status: CheckStatus;
  owner: string;
  proof: string;
  detail: string;
};

type CredentialActivationEvidence = {
  key: string;
  label: string;
  status: CheckStatus;
  proof: string;
  artifact: string;
  detail: string;
};

type CredentialActivationReport = {
  generated_at: string;
  status: CheckStatus;
  score: number;
  decision: ReleaseDecision;
  summary: {
    providers_total: number;
    providers_ready: number;
    smoke_steps: number;
    smoke_ready: number;
    missing_settings: number;
    blockers: number;
    live_environment_score: number;
    readiness_score: number;
  };
  activation_lanes: CredentialActivationLane[];
  provider_matrix: CredentialActivationProvider[];
  smoke_plan: CredentialActivationSmokeStep[];
  evidence: CredentialActivationEvidence[];
  blockers: ProductionDatabaseStep[];
  go_no_go: {
    title: string;
    status: ReleaseDecision;
    detail: string;
    required_signoffs: string[];
  };
  next_actions: string[];
};

const credentialActivationLoadingReport: CredentialActivationReport = {
  generated_at: "pending",
  status: "warn",
  score: 0,
  decision: "hold",
  summary: {
    providers_total: 4,
    providers_ready: 0,
    smoke_steps: 4,
    smoke_ready: 0,
    missing_settings: 0,
    blockers: 1,
    live_environment_score: 0,
    readiness_score: 0,
  },
  activation_lanes: [
    {
      key: "payment_gateway",
      title: "Payment Gateway",
      status: "warn",
      owner: "Owner / Finance",
      detail: "Checking live Cashfree, Razorpay, Direct Bank and webhook evidence.",
      providers: [
        {
          key: "payment_gateway_loading",
          label: "Gateway evidence",
          provider: "Cashfree / Razorpay / Direct Bank",
          status: "warn",
          channel: "payments",
          configured: false,
          missing_settings: [],
          proof: "Loading live provider readiness.",
          detail: "The command panel is visible while the production credential report warms.",
        },
      ],
    },
    {
      key: "messaging_channels",
      title: "Messaging Channels",
      status: "warn",
      owner: "Marketing / CRM",
      detail: "Checking WhatsApp, SMS and email sender credentials.",
      providers: [
        {
          key: "messaging_loading",
          label: "Messaging evidence",
          provider: "WhatsApp / SMS / Email",
          status: "warn",
          channel: "messaging",
          configured: false,
          missing_settings: [],
          proof: "Loading live provider readiness.",
          detail: "No live send is implied until the provider report returns pass evidence.",
        },
      ],
    },
    {
      key: "social_publishing",
      title: "Social Publishing",
      status: "warn",
      owner: "Marketing",
      detail: "Checking Facebook, Instagram and post proof readiness.",
      providers: [
        {
          key: "social_loading",
          label: "Social evidence",
          provider: "Facebook / Instagram",
          status: "warn",
          channel: "social",
          configured: false,
          missing_settings: [],
          proof: "Loading live provider readiness.",
          detail: "Auto-posting stays blocked unless real credentials and smoke proof are present.",
        },
      ],
    },
    {
      key: "ad_campaign_sync",
      title: "Ad Campaign Sync",
      status: "warn",
      owner: "Marketing / Ads",
      detail: "Checking Meta Ads campaign sync credentials and low-budget smoke evidence.",
      providers: [
        {
          key: "ads_loading",
          label: "Ads evidence",
          provider: "Meta Ads",
          status: "warn",
          channel: "ads",
          configured: false,
          missing_settings: [],
          proof: "Loading live provider readiness.",
          detail: "Ad launch remains a manual hold until the real provider report is loaded.",
        },
      ],
    },
  ],
  provider_matrix: [],
  smoke_plan: [
    {
      key: "payment_smoke_loading",
      label: "Payment smoke",
      status: "warn",
      owner: "Owner / Finance",
      proof: "Pending live report.",
      detail: "Checking low-value checkout, callback and settlement proof.",
    },
    {
      key: "messaging_smoke_loading",
      label: "Messaging smoke",
      status: "warn",
      owner: "Marketing / CRM",
      proof: "Pending live report.",
      detail: "Checking dry-run and live-send safety controls.",
    },
    {
      key: "social_smoke_loading",
      label: "Social publish smoke",
      status: "warn",
      owner: "Marketing",
      proof: "Pending live report.",
      detail: "Checking post creation and publishing handoff evidence.",
    },
    {
      key: "ads_smoke_loading",
      label: "Ad sync smoke",
      status: "warn",
      owner: "Marketing / Ads",
      proof: "Pending live report.",
      detail: "Checking ad campaign draft/sync evidence.",
    },
  ],
  evidence: [
    {
      key: "credential_report_loading",
      label: "Credential report",
      status: "warn",
      proof: "Loading production credential activation report.",
      artifact: "The live API report replaces this placeholder automatically.",
      detail: "Placeholder only; not a credential pass.",
    },
  ],
  blockers: [
    {
      key: "credential_report_loading",
      label: "Credential report loading",
      status: "warn",
      detail: "Waiting for the live credential activation report before any provider can be marked ready.",
    },
  ],
  go_no_go: {
    title: "Hold live provider launch",
    status: "hold",
    detail: "Provider launch stays on hold until real credential and smoke evidence is loaded.",
    required_signoffs: [
      "Payment owner confirms gateway credentials.",
      "Marketing owner confirms messaging, social and ads credentials.",
    ],
  },
  next_actions: [
    "Wait for the production credential activation report to finish loading.",
    "Keep live sends, posts, ads and gateway checkout blocked until real credentials are configured.",
  ],
};

export default function ProductionOpsPage() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [credentialActivation, setCredentialActivation] = useState<CredentialActivationReport | null>(null);
  const [liveEnvironment, setLiveEnvironment] = useState<LiveEnvironmentReport | null>(null);
  const [productionLaunch, setProductionLaunch] = useState<ProductionLaunchReport | null>(null);
  const [betaDelivery, setBetaDelivery] = useState<BetaDeliveryReport | null>(null);
  const [finalAcceptance, setFinalAcceptance] = useState<FinalAcceptanceReport | null>(null);
  const [launchCandidate, setLaunchCandidate] = useState<LaunchCandidateReport | null>(null);
  const [dataQuality, setDataQuality] = useState<DataQualityReport | null>(null);
  const [backups, setBackups] = useState<BackupRun[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [runningLogicalBackupProof, setRunningLogicalBackupProof] = useState(false);
  const [runningRestoreRehearsal, setRunningRestoreRehearsal] = useState(false);
  const [runningLiveDeploymentProof, setRunningLiveDeploymentProof] = useState(false);
  const [recordingBackupProof, setRecordingBackupProof] = useState(false);
  const [backupProofType, setBackupProofType] = useState("managed_snapshot");
  const [backupProofReference, setBackupProofReference] = useState("");
  const [backupProofNotes, setBackupProofNotes] = useState("");

  const latestBackup = useMemo(() => backups[0] || null, [backups]);
  const isManagedDatabase = Boolean(readiness?.database_backend && readiness.database_backend !== "sqlite");
  const backupProofReferenceValue = backupProofReference.trim();
  const backupProofNotesValue = backupProofNotes.trim();
  const isRestoreProof = backupProofType === "restore_rehearsal";
  const restoreEvidenceText = `${backupProofReferenceValue} ${backupProofNotesValue}`.toLowerCase();
  const restoreEvidenceChecks = [
    {
      key: "restore_target",
      label: "Restore target",
      ready: /restore|restored|target|clean database/.test(restoreEvidenceText),
    },
    {
      key: "admin_login",
      label: "Admin login smoke",
      ready: /admin|login|ops|dashboard/.test(restoreEvidenceText),
    },
    {
      key: "order_smoke",
      label: "Order smoke",
      ready: /order|checkout|pos|receipt|tracking/.test(restoreEvidenceText),
    },
    {
      key: "report_export",
      label: "Report/export smoke",
      ready: /report|export|customer|sales/.test(restoreEvidenceText),
    },
  ];
  const restoreEvidenceReady =
    !isRestoreProof ||
    (backupProofReferenceValue.length >= 12 &&
      backupProofNotesValue.length >= 60 &&
      restoreEvidenceChecks.every((check) => check.ready));
  const backupProofReady = backupProofReferenceValue.length >= (isRestoreProof ? 12 : 6) && restoreEvidenceReady;

  useEffect(() => {
    fetchOps();
  }, []);

  const fetchOps = async () => {
    setLoading(true);
    setMessage("");
    const delayedSections: string[] = [];
    const loadSection = async (
      label: string,
      request: Promise<Response>,
      onData: (data: any) => void
    ) => {
      try {
        const response = await request;
        if (!response.ok) {
          delayedSections.push(label);
          return;
        }
        onData(await response.json());
      } catch {
        delayedSections.push(label);
      }
    };

    const tasks = [
      () => loadSection("readiness", fetchWithAuth(`${OPS_API}/readiness`), setReadiness),
      () => loadSection("credential activation", fetchWithAuth(`${OPS_API}/credential-activation`), setCredentialActivation),
      () => loadSection("production launch", fetchWithAuth(`${OPS_API}/production-launch`), setProductionLaunch),
      () => loadSection("live environment", fetchWithAuth(`${OPS_API}/live-environment`), setLiveEnvironment),
      () => loadSection("backup history", fetchWithAuth(`${OPS_API}/backups`), (data) => setBackups(data.backups || [])),
      () => loadSection("data quality", fetchWithAuth(`${OPS_API}/data-quality`), setDataQuality),
      () => loadSection("launch candidate", fetchWithAuth(`${OPS_API}/launch-candidate`), setLaunchCandidate),
      () => loadSection("beta delivery", fetchWithAuth(`${OPS_API}/beta-delivery`), setBetaDelivery),
      () => loadSection("final acceptance", fetchWithAuth(`${OPS_API}/final-acceptance`), setFinalAcceptance),
    ];
    const workers = Array.from({ length: Math.min(4, tasks.length) }, async () => {
      while (tasks.length) {
        const task = tasks.shift();
        if (task) await task();
      }
    });
    await Promise.all(workers);
    if (delayedSections.length) {
      setMessage(
        `Loaded available Ops sections. Still warming: ${delayedSections
          .join(", ")}.`
      );
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
    let backupMessage = backup.error || `Backup status: ${backup.status}`;
    if (backup.status === "external_required") {
      backupMessage = "Managed database backups must be recorded with a Supabase snapshot or pg_dump proof in Backup History.";
    } else if (backup.status === "success") {
      backupMessage = `Backup created: ${formatBytes(backup.size_bytes)}`;
    }
    setMessage(backupMessage);
    await fetchOps();
    setCreatingBackup(false);
  };

  const runLogicalBackupProof = async () => {
    setRunningLogicalBackupProof(true);
    const response = await fetchWithAuth(`${OPS_API}/backups/logical-proof/run`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.detail || "Logical database export proof could not be completed.");
      setRunningLogicalBackupProof(false);
      return;
    }
    const manifest = data.manifest || {};
    const checksum = String(manifest.checksum || "").slice(0, 12);
    await fetchOps();
    setMessage(
      `Logical export proof recorded: ${manifest.table_count || 0} tables, ${manifest.total_rows || 0} rows, checksum ${checksum}. Managed snapshot or pg_dump is still required before public launch.`
    );
    setRunningLogicalBackupProof(false);
  };

  const runRestoreRehearsal = async () => {
    setRunningRestoreRehearsal(true);
    const response = await fetchWithAuth(`${OPS_API}/backups/restore-rehearsal/run`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.detail || "Restore rehearsal could not be completed.");
      setRunningRestoreRehearsal(false);
      return;
    }
    const rowCounts = data.checks?.row_counts || {};
    const checkedTables = Object.entries(rowCounts)
      .map(([table, count]) => `${table}: ${count}`)
      .join(", ");
    await fetchOps();
    setMessage(
      checkedTables
        ? `Restore rehearsal passed. Checked ${checkedTables}.`
        : "Restore rehearsal passed."
    );
    setRunningRestoreRehearsal(false);
  };

  const runLiveDeploymentProof = async () => {
    setRunningLiveDeploymentProof(true);
    const response = await fetchWithAuth(`${OPS_API}/live-deployment-proof/run`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.detail || "Live deployment proof could not be completed.");
      setRunningLiveDeploymentProof(false);
      return;
    }
    const proof = data.proof || {};
    const resultMessage =
      proof.status === "pass"
        ? `Live deployment proof passed: ${proof.checks_passed}/${proof.checks_total} checks.`
        : `Live deployment proof needs attention: ${proof.checks_passed || 0}/${proof.checks_total || 0} checks passed.`;
    await fetchOps();
    setMessage(
      resultMessage
    );
    setRunningLiveDeploymentProof(false);
  };

  const recordBackupProof = async () => {
    if (backupProofReferenceValue.length < (isRestoreProof ? 12 : 6)) {
      setMessage(
        isRestoreProof
          ? "Restore rehearsal proof reference must be at least 12 characters."
          : "Backup proof reference must be at least 6 characters."
      );
      return;
    }
    if (isRestoreProof && !restoreEvidenceReady) {
      const missing = restoreEvidenceChecks.filter((check) => !check.ready).map((check) => check.label);
      setMessage(
        `Restore rehearsal notes need at least 60 characters and evidence for: ${missing.join(", ") || "all checks"}.`
      );
      return;
    }
    setRecordingBackupProof(true);
    const response = await fetchWithAuth(`${OPS_API}/backups/proof`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proof_type: backupProofType,
        reference: backupProofReferenceValue,
        notes: backupProofNotesValue || null,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.detail || "Backup proof could not be recorded.");
      setRecordingBackupProof(false);
      return;
    }
    setBackupProofReference("");
    setBackupProofNotes("");
    setMessage(`Recorded ${data.backup.backup_type.replaceAll("_", " ")} proof.`);
    await fetchOps();
    setRecordingBackupProof(false);
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
            data-testid="create-backup-action"
            onClick={createBackup}
            disabled={creatingBackup}
            className="flex items-center gap-2 rounded-xl bg-white px-5 py-3 font-bold text-black hover:bg-orange-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <HardDrive className="h-4 w-4" /> {isManagedDatabase ? "Managed Proof" : "Create Backup"}
          </button>
          <button
            data-testid="run-logical-backup-proof"
            onClick={runLogicalBackupProof}
            disabled={runningLogicalBackupProof}
            className="flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-5 py-3 font-bold text-sky-50 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileText className={`h-4 w-4 ${runningLogicalBackupProof ? "animate-pulse" : ""}`} />
            {runningLogicalBackupProof ? "Reading Data" : "Run Export Proof"}
          </button>
          <button
            data-testid="run-restore-rehearsal"
            onClick={runRestoreRehearsal}
            disabled={runningRestoreRehearsal}
            className="flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-5 py-3 font-bold text-cyan-50 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Database className={`h-4 w-4 ${runningRestoreRehearsal ? "animate-pulse" : ""}`} />
            {runningRestoreRehearsal ? "Running Drill" : "Run Restore Drill"}
          </button>
          <button
            data-testid="run-live-deployment-proof"
            onClick={runLiveDeploymentProof}
            disabled={runningLiveDeploymentProof}
            className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-3 font-bold text-emerald-50 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Rocket className={`h-4 w-4 ${runningLiveDeploymentProof ? "animate-pulse" : ""}`} />
            {runningLiveDeploymentProof ? "Checking Live" : "Run Live Proof"}
          </button>
        </div>
      </div>

      {message && (
        <div data-testid="ops-message" className="mb-6 rounded-xl border border-orange-500/20 bg-orange-500/10 px-5 py-3 text-sm text-orange-100">
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

      {readiness?.readiness_summary ? (
        <ReadinessSummaryPanel summary={readiness.readiness_summary} />
      ) : null}

      {readiness?.restaurant_ready_audit ? (
        <RestaurantReadyAuditPanel audit={readiness.restaurant_ready_audit} />
      ) : null}

      <CredentialActivationCommand report={credentialActivation || credentialActivationLoadingReport} />

      {liveEnvironment ? <LiveEnvironmentExecutionCommand report={liveEnvironment} /> : null}

      {productionLaunch ? <ProductionLaunchIntegrationsCommand report={productionLaunch} /> : null}

      {readiness?.live_deployment_command ? (
        <LiveDeploymentProofCommand
          command={readiness.live_deployment_command}
          isRunning={runningLiveDeploymentProof}
          onRun={runLiveDeploymentProof}
        />
      ) : null}

      {betaDelivery ? <BetaDeliveryCheckpointCommand report={betaDelivery} /> : null}

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

      {readiness?.restore_rehearsal_command ? (
        <RestoreRehearsalCommandPanel command={readiness.restore_rehearsal_command} />
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
              <p className="mt-2 text-xs font-bold text-green-100/70">
                Logical export: {readiness.logical_backup_proof?.status || "checking"}
              </p>
              <p className="mt-1 text-xs font-semibold leading-5 text-green-100/60">
                {readiness.logical_backup_proof?.detail || "Logical export proof is loading."}
              </p>
              <p className="mt-2 text-xs font-bold text-green-100/70">
                Restore: {readiness.restore_rehearsal?.status || "checking"}
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
            <div data-testid="managed-backup-proof-form" className="mb-5 rounded-xl border border-orange-500/15 bg-orange-500/10 p-4">
              <p className="mb-3 text-xs font-black uppercase tracking-widest text-orange-200">
                Managed Backup Proof
              </p>
              <div className="grid gap-3">
                <select
                  data-testid="backup-proof-type"
                  value={backupProofType}
                  onChange={(event) => setBackupProofType(event.target.value)}
                  className="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm font-bold text-white outline-none"
                >
                  <option value="managed_snapshot">Managed snapshot</option>
                  <option value="pg_dump">pg_dump export</option>
                  <option value="restore_rehearsal">Restore rehearsal</option>
                </select>
                <input
                  data-testid="backup-proof-reference"
                  value={backupProofReference}
                  onChange={(event) => setBackupProofReference(event.target.value)}
                  className="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm font-bold text-white outline-none"
                  placeholder={isRestoreProof ? "Restore job id or clean restore target reference" : "Snapshot or pg_dump export reference"}
                />
                <textarea
                  data-testid="backup-proof-notes"
                  value={backupProofNotes}
                  onChange={(event) => setBackupProofNotes(event.target.value)}
                  className="min-h-20 rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm font-bold text-white outline-none"
                  placeholder={
                    isRestoreProof
                      ? "restore target, admin login smoke, order smoke, report/export smoke"
                      : "Owner note or verification result"
                  }
                />
                {isRestoreProof ? (
                  <div data-testid="restore-proof-checklist" className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {restoreEvidenceChecks.map((check) => (
                      <span
                        key={check.key}
                        className={`rounded-md border px-3 py-2 text-xs font-black uppercase ${
                          check.ready
                            ? "border-green-500/20 bg-green-500/10 text-green-200"
                            : "border-white/10 bg-black/20 text-gray-500"
                        }`}
                      >
                        {check.ready ? "Ready" : "Needed"}: {check.label}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs font-bold leading-5 text-orange-100/80">
                    Snapshot or pg_dump proof clears backup freshness; restore rehearsal is recorded separately after a clean restore smoke.
                  </p>
                )}
                <button
                  data-testid="backup-proof-submit"
                  type="button"
                  onClick={recordBackupProof}
                  disabled={recordingBackupProof || !backupProofReady}
                  className="rounded-md bg-orange-500 px-4 py-3 text-sm font-black text-black hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {recordingBackupProof ? "Recording Proof" : "Record Proof"}
                </button>
              </div>
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

function CredentialActivationCommand({ report }: { report: CredentialActivationReport }) {
  const blockers = report.blockers.slice(0, 6);
  const laneTestId = (key: CredentialActivationLane["key"]) => {
    if (key === "payment_gateway") return "payment-gateway-activation";
    if (key === "messaging_channels") return "messaging-activation";
    if (key === "social_publishing") return "social-publishing-activation";
    return "ad-sync-activation";
  };

  return (
    <section
      data-testid="credential-activation-command"
      className="mb-8 rounded-xl border border-lime-500/20 bg-[#10150f] p-6"
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-lime-300">Credential Activation</p>
          <h2 className="mt-2 text-2xl font-black">Credential Activation Command</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
            Real gateway, messaging, social and ad credentials with low-value payment, webhook, send, publish and sync smoke.
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
        <DataQualityMetric icon={KeyRound} label="Providers" value={`${report.summary.providers_ready}/${report.summary.providers_total}`} />
        <DataQualityMetric icon={ListChecks} label="Smoke" value={`${report.summary.smoke_ready}/${report.summary.smoke_steps}`} />
        <DataQualityMetric icon={FileText} label="Missing" value={`${report.summary.missing_settings}`} />
        <DataQualityMetric icon={AlertTriangle} label="Blockers" value={`${report.summary.blockers}`} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-4">
        {report.activation_lanes.map((lane) => {
          const LaneIcon =
            lane.key === "payment_gateway"
              ? CreditCard
              : lane.key === "messaging_channels"
                ? Users
                : lane.key === "social_publishing"
                  ? LinkIcon
                  : Rocket;

          return (
            <div key={lane.key} data-testid={laneTestId(lane.key)} className="rounded-xl border border-white/5 bg-black/25 p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lime-500/10 text-lime-300">
                  <LaneIcon className="h-5 w-5" />
                </div>
                <StatusBadge status={lane.status} />
              </div>
              <p className="text-lg font-black text-white">{lane.title}</p>
              <p className="mt-1 text-xs font-black uppercase tracking-widest text-lime-100/70">{lane.owner}</p>
              <p className="mt-3 text-sm leading-6 text-gray-500">{lane.detail}</p>
              <div className="mt-4 space-y-3">
                {lane.providers.map((provider) => (
                  <CredentialProviderCard key={provider.key} provider={provider} compact />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div data-testid="credential-smoke-plan" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-7">
          <div className="mb-4 flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-lime-300" />
            <h3 className="font-black">Provider Smoke Plan</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {report.smoke_plan.map((step) => (
              <div key={step.key} className="rounded-xl border border-white/5 bg-[#111113] p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <p className="font-black text-white">{step.label}</p>
                  <StatusBadge status={step.status} />
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{step.owner}</p>
                <p className="mt-2 text-sm leading-6 text-gray-400">{step.detail}</p>
                <p className="mt-3 break-words text-[11px] font-black leading-4 text-lime-100">{step.proof}</p>
              </div>
            ))}
          </div>
        </div>

        <div data-testid="credential-go-no-go" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-5">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-lime-300" />
            <h3 className="font-black">Credential Go/No-Go</h3>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <SummaryPill label="Live Env" value={`${report.summary.live_environment_score}%`} />
            <SummaryPill label="Ops" value={`${report.summary.readiness_score}%`} />
          </div>
          <div className={`rounded-xl border border-white/5 p-4 ${releaseDecisionClass(report.go_no_go.status)}`}>
            <p className="text-sm font-black uppercase tracking-widest">{report.go_no_go.title}</p>
            <p className="mt-2 text-sm font-semibold leading-6">{report.go_no_go.detail}</p>
          </div>
          <div className="mt-4 space-y-2">
            {report.go_no_go.required_signoffs.map((signoff) => (
              <p key={signoff} className="rounded-lg bg-white/5 px-3 py-2 text-sm font-bold leading-6 text-gray-200">
                {signoff}
              </p>
            ))}
          </div>
          <div className="mt-4 space-y-3">
            {report.evidence.map((item) => (
              <div key={item.key} className="rounded-lg border border-white/5 bg-black/25 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-black text-white">{item.label}</p>
                  <StatusBadge status={item.status} />
                </div>
                <p className="break-words text-[11px] font-black leading-4 text-lime-100">{item.proof}</p>
                <p className="mt-2 break-words text-xs font-bold leading-5 text-gray-500">{item.artifact}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div data-testid="provider-readiness-matrix" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-7">
          <div className="mb-4 flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-lime-300" />
            <h3 className="font-black">Provider Readiness Matrix</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {report.provider_matrix.map((provider) => (
              <CredentialProviderCard key={provider.key} provider={provider} />
            ))}
          </div>
        </div>

        <div data-testid="credential-activation-blockers" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-5">
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-lime-300" />
            <h3 className="font-black">Credential Blockers</h3>
          </div>
          <div className="space-y-3">
            {blockers.map((blocker) => (
              <ReadinessStep key={blocker.key} step={blocker} />
            ))}
            {!blockers.length ? (
              <div className="rounded-xl border border-green-500/10 bg-green-500/5 p-4 text-sm font-semibold text-green-100">
                No credential blockers are currently reported.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div
        data-testid="credential-activation-next-actions"
        className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-lime-500/10 bg-lime-500/5 p-4 md:grid-cols-2"
      >
        {report.next_actions.map((action) => (
          <p key={action} className="flex items-start gap-3 text-sm font-semibold leading-6 text-lime-50/90">
            <ListChecks className="mt-1 h-4 w-4 shrink-0 text-lime-300" />
            {action}
          </p>
        ))}
      </div>
    </section>
  );
}

function CredentialProviderCard({ provider, compact = false }: { provider: CredentialActivationProvider; compact?: boolean }) {
  return (
    <div className="rounded-xl border border-white/5 bg-[#111113] p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <p className="font-black text-white">{provider.label}</p>
        <StatusBadge status={provider.status} />
      </div>
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{provider.provider}</p>
      <p className={`mt-2 text-sm leading-6 text-gray-400 ${compact ? "line-clamp-3" : ""}`}>{provider.detail}</p>
      <p className="mt-3 break-words text-[11px] font-black leading-4 text-lime-100">{provider.proof}</p>
      {provider.missing_settings.length ? (
        <p className="mt-2 break-words text-xs font-semibold leading-5 text-yellow-100/80">
          Missing: {provider.missing_settings.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function LiveEnvironmentExecutionCommand({ report }: { report: LiveEnvironmentReport }) {
  const phaseTestId = (key: string) => `${key.replace(/_/g, "-")}-phase`;
  const blockers = report.blockers.slice(0, 6);

  return (
    <section
      data-testid="live-environment-execution-command"
      className="mb-8 rounded-xl border border-fuchsia-500/20 bg-[#150f18] p-6"
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-fuchsia-300">Live Environment</p>
          <h2 className="mt-2 text-2xl font-black">Live Environment Execution Command</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
            Credential cutover, managed database migration, secret sync, restore rehearsal, public-host smoke and go/no-go evidence.
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
        <DataQualityMetric icon={RouteIcon} label="Phases" value={`${report.summary.phases_ready}/${report.summary.phases_total}`} />
        <DataQualityMetric icon={ListChecks} label="Actions" value={`${report.summary.actions_total}`} />
        <DataQualityMetric icon={FileText} label="Evidence" value={`${report.summary.evidence_total}`} />
        <DataQualityMetric icon={AlertTriangle} label="Blockers" value={`${report.summary.live_blockers}`} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-5">
        {report.phases.map((phase) => {
          const PhaseIcon =
            phase.key === "credential_cutover"
              ? KeyRound
              : phase.key === "database_migration"
                ? Database
                : phase.key === "secret_sync"
                  ? ShieldCheck
                  : phase.key === "restore_rehearsal"
                    ? HardDrive
                    : Rocket;

          return (
            <div key={phase.key} data-testid={phaseTestId(phase.key)} className="rounded-xl border border-white/5 bg-black/25 p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fuchsia-500/10 text-fuchsia-300">
                  <PhaseIcon className="h-5 w-5" />
                </div>
                <StatusBadge status={phase.status} />
              </div>
              <p className="text-lg font-black text-white">{phase.title}</p>
              <p className="mt-1 text-xs font-black uppercase tracking-widest text-fuchsia-100/70">{phase.owner}</p>
              <p className="mt-3 text-sm leading-6 text-gray-500">{phase.goal}</p>
              <div className="mt-4 space-y-3">
                {phase.steps.slice(0, 3).map((step) => (
                  <LiveEnvironmentStepCard key={`${phase.key}-${step.key}`} step={step} compact />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div data-testid="cutover-window-plan" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-7">
          <div className="mb-4 flex items-center gap-2">
            <Rocket className="h-5 w-5 text-fuchsia-300" />
            <h3 className="font-black">Cutover Window Plan</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {report.cutover_windows.map((window) => (
              <div key={window.key} className="rounded-xl border border-white/5 bg-[#111113] p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <p className="font-black text-white">{window.title}</p>
                  <StatusBadge status={window.status} />
                </div>
                <p className="text-[11px] font-black uppercase tracking-widest text-fuchsia-100">{window.window}</p>
                <p className="mt-2 text-sm leading-6 text-gray-400">{window.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div data-testid="go-no-go-checkpoint" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-5">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-fuchsia-300" />
            <h3 className="font-black">Go/No-Go Checkpoint</h3>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <SummaryPill label="Launch" value={`${report.summary.production_launch_score}%`} />
            <SummaryPill label="Env" value={report.summary.required_env} />
          </div>
          <div className={`rounded-xl border border-white/5 p-4 ${releaseDecisionClass(report.go_no_go.status)}`}>
            <p className="text-sm font-black uppercase tracking-widest">{report.go_no_go.title}</p>
            <p className="mt-2 text-sm font-semibold leading-6">{report.go_no_go.detail}</p>
          </div>
          <div className="mt-4 space-y-2">
            {report.go_no_go.required_signoffs.map((signoff) => (
              <p key={signoff} className="rounded-lg bg-white/5 px-3 py-2 text-sm font-bold leading-6 text-gray-200">
                {signoff}
              </p>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div data-testid="live-environment-evidence" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-7">
          <div className="mb-4 flex items-center gap-2">
            <FileText className="h-5 w-5 text-fuchsia-300" />
            <h3 className="font-black">Execution Evidence</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {report.evidence.map((item) => (
              <div key={item.key} className="rounded-xl border border-white/5 bg-[#111113] p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <p className="font-black text-white">{item.label}</p>
                  <StatusBadge status={item.status} />
                </div>
                <p className="break-words text-[11px] font-black leading-4 text-fuchsia-100">{item.proof}</p>
                <p className="mt-2 break-words text-xs font-bold leading-5 text-gray-500">{item.artifact}</p>
                <p className="mt-2 text-sm leading-6 text-gray-400">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div data-testid="live-environment-blockers" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-5">
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-fuchsia-300" />
            <h3 className="font-black">Live Blockers</h3>
          </div>
          <div className="space-y-3">
            {blockers.map((blocker) => (
              <ReadinessStep key={blocker.key} step={blocker} />
            ))}
            {!blockers.length ? (
              <div className="rounded-xl border border-green-500/10 bg-green-500/5 p-4 text-sm font-semibold text-green-100">
                No live environment blockers are currently reported.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div
        data-testid="live-environment-next-actions"
        className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-fuchsia-500/10 bg-fuchsia-500/5 p-4 md:grid-cols-2"
      >
        {report.next_actions.map((action) => (
          <p key={action} className="flex items-start gap-3 text-sm font-semibold leading-6 text-fuchsia-50/90">
            <ListChecks className="mt-1 h-4 w-4 shrink-0 text-fuchsia-300" />
            {action}
          </p>
        ))}
      </div>
    </section>
  );
}

function LiveEnvironmentStepCard({ step, compact = false }: { step: LiveEnvironmentStep; compact?: boolean }) {
  return (
    <div className="rounded-xl border border-white/5 bg-[#111113] p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <p className="font-black text-white">{step.label}</p>
        <StatusBadge status={step.status} />
      </div>
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{step.owner}</p>
      <p className={`mt-2 text-sm leading-6 text-gray-400 ${compact ? "line-clamp-3" : ""}`}>{step.detail}</p>
      <p className="mt-3 break-words text-[11px] font-black leading-4 text-fuchsia-100">{step.command}</p>
      <p className="mt-2 break-words text-xs font-bold leading-5 text-gray-500">{step.proof}</p>
    </div>
  );
}

function ProductionLaunchIntegrationsCommand({ report }: { report: ProductionLaunchReport }) {
  const blockers = report.blockers.slice(0, 6);
  const laneTestId = (key: string) => `${key.replace(/_/g, "-")}-lane`;

  return (
    <section
      data-testid="production-launch-integrations-command"
      className="mb-8 rounded-xl border border-rose-500/20 bg-[#151013] p-6"
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-rose-300">Production Launch</p>
          <h2 className="mt-2 text-2xl font-black">Production Launch Integrations Command</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
            Live credentials, managed database, backup/restore rehearsal, deployment secrets and production smoke.
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
        <DataQualityMetric icon={RouteIcon} label="Lanes" value={`${report.summary.lanes_ready}/${report.summary.lanes_total}`} />
        <DataQualityMetric icon={KeyRound} label="Live Creds" value={report.summary.live_credentials_ready} />
        <DataQualityMetric icon={ShieldCheck} label="Required Env" value={report.summary.required_env} />
        <DataQualityMetric icon={AlertTriangle} label="Blockers" value={`${report.summary.production_blockers}`} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-5">
        {report.lanes.map((lane) => {
          const LaneIcon =
            lane.key === "live_credentials"
              ? KeyRound
              : lane.key === "managed_database"
                ? Database
                : lane.key === "backup_restore"
                  ? HardDrive
                  : lane.key === "deployment_secrets"
                    ? ShieldCheck
                    : Rocket;

          return (
            <div key={lane.key} data-testid={laneTestId(lane.key)} className="rounded-xl border border-white/5 bg-black/25 p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-300">
                  <LaneIcon className="h-5 w-5" />
                </div>
                <StatusBadge status={lane.status} />
              </div>
              <p className="text-lg font-black text-white">{lane.title}</p>
              <p className="mt-1 text-xs font-black uppercase tracking-widest text-rose-100/70">{lane.owner}</p>
              <p className="mt-3 text-sm leading-6 text-gray-500">{lane.detail}</p>
              <div className="mt-4 space-y-3">
                {lane.steps.slice(0, 3).map((step) => (
                  <ProductionLaunchStepCard key={`${lane.key}-${step.key}`} step={step} compact />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div data-testid="production-launch-execution-plan" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-7">
          <div className="mb-4 flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-rose-300" />
            <h3 className="font-black">Execution Plan</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {report.execution_plan.map((step) => (
              <ProductionLaunchStepCard key={step.key} step={step} />
            ))}
          </div>
        </div>

        <div data-testid="production-launch-blockers" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-5">
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-rose-300" />
            <h3 className="font-black">Launch Blockers</h3>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <SummaryPill label="Ops" value={`${report.summary.readiness_score}%`} />
            <SummaryPill label="Beta" value={`${report.summary.beta_score}%`} />
          </div>
          <div className="space-y-3">
            {blockers.map((blocker) => (
              <ReadinessStep key={blocker.key} step={blocker} />
            ))}
            {!blockers.length ? (
              <div className="rounded-xl border border-green-500/10 bg-green-500/5 p-4 text-sm font-semibold text-green-100">
                No launch blockers are currently reported.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div
        data-testid="production-launch-next-actions"
        className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-rose-500/10 bg-rose-500/5 p-4 md:grid-cols-2"
      >
        {report.next_actions.map((action) => (
          <p key={action} className="flex items-start gap-3 text-sm font-semibold leading-6 text-rose-50/90">
            <ListChecks className="mt-1 h-4 w-4 shrink-0 text-rose-300" />
            {action}
          </p>
        ))}
      </div>
    </section>
  );
}

function ProductionLaunchStepCard({ step, compact = false }: { step: ProductionLaunchStep; compact?: boolean }) {
  return (
    <div className="rounded-xl border border-white/5 bg-[#111113] p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <p className="font-black text-white">{step.label}</p>
        <StatusBadge status={step.status} />
      </div>
      {step.owner ? <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-gray-500">{step.owner}</p> : null}
      <p className={`text-sm leading-6 text-gray-400 ${compact ? "line-clamp-3" : ""}`}>{step.detail}</p>
      {step.proof ? <p className="mt-3 break-words text-[11px] font-black leading-4 text-rose-100">{step.proof}</p> : null}
      {step.missing_settings?.length ? (
        <p className="mt-2 break-words text-xs font-semibold leading-5 text-yellow-100/80">
          Missing: {step.missing_settings.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function LiveDeploymentProofCommand({
  command,
  isRunning,
  onRun,
}: {
  command: LiveDeploymentCommand;
  isRunning: boolean;
  onRun: () => void;
}) {
  const checks = command.checks || [];
  return (
    <section
      data-testid="live-deployment-proof-command"
      className="mb-8 rounded-xl border border-emerald-500/20 bg-[#0f1512] p-6"
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">Live Deployment Proof</p>
          <h2 className="mt-2 text-2xl font-black">{command.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">{command.detail}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={command.status} />
          <button
            data-testid="live-deployment-proof-panel-run"
            onClick={onRun}
            disabled={isRunning}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2 text-sm font-black text-black hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Rocket className={`h-4 w-4 ${isRunning ? "animate-pulse" : ""}`} />
            {isRunning ? "Checking" : "Run Proof"}
          </button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryPill label="Score" value={`${command.score}%`} />
        <SummaryPill label="Checks" value={`${checks.filter((check) => check.status === "pass").length}/${checks.length}`} />
        <SummaryPill label="Target" value="live site" />
        <SummaryPill
          label="Last Proof"
          value={command.last_checked_at ? new Date(command.last_checked_at).toLocaleDateString() : "none"}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-4">
        {checks.map((check) => (
          <div key={check.key} className="rounded-xl border border-white/5 bg-black/25 p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="font-black text-white">{check.label}</p>
              <StatusBadge status={check.status} />
            </div>
            <p className="min-h-[72px] text-sm leading-6 text-gray-400">{check.detail}</p>
            {check.url ? (
              <p className="mt-3 break-words text-[11px] font-black leading-4 text-emerald-100">{check.url}</p>
            ) : null}
            {check.evidence ? (
              <div className="mt-4 grid grid-cols-1 gap-2">
                {Object.entries(check.evidence)
                  .filter(([, value]) => value !== undefined && value !== null && value !== "")
                  .slice(0, 4)
                  .map(([label, value]) => (
                    <div key={`${check.key}-${label}`} className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                        {label.replaceAll("_", " ")}
                      </span>
                      <span className="max-w-[9rem] truncate text-xs font-black text-white">{String(value)}</span>
                    </div>
                  ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-4 md:grid-cols-2">
        {command.next_actions.map((action) => (
          <p key={action} className="flex items-start gap-3 text-sm font-semibold leading-6 text-emerald-50/90">
            <ListChecks className="mt-1 h-4 w-4 shrink-0 text-emerald-300" />
            {action}
          </p>
        ))}
      </div>
    </section>
  );
}

function BetaDeliveryCheckpointCommand({ report }: { report: BetaDeliveryReport }) {
  return (
    <section
      data-testid="beta-delivery-checkpoint-command"
      className="mb-8 rounded-xl border border-amber-500/20 bg-[#15120c] p-6"
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">Beta Delivery Checkpoint</p>
          <h2 className="mt-2 text-2xl font-black">Beta Delivery Checkpoint Command</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
            Final build, smoke/core proofs, known gaps and next production plan for the June 20 checkpoint.
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
        <DataQualityMetric icon={FileText} label="Proofs" value={`${report.summary.proofs_total}`} />
        <DataQualityMetric icon={CheckCircle2} label="Ready Proofs" value={`${report.summary.proofs_ready}`} />
        <DataQualityMetric icon={AlertTriangle} label="Known Gaps" value={`${report.summary.known_gaps}`} />
        <DataQualityMetric icon={Rocket} label="Prod Steps" value={`${report.summary.production_steps}`} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div data-testid="beta-proof-queue" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-7">
          <div className="mb-4 flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-amber-300" />
            <h3 className="font-black">Final Build and Smoke Proof Queue</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {report.proof_queue.map((proof) => (
              <div key={proof.key} className="rounded-xl border border-white/5 bg-[#111113] p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <p className="font-black text-white">{proof.label}</p>
                  <StatusBadge status={proof.status} />
                </div>
                <p className="break-words text-[11px] font-black leading-4 text-amber-100">{proof.proof}</p>
                <p className="mt-2 text-sm leading-6 text-gray-500">{proof.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div data-testid="known-gap-documentation" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-5">
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-300" />
            <h3 className="font-black">Known Gap Documentation</h3>
          </div>
          <div className="space-y-3">
            {report.known_gaps.map((gap) => (
              <ReadinessStep key={gap.key} step={gap} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div data-testid="next-production-plan" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-7">
          <div className="mb-4 flex items-center gap-2">
            <Rocket className="h-5 w-5 text-amber-300" />
            <h3 className="font-black">Next Production Plan</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {report.production_plan.map((step) => (
              <ReadinessStep key={step.key} step={step} />
            ))}
          </div>
        </div>

        <div data-testid="beta-handoff-decision" className="rounded-xl border border-white/5 bg-black/25 p-5 xl:col-span-5">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-amber-300" />
            <h3 className="font-black">Checkpoint Handoff</h3>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <SummaryPill label="Final" value={`${report.summary.final_acceptance_score}%`} />
            <SummaryPill label="Ready" value={`${report.summary.readiness_score}%`} />
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
            <p className="text-sm font-black uppercase tracking-widest text-amber-200">{report.handoff.title}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-amber-50/80">{report.handoff.detail}</p>
          </div>
        </div>
      </div>

      <div
        data-testid="beta-delivery-next-actions"
        className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-amber-500/10 bg-amber-500/5 p-4 md:grid-cols-2"
      >
        {report.next_actions.map((action) => (
          <p key={action} className="flex items-start gap-3 text-sm font-semibold leading-6 text-amber-50/90">
            <ListChecks className="mt-1 h-4 w-4 shrink-0 text-amber-300" />
            {action}
          </p>
        ))}
      </div>
    </section>
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
          <CustomerCsvDryRunValidator />
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

function ReadinessSummaryPanel({ summary }: { summary: ReadinessSummary }) {
  const externalGates = summary.external_gates || [];
  return (
    <section data-testid="readiness-summary" className="mb-8 rounded-xl border border-orange-500/15 bg-[#14110d] p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-300">Live Readiness Summary</p>
          <h2 className="mt-2 text-2xl font-black">Built, Verified And Still External</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">
            One compact owner view of the current production score, restaurant-ready audit, and the gates that still
            require real provider or backup evidence.
          </p>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(summary.overall === "ready" ? "pass" : summary.overall === "blocked" ? "fail" : "warn")}`}>
          {summary.overall === "ready" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          {summary.overall}
        </span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <SummaryPill label="Go-Live" value={`${summary.go_live_score}%`} />
        <SummaryPill label="Built" value={`${summary.implementation_score}%`} />
        <SummaryPill label="Restaurant" value={`${summary.restaurant_ready_score}%`} />
        <SummaryPill label="Modules" value={`${summary.modules.ready}/${summary.modules.total}`} />
        <SummaryPill label="Reqs" value={`${summary.requirements.ready}/${summary.requirements.total}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-white/5 bg-black/25 p-5">
          <div className="mb-3 flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-orange-300" />
            <h3 className="font-black text-orange-50">Remaining External Gates</h3>
          </div>
          <div data-testid="readiness-external-gates" className="space-y-3">
            {externalGates.map((gate) => (
              <div key={gate.key} className="rounded-lg border border-white/5 bg-black/30 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-black text-white">{gate.label}</p>
                  <StatusBadge status={gate.status} />
                </div>
                <p className="text-sm leading-6 text-gray-400">{gate.detail}</p>
                <p className="mt-2 text-xs font-bold text-orange-100/80">{gate.next_action}</p>
              </div>
            ))}
            {!externalGates.length && (
              <p className="rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-sm font-bold text-green-100">
                No external gates are currently reported by the readiness API.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/5 bg-black/25 p-5">
          <div className="mb-3 flex items-center gap-2">
            <RouteIcon className="h-5 w-5 text-orange-300" />
            <h3 className="font-black text-orange-50">Next Actions</h3>
          </div>
          <div className="space-y-2">
            {(summary.next_actions || []).map((action) => (
              <p key={action} className="rounded-lg bg-black/30 px-3 py-2 text-sm font-bold leading-6 text-orange-50">
                {action}
              </p>
            ))}
            {!summary.next_actions?.length && (
              <p className="rounded-lg bg-black/30 px-3 py-2 text-sm font-bold leading-6 text-orange-50">
                Keep proof checks current after each production deploy.
              </p>
            )}
          </div>
        </div>
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

function CustomerCsvDryRunValidator() {
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<CustomerCsvDryRunResult | null>(null);

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setResult(null);
    setMessage("");
    if (!file) {
      setFileName("");
      setCsvText("");
      return;
    }
    setFileName(file.name);
    try {
      setCsvText(await file.text());
    } catch {
      setCsvText("");
      setMessage("CSV file could not be read.");
    }
  };

  const validatePreview = async () => {
    if (!csvText.trim()) return;
    setIsValidating(true);
    setMessage("");
    setResult(null);
    try {
      const response = await fetchWithAuth(CUSTOMER_CSV_VALIDATE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv_text: csvText }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.detail || "Customer CSV could not be validated.");
        return;
      }
      setResult(data);
    } catch {
      setMessage("Customer CSV validation API is unavailable.");
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div data-testid="customer-csv-dry-run-validator" className="mt-5 border-t border-white/10 pt-5">
      <div className="mb-3 flex items-start gap-3">
        <Upload className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
        <div>
          <p className="text-sm font-black text-white">Validate customer CSV</p>
          <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">
            Preview rows, duplicate phones and existing matches. Validation never writes customer records.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor="customer-csv-file"
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-black text-gray-200 hover:bg-white/10"
        >
          <FileText className="h-3.5 w-3.5" />
          Choose CSV
        </label>
        <input
          id="customer-csv-file"
          data-testid="customer-csv-file"
          className="hidden"
          type="file"
          accept=".csv,text/csv"
          onChange={chooseFile}
        />
        <button
          data-testid="customer-csv-validate"
          type="button"
          disabled={!csvText.trim() || isValidating}
          onClick={validatePreview}
          className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-black text-black disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-gray-600"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          {isValidating ? "Validating..." : "Validate preview"}
        </button>
      </div>
      {fileName ? <p className="mt-2 break-all text-xs font-semibold text-gray-500">{fileName}</p> : null}
      {message ? <p className="mt-3 text-xs font-bold text-amber-300">{message}</p> : null}
      {result ? (
        <div data-testid="customer-csv-dry-run-result" className="mt-4 bg-cyan-500/5 p-3">
          <p className="text-xs font-black uppercase text-cyan-200">
            {result.ready_for_review ? "Ready for review" : "Review required"} · No records written
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold text-gray-300">
            <p>{result.summary.rows_valid} valid row(s)</p>
            <p>{result.summary.rows_invalid} invalid row(s)</p>
            <p>{result.summary.duplicate_phone_groups} duplicate group(s)</p>
            <p>{result.summary.existing_customer_matches} existing match(es)</p>
          </div>
          <p className="mt-3 text-xs leading-5 text-gray-500">{result.rollback_plan}</p>
        </div>
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

function RestoreRehearsalCommandPanel({ command }: { command: RestoreRehearsalCommand }) {
  return (
    <section
      data-testid="restore-rehearsal-proof-command"
      className="mb-8 rounded-xl border border-cyan-500/20 bg-[#101417] p-6"
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">Backup / Restore Proof</p>
          <h2 className="mt-2 text-2xl font-black">Restore Rehearsal Command</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">{command.detail}</p>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(command.status)}`}>
          <HardDrive className="h-3.5 w-3.5" />
          {command.status}
        </span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryPill label="Backup" value={command.summary.backup_status} />
        <SummaryPill label="Restore" value={command.summary.restore_status} />
        <SummaryPill label="Evidence" value={`${command.summary.requirements_ready}/${command.summary.requirements_total}`} />
        <SummaryPill label="Retention" value={`${command.summary.retention_days}d`} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-5">
        {command.evidence_requirements.map((step) => (
          <ReadinessStep key={step.key} step={step} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-white/5 bg-black/25 p-5">
          <div className="mb-3 flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-cyan-300" />
            <h3 className="font-black text-cyan-50">Proof Notes Template</h3>
          </div>
          <p className="mb-3 text-xs font-bold leading-5 text-gray-500">
            Use proof type <span className="font-mono text-cyan-100">{command.recorder.proof_type}</span> in Backup History.
            Reference hint: <span className="font-mono text-cyan-100">{command.recorder.reference_hint}</span>.
          </p>
          <div className="space-y-2">
            {command.recorder.notes_template.map((line) => (
              <p key={line} className="rounded-lg bg-white/5 px-3 py-2 text-sm font-bold leading-6 text-gray-300">
                {line}
              </p>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/5 bg-black/25 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Database className="h-5 w-5 text-cyan-300" />
            <h3 className="font-black text-cyan-50">Latest Restore Proof</h3>
          </div>
          {command.last_proof ? (
            <div className="space-y-3 text-sm font-semibold text-gray-300">
              <Detail label="Reference" value={command.last_proof.file_path || "No reference"} />
              <Detail label="Recorded" value={command.last_proof.created_at ? new Date(command.last_proof.created_at).toLocaleString() : "No time"} />
              <Detail label="Backend" value={command.last_proof.database_backend || "unknown"} />
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-white/10 p-5 text-sm font-bold leading-6 text-gray-500">
              No restore rehearsal proof is recorded. Run a clean database restore and record the evidence in Backup History.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function RestaurantReadyAuditPanel({ audit }: { audit: RestaurantReadyAudit }) {
  return (
    <section data-testid="restaurant-ready-audit" className="mb-8 rounded-xl border border-emerald-500/10 bg-[#101412] p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">Restaurant Ready Audit</p>
          <h2 className="mt-2 text-2xl font-black">100% Restaurant Readiness Tracker</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
            Owner, counter, kitchen, delivery, staff, payments, marketing and production readiness in one view.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-center md:grid-cols-4">
          <SummaryPill label="Score" value={`${audit.score}%`} />
          <SummaryPill label="Ready" value={`${audit.summary.requirements_ready}`} />
          <SummaryPill label="Attention" value={`${audit.summary.requirements_attention}`} />
          <SummaryPill label="Blocked" value={`${audit.summary.requirements_blocked}`} />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-5">
        {audit.requirements.map((requirement) => (
          <div
            key={requirement.key}
            data-testid={`restaurant-ready-${requirement.key}`}
            className="flex min-h-[240px] flex-col rounded-xl border border-white/5 bg-black/25 p-4"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">
                <ListChecks className="h-5 w-5" />
              </div>
              <StatusBadge status={requirement.status} />
            </div>
            <p className="text-base font-black leading-6 text-white">{requirement.label}</p>
            <p className="mt-3 text-sm leading-6 text-gray-500">{requirement.evidence}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-white/5 bg-[#111113] p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Score</p>
                <p className="mt-1 text-xl font-black text-emerald-300">{requirement.score}%</p>
              </div>
              <div className="rounded-lg border border-white/5 bg-[#111113] p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Route</p>
                <p className="mt-1 truncate text-sm font-black text-gray-200">{requirement.route}</p>
              </div>
            </div>
            <p className="mt-auto pt-4 text-sm font-bold leading-6 text-gray-300">{requirement.next_action}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-300" />
            <h3 className="font-black text-emerald-100">Next Restaurant Readiness Actions</h3>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${statusClass(audit.status)}`}>
            {audit.summary.target}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {(audit.next_actions || []).map((action) => (
            <p key={action} className="rounded-lg bg-black/25 px-3 py-2 text-sm font-bold text-emerald-50">
              {action}
            </p>
          ))}
          {!audit.next_actions?.length && (
            <p className="rounded-lg bg-black/25 px-3 py-2 text-sm font-bold text-emerald-50">
              All tracked restaurant readiness items are green.
            </p>
          )}
        </div>
      </div>
    </section>
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
