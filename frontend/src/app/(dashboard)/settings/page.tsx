"use client";
export const dynamic = "force-dynamic";
import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  Clock,
  CircleDollarSign,
  Globe2,
  Layers,
  LockKeyhole,
  MapPin,
  Plus,
  RefreshCw,
  Route,
  Save,
  Shield,
  Trash2,
  Truck,
  UserCheck,
  Users,
} from 'lucide-react';
import { getApiUrl } from '@/lib/api';

const DELIVERY_ZONES_API = getApiUrl('/api/v1/restaurant/delivery/zones');
const DELIVERY_QUOTE_API = getApiUrl('/api/v1/restaurant/delivery/quote');
const DELIVERY_ECONOMICS_API = getApiUrl('/api/v1/restaurant/delivery/economics');
const PAYMENT_READINESS_API = getApiUrl('/api/v1/restaurant/ops/readiness');
const PAYMENT_PRODUCTION_API = getApiUrl('/api/v1/restaurant/orders/payments/production-readiness');
const PAYMENT_GATEWAY_ACTIVATION_API = getApiUrl('/api/v1/restaurant/orders/payments/gateway-activation');
const PAYMENT_RECONCILIATION_API = getApiUrl('/api/v1/restaurant/orders/payments/reconciliation');
const MANUAL_PAYMENT_WEBHOOK_API = getApiUrl('/api/v1/restaurant/orders/payments/webhook/manual');
const SHEETS_IMPORT_API = getApiUrl('/api/v1/restaurant/import/sheets');
const STAFF_CREDENTIAL_API = getApiUrl('/api/v1/auth/staff/credential');

type RoleAccess = {
  role: string;
  access: string;
  entry: string;
  protection: string;
};

type SessionStatus = {
  name: string;
  cookie: string;
  duration: string;
  protectedRoutes: number;
  status: string;
};

type HardeningCheck = {
  name: string;
  status: string;
  detail: string;
};

type SecurityControl = {
  name: string;
  status: string;
  detail: string;
  proof?: string;
};

type SecuritySummary = {
  launchStatus: string;
  launchTone: string;
  adminConfigured: boolean;
  staffConfigured: boolean;
  sessionSecretConfigured: boolean;
  hardeningReadyCount: number;
  hardeningTotalCount: number;
  adminRouteCount: number;
  staffRouteCount: number;
  customerRouteCount: number;
  publicRouteCount: number;
  roleCount: number;
};

type RouteMatrixEntry = {
  area: string;
  routeGroup: string;
  publicAccess: string;
  customerAccess: string;
  staffAccess: string;
  adminAccess: string;
};

type SecurityOverview = {
  summary: SecuritySummary;
  routeMatrix: RouteMatrixEntry[];
  roles: RoleAccess[];
  sessions: SessionStatus[];
  gateChecks: SecurityControl[];
  recoveryControls: SecurityControl[];
  auditControls: SecurityControl[];
  hardening: HardeningCheck[];
};

type StaffCredentialStatus = {
  configured: boolean;
  source: string;
  staff_id?: string | null;
  display_name?: string | null;
  is_active: boolean;
  must_rotate: boolean;
  updated_at?: string | null;
  last_login_at?: string | null;
  password_policy: string;
  next_action: string;
};

type StaffCredentialDraft = {
  id: string;
  display_name: string;
  password: string;
  is_active: boolean;
};

type DeliveryZone = {
  id: number;
  name: string;
  keywords: string[];
  delivery_fee: number;
  minimum_order_amount: number;
  eta_min_minutes: number;
  eta_max_minutes: number;
  eta_window: string;
  pricing_rule?: string;
  is_active: boolean;
};

type DeliveryZoneDraft = {
  name: string;
  keywords: string;
  delivery_fee: number;
  minimum_order_amount: number;
  eta_min_minutes: number;
  eta_max_minutes: number;
  is_active: boolean;
};

type DeliveryQuote = {
  is_deliverable: boolean;
  reason?: string | null;
  address: string;
  zone?: DeliveryZone | null;
  delivery_fee: number;
  eta_window?: string | null;
  address_validation?: {
    quality: string;
    score: number;
    matched_keyword?: string | null;
    warnings: string[];
    requires_review: boolean;
  };
  charge_breakdown?: {
    subtotal: number;
    minimum_order_amount: number;
    minimum_gap?: number;
    delivery_fee: number;
    total_with_delivery: number;
  };
};

type DeliveryEconomics = {
  generated_at: string;
  summary: {
    active_zone_count: number;
    inactive_zone_count: number;
    lowest_fee: number;
    highest_fee: number;
    average_fee: number;
    longest_eta_minutes: number;
    minimum_order_zone_count: number;
    coverage_keyword_count: number;
    open_delivery_count: number;
    open_delivery_value: number;
    unassigned_count: number;
    payment_due_count: number;
  };
  zones: DeliveryZone[];
  queue_preview: {
    id: number;
    customer_name?: string | null;
    delivery_zone?: string | null;
    delivery_fee?: string | null;
    eta_window?: string | null;
    total_amount: number;
    payment_status: string;
    assignment_status: string;
    assigned_to?: string | null;
  }[];
  next_actions: string[];
};

type PaymentProviderStatus = {
  provider: string;
  currency: string;
  environment: string;
  return_url?: string | null;
  checkout_configured: boolean;
  webhook_configured: boolean;
  missing_checkout_settings: string[];
  missing_webhook_settings: string[];
  session_endpoint: string;
  webhook_endpoint: string;
  mode: string;
};

type PaymentWebhookContract = {
  provider: string;
  endpoint: string;
  signature: string;
  required_fields: string[];
  paid_statuses: string[];
  notes: string;
};

type PaymentReadiness = {
  payment: PaymentProviderStatus;
  payment_providers?: PaymentProviderStatus[];
  payment_webhook_contracts?: PaymentWebhookContract[];
  readiness_score?: number;
  overall?: string;
};

type PaymentQueueOrder = {
  id: number;
  customer_name?: string | null;
  customer_phone?: string | null;
  order_type?: string | null;
  fulfillment_type?: string | null;
  source?: string | null;
  total_amount: number;
  payment_status?: string | null;
  payment_method?: string | null;
  payment_provider?: string | null;
  payment_session_id?: string | null;
  payment_reference?: string | null;
  payment_confirmed_at?: string | null;
  created_at?: string | null;
};

type PaymentProductionReadiness = {
  generated_at: string;
  active_provider: PaymentProviderStatus;
  providers: PaymentProviderStatus[];
  summary: {
    gateway_ready: boolean;
    live_gateway_ready: boolean;
    settlement_clear: boolean;
    awaiting_settlement_count: number;
    awaiting_settlement_total: number;
    paid_today_count: number;
    paid_today_total: number;
    provider_ready_count: number;
    webhook_ready_count: number;
    production_status: string;
  };
  queues: {
    awaiting_settlement: PaymentQueueOrder[];
    recent_paid: PaymentQueueOrder[];
  };
  next_actions: string[];
};

type PaymentAuditEvent = {
  id: number;
  order_id: number;
  provider: string;
  event_type: string;
  payment_status: string;
  action: string;
  provider_order_id?: string | null;
  provider_payment_id?: string | null;
  paid_amount?: number | null;
  duplicate_count: number;
  received_at?: string | null;
  last_seen_at?: string | null;
};

type PaymentReconciliation = {
  generated_at: string;
  summary: {
    events_today_count: number;
    processed_today_count: number;
    already_paid_today_count: number;
    ignored_today_count: number;
    duplicate_delivery_count: number;
    recent_event_count: number;
  };
  provider_breakdown: {
    provider: string;
    count: number;
  }[];
  recent_events: PaymentAuditEvent[];
  controls: {
    name: string;
    status: string;
    detail: string;
  }[];
};

type PaymentGatewayActivationStep = {
  name: string;
  status: string;
  detail: string;
};

type PaymentGatewayActivationProvider = {
  provider: string;
  label: string;
  environment: string;
  dashboard: string;
  activation_status: string;
  next_action: string;
  missing_settings: string[];
  checkout_configured: boolean;
  webhook_configured: boolean;
  session_endpoint: string;
  webhook_endpoint: string;
  session_count: number;
  webhook_event_count: number;
  latest_session?: {
    order_id: number;
    provider?: string | null;
    session_id?: string | null;
    checkout_url_present: boolean;
    payment_status?: string | null;
    total_amount: number;
    created_at?: string | null;
  } | null;
  latest_webhook_event?: PaymentAuditEvent | null;
  blockers: string[];
  steps: PaymentGatewayActivationStep[];
};

type PaymentGatewayActivation = {
  generated_at: string;
  summary: {
    overall_status: string;
    active_provider: string;
    active_provider_status: string;
    live_ready_provider_count: number;
    proof_needed_provider_count: number;
    blocked_provider_count: number;
    selectable_live_providers: string[];
    next_action: string;
  };
  providers: PaymentGatewayActivationProvider[];
  controls: {
    name: string;
    status: string;
    detail: string;
  }[];
};

type PaymentWebhookResult = {
  status: string;
  event: string;
  audit?: PaymentAuditEvent;
  order?: {
    id: number;
    payment_status: string;
    payment_provider?: string | null;
    payment_reference?: string | null;
    total_amount?: number;
  };
};

type SheetSyncResult = {
  rows_found: number;
  rows_imported: number;
  rows_created: number;
  rows_updated: number;
  rows_skipped: number;
  months_processed: number;
  date_start?: string | null;
  date_end?: string | null;
  source?: string;
  skip_reasons?: string[];
};

const formatMoney = (value?: number | null) =>
  `Rs ${Math.round(Number(value || 0)).toLocaleString("en-IN")}`;

const paymentEventActionClass = (action?: string) => {
  if (action === "processed") return "bg-green-100 text-green-700";
  if (action === "already_paid") return "bg-blue-100 text-blue-700";
  if (action === "ignored") return "bg-amber-100 text-amber-700";
  return "bg-gray-100 text-gray-700";
};

const gatewayActivationStatusClass = (status?: string) => {
  if (status === "live_ready") return "bg-green-100 text-green-700";
  if (status === "proof_needed") return "bg-blue-100 text-blue-700";
  if (status === "fallback_ready") return "bg-emerald-100 text-emerald-700";
  return "bg-amber-100 text-amber-700";
};

const paymentStepStatusClass = (status?: string) => {
  if (status === "complete") return "bg-green-100 text-green-700";
  if (status === "pending") return "bg-blue-100 text-blue-700";
  return "bg-amber-100 text-amber-700";
};

const formatTimestamp = (value?: string | null) => {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

async function fetchPaymentJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

const emptyDeliveryZoneDraft: DeliveryZoneDraft = {
  name: "",
  keywords: "",
  delivery_fee: 49,
  minimum_order_amount: 0,
  eta_min_minutes: 35,
  eta_max_minutes: 50,
  is_active: true,
};

const emptyStaffCredentialDraft: StaffCredentialDraft = {
  id: "counter",
  display_name: "Counter Staff",
  password: "",
  is_active: true,
};

export default function Settings() {
  const [securityOverview, setSecurityOverview] = useState<SecurityOverview | null>(null);
  const [isSecurityLoading, setIsSecurityLoading] = useState(true);
  const [staffCredential, setStaffCredential] = useState<StaffCredentialStatus | null>(null);
  const [staffCredentialDraft, setStaffCredentialDraft] =
    useState<StaffCredentialDraft>(emptyStaffCredentialDraft);
  const [isStaffCredentialLoading, setIsStaffCredentialLoading] = useState(true);
  const [isSavingStaffCredential, setIsSavingStaffCredential] = useState(false);
  const [staffCredentialMessage, setStaffCredentialMessage] = useState("");
  const [paymentReadiness, setPaymentReadiness] = useState<PaymentReadiness | null>(null);
  const [paymentProduction, setPaymentProduction] = useState<PaymentProductionReadiness | null>(null);
  const [paymentGatewayActivation, setPaymentGatewayActivation] =
    useState<PaymentGatewayActivation | null>(null);
  const [paymentReconciliation, setPaymentReconciliation] = useState<PaymentReconciliation | null>(null);
  const [isPaymentLoading, setIsPaymentLoading] = useState(true);
  const [paymentMessage, setPaymentMessage] = useState("");
  const [webhookOrderId, setWebhookOrderId] = useState("");
  const [webhookReference, setWebhookReference] = useState("");
  const [webhookResult, setWebhookResult] = useState<PaymentWebhookResult | null>(null);
  const [isSendingWebhook, setIsSendingWebhook] = useState(false);
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
  const [deliveryEconomics, setDeliveryEconomics] = useState<DeliveryEconomics | null>(null);
  const [deliveryDrafts, setDeliveryDrafts] = useState<Record<number, DeliveryZone>>({});
  const [isDeliveryLoading, setIsDeliveryLoading] = useState(true);
  const [savingZoneId, setSavingZoneId] = useState<number | null>(null);
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const [newDeliveryZone, setNewDeliveryZone] = useState<DeliveryZoneDraft>(emptyDeliveryZoneDraft);
  const [isCreatingDeliveryZone, setIsCreatingDeliveryZone] = useState(false);
  const [archivingZoneId, setArchivingZoneId] = useState<number | null>(null);
  const [quoteAddress, setQuoteAddress] = useState("Civil Lines market, near main road");
  const [quoteSubtotal, setQuoteSubtotal] = useState(249);
  const [quoteZoneId, setQuoteZoneId] = useState<number | null>(null);
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [isQuotingDelivery, setIsQuotingDelivery] = useState(false);
  const [categories, setCategories] = useState([
    { id: 1, name: "Raw Materials", active: true },
    { id: 2, name: "Electricity", active: true },
    { id: 3, name: "Rent", active: true },
    { id: 4, name: "Staff Wages", active: true },
    { id: 5, name: "Gas", active: true },
    { id: 6, name: "Packaging", active: true },
  ]);
  const [newCategory, setNewCategory] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [importMode, setImportMode] = useState("all"); // "all" or "current"
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SheetSyncResult | null>(null);
  const [syncMessage, setSyncMessage] = useState("");

  // Missing State for Admin Credentials
  const [adminId, setAdminId] = useState("admin");
  const [adminPassword, setAdminPassword] = useState("");

  const loadStaffCredential = async () => {
    setIsStaffCredentialLoading(true);
    try {
      const response = await fetch(STAFF_CREDENTIAL_API, {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Staff credential API failed.");
      }
      const data: StaffCredentialStatus = await response.json();
      setStaffCredential(data);
      setStaffCredentialDraft((current) => ({
        id: data.staff_id || current.id || "counter",
        display_name: data.display_name || current.display_name || "Counter Staff",
        password: "",
        is_active: data.staff_id ? data.is_active : true,
      }));
    } catch {
      setStaffCredential(null);
      setStaffCredentialMessage("Staff credential status is unavailable right now.");
    } finally {
      setIsStaffCredentialLoading(false);
    }
  };

  const saveStaffCredential = async () => {
    setIsSavingStaffCredential(true);
    setStaffCredentialMessage("");
    try {
      const response = await fetch(STAFF_CREDENTIAL_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(staffCredentialDraft),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || "Could not save staff credential.");
      }
      setStaffCredential(data as StaffCredentialStatus);
      setStaffCredentialDraft((current) => ({ ...current, password: "" }));
      setStaffCredentialMessage("Counter staff credential saved and ready for staff login.");
    } catch (error) {
      setStaffCredentialMessage(error instanceof Error ? error.message : "Could not save staff credential.");
    } finally {
      setIsSavingStaffCredential(false);
    }
  };

  const loadPaymentReadiness = async () => {
    setIsPaymentLoading(true);
    try {
      const [
        readinessData,
        productionData,
        gatewayActivationData,
        reconciliationData,
      ] = await Promise.all([
        fetchPaymentJson<PaymentReadiness>(PAYMENT_READINESS_API),
        fetchPaymentJson<PaymentProductionReadiness>(PAYMENT_PRODUCTION_API),
        fetchPaymentJson<PaymentGatewayActivation>(PAYMENT_GATEWAY_ACTIVATION_API),
        fetchPaymentJson<PaymentReconciliation>(PAYMENT_RECONCILIATION_API),
      ]);
      setPaymentReadiness(readinessData);
      setPaymentProduction(productionData);
      setPaymentGatewayActivation(gatewayActivationData);
      setPaymentReconciliation(reconciliationData);
      if (!readinessData && !productionData && !gatewayActivationData && !reconciliationData) {
        setPaymentMessage("Payment readiness API is not available right now.");
      } else if (paymentMessage === "Payment readiness API is not available right now.") {
        setPaymentMessage("");
      }
    } catch {
      setPaymentReadiness(null);
      setPaymentProduction(null);
      setPaymentGatewayActivation(null);
      setPaymentReconciliation(null);
      setPaymentMessage("Payment readiness API is not available right now.");
    } finally {
      setIsPaymentLoading(false);
    }
  };

  const loadDeliveryEconomics = async () => {
    try {
      const response = await fetch(DELIVERY_ECONOMICS_API, {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Delivery economics API failed.");
      }
      const data: DeliveryEconomics = await response.json();
      setDeliveryEconomics(data);
    } catch {
      setDeliveryEconomics(null);
    }
  };

  const loadDeliveryZones = async () => {
    setIsDeliveryLoading(true);
    try {
      const response = await fetch(DELIVERY_ZONES_API, {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Delivery zones API failed.");
      }
      const data: DeliveryZone[] = await response.json();
      setDeliveryZones(data);
      setDeliveryDrafts(
        data.reduce<Record<number, DeliveryZone>>((drafts, zone) => {
          drafts[zone.id] = { ...zone, keywords: [...(zone.keywords || [])] };
          return drafts;
        }, {})
      );
      setQuoteZoneId((current) => {
        if (current && data.some((zone) => zone.id === current)) return current;
        return data.find((zone) => zone.is_active)?.id || data[0]?.id || null;
      });
    } catch {
      setDeliveryZones([]);
      setDeliveryDrafts({});
    } finally {
      setIsDeliveryLoading(false);
      await loadDeliveryEconomics();
    }
  };

  useEffect(() => {
    let isMounted = true;
    fetch("/api/security-overview", { cache: "no-store", credentials: "include" })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Security overview requires an admin session.");
        }
        return response.json();
      })
      .then((data: SecurityOverview) => {
        if (isMounted) {
          setSecurityOverview(data);
        }
      })
      .catch(() => {
        if (isMounted) {
          setSecurityOverview(null);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsSecurityLoading(false);
        }
      });

    if (isMounted) {
      void loadDeliveryZones();
      void loadStaffCredential();
    }

    loadPaymentReadiness();

    return () => {
      isMounted = false;
    };
  }, []);

  const activeDeliveryZones = deliveryZones.filter((zone) => zone.is_active);
  const lowestDeliveryFee = activeDeliveryZones.length
    ? Math.min(...activeDeliveryZones.map((zone) => Number(zone.delivery_fee || 0)))
    : 0;
  const widestDeliveryEta = activeDeliveryZones.length
    ? Math.max(...activeDeliveryZones.map((zone) => Number(zone.eta_max_minutes || 0)))
    : 0;
  const paymentProviders = paymentReadiness?.payment_providers?.length
    ? paymentReadiness.payment_providers
    : paymentProduction?.providers?.length
      ? paymentProduction.providers
      : paymentReadiness?.payment
        ? [paymentReadiness.payment]
        : [];
  const activePaymentProvider =
    paymentReadiness?.payment || paymentProduction?.active_provider || paymentProviders[0];
  const webhookContracts = paymentReadiness?.payment_webhook_contracts || [];
  const paymentProductionSummary = paymentProduction?.summary;
  const paymentGatewayActivationSummary = paymentGatewayActivation?.summary;
  const gatewayActivationProviders = paymentGatewayActivation?.providers || [];
  const gatewayActivationControls = paymentGatewayActivation?.controls || [];
  const paymentReconciliationSummary = paymentReconciliation?.summary;
  const awaitingSettlement = paymentProduction?.queues.awaiting_settlement || [];
  const recentPaidSettlements = paymentProduction?.queues.recent_paid || [];
  const recentPaymentEvents = paymentReconciliation?.recent_events || [];
  const paymentReconciliationControls = paymentReconciliation?.controls || [];
  const paymentProviderBreakdown = paymentReconciliation?.provider_breakdown || [];
  const deliveryEconomicsSummary = deliveryEconomics?.summary;

  const updateDeliveryDraft = (zoneId: number, updates: Partial<DeliveryZone>) => {
    setDeliveryDrafts((current) => ({
      ...current,
      [zoneId]: {
        ...(current[zoneId] || deliveryZones.find((zone) => zone.id === zoneId)!),
        ...updates,
      },
    }));
  };

  const updateNewDeliveryZone = (updates: Partial<DeliveryZoneDraft>) => {
    setNewDeliveryZone((current) => ({
      ...current,
      ...updates,
    }));
  };

  const keywordListFromText = (value: string) =>
    value
      .split(",")
      .map((keyword) => keyword.trim())
      .filter(Boolean);

  const createDeliveryZone = async () => {
    if (!newDeliveryZone.name.trim()) {
      setDeliveryMessage("Enter a delivery zone name before adding it.");
      return;
    }

    setIsCreatingDeliveryZone(true);
    setDeliveryMessage("");
    try {
      const response = await fetch(DELIVERY_ZONES_API, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newDeliveryZone.name.trim(),
          keywords: keywordListFromText(newDeliveryZone.keywords),
          delivery_fee: Number(newDeliveryZone.delivery_fee || 0),
          minimum_order_amount: Number(newDeliveryZone.minimum_order_amount || 0),
          eta_min_minutes: Number(newDeliveryZone.eta_min_minutes || 1),
          eta_max_minutes: Number(newDeliveryZone.eta_max_minutes || 1),
          is_active: newDeliveryZone.is_active,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setDeliveryMessage(data.detail || "Could not add delivery zone.");
        return;
      }
      setNewDeliveryZone(emptyDeliveryZoneDraft);
      setDeliveryMessage(`${data.name} delivery zone added.`);
      await loadDeliveryZones();
    } catch {
      setDeliveryMessage("Delivery zone API is not available right now.");
    } finally {
      setIsCreatingDeliveryZone(false);
    }
  };

  const saveDeliveryZone = async (zoneId: number) => {
    const draft = deliveryDrafts[zoneId];
    if (!draft) return;

    setSavingZoneId(zoneId);
    setDeliveryMessage("");
    try {
      const response = await fetch(`${DELIVERY_ZONES_API}/${zoneId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          keywords: draft.keywords || [],
          delivery_fee: Number(draft.delivery_fee || 0),
          minimum_order_amount: Number(draft.minimum_order_amount || 0),
          eta_min_minutes: Number(draft.eta_min_minutes || 1),
          eta_max_minutes: Number(draft.eta_max_minutes || 1),
          is_active: draft.is_active,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setDeliveryMessage(data.detail || "Could not save delivery zone.");
        return;
      }
      setDeliveryZones((current) =>
        current.map((zone) => (zone.id === zoneId ? data : zone))
      );
      setDeliveryDrafts((current) => ({
        ...current,
        [zoneId]: { ...data, keywords: [...(data.keywords || [])] },
      }));
      setDeliveryMessage(`${data.name} delivery rules saved.`);
      await loadDeliveryEconomics();
    } catch {
      setDeliveryMessage("Delivery zone API is not available right now.");
    } finally {
      setSavingZoneId(null);
    }
  };

  const archiveDeliveryZone = async (zone: DeliveryZone) => {
    setArchivingZoneId(zone.id);
    setDeliveryMessage("");
    try {
      const response = await fetch(`${DELIVERY_ZONES_API}/${zone.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) {
        setDeliveryMessage(data.detail || "Could not archive delivery zone.");
        return;
      }
      const zoneName = data.zone?.name || zone.name;
      setDeliveryMessage(
        data.status === "deleted"
          ? `${zoneName} delivery zone removed.`
          : `${zoneName} delivery zone archived because it has delivery history.`
      );
      await loadDeliveryZones();
    } catch {
      setDeliveryMessage("Delivery zone API is not available right now.");
    } finally {
      setArchivingZoneId(null);
    }
  };

  const testDeliveryQuote = async () => {
    if (!quoteAddress.trim()) {
      setDeliveryMessage("Enter a delivery address to test.");
      return;
    }

    setIsQuotingDelivery(true);
    setDeliveryQuote(null);
    setDeliveryMessage("");
    try {
      const response = await fetch(DELIVERY_QUOTE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: quoteAddress,
          subtotal: Number(quoteSubtotal || 0),
          zone_id: quoteZoneId,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setDeliveryQuote(null);
        setDeliveryMessage(data.detail || "Address could not be validated.");
        return;
      }
      setDeliveryQuote(data);
    } catch {
      setDeliveryMessage("Delivery quote API is not available right now.");
    } finally {
      setIsQuotingDelivery(false);
    }
  };

  const sendManualPaymentWebhook = async () => {
    const orderId = Number(webhookOrderId);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      setPaymentMessage("Enter a valid prepaid order ID before sending the webhook.");
      return;
    }

    setIsSendingWebhook(true);
    setWebhookResult(null);
    setPaymentMessage("");
    try {
      const response = await fetch(MANUAL_PAYMENT_WEBHOOK_API, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "manual.payment.updated",
          status: "paid",
          order_id: orderId,
          payment_reference:
            webhookReference.trim() || `MANUAL-ADMIN-${Date.now()}`,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setPaymentMessage(data.detail || "Manual payment webhook failed.");
        return;
      }
      setWebhookResult(data);
      await loadPaymentReadiness();
      setPaymentMessage(
        data.status === "processed"
          ? `Order #${data.order?.id || orderId} marked paid through manual webhook.`
          : data.status === "already_paid"
            ? `Order #${data.order?.id || orderId} was already paid.`
            : `Webhook received with status: ${data.status}.`
      );
    } catch {
      setPaymentMessage("Manual payment webhook API is not available right now.");
    } finally {
      setIsSendingWebhook(false);
    }
  };

  // Missing Handlers for Categories
  const toggleCategory = (id: number) => {
    setCategories(categories.map(cat => 
      cat.id === id ? { ...cat, active: !cat.active } : cat
    ));
  };

  const deleteCategory = (id: number) => {
    setCategories(categories.filter(cat => cat.id !== id));
  };

  const addCategory = () => {
    if (!newCategory.trim()) return;
    const nextId = categories.length > 0 ? Math.max(...categories.map(c => c.id)) + 1 : 1;
    setCategories([...categories, { id: nextId, name: newCategory, active: true }]);
    setNewCategory("");
  };

  const handleSync = async () => {
    if (!sheetUrl) {
      setSyncMessage("Please enter your Google Sheet URL first.");
      return;
    }
    setIsSyncing(true);
    setSyncResult(null);
    setSyncMessage("");
    
    try {
      const response = await fetch(SHEETS_IMPORT_API, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheet_url: sheetUrl, mode: importMode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSyncMessage(data.detail || "Google Sheets import failed.");
        return;
      }
      setSyncResult(data.data);
      setSyncMessage(
        `Imported ${data.data.rows_imported} sales rows into the portal.`
      );
    } catch (error) {
      setSyncMessage("Google Sheets import API is not available right now.");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Configure portal preferences, data sources, and security.</p>
      </div>

      {/* Access Control */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start">
            <div className="p-2 bg-indigo-100 rounded-lg mr-3">
              <LockKeyhole className="w-5 h-5 text-indigo-700" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900">Access Control & Roles</h3>
              <p className="text-sm text-gray-500">
                Admin, counter staff, and customer sessions are separated with route-level permissions.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-bold">
            <span className="inline-flex items-center gap-1 rounded-md bg-green-50 px-3 py-2 text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Admin protected
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-3 py-2 text-blue-700">
              <UserCheck className="h-3.5 w-3.5" /> Customer protected
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-3 py-2 text-indigo-700">
              <Shield className="h-3.5 w-3.5" /> Staff restricted
            </span>
          </div>
        </div>

        {isSecurityLoading ? (
          <div className="mt-5 rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm font-semibold text-gray-500">
            Loading security overview...
          </div>
        ) : securityOverview ? (
          <div className="mt-5 space-y-5">
            <div
              data-testid="access-control-command"
              className="rounded-lg border border-slate-200 bg-slate-50 p-4"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-slate-700" />
                    <h4 className="font-black text-gray-950">Access Control Command</h4>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-gray-600">
                    Role boundaries, protected route counts, and credential hardening are tracked in one owner view.
                  </p>
                </div>
                <span
                  data-testid="access-launch-status"
                  className={`inline-flex w-fit items-center gap-2 rounded-md px-3 py-2 text-xs font-black uppercase ${
                    securityOverview.summary.launchTone === "Ready"
                      ? "bg-green-100 text-green-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {securityOverview.summary.launchTone}
                </span>
              </div>
              <p className="mt-3 text-sm font-semibold text-gray-700">
                {securityOverview.summary.launchStatus}
              </p>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="rounded-lg border border-white bg-white p-4">
                  <p className="text-xs font-black uppercase text-gray-500">Hardening score</p>
                  <p data-testid="access-hardening-score" className="mt-2 text-2xl font-black text-gray-950">
                    {securityOverview.summary.hardeningReadyCount}/{securityOverview.summary.hardeningTotalCount}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-gray-500">checks ready</p>
                </div>
                <div className="rounded-lg border border-white bg-white p-4">
                  <p className="text-xs font-black uppercase text-gray-500">Owner routes</p>
                  <p className="mt-2 text-2xl font-black text-gray-950">
                    {securityOverview.summary.adminRouteCount}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-gray-500">admin-only groups</p>
                </div>
                <div className="rounded-lg border border-white bg-white p-4">
                  <p className="text-xs font-black uppercase text-gray-500">Counter routes</p>
                  <p className="mt-2 text-2xl font-black text-gray-950">
                    {securityOverview.summary.staffRouteCount}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-gray-500">staff workflow groups</p>
                </div>
                <div className="rounded-lg border border-white bg-white p-4">
                  <p className="text-xs font-black uppercase text-gray-500">Credential split</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span
                      className={`rounded-md px-2.5 py-1 text-xs font-black ${
                        securityOverview.summary.adminConfigured
                          ? "bg-green-50 text-green-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      Admin
                    </span>
                    <span
                      className={`rounded-md px-2.5 py-1 text-xs font-black ${
                        securityOverview.summary.staffConfigured
                          ? "bg-green-50 text-green-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      Staff
                    </span>
                    <span
                      className={`rounded-md px-2.5 py-1 text-xs font-black ${
                        securityOverview.summary.sessionSecretConfigured
                          ? "bg-green-50 text-green-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      Session
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div data-testid="access-route-matrix" className="overflow-hidden rounded-lg border border-gray-100">
              <div className="overflow-x-auto">
                <div className="min-w-[820px]">
                  <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 text-xs font-black uppercase text-gray-500">
                    <div className="col-span-2">Area</div>
                    <div className="col-span-3">Routes</div>
                    <div className="col-span-2">Public</div>
                    <div className="col-span-2">Customer</div>
                    <div className="col-span-2">Staff</div>
                    <div className="col-span-1">Admin</div>
                  </div>
                  {securityOverview.routeMatrix.map((row) => (
                    <div key={row.area} className="grid grid-cols-12 gap-2 border-t border-gray-100 px-4 py-3 text-sm">
                      <div className="col-span-2 font-black text-gray-900">{row.area}</div>
                      <div className="col-span-3 font-mono text-xs font-bold text-gray-600">{row.routeGroup}</div>
                      <div className="col-span-2 text-gray-600">{row.publicAccess}</div>
                      <div className="col-span-2 text-gray-600">{row.customerAccess}</div>
                      <div className="col-span-2 text-gray-600">{row.staffAccess}</div>
                      <div className="col-span-1 text-gray-600">{row.adminAccess}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div
              data-testid="staff-credential-command"
              className="rounded-lg border border-blue-100 bg-blue-50 p-4"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <UserCheck className="h-5 w-5 text-blue-700" />
                    <h4 className="font-black text-gray-950">Counter Staff Credential Activation</h4>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-gray-600">
                    Create or rotate a separate counter login without changing the master admin ID.
                  </p>
                </div>
                <span
                  data-testid="staff-credential-status"
                  className={`inline-flex w-fit items-center gap-2 rounded-md px-3 py-2 text-xs font-black uppercase ${
                    staffCredential?.configured
                      ? "bg-green-100 text-green-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  <Shield className="h-3.5 w-3.5" />
                  {staffCredential?.configured ? "Staff Active" : "Setup Needed"}
                </span>
              </div>

              {isStaffCredentialLoading ? (
                <div className="mt-4 rounded-lg border border-blue-100 bg-white/70 p-4 text-sm font-semibold text-gray-500">
                  Loading staff credential status...
                </div>
              ) : (
                <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-5">
                  <div className="rounded-lg border border-white bg-white/80 p-4 xl:col-span-2">
                    <p className="text-xs font-black uppercase text-gray-500">Current staff login</p>
                    <p className="mt-2 text-lg font-black text-gray-950">
                      {staffCredential?.staff_id || "Not activated"}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-gray-600">
                      {staffCredential?.display_name || "No counter staff credential saved yet."}
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-md bg-blue-50 p-3">
                        <p className="text-xs font-black uppercase text-blue-700">Source</p>
                        <p className="mt-1 font-bold text-gray-900">{staffCredential?.source || "managed"}</p>
                      </div>
                      <div className="rounded-md bg-blue-50 p-3">
                        <p className="text-xs font-black uppercase text-blue-700">Last login</p>
                        <p className="mt-1 font-bold text-gray-900">
                          {staffCredential?.last_login_at ? "Recorded" : "No login yet"}
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-5 text-gray-600">
                      {staffCredential?.next_action || "Save a staff ID and password to unlock direct staff sign-in."}
                    </p>
                  </div>

                  <div className="rounded-lg border border-white bg-white/80 p-4 xl:col-span-3">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="block text-sm font-bold text-gray-700">
                        Staff ID
                        <input
                          value={staffCredentialDraft.id}
                          onChange={(event) =>
                            setStaffCredentialDraft((current) => ({ ...current, id: event.target.value }))
                          }
                          className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                          placeholder="counter"
                        />
                      </label>
                      <label className="block text-sm font-bold text-gray-700">
                        Display Name
                        <input
                          value={staffCredentialDraft.display_name}
                          onChange={(event) =>
                            setStaffCredentialDraft((current) => ({
                              ...current,
                              display_name: event.target.value,
                            }))
                          }
                          className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                          placeholder="Counter Staff"
                        />
                      </label>
                      <label className="block text-sm font-bold text-gray-700 md:col-span-2">
                        New Password
                        <input
                          type="password"
                          value={staffCredentialDraft.password}
                          onChange={(event) =>
                            setStaffCredentialDraft((current) => ({ ...current, password: event.target.value }))
                          }
                          className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                          placeholder="Minimum 8 characters"
                        />
                      </label>
                    </div>
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <label className="inline-flex items-center gap-2 text-sm font-bold text-gray-700">
                        <input
                          type="checkbox"
                          checked={staffCredentialDraft.is_active}
                          onChange={(event) =>
                            setStaffCredentialDraft((current) => ({
                              ...current,
                              is_active: event.target.checked,
                            }))
                          }
                          className="h-4 w-4 rounded border-gray-300 text-blue-600"
                        />
                        Active for staff login
                      </label>
                      <button
                        data-testid="staff-credential-save"
                        onClick={saveStaffCredential}
                        disabled={isSavingStaffCredential || staffCredentialDraft.password.length < 8}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Save className="h-4 w-4" />
                        {isSavingStaffCredential ? "Saving..." : "Save Staff Login"}
                      </button>
                    </div>
                    {staffCredentialMessage && (
                      <p className="mt-3 rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-700">
                        {staffCredentialMessage}
                      </p>
                    )}
                    <p className="mt-3 text-xs font-semibold text-gray-500">
                      {staffCredential?.password_policy || "Passwords are stored only as a salted hash."}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {securityOverview.sessions.map((session) => (
                <div key={session.cookie} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-gray-900">{session.name}</p>
                      <p className="mt-1 text-xs font-semibold text-gray-500">{session.cookie}</p>
                    </div>
                    <span
                      className={`rounded-md px-2.5 py-1 text-xs font-black ${
                        session.status === "Ready"
                          ? "bg-green-100 text-green-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {session.status}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-md bg-white p-3">
                      <div className="flex items-center gap-2 text-gray-500">
                        <Clock className="h-4 w-4" />
                        Session
                      </div>
                      <p className="mt-1 font-black text-gray-900">{session.duration}</p>
                    </div>
                    <div className="rounded-md bg-white p-3">
                      <div className="flex items-center gap-2 text-gray-500">
                        <Shield className="h-4 w-4" />
                        Routes
                      </div>
                      <p className="mt-1 font-black text-gray-900">{session.protectedRoutes} protected</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5 text-indigo-700" />
                    <h4 className="font-black text-gray-950">Authentication Hardening Command</h4>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-gray-600">
                    Admin-only security overview, staff route restrictions, customer account guard, recovery notes and audit evidence.
                  </p>
                </div>
                <span className="inline-flex w-fit items-center gap-2 rounded-md bg-white px-3 py-2 text-xs font-black uppercase text-indigo-700">
                  <Shield className="h-3.5 w-3.5" />
                  Role Gates Active
                </span>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-4">
                {securityOverview.gateChecks.map((check) => (
                  <div key={check.name} className="rounded-lg border border-white bg-white/75 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-black text-gray-900">{check.name}</p>
                      <span className="rounded-md bg-indigo-100 px-2 py-1 text-xs font-black text-indigo-700">
                        {check.status}
                      </span>
                    </div>
                    {check.proof && (
                      <p className="mt-2 font-mono text-xs font-bold text-indigo-700">{check.proof}</p>
                    )}
                    <p className="mt-2 text-sm leading-5 text-gray-600">{check.detail}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-white bg-white/75 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 text-indigo-700" />
                    <p className="font-black text-gray-900">Account Recovery Controls</p>
                  </div>
                  <div className="space-y-2">
                    {securityOverview.recoveryControls.map((control) => (
                      <div key={control.name} className="rounded-md bg-white p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-bold text-gray-900">{control.name}</p>
                          <span className="rounded-md bg-green-50 px-2 py-1 text-xs font-black text-green-700">
                            {control.status}
                          </span>
                        </div>
                        <p className="mt-1 text-sm leading-5 text-gray-600">{control.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-white bg-white/75 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Route className="h-4 w-4 text-indigo-700" />
                    <p className="font-black text-gray-900">Audit Controls</p>
                  </div>
                  <div className="space-y-2">
                    {securityOverview.auditControls.map((control) => (
                      <div key={control.name} className="rounded-md bg-white p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-bold text-gray-900">{control.name}</p>
                          <span className="rounded-md bg-green-50 px-2 py-1 text-xs font-black text-green-700">
                            {control.status}
                          </span>
                        </div>
                        <p className="mt-1 text-sm leading-5 text-gray-600">{control.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-gray-100">
              <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 text-xs font-black uppercase text-gray-500">
                <div className="col-span-12 md:col-span-3">Role</div>
                <div className="hidden md:col-span-5 md:block">Access</div>
                <div className="hidden md:col-span-2 md:block">Entry</div>
                <div className="hidden md:col-span-2 md:block">Protection</div>
              </div>
              {securityOverview.roles.map((role) => (
                <div key={role.role} className="grid grid-cols-12 gap-2 border-t border-gray-100 px-4 py-3 text-sm">
                  <div className="col-span-12 font-black text-gray-900 md:col-span-3">
                    <span className="inline-flex items-center gap-2">
                      {role.role === "Public Visitor" ? (
                        <Globe2 className="h-4 w-4 text-gray-400" />
                      ) : role.role === "Customer" ? (
                        <Users className="h-4 w-4 text-blue-500" />
                      ) : (
                        <Shield className="h-4 w-4 text-indigo-600" />
                      )}
                      {role.role}
                    </span>
                  </div>
                  <div className="col-span-12 text-gray-600 md:col-span-5">{role.access}</div>
                  <div className="col-span-6 font-semibold text-gray-700 md:col-span-2">{role.entry}</div>
                  <div className="col-span-6 text-gray-600 md:col-span-2">{role.protection}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {securityOverview.hardening.map((item) => {
                const needsAction = ["Default", "Fallback", "Planned"].includes(item.status);
                return (
                  <div
                    key={item.name}
                    className={`rounded-lg border p-4 ${
                      needsAction
                        ? "border-amber-100 bg-amber-50"
                        : "border-green-100 bg-green-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-black text-gray-900">{item.name}</p>
                      <span
                        className={`rounded-md px-2 py-1 text-xs font-black ${
                          needsAction ? "bg-white text-amber-700" : "bg-white text-green-700"
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-gray-600">{item.detail}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-red-100 bg-red-50 p-4 text-sm font-semibold text-red-700">
            Security overview is unavailable. Check the Next.js API route logs.
          </div>
        )}
      </div>

      {/* Payment Gateway */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start">
            <div className="p-2 bg-emerald-100 rounded-lg mr-3">
              <CircleDollarSign className="w-5 h-5 text-emerald-700" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900">Payment Gateway Readiness</h3>
              <p className="text-sm text-gray-500">
                Track checkout credentials, webhook verification, and test a controlled manual paid event.
              </p>
            </div>
          </div>
          <button
            onClick={loadPaymentReadiness}
            disabled={isPaymentLoading}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-700 hover:border-emerald-200 hover:bg-emerald-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${isPaymentLoading ? "animate-spin" : ""}`} />
            Refresh Payments
          </button>
        </div>

        {paymentMessage && (
          <div className="mt-5 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            {paymentMessage}
          </div>
        )}

        {isPaymentLoading ? (
          <div className="mt-5 rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm font-semibold text-gray-500">
            Loading payment readiness...
          </div>
        ) : activePaymentProvider ? (
          <div className="mt-5 space-y-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-black uppercase text-gray-500">Active Provider</p>
                <p className="mt-2 text-xl font-black capitalize text-gray-900">
                  {activePaymentProvider.provider}
                </p>
                <p className="mt-1 text-xs font-semibold text-gray-500">
                  {activePaymentProvider.environment}
                </p>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-black uppercase text-gray-500">Currency</p>
                <p className="mt-2 text-xl font-black text-gray-900">
                  {activePaymentProvider.currency}
                </p>
                <p className="mt-1 text-xs font-semibold text-gray-500">
                  Checkout mode: {activePaymentProvider.mode}
                </p>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-black uppercase text-gray-500">Checkout</p>
                <span
                  className={`mt-2 inline-flex rounded-md px-2.5 py-1 text-xs font-black ${
                    activePaymentProvider.checkout_configured
                      ? "bg-green-100 text-green-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {activePaymentProvider.checkout_configured ? "Configured" : "Needs settings"}
                </span>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-black uppercase text-gray-500">Webhook</p>
                <span
                  className={`mt-2 inline-flex rounded-md px-2.5 py-1 text-xs font-black ${
                    activePaymentProvider.webhook_configured
                      ? "bg-green-100 text-green-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {activePaymentProvider.webhook_configured ? "Configured" : "Needs secret"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {paymentProviders.map((provider) => {
                const missingSettings = Array.from(
                  new Set([
                    ...provider.missing_checkout_settings,
                    ...provider.missing_webhook_settings,
                  ])
                );
                return (
                  <div key={provider.provider} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-black capitalize text-gray-900">{provider.provider}</p>
                        <p className="text-xs font-semibold text-gray-500">{provider.environment}</p>
                      </div>
                      <span
                        className={`rounded-md px-2 py-1 text-xs font-black ${
                          provider.checkout_configured && provider.webhook_configured
                            ? "bg-green-100 text-green-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {provider.checkout_configured && provider.webhook_configured ? "Ready" : "Setup"}
                      </span>
                    </div>
                    <div className="mt-4 space-y-2 text-xs font-semibold text-gray-600">
                      <p className="break-all">
                        Session: <span className="font-mono text-gray-800">{provider.session_endpoint}</span>
                      </p>
                      <p className="break-all">
                        Webhook: <span className="font-mono text-gray-800">{provider.webhook_endpoint}</span>
                      </p>
                    </div>
                    {missingSettings.length ? (
                      <div className="mt-3 rounded-md border border-amber-100 bg-white p-3">
                        <p className="text-xs font-black uppercase text-amber-700">Missing</p>
                        <p className="mt-1 break-words text-xs font-semibold text-gray-700">
                          {missingSettings.join(", ")}
                        </p>
                      </div>
                    ) : (
                      <div className="mt-3 inline-flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-xs font-black text-green-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Required settings present
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {paymentGatewayActivationSummary && (
              <div
                data-testid="payment-gateway-activation-command"
                className="rounded-lg border border-orange-100 bg-orange-50 p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-white p-2 text-orange-700">
                      <Globe2 className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-black text-gray-900">Gateway Activation Command</p>
                      <p className="text-sm text-orange-900">
                        Live provider switchboard for credentials, checkout proof, webhook proof, and final go-live blockers.
                      </p>
                    </div>
                  </div>
                  <span
                    data-testid="gateway-activation-status"
                    className={`inline-flex rounded-md px-3 py-2 text-xs font-black uppercase ${gatewayActivationStatusClass(paymentGatewayActivationSummary.active_provider_status)}`}
                  >
                    {paymentGatewayActivationSummary.active_provider_status.replace("_", " ")}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div className="rounded-lg border border-orange-100 bg-white p-4">
                    <p className="text-xs font-black uppercase text-gray-500">Active Provider</p>
                    <p className="mt-2 text-xl font-black capitalize text-gray-900">
                      {paymentGatewayActivationSummary.active_provider}
                    </p>
                    <p className="text-xs font-semibold text-gray-500">
                      {paymentGatewayActivationSummary.overall_status.replace("_", " ")}
                    </p>
                  </div>
                  <div className="rounded-lg border border-orange-100 bg-white p-4">
                    <p className="text-xs font-black uppercase text-gray-500">Live Ready</p>
                    <p className="mt-2 text-2xl font-black text-gray-900">
                      {paymentGatewayActivationSummary.live_ready_provider_count}
                    </p>
                    <p className="text-xs font-semibold text-gray-500">
                      {paymentGatewayActivationSummary.selectable_live_providers.length
                        ? paymentGatewayActivationSummary.selectable_live_providers.join(", ")
                        : "No public gateway yet"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-orange-100 bg-white p-4">
                    <p className="text-xs font-black uppercase text-gray-500">Proof Needed</p>
                    <p className="mt-2 text-2xl font-black text-gray-900">
                      {paymentGatewayActivationSummary.proof_needed_provider_count}
                    </p>
                    <p className="text-xs font-semibold text-gray-500">Session or webhook proof pending</p>
                  </div>
                  <div className="rounded-lg border border-orange-100 bg-white p-4">
                    <p className="text-xs font-black uppercase text-gray-500">Blocked</p>
                    <p className="mt-2 text-2xl font-black text-gray-900">
                      {paymentGatewayActivationSummary.blocked_provider_count}
                    </p>
                    <p className="text-xs font-semibold text-gray-500">Missing credentials or secrets</p>
                  </div>
                </div>

                <div className="mt-4 rounded-md border border-orange-100 bg-white px-4 py-3">
                  <p className="text-xs font-black uppercase text-orange-700">Next Gateway Action</p>
                  <p className="mt-1 text-sm font-semibold text-gray-800">
                    {paymentGatewayActivationSummary.next_action}
                  </p>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
                  {gatewayActivationProviders.map((provider) => (
                    <div
                      key={provider.provider}
                      data-testid={`gateway-activation-${provider.provider}`}
                      className="rounded-lg border border-orange-100 bg-white p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-black text-gray-900">{provider.label}</p>
                          <p className="text-xs font-semibold text-gray-500">{provider.environment}</p>
                        </div>
                        <span
                          className={`rounded-md px-2 py-1 text-[11px] font-black uppercase ${gatewayActivationStatusClass(provider.activation_status)}`}
                        >
                          {provider.activation_status.replace("_", " ")}
                        </span>
                      </div>

                      <p className="mt-3 text-sm font-semibold text-gray-700">{provider.next_action}</p>

                      {provider.missing_settings.length ? (
                        <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-3 py-2">
                          <p className="text-xs font-black uppercase text-amber-700">Missing Env</p>
                          <p className="mt-1 break-words text-xs font-semibold text-gray-700">
                            {provider.missing_settings.join(", ")}
                          </p>
                        </div>
                      ) : (
                        <div className="mt-3 inline-flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-xs font-black text-green-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          No gateway secrets shown
                        </div>
                      )}

                      <div className="mt-4 grid grid-cols-1 gap-2 text-xs font-semibold text-gray-600">
                        <div className="rounded-md bg-gray-50 px-3 py-2">
                          <p className="font-black text-gray-900">Session Proof</p>
                          <p className="mt-1">
                            {provider.latest_session
                              ? `Order #${provider.latest_session.order_id} - ${formatMoney(provider.latest_session.total_amount)}`
                              : "Not recorded"}
                          </p>
                          <p className="mt-1 text-gray-500">
                            {formatTimestamp(provider.latest_session?.created_at)}
                          </p>
                        </div>
                        <div className="rounded-md bg-gray-50 px-3 py-2">
                          <p className="font-black text-gray-900">Webhook Proof</p>
                          <p className="mt-1">
                            {provider.latest_webhook_event
                              ? `Order #${provider.latest_webhook_event.order_id} - ${provider.latest_webhook_event.action}`
                              : "Not recorded"}
                          </p>
                          <p className="mt-1 text-gray-500">
                            {formatTimestamp(provider.latest_webhook_event?.received_at)}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 space-y-2">
                        {provider.steps.map((step) => (
                          <div key={`${provider.provider}-${step.name}`} className="rounded-md bg-gray-50 px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-black text-gray-900">{step.name}</p>
                              <span
                                className={`rounded px-2 py-1 text-[10px] font-black uppercase ${paymentStepStatusClass(step.status)}`}
                              >
                                {step.status}
                              </span>
                            </div>
                            <p className="mt-1 text-xs font-semibold text-gray-500">{step.detail}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
                  {gatewayActivationControls.map((control) => (
                    <div key={control.name} className="rounded-md border border-orange-100 bg-white px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-black text-gray-900">{control.name}</p>
                        <span className="rounded bg-green-50 px-2 py-1 text-[11px] font-black uppercase text-green-700">
                          {control.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-gray-500">{control.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {paymentProductionSummary && (
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-white p-2 text-emerald-700">
                      <ClipboardCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-black text-gray-900">Payment Production Control</p>
                      <p className="text-sm text-emerald-900">
                        Provider setup, unsettled prepaid orders, and recent settlements in one operator view.
                      </p>
                    </div>
                  </div>
                  <span
                    className={`inline-flex rounded-md px-3 py-2 text-xs font-black uppercase ${
                      paymentProductionSummary.live_gateway_ready
                        ? "bg-green-100 text-green-700"
                        : paymentProductionSummary.gateway_ready
                          ? "bg-white text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {paymentProductionSummary.live_gateway_ready
                      ? "Live gateway ready"
                      : paymentProductionSummary.gateway_ready
                        ? "Controlled manual mode"
                        : "Configuration needed"}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div className="rounded-lg border border-emerald-100 bg-white p-4">
                    <p className="text-xs font-black uppercase text-gray-500">Settlement Queue</p>
                    <p className="mt-2 text-2xl font-black text-gray-900">
                      {paymentProductionSummary.awaiting_settlement_count}
                    </p>
                    <p className="text-xs font-semibold text-gray-500">
                      {formatMoney(paymentProductionSummary.awaiting_settlement_total)} waiting
                    </p>
                  </div>
                  <div className="rounded-lg border border-emerald-100 bg-white p-4">
                    <p className="text-xs font-black uppercase text-gray-500">Paid Today</p>
                    <p className="mt-2 text-2xl font-black text-gray-900">
                      {paymentProductionSummary.paid_today_count}
                    </p>
                    <p className="text-xs font-semibold text-gray-500">
                      {formatMoney(paymentProductionSummary.paid_today_total)} settled
                    </p>
                  </div>
                  <div className="rounded-lg border border-emerald-100 bg-white p-4">
                    <p className="text-xs font-black uppercase text-gray-500">Providers Ready</p>
                    <p className="mt-2 text-2xl font-black text-gray-900">
                      {paymentProductionSummary.provider_ready_count}/{paymentProduction?.providers.length || 0}
                    </p>
                    <p className="text-xs font-semibold text-gray-500">
                      Checkout and webhook configured
                    </p>
                  </div>
                  <div className="rounded-lg border border-emerald-100 bg-white p-4">
                    <p className="text-xs font-black uppercase text-gray-500">Webhook Ready</p>
                    <p className="mt-2 text-2xl font-black text-gray-900">
                      {paymentProductionSummary.webhook_ready_count}/{paymentProduction?.providers.length || 0}
                    </p>
                    <p className="text-xs font-semibold text-gray-500">
                      Signature route can verify events
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-lg border border-emerald-100 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-black text-gray-900">Awaiting Settlement Queue</p>
                        <p className="text-sm text-gray-500">
                          Prepaid orders that still need a paid provider event.
                        </p>
                      </div>
                      <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700">
                        {paymentProductionSummary.settlement_clear ? "Clear" : "Needs action"}
                      </span>
                    </div>
                    <div className="mt-4 space-y-3">
                      {awaitingSettlement.length ? (
                        awaitingSettlement.map((order) => (
                          <div
                            key={`awaiting-${order.id}`}
                            className="grid grid-cols-1 gap-3 rounded-md border border-gray-100 bg-gray-50 p-3 md:grid-cols-[1fr_auto]"
                          >
                            <div>
                              <p className="font-black text-gray-900">
                                Order #{order.id} - {order.customer_name || "Guest"}
                              </p>
                              <p className="mt-1 text-xs font-semibold text-gray-500">
                                {formatMoney(order.total_amount)} - {order.fulfillment_type || order.order_type || "takeaway"} - {order.payment_status || "awaiting"}
                              </p>
                            </div>
                            <button
                              onClick={() => {
                                setWebhookOrderId(String(order.id));
                                setWebhookReference(`MANUAL-QUEUE-${order.id}-${Date.now()}`);
                                setPaymentMessage(`Order #${order.id} loaded into the manual webhook tester.`);
                              }}
                              className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-xs font-black text-white hover:bg-emerald-800"
                            >
                              <CircleDollarSign className="h-3.5 w-3.5" />
                              Load #{order.id}
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-md border border-green-100 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800">
                          No prepaid orders are waiting for settlement.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-emerald-100 bg-white p-4">
                    <p className="font-black text-gray-900">Next Payment Actions</p>
                    <div className="mt-3 space-y-2">
                      {(paymentProduction?.next_actions || []).map((action) => (
                        <div key={action} className="flex gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                          <span>{action}</span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 border-t border-gray-100 pt-4">
                      <p className="font-black text-gray-900">Recent Paid Settlements</p>
                      <div className="mt-3 space-y-2">
                        {recentPaidSettlements.length ? (
                          recentPaidSettlements.slice(0, 4).map((order) => (
                            <div key={`paid-${order.id}`} className="rounded-md bg-gray-50 px-3 py-2">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-black text-gray-900">Order #{order.id}</p>
                                <p className="text-sm font-black text-emerald-700">
                                  {formatMoney(order.total_amount)}
                                </p>
                              </div>
                              <p className="mt-1 text-xs font-semibold text-gray-500">
                                {order.payment_provider || "manual"} - {order.payment_reference || "reference pending"}
                              </p>
                            </div>
                          ))
                        ) : (
                          <p className="rounded-md bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-500">
                            No paid settlement has been recorded yet.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {paymentReconciliationSummary && (
              <div
                data-testid="payment-reconciliation-ledger"
                className="rounded-lg border border-sky-100 bg-sky-50 p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-white p-2 text-sky-700">
                      <Shield className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-black text-gray-900">Payment Reconciliation Ledger</p>
                      <p className="text-sm text-sky-900">
                        Webhook audit trail with idempotency, duplicate delivery count, and settlement proof.
                      </p>
                    </div>
                  </div>
                  <span
                    data-testid="payment-duplicate-count"
                    className="inline-flex rounded-md bg-white px-3 py-2 text-xs font-black uppercase text-sky-700"
                  >
                    {paymentReconciliationSummary.duplicate_delivery_count} duplicate deliveries
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div className="rounded-lg border border-sky-100 bg-white p-4">
                    <p className="text-xs font-black uppercase text-gray-500">Events Today</p>
                    <p className="mt-2 text-2xl font-black text-gray-900">
                      {paymentReconciliationSummary.events_today_count}
                    </p>
                    <p className="text-xs font-semibold text-gray-500">
                      {paymentReconciliationSummary.recent_event_count} recent audits visible
                    </p>
                  </div>
                  <div className="rounded-lg border border-sky-100 bg-white p-4">
                    <p className="text-xs font-black uppercase text-gray-500">Processed</p>
                    <p className="mt-2 text-2xl font-black text-gray-900">
                      {paymentReconciliationSummary.processed_today_count}
                    </p>
                    <p className="text-xs font-semibold text-gray-500">Marked paid by provider event</p>
                  </div>
                  <div className="rounded-lg border border-sky-100 bg-white p-4">
                    <p className="text-xs font-black uppercase text-gray-500">Already Paid</p>
                    <p className="mt-2 text-2xl font-black text-gray-900">
                      {paymentReconciliationSummary.already_paid_today_count}
                    </p>
                    <p className="text-xs font-semibold text-gray-500">Matched safely after settlement</p>
                  </div>
                  <div className="rounded-lg border border-sky-100 bg-white p-4">
                    <p className="text-xs font-black uppercase text-gray-500">Ignored</p>
                    <p className="mt-2 text-2xl font-black text-gray-900">
                      {paymentReconciliationSummary.ignored_today_count}
                    </p>
                    <p className="text-xs font-semibold text-gray-500">Non-paid events preserved</p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.25fr_0.75fr]">
                  <div className="rounded-lg border border-sky-100 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-black text-gray-900">Recent Payment Event Audit</p>
                        <p className="text-sm text-gray-500">
                          Latest provider events and manual webhook tests recorded for reconciliation.
                        </p>
                      </div>
                      <span className="rounded-md bg-sky-50 px-2.5 py-1 text-xs font-black text-sky-700">
                        {recentPaymentEvents.length} rows
                      </span>
                    </div>
                    <div data-testid="payment-event-audit" className="mt-4 space-y-3">
                      {recentPaymentEvents.length ? (
                        recentPaymentEvents.slice(0, 6).map((event) => (
                          <div
                            key={event.id}
                            className="grid grid-cols-1 gap-3 rounded-md border border-gray-100 bg-gray-50 p-3 lg:grid-cols-[1fr_auto]"
                          >
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-black text-gray-900">Order #{event.order_id}</p>
                                <span className={`rounded-md px-2 py-1 text-[11px] font-black uppercase ${paymentEventActionClass(event.action)}`}>
                                  {event.action.replace("_", " ")}
                                </span>
                                <span className="rounded-md bg-white px-2 py-1 text-[11px] font-black uppercase text-gray-600">
                                  {event.provider}
                                </span>
                              </div>
                              <p className="mt-2 text-xs font-semibold text-gray-500">
                                {event.event_type} - {event.payment_status}
                              </p>
                              <p
                                data-testid="payment-event-reference"
                                className="mt-1 break-all font-mono text-xs font-bold text-gray-700"
                              >
                                {event.provider_payment_id || event.provider_order_id || "reference pending"}
                              </p>
                            </div>
                            <div className="rounded-md bg-white px-3 py-2 text-sm font-black text-gray-900">
                              Duplicate {event.duplicate_count}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-md border border-sky-100 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800">
                          No payment webhook events have been recorded yet.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-sky-100 bg-white p-4">
                    <p className="font-black text-gray-900">Reconciliation Controls</p>
                    <div className="mt-3 space-y-2">
                      {paymentReconciliationControls.map((control) => (
                        <div key={control.name} className="rounded-md bg-gray-50 px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-black text-gray-900">{control.name}</p>
                            <span className="rounded bg-green-50 px-2 py-1 text-[11px] font-black uppercase text-green-700">
                              {control.status}
                            </span>
                          </div>
                          <p className="mt-1 text-xs font-semibold text-gray-500">{control.detail}</p>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 border-t border-gray-100 pt-4">
                      <p className="font-black text-gray-900">Provider Mix</p>
                      <div className="mt-3 space-y-2">
                        {paymentProviderBreakdown.length ? (
                          paymentProviderBreakdown.map((provider) => (
                            <div
                              key={provider.provider}
                              className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2 text-sm font-bold text-gray-700"
                            >
                              <span className="capitalize">{provider.provider}</span>
                              <span>{provider.count}</span>
                            </div>
                          ))
                        ) : (
                          <p className="rounded-md bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-500">
                            Provider events will appear here after checkout traffic starts.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-lg border border-gray-100 bg-white p-4">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-emerald-700" />
                  <div>
                    <p className="font-black text-gray-900">Webhook Contracts</p>
                    <p className="text-sm text-gray-500">
                      Signature and matching rules used by each provider endpoint.
                    </p>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {webhookContracts.map((contract) => (
                    <div key={contract.provider} className="rounded-md border border-gray-100 bg-gray-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-black capitalize text-gray-900">{contract.provider}</p>
                        <span className="rounded bg-white px-2 py-1 font-mono text-xs font-bold text-gray-600">
                          {contract.endpoint}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-gray-700">{contract.signature}</p>
                      <p className="mt-1 text-xs text-gray-500">{contract.notes}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                <div className="flex items-center gap-2">
                  <CircleDollarSign className="h-5 w-5 text-emerald-700" />
                  <div>
                    <p className="font-black text-gray-900">Manual Paid Webhook Tester</p>
                    <p className="text-sm text-gray-500">
                      Use this for a prepaid test order before live gateway credentials are active.
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3">
                  <input
                    value={webhookOrderId}
                    onChange={(event) => setWebhookOrderId(event.target.value)}
                    className="rounded-md border border-gray-200 bg-white px-3 py-3 text-sm font-semibold outline-none focus:border-emerald-500"
                    placeholder="Prepaid order ID"
                  />
                  <input
                    value={webhookReference}
                    onChange={(event) => setWebhookReference(event.target.value)}
                    className="rounded-md border border-gray-200 bg-white px-3 py-3 text-sm font-semibold outline-none focus:border-emerald-500"
                    placeholder="Payment reference"
                  />
                  <button
                    onClick={sendManualPaymentWebhook}
                    disabled={isSendingWebhook}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-5 py-3 text-sm font-black text-white hover:bg-emerald-800 disabled:bg-gray-300"
                  >
                    <CircleDollarSign className="h-4 w-4" />
                    {isSendingWebhook ? "Sending" : "Send Manual Paid Webhook"}
                  </button>
                </div>

                {webhookResult?.order && (
                  <div className="mt-4 rounded-md border border-green-100 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800">
                    Order #{webhookResult.order.id} is {webhookResult.order.payment_status}
                    {webhookResult.order.payment_reference
                      ? ` with reference ${webhookResult.order.payment_reference}.`
                      : "."}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-red-100 bg-red-50 p-4 text-sm font-semibold text-red-700">
            Payment readiness is unavailable. Check the backend operations API.
          </div>
        )}
      </div>

      {/* Delivery Zones */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start">
            <div className="p-2 bg-red-100 rounded-lg mr-3">
              <Truck className="w-5 h-5 text-red-700" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900">Delivery Zones & Charges</h3>
              <p className="text-sm text-gray-500">
                Manage fee, minimum order, ETA, coverage keywords, and test address validation.
              </p>
            </div>
          </div>
          <button
            onClick={loadDeliveryZones}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-700 hover:border-red-200 hover:bg-red-50"
          >
            <RefreshCw className="h-4 w-4" /> Refresh Zones
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-500">
              <Route className="h-4 w-4" /> Active Zones
            </div>
            <p className="mt-2 text-2xl font-black text-gray-900">{activeDeliveryZones.length}</p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-500">
              <CircleDollarSign className="h-4 w-4" /> Lowest Fee
            </div>
            <p className="mt-2 text-2xl font-black text-gray-900">Rs {lowestDeliveryFee}</p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-500">
              <Clock className="h-4 w-4" /> Longest ETA
            </div>
            <p className="mt-2 text-2xl font-black text-gray-900">{widestDeliveryEta || 0} min</p>
          </div>
        </div>

        {deliveryMessage && (
          <div className="mt-5 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            {deliveryMessage}
          </div>
        )}

        {deliveryEconomicsSummary && (
          <div className="mt-5 rounded-lg border border-red-100 bg-red-50 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="font-black text-gray-900">Delivery Economics Command</p>
                <p className="text-sm text-red-900">
                  Zone fees, minimum order rules, ETA promise, and live delivery queue risk.
                </p>
              </div>
              <span className="rounded-md bg-white px-3 py-2 text-xs font-black uppercase text-red-700">
                {deliveryEconomicsSummary.active_zone_count} active zones
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-red-100 bg-white p-4">
                <p className="text-xs font-black uppercase text-gray-500">Fee Range</p>
                <p className="mt-2 text-2xl font-black text-gray-900">
                  Rs {deliveryEconomicsSummary.lowest_fee}-{deliveryEconomicsSummary.highest_fee}
                </p>
                <p className="text-xs font-semibold text-gray-500">
                  Avg Rs {deliveryEconomicsSummary.average_fee}
                </p>
              </div>
              <div className="rounded-lg border border-red-100 bg-white p-4">
                <p className="text-xs font-black uppercase text-gray-500">Minimum Rules</p>
                <p className="mt-2 text-2xl font-black text-gray-900">
                  {deliveryEconomicsSummary.minimum_order_zone_count}
                </p>
                <p className="text-xs font-semibold text-gray-500">
                  Zones protect delivery margin
                </p>
              </div>
              <div className="rounded-lg border border-red-100 bg-white p-4">
                <p className="text-xs font-black uppercase text-gray-500">ETA Promise</p>
                <p className="mt-2 text-2xl font-black text-gray-900">
                  {deliveryEconomicsSummary.longest_eta_minutes} min
                </p>
                <p className="text-xs font-semibold text-gray-500">
                  Longest active delivery window
                </p>
              </div>
              <div className="rounded-lg border border-red-100 bg-white p-4">
                <p className="text-xs font-black uppercase text-gray-500">Open Delivery</p>
                <p className="mt-2 text-2xl font-black text-gray-900">
                  {deliveryEconomicsSummary.open_delivery_count}
                </p>
                <p className="text-xs font-semibold text-gray-500">
                  {formatMoney(deliveryEconomicsSummary.open_delivery_value)} in queue
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
              <div className="rounded-lg border border-red-100 bg-white p-4">
                <p className="font-black text-gray-900">Zone Rule Summary</p>
                <div className="mt-3 space-y-2">
                  {(deliveryEconomics?.zones || []).slice(0, 5).map((zone) => (
                    <div key={`economics-${zone.id}`} className="rounded-md bg-gray-50 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-black text-gray-900">{zone.name}</p>
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-black ${
                            zone.is_active
                              ? "bg-green-100 text-green-700"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {zone.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-gray-500">
                        Rs {zone.delivery_fee} - {zone.pricing_rule || "No minimum"} - {zone.eta_window}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-red-100 bg-white p-4">
                <p className="font-black text-gray-900">Delivery Next Actions</p>
                <div className="mt-3 space-y-2">
                  {(deliveryEconomics?.next_actions || []).map((action) => (
                    <div key={action} className="flex gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
                      <span>{action}</span>
                    </div>
                  ))}
                </div>
                {!!deliveryEconomics?.queue_preview?.length && (
                  <div className="mt-4 border-t border-gray-100 pt-4">
                    <p className="text-sm font-black text-gray-900">Live Queue Preview</p>
                    <div className="mt-2 space-y-2">
                      {deliveryEconomics.queue_preview.slice(0, 3).map((order) => (
                        <div key={`delivery-preview-${order.id}`} className="rounded-md bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600">
                          Order #{order.id} - {order.delivery_zone || "Zone pending"} - {order.assignment_status}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div data-testid="delivery-zone-create-panel" className="mt-5 rounded-lg border border-gray-100 bg-gray-50 p-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-red-700">New Zone</p>
              <p className="mt-1 text-sm font-semibold text-gray-600">
                Add a delivery area with fee, minimum order, ETA, and matching keywords.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-black text-gray-600">
              <input
                type="checkbox"
                checked={newDeliveryZone.is_active}
                onChange={(event) =>
                  updateNewDeliveryZone({ is_active: event.target.checked })
                }
                className="h-4 w-4 rounded border-gray-300 text-red-600"
              />
              Active
            </label>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_0.55fr_0.55fr_0.45fr_0.45fr]">
            <input
              value={newDeliveryZone.name}
              onChange={(event) => updateNewDeliveryZone({ name: event.target.value })}
              className="rounded-md border border-gray-200 bg-white px-3 py-3 text-sm font-black text-gray-900 outline-none focus:border-red-500"
              placeholder="Zone name"
            />
            <input
              type="number"
              min="0"
              value={newDeliveryZone.delivery_fee}
              onChange={(event) =>
                updateNewDeliveryZone({ delivery_fee: Number(event.target.value) || 0 })
              }
              className="rounded-md border border-gray-200 bg-white px-3 py-3 text-sm font-black text-gray-900 outline-none focus:border-red-500"
              placeholder="Fee"
            />
            <input
              type="number"
              min="0"
              value={newDeliveryZone.minimum_order_amount}
              onChange={(event) =>
                updateNewDeliveryZone({ minimum_order_amount: Number(event.target.value) || 0 })
              }
              className="rounded-md border border-gray-200 bg-white px-3 py-3 text-sm font-black text-gray-900 outline-none focus:border-red-500"
              placeholder="Minimum"
            />
            <input
              type="number"
              min="1"
              value={newDeliveryZone.eta_min_minutes}
              onChange={(event) =>
                updateNewDeliveryZone({ eta_min_minutes: Number(event.target.value) || 1 })
              }
              className="rounded-md border border-gray-200 bg-white px-3 py-3 text-sm font-black text-gray-900 outline-none focus:border-red-500"
              placeholder="ETA min"
            />
            <input
              type="number"
              min="1"
              value={newDeliveryZone.eta_max_minutes}
              onChange={(event) =>
                updateNewDeliveryZone({ eta_max_minutes: Number(event.target.value) || 1 })
              }
              className="rounded-md border border-gray-200 bg-white px-3 py-3 text-sm font-black text-gray-900 outline-none focus:border-red-500"
              placeholder="ETA max"
            />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto]">
            <input
              value={newDeliveryZone.keywords}
              onChange={(event) =>
                updateNewDeliveryZone({ keywords: event.target.value })
              }
              className="rounded-md border border-gray-200 bg-white px-3 py-3 text-sm font-semibold text-gray-700 outline-none focus:border-red-500"
              placeholder="Coverage keywords separated by comma"
            />
            <button
              onClick={createDeliveryZone}
              disabled={isCreatingDeliveryZone}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-red-700 px-4 py-3 text-sm font-black text-white hover:bg-red-800 disabled:bg-gray-300"
            >
              <Plus className="h-4 w-4" />
              {isCreatingDeliveryZone ? "Adding" : "Add Zone"}
            </button>
          </div>
        </div>

        {isDeliveryLoading ? (
          <div className="mt-5 rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm font-semibold text-gray-500">
            Loading delivery zones...
          </div>
        ) : deliveryZones.length ? (
          <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
            {deliveryZones.map((zone) => {
              const draft = deliveryDrafts[zone.id] || zone;
              return (
                <div key={zone.id} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <input
                      value={draft.name}
                      onChange={(event) =>
                        updateDeliveryDraft(zone.id, { name: event.target.value })
                      }
                      className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-black text-gray-900 outline-none focus:border-red-500"
                    />
                    <label className="inline-flex items-center gap-2 text-xs font-black text-gray-600">
                      <input
                        type="checkbox"
                        checked={draft.is_active}
                        onChange={(event) =>
                          updateDeliveryDraft(zone.id, { is_active: event.target.checked })
                        }
                        className="h-4 w-4 rounded border-gray-300 text-red-600"
                      />
                      Active
                    </label>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <label className="text-xs font-bold text-gray-500">
                      Fee
                      <input
                        type="number"
                        min="0"
                        value={draft.delivery_fee}
                        onChange={(event) =>
                          updateDeliveryDraft(zone.id, {
                            delivery_fee: Number(event.target.value) || 0,
                          })
                        }
                        className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-black text-gray-900 outline-none focus:border-red-500"
                      />
                    </label>
                    <label className="text-xs font-bold text-gray-500">
                      Minimum
                      <input
                        type="number"
                        min="0"
                        value={draft.minimum_order_amount}
                        onChange={(event) =>
                          updateDeliveryDraft(zone.id, {
                            minimum_order_amount: Number(event.target.value) || 0,
                          })
                        }
                        className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-black text-gray-900 outline-none focus:border-red-500"
                      />
                    </label>
                    <label className="text-xs font-bold text-gray-500">
                      ETA Min
                      <input
                        type="number"
                        min="1"
                        value={draft.eta_min_minutes}
                        onChange={(event) =>
                          updateDeliveryDraft(zone.id, {
                            eta_min_minutes: Number(event.target.value) || 1,
                          })
                        }
                        className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-black text-gray-900 outline-none focus:border-red-500"
                      />
                    </label>
                    <label className="text-xs font-bold text-gray-500">
                      ETA Max
                      <input
                        type="number"
                        min="1"
                        value={draft.eta_max_minutes}
                        onChange={(event) =>
                          updateDeliveryDraft(zone.id, {
                            eta_max_minutes: Number(event.target.value) || 1,
                          })
                        }
                        className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-black text-gray-900 outline-none focus:border-red-500"
                      />
                    </label>
                  </div>

                  <label className="mt-3 block text-xs font-bold text-gray-500">
                    Coverage Keywords
                    <textarea
                      value={(draft.keywords || []).join(", ")}
                      onChange={(event) =>
                        updateDeliveryDraft(zone.id, {
                          keywords: event.target.value
                            .split(",")
                            .map((keyword) => keyword.trim())
                            .filter(Boolean),
                        })
                      }
                      rows={3}
                      className="mt-1 w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 outline-none focus:border-red-500"
                    />
                  </label>

                  <button
                    onClick={() => saveDeliveryZone(zone.id)}
                    disabled={savingZoneId === zone.id}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-red-700 px-4 py-3 text-sm font-black text-white hover:bg-red-800 disabled:bg-gray-300"
                  >
                    <Save className="h-4 w-4" />
                    {savingZoneId === zone.id ? "Saving" : "Save Zone"}
                  </button>
                  <button
                    onClick={() => archiveDeliveryZone(zone)}
                    disabled={archivingZoneId === zone.id}
                    className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md border border-gray-200 bg-white px-4 py-3 text-sm font-black text-gray-700 hover:border-red-200 hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    {archivingZoneId === zone.id ? "Archiving" : "Archive Zone"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-red-100 bg-red-50 p-4 text-sm font-semibold text-red-700">
            Delivery zones are unavailable. Check the backend delivery API.
          </div>
        )}

        <div className="mt-5 rounded-lg border border-gray-100 bg-white p-4">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-red-700" />
            <div>
              <p className="font-black text-gray-900">Address Validation Tester</p>
              <p className="text-sm text-gray-500">
                Uses the same quote endpoint as customer checkout.
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1.5fr_0.6fr_0.8fr_auto]">
            <input
              value={quoteAddress}
              onChange={(event) => setQuoteAddress(event.target.value)}
              className="rounded-md border border-gray-200 px-3 py-3 text-sm font-semibold outline-none focus:border-red-500"
              placeholder="House/building and area"
            />
            <input
              type="number"
              min="0"
              value={quoteSubtotal}
              onChange={(event) => setQuoteSubtotal(Number(event.target.value) || 0)}
              className="rounded-md border border-gray-200 px-3 py-3 text-sm font-semibold outline-none focus:border-red-500"
              placeholder="Subtotal"
            />
            <select
              value={quoteZoneId || ""}
              onChange={(event) => setQuoteZoneId(Number(event.target.value) || null)}
              className="rounded-md border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-700 outline-none focus:border-red-500"
            >
              {deliveryZones.map((zone) => (
                <option key={`quote-${zone.id}`} value={zone.id}>
                  {zone.name}
                </option>
              ))}
            </select>
            <button
              onClick={testDeliveryQuote}
              disabled={isQuotingDelivery}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-gray-900 px-5 py-3 text-sm font-black text-white hover:bg-red-700 disabled:bg-gray-300"
            >
              <MapPin className="h-4 w-4" />
              {isQuotingDelivery ? "Testing" : "Test"}
            </button>
          </div>

          {deliveryQuote && (
            <div
              className={`mt-4 rounded-md border px-4 py-3 text-sm font-semibold ${
                deliveryQuote.is_deliverable
                  ? "border-green-100 bg-green-50 text-green-800"
                  : "border-red-100 bg-red-50 text-red-800"
              }`}
            >
              {deliveryQuote.is_deliverable
                ? `${deliveryQuote.zone?.name || "Delivery"} is available: Rs ${deliveryQuote.delivery_fee}, ETA ${deliveryQuote.eta_window}.`
                : `${deliveryQuote.reason || "This address is not deliverable."}${
                    deliveryQuote.charge_breakdown?.minimum_gap
                      ? ` Add Rs ${Math.round(deliveryQuote.charge_breakdown.minimum_gap)} more to unlock this zone.`
                      : ""
                  }`}
            </div>
          )}

          {deliveryQuote?.address_validation && (
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-md border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs font-black uppercase text-gray-500">Address Score</p>
                <p className="mt-1 text-xl font-black text-gray-900">
                  {deliveryQuote.address_validation.score}/100
                </p>
                <p className="text-xs font-semibold capitalize text-gray-500">
                  {deliveryQuote.address_validation.quality}
                </p>
              </div>
              <div className="rounded-md border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs font-black uppercase text-gray-500">Matched Keyword</p>
                <p className="mt-1 text-sm font-black text-gray-900">
                  {deliveryQuote.address_validation.matched_keyword || "Manual zone"}
                </p>
                <p className="text-xs font-semibold text-gray-500">
                  {deliveryQuote.address}
                </p>
              </div>
              <div className="rounded-md border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs font-black uppercase text-gray-500">Total With Delivery</p>
                <p className="mt-1 text-xl font-black text-gray-900">
                  Rs {Math.round(deliveryQuote.charge_breakdown?.total_with_delivery || 0)}
                </p>
                <p className="text-xs font-semibold text-gray-500">
                  Min Rs {Math.round(deliveryQuote.charge_breakdown?.minimum_order_amount || 0)}
                </p>
              </div>
            </div>
          )}

          {!!deliveryQuote?.address_validation?.warnings?.length && (
            <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
              {deliveryQuote.address_validation.warnings.join(" ")}
            </div>
          )}
        </div>
      </div>

      {/* Google Sheets Integration */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center mb-4">
          <div className="p-2 bg-green-100 rounded-lg mr-3">
            <RefreshCw className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">Google Sheets Data Sync</h3>
            <p className="text-sm text-gray-500">Import daily sales rows from your spreadsheet into Supabase.</p>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Spreadsheet URL</label>
            <input
              type="url"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full border border-gray-200 rounded-lg p-3 text-sm focus:ring-2 focus:ring-orange-500 outline-none transition-all"
            />
          </div>

          <div className="flex gap-4">
            <label className="flex items-center cursor-pointer">
              <input 
                type="radio" 
                name="importMode" 
                value="all" 
                checked={importMode === "all"} 
                onChange={() => setImportMode("all")}
                className="w-4 h-4 text-orange-600 focus:ring-orange-500"
              />
              <span className="ml-2 text-sm text-gray-700 font-medium">Import Accessible Rows</span>
            </label>
            <label className="flex items-center cursor-pointer">
              <input 
                type="radio" 
                name="importMode" 
                value="current" 
                checked={importMode === "current"} 
                onChange={() => setImportMode("current")}
                className="w-4 h-4 text-orange-600 focus:ring-orange-500"
              />
              <span className="ml-2 text-sm text-gray-700 font-medium">Current Month Only</span>
            </label>
          </div>

          <div className="text-xs text-gray-500 bg-orange-50 p-3 rounded-lg border border-orange-100 italic">
            <strong>Note:</strong> The importer maps headers automatically, and also supports <code className="bg-white px-1 rounded border">A:Date</code>, <code className="bg-white px-1 rounded border">B:Cash</code>, <code className="bg-white px-1 rounded border">C:Expense</code>, <code className="bg-white px-1 rounded border">D:Sale</code>.
          </div>

          <div className="pt-2">
            <button
              onClick={handleSync}
              disabled={isSyncing}
              className="px-6 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-bold shadow-md transition-all flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSyncing ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Importing Data...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Import Sales Data
                </>
              )}
            </button>
            
            {isSyncing && (
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-xs font-medium text-gray-600">
                  <span>Processing spreadsheet...</span>
                  <span>Live import</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div className="bg-orange-500 h-2 rounded-full animate-pulse" style={{width: '100%'}}></div>
                </div>
              </div>
            )}

            {syncMessage && !syncResult && (
              <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-lg text-amber-800 text-sm font-semibold">
                {syncMessage}
              </div>
            )}

            {syncResult && (
              <div className="mt-4 p-3 bg-green-50 border border-green-100 rounded-lg text-green-700 text-sm font-medium animate-in zoom-in-95 duration-200">
                <div className="flex items-center">
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Successfully imported {syncResult.rows_imported} days across {syncResult.months_processed} source{syncResult.months_processed === 1 ? "" : "s"}.
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-bold text-green-800 md:grid-cols-4">
                  <span>Created: {syncResult.rows_created}</span>
                  <span>Updated: {syncResult.rows_updated}</span>
                  <span>Skipped: {syncResult.rows_skipped}</span>
                  <span>{syncResult.date_start || "No date"} - {syncResult.date_end || "No date"}</span>
                </div>
                {!!syncResult.skip_reasons?.length && (
                  <div className="mt-2 rounded-md bg-white/70 p-2 text-xs font-semibold text-green-900">
                    {syncResult.skip_reasons.slice(0, 3).join(" ")}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Expense Categories */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center mb-4">
          <div className="p-2 bg-orange-100 rounded-lg mr-3">
            <Layers className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">Expense Categories</h3>
            <p className="text-sm text-gray-500">Add or remove categories for the expense tracker.</p>
          </div>
        </div>

        <div className="space-y-2 mb-4">
          {categories.map((cat) => (
            <div key={cat.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100 hover:border-gray-200 transition-all">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={cat.active}
                  onChange={() => toggleCategory(cat.id)}
                  className="w-4 h-4 text-orange-600 rounded border-gray-300 focus:ring-orange-500 cursor-pointer mr-3"
                />
                <span className={`font-medium ${cat.active ? 'text-gray-800' : 'text-gray-400 line-through'}`}>
                  {cat.name}
                </span>
              </div>
              <button
                onClick={() => deleteCategory(cat.id)}
                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCategory()}
            placeholder="New category name..."
            className="flex-1 border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-orange-500 outline-none"
          />
          <button
            onClick={addCategory}
            className="px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-bold transition-colors flex items-center shadow-sm"
          >
            <Plus className="w-4 h-4 mr-1.5" /> Add
          </button>
        </div>
      </div>

      {/* Admin Credentials */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center mb-4">
          <div className="p-2 bg-blue-100 rounded-lg mr-3">
            <Shield className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">Admin Credentials</h3>
            <p className="text-sm text-gray-500">Update the portal login ID and password.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Admin ID</label>
            <input
              type="text"
              value={adminId}
              onChange={(e) => setAdminId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-orange-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="Enter new password"
              className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-orange-500 outline-none"
            />
          </div>
        </div>
        <div className="mt-4">
          <button className="px-5 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-lg font-bold shadow-sm transition-colors flex items-center">
            <Save className="w-4 h-4 mr-2" /> Save Credentials
          </button>
        </div>
      </div>
    </div>
  );
}
