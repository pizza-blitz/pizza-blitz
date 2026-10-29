"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Pencil,
  Play,
  Plus,
  Search,
  X,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";
import {
  DepartmentToolShell,
  EmptyState,
  ErrorNote,
  LoadingRow,
  Panel,
  StatCard,
  StatusBadge,
  formatDate,
  formatMoney,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/department-tools";

type Asset = {
  id: number;
  name: string;
  category: string;
  location: string | null;
  serial_number: string | null;
  status: string;
  criticality: string;
  purchase_date: string | null;
  warranty_until: string | null;
  next_service_due: string | null;
  service_due: boolean;
  open_work_orders: number;
  notes: string | null;
};

type AssetSummary = {
  total: number;
  operational: number;
  under_maintenance: number;
  out_of_service: number;
  due_service: number;
  open_work_orders: number;
};

type WorkOrder = {
  id: number;
  asset_id: number | null;
  asset_name: string | null;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  reported_by: string | null;
  assigned_to: string | null;
  due_at: string | null;
  completed_at: string | null;
  cost: number;
  overdue: boolean;
  created_at: string;
};

type WorkOrderSummary = {
  open: number;
  in_progress: number;
  completed: number;
  overdue: number;
};

type AssetsPayload = {
  items: Asset[];
  summary: AssetSummary;
};

type WorkOrdersPayload = {
  items: WorkOrder[];
  summary: WorkOrderSummary;
};

const ASSET_CATEGORIES = [
  "kitchen",
  "refrigeration",
  "hvac",
  "electrical",
  "furniture",
  "it",
] as const;

const ASSET_STATUSES = ["operational", "under_maintenance", "out_of_service"] as const;
const CRITICALITIES = ["low", "normal", "high", "critical"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const WORK_ORDER_STATUSES = ["open", "in_progress", "completed"] as const;

type AssetForm = {
  name: string;
  category: string;
  location: string;
  serial_number: string;
  status: string;
  criticality: string;
  next_service_due: string;
  warranty_until: string;
  notes: string;
};

const EMPTY_ASSET_FORM: AssetForm = {
  name: "",
  category: "kitchen",
  location: "",
  serial_number: "",
  status: "operational",
  criticality: "normal",
  next_service_due: "",
  warranty_until: "",
  notes: "",
};

type WorkOrderForm = {
  title: string;
  asset_id: string;
  description: string;
  priority: string;
  assigned_to: string;
  due_at: string;
};

const EMPTY_WORK_ORDER_FORM: WorkOrderForm = {
  title: "",
  asset_id: "",
  description: "",
  priority: "normal",
  assigned_to: "",
  due_at: "",
};

const CRITICALITY_TONES: Record<string, string> = {
  low: "bg-gray-50 text-gray-600 border-gray-200",
  normal: "bg-blue-50 text-blue-700 border-blue-100",
  high: "bg-amber-50 text-amber-700 border-amber-100",
  critical: "bg-red-50 text-red-700 border-red-100",
};

const PRIORITY_TONES: Record<string, string> = {
  low: "bg-gray-50 text-gray-600 border-gray-200",
  normal: "bg-blue-50 text-blue-700 border-blue-100",
  high: "bg-amber-50 text-amber-700 border-amber-100",
  urgent: "bg-red-50 text-red-700 border-red-100",
};

function toneBadge(label: string, tones: Record<string, string>) {
  return tones[label] || "bg-gray-50 text-gray-600 border-gray-200";
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(getApiUrl(path), {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const errorBody = body as { detail?: string } | null;
    throw new Error(errorBody?.detail || `Request failed (${res.status})`);
  }
  return body as T;
}

export default function FacilitiesAssetsPage() {
  const [tab, setTab] = useState<"assets" | "work_orders">("assets");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetSummary, setAssetSummary] = useState<AssetSummary | null>(null);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [orderSummary, setOrderSummary] = useState<WorkOrderSummary | null>(null);
  const [isLoadingAssets, setIsLoadingAssets] = useState(true);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [assetQuery, setAssetQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [assetForm, setAssetForm] = useState<AssetForm>(EMPTY_ASSET_FORM);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [orderForm, setOrderForm] = useState<WorkOrderForm>(
    EMPTY_WORK_ORDER_FORM
  );

  const loadAssets = async () => {
    setIsLoadingAssets(true);
    try {
      const params = new URLSearchParams();
      if (assetQuery.trim()) params.set("query", assetQuery.trim());
      if (categoryFilter) params.set("category", categoryFilter);
      if (statusFilter) params.set("status", statusFilter);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const data = await apiRequest<AssetsPayload>(
        `/api/v1/restaurant/company/operations/assets${suffix}`
      );
      setAssets(data.items || []);
      setAssetSummary(data.summary || null);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Assets failed to load."
      );
    } finally {
      setIsLoadingAssets(false);
    }
  };

  const loadOrders = async () => {
    setIsLoadingOrders(true);
    try {
      const params = new URLSearchParams();
      if (orderStatusFilter) params.set("status", orderStatusFilter);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const data = await apiRequest<WorkOrdersPayload>(
        `/api/v1/restaurant/company/operations/work-orders${suffix}`
      );
      setOrders(data.items || []);
      setOrderSummary(data.summary || null);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Work orders failed to load."
      );
    } finally {
      setIsLoadingOrders(false);
    }
  };

  useEffect(() => {
    void loadAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "work_orders") void loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, orderStatusFilter]);

  const openCreateAsset = () => {
    setEditingAsset(null);
    setAssetForm(EMPTY_ASSET_FORM);
    setShowAssetForm(true);
    setMessage("");
    setNotice("");
  };

  const openEditAsset = (asset: Asset) => {
    setEditingAsset(asset);
    setAssetForm({
      name: asset.name,
      category: asset.category,
      location: asset.location || "",
      serial_number: asset.serial_number || "",
      status: asset.status,
      criticality: asset.criticality,
      next_service_due: asset.next_service_due
        ? asset.next_service_due.slice(0, 10)
        : "",
      warranty_until: asset.warranty_until
        ? asset.warranty_until.slice(0, 10)
        : "",
      notes: asset.notes || "",
    });
    setShowAssetForm(true);
    setMessage("");
    setNotice("");
  };

  const saveAsset = async () => {
    const name = assetForm.name.trim();
    if (!name) {
      setMessage("Asset name is required.");
      return;
    }
    setBusyKey("asset");
    setMessage("");
    setNotice("");
    try {
      const payload = {
        name,
        category: assetForm.category,
        location: assetForm.location.trim() || null,
        serial_number: assetForm.serial_number.trim() || null,
        status: assetForm.status,
        criticality: assetForm.criticality,
        next_service_due: assetForm.next_service_due || null,
        warranty_until: assetForm.warranty_until || null,
        notes: assetForm.notes.trim() || null,
      };
      await apiRequest<unknown>(
        editingAsset
          ? `/api/v1/restaurant/company/operations/assets/${editingAsset.id}`
          : "/api/v1/restaurant/company/operations/assets",
        {
          method: editingAsset ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      setShowAssetForm(false);
      setEditingAsset(null);
      setAssetForm(EMPTY_ASSET_FORM);
      await loadAssets();
      setNotice(`${name} saved to the asset register.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Asset could not be saved."
      );
    } finally {
      setBusyKey("");
    }
  };

  const createWorkOrder = async () => {
    const title = orderForm.title.trim();
    if (!title) {
      setMessage("Work order title is required.");
      return;
    }
    setBusyKey("order");
    setMessage("");
    setNotice("");
    try {
      await apiRequest<unknown>(
        "/api/v1/restaurant/company/operations/work-orders",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            asset_id: orderForm.asset_id ? Number(orderForm.asset_id) : null,
            description: orderForm.description.trim() || null,
            priority: orderForm.priority,
            assigned_to: orderForm.assigned_to.trim() || null,
            due_at: orderForm.due_at || null,
          }),
        }
      );
      setShowOrderForm(false);
      setOrderForm(EMPTY_WORK_ORDER_FORM);
      await Promise.all([loadOrders(), loadAssets()]);
      setNotice(`${title} work order created.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Work order could not be saved."
      );
    } finally {
      setBusyKey("");
    }
  };

  const updateOrderStatus = async (
    order: WorkOrder,
    status: "in_progress" | "completed"
  ) => {
    setBusyKey(`order-${order.id}`);
    setMessage("");
    setNotice("");
    try {
      await apiRequest<unknown>(
        `/api/v1/restaurant/company/operations/work-orders/${order.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }
      );
      await Promise.all([loadOrders(), loadAssets()]);
      setNotice(
        `${order.title} marked ${status === "completed" ? "completed" : "in progress"}.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Work order could not be updated."
      );
    } finally {
      setBusyKey("");
    }
  };

  return (
    <DepartmentToolShell
      departmentKey="facilities"
      departmentLabel="Facilities"
      title="Assets & maintenance"
      subtitle="Track equipment, service dates and maintenance work orders across the restaurant."
    >
      <div data-testid="assets-page" className="space-y-6">
        <ErrorNote message={message} />
        {notice ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
            {notice}
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {tab === "assets" ? (
            <>
              <StatCard
                label="Total assets"
                value={assetSummary?.total ?? 0}
                hint={`${assetSummary?.under_maintenance ?? 0} under maintenance`}
              />
              <StatCard
                label="Operational"
                value={assetSummary?.operational ?? 0}
                tone="good"
              />
              <StatCard
                label="Due service"
                value={assetSummary?.due_service ?? 0}
                tone="warn"
              />
              <StatCard
                label="Open work orders"
                value={assetSummary?.open_work_orders ?? 0}
                tone="info"
              />
            </>
          ) : (
            <>
              <StatCard label="Open" value={orderSummary?.open ?? 0} tone="info" />
              <StatCard
                label="In progress"
                value={orderSummary?.in_progress ?? 0}
              />
              <StatCard
                label="Completed"
                value={orderSummary?.completed ?? 0}
                tone="good"
              />
              <StatCard
                label="Overdue"
                value={orderSummary?.overdue ?? 0}
                tone="bad"
              />
            </>
          )}
        </section>

        <div className="flex w-fit flex-wrap items-center gap-1 rounded-xl border border-gray-200 bg-white p-1">
          <button
            type="button"
            data-testid="assets-tab-assets"
            onClick={() => setTab("assets")}
            className={`rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest ${
              tab === "assets"
                ? "bg-gray-950 text-white"
                : "text-gray-500 hover:bg-gray-50"
            }`}
          >
            Assets
          </button>
          <button
            type="button"
            data-testid="assets-tab-work-orders"
            onClick={() => setTab("work_orders")}
            className={`rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest ${
              tab === "work_orders"
                ? "bg-gray-950 text-white"
                : "text-gray-500 hover:bg-gray-50"
            }`}
          >
            Work orders
          </button>
        </div>

        {tab === "assets" ? (
          <>
            {showAssetForm ? (
              <Panel
                title={editingAsset ? "Edit asset" : "Add asset"}
                description={
                  editingAsset
                    ? editingAsset.name
                    : "Register equipment so service and work orders stay visible."
                }
                actions={
                  <button
                    type="button"
                    aria-label="Close asset form"
                    onClick={() => {
                      setShowAssetForm(false);
                      setEditingAsset(null);
                    }}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                }
              >
                <form
                  data-testid="asset-form"
                  className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveAsset();
                  }}
                >
                  <label className="block">
                    <span className={labelClass}>Name</span>
                    <input
                      data-testid="asset-name"
                      value={assetForm.name}
                      onChange={(event) =>
                        setAssetForm({ ...assetForm, name: event.target.value })
                      }
                      placeholder="Walk-in chiller"
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                  <label className="block">
                    <span className={labelClass}>Category</span>
                    <select
                      value={assetForm.category}
                      onChange={(event) =>
                        setAssetForm({
                          ...assetForm,
                          category: event.target.value,
                        })
                      }
                      className={`${inputClass} mt-1`}
                    >
                      {ASSET_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {category.charAt(0).toUpperCase() + category.slice(1)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={labelClass}>Location</span>
                    <input
                      value={assetForm.location}
                      onChange={(event) =>
                        setAssetForm({
                          ...assetForm,
                          location: event.target.value,
                        })
                      }
                      placeholder="Main kitchen"
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                  <label className="block">
                    <span className={labelClass}>Serial number</span>
                    <input
                      value={assetForm.serial_number}
                      onChange={(event) =>
                        setAssetForm({
                          ...assetForm,
                          serial_number: event.target.value,
                        })
                      }
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                  <label className="block">
                    <span className={labelClass}>Status</span>
                    <select
                      value={assetForm.status}
                      onChange={(event) =>
                        setAssetForm({ ...assetForm, status: event.target.value })
                      }
                      className={`${inputClass} mt-1`}
                    >
                      {ASSET_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={labelClass}>Criticality</span>
                    <select
                      value={assetForm.criticality}
                      onChange={(event) =>
                        setAssetForm({
                          ...assetForm,
                          criticality: event.target.value,
                        })
                      }
                      className={`${inputClass} mt-1`}
                    >
                      {CRITICALITIES.map((criticality) => (
                        <option key={criticality} value={criticality}>
                          {criticality}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={labelClass}>Next service</span>
                    <input
                      type="date"
                      value={assetForm.next_service_due}
                      onChange={(event) =>
                        setAssetForm({
                          ...assetForm,
                          next_service_due: event.target.value,
                        })
                      }
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                  <label className="block">
                    <span className={labelClass}>Warranty until</span>
                    <input
                      type="date"
                      value={assetForm.warranty_until}
                      onChange={(event) =>
                        setAssetForm({
                          ...assetForm,
                          warranty_until: event.target.value,
                        })
                      }
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                  <label className="block sm:col-span-2 lg:col-span-3">
                    <span className={labelClass}>Notes</span>
                    <textarea
                      rows={2}
                      value={assetForm.notes}
                      onChange={(event) =>
                        setAssetForm({ ...assetForm, notes: event.target.value })
                      }
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                  <div className="flex items-center justify-end gap-2 sm:col-span-2 lg:col-span-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAssetForm(false);
                        setEditingAsset(null);
                      }}
                      className={secondaryButtonClass}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      data-testid="asset-save"
                      disabled={busyKey === "asset"}
                      className={`${primaryButtonClass} inline-flex items-center gap-1.5`}
                    >
                      {busyKey === "asset" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      {editingAsset ? "Save changes" : "Add asset"}
                    </button>
                  </div>
                </form>
              </Panel>
            ) : null}

            <Panel
              title="Asset register"
              description="Service due dates, criticality and maintenance load at a glance."
              actions={
                <button
                  type="button"
                  data-testid="asset-create-open"
                  onClick={openCreateAsset}
                  className={`${primaryButtonClass} inline-flex items-center gap-1.5`}
                >
                  <Plus className="h-3.5 w-3.5" /> Add asset
                </button>
              }
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <div className="relative min-w-[200px] flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <input
                    value={assetQuery}
                    onChange={(event) => setAssetQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void loadAssets();
                    }}
                    placeholder="Search assets, serials or locations"
                    aria-label="Search assets"
                    className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm font-semibold text-gray-900 outline-none focus:border-gray-400"
                  />
                </div>
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                  aria-label="Filter assets by category"
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600"
                >
                  <option value="">All categories</option>
                  {ASSET_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category.charAt(0).toUpperCase() + category.slice(1)}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  aria-label="Filter assets by status"
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600"
                >
                  <option value="">All statuses</option>
                  {ASSET_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void loadAssets()}
                  className={secondaryButtonClass}
                >
                  Apply filters
                </button>
              </div>

              {isLoadingAssets ? (
                <LoadingRow label="Loading assets..." />
              ) : assets.length === 0 ? (
                <div className="mt-4">
                  <EmptyState
                    title="No assets found"
                    body="Add equipment or clear the filters to see the register."
                  />
                </div>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-left">
                    <thead>
                      <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                        <th className="px-2 py-2">Asset</th>
                        <th className="px-2 py-2">Category</th>
                        <th className="px-2 py-2">Status</th>
                        <th className="px-2 py-2">Criticality</th>
                        <th className="px-2 py-2">Next service</th>
                        <th className="px-2 py-2">Open WOs</th>
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {assets.map((asset) => (
                        <tr
                          key={asset.id}
                          data-testid={`asset-row-${asset.id}`}
                          className={`border-b border-gray-50 text-sm ${
                            asset.service_due ? "bg-amber-50/40" : ""
                          }`}
                        >
                          <td className="px-2 py-3">
                            <p className="font-black text-gray-900">{asset.name}</p>
                            <p className="text-[10px] font-semibold text-gray-400">
                              {asset.location || "No location"}
                              {asset.serial_number
                                ? ` · ${asset.serial_number}`
                                : ""}
                            </p>
                          </td>
                          <td className="px-2 py-3 text-xs font-bold capitalize text-gray-500">
                            {asset.category.replace(/_/g, " ")}
                          </td>
                          <td className="px-2 py-3">
                            <StatusBadge label={asset.status} />
                          </td>
                          <td className="px-2 py-3">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${toneBadge(
                                asset.criticality,
                                CRITICALITY_TONES
                              )}`}
                            >
                              {asset.criticality}
                            </span>
                          </td>
                          <td className="px-2 py-3">
                            <p className="text-xs font-bold text-gray-600">
                              {formatDate(asset.next_service_due)}
                            </p>
                            {asset.service_due ? (
                              <span className="mt-1 inline-flex rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-red-700">
                                Service due
                              </span>
                            ) : null}
                          </td>
                          <td className="px-2 py-3 text-xs font-black text-gray-700">
                            {asset.open_work_orders}
                          </td>
                          <td className="px-2 py-3 text-right">
                            <button
                              type="button"
                              data-testid={`asset-edit-${asset.id}`}
                              aria-label={`Edit ${asset.name}`}
                              onClick={() => openEditAsset(asset)}
                              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </>
        ) : (
          <>
            {showOrderForm ? (
              <Panel
                title="New work order"
                description="Assign a maintenance job to an asset and owner."
                actions={
                  <button
                    type="button"
                    aria-label="Close work order form"
                    onClick={() => setShowOrderForm(false)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                }
              >
                <form
                  data-testid="work-order-form"
                  className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createWorkOrder();
                  }}
                >
                  <label className="block">
                    <span className={labelClass}>Title</span>
                    <input
                      data-testid="work-order-title"
                      value={orderForm.title}
                      onChange={(event) =>
                        setOrderForm({ ...orderForm, title: event.target.value })
                      }
                      placeholder="Chiller not cooling"
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                  <label className="block">
                    <span className={labelClass}>Asset</span>
                    <select
                      value={orderForm.asset_id}
                      onChange={(event) =>
                        setOrderForm({
                          ...orderForm,
                          asset_id: event.target.value,
                        })
                      }
                      className={`${inputClass} mt-1`}
                    >
                      <option value="">No specific asset</option>
                      {assets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={labelClass}>Priority</span>
                    <select
                      value={orderForm.priority}
                      onChange={(event) =>
                        setOrderForm({
                          ...orderForm,
                          priority: event.target.value,
                        })
                      }
                      className={`${inputClass} mt-1`}
                    >
                      {PRIORITIES.map((priority) => (
                        <option key={priority} value={priority}>
                          {priority.charAt(0).toUpperCase() + priority.slice(1)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={labelClass}>Assign to</span>
                    <input
                      value={orderForm.assigned_to}
                      onChange={(event) =>
                        setOrderForm({
                          ...orderForm,
                          assigned_to: event.target.value,
                        })
                      }
                      placeholder="Technician or staff name"
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                  <label className="block">
                    <span className={labelClass}>Due</span>
                    <input
                      type="datetime-local"
                      value={orderForm.due_at}
                      onChange={(event) =>
                        setOrderForm({
                          ...orderForm,
                          due_at: event.target.value,
                        })
                      }
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                  <label className="block sm:col-span-2 lg:col-span-3">
                    <span className={labelClass}>Description</span>
                    <textarea
                      rows={2}
                      value={orderForm.description}
                      onChange={(event) =>
                        setOrderForm({
                          ...orderForm,
                          description: event.target.value,
                        })
                      }
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                  <div className="flex items-center justify-end gap-2 sm:col-span-2 lg:col-span-3">
                    <button
                      type="button"
                      onClick={() => setShowOrderForm(false)}
                      className={secondaryButtonClass}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      data-testid="work-order-save"
                      disabled={busyKey === "order"}
                      className={`${primaryButtonClass} inline-flex items-center gap-1.5`}
                    >
                      {busyKey === "order" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      Create work order
                    </button>
                  </div>
                </form>
              </Panel>
            ) : null}

            <Panel
              title="Work orders"
              description="Maintenance jobs with priority, ownership and completion status."
              actions={
                <button
                  type="button"
                  data-testid="work-order-create-open"
                  onClick={() => {
                    setShowOrderForm(true);
                    setMessage("");
                    setNotice("");
                  }}
                  className={`${primaryButtonClass} inline-flex items-center gap-1.5`}
                >
                  <Plus className="h-3.5 w-3.5" /> New work order
                </button>
              }
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <select
                  value={orderStatusFilter}
                  onChange={(event) => setOrderStatusFilter(event.target.value)}
                  aria-label="Filter work orders by status"
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600"
                >
                  <option value="">All statuses</option>
                  {WORK_ORDER_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void loadOrders()}
                  className={secondaryButtonClass}
                >
                  Refresh
                </button>
              </div>

              {isLoadingOrders ? (
                <LoadingRow label="Loading work orders..." />
              ) : orders.length === 0 ? (
                <EmptyState
                  title="No work orders"
                  body="Log a maintenance job to schedule and track repairs."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left">
                    <thead>
                      <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                        <th className="px-2 py-2">Work order</th>
                        <th className="px-2 py-2">Priority</th>
                        <th className="px-2 py-2">Status</th>
                        <th className="px-2 py-2">Assignee</th>
                        <th className="px-2 py-2">Due</th>
                        <th className="px-2 py-2">Cost</th>
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((order) => (
                        <tr
                          key={order.id}
                          data-testid={`work-order-row-${order.id}`}
                          className={`border-b border-gray-50 text-sm ${
                            order.overdue ? "bg-red-50/60" : ""
                          }`}
                        >
                          <td className="px-2 py-3">
                            <p className="font-black text-gray-900">
                              {order.title}
                            </p>
                            <p className="text-[10px] font-semibold text-gray-400">
                              {order.asset_name || "No asset linked"}
                            </p>
                          </td>
                          <td className="px-2 py-3">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${toneBadge(
                                order.priority,
                                PRIORITY_TONES
                              )}`}
                            >
                              {order.priority}
                            </span>
                          </td>
                          <td className="px-2 py-3">
                            <StatusBadge label={order.status} />
                          </td>
                          <td className="px-2 py-3 text-xs font-bold text-gray-600">
                            {order.assigned_to || "Unassigned"}
                          </td>
                          <td className="px-2 py-3">
                            <p className="text-xs font-bold text-gray-600">
                              {formatDate(order.due_at)}
                            </p>
                            {order.overdue ? (
                              <span className="mt-1 inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-red-700">
                                Overdue
                              </span>
                            ) : null}
                          </td>
                          <td className="px-2 py-3 text-xs font-black text-gray-700">
                            {formatMoney(order.cost)}
                          </td>
                          <td className="px-2 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              {order.status !== "in_progress" &&
                              order.status !== "completed" ? (
                                <button
                                  type="button"
                                  data-testid={`work-order-start-${order.id}`}
                                  onClick={() =>
                                    void updateOrderStatus(order, "in_progress")
                                  }
                                  disabled={busyKey === `order-${order.id}`}
                                  className={`${secondaryButtonClass} inline-flex items-center gap-1`}
                                >
                                  {busyKey === `order-${order.id}` ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Play className="h-3 w-3" />
                                  )}
                                  Start
                                </button>
                              ) : null}
                              {order.status !== "completed" ? (
                                <button
                                  type="button"
                                  data-testid={`work-order-complete-${order.id}`}
                                  onClick={() =>
                                    void updateOrderStatus(order, "completed")
                                  }
                                  disabled={busyKey === `order-${order.id}`}
                                  className={`${secondaryButtonClass} inline-flex items-center gap-1`}
                                >
                                  <CheckCircle2 className="h-3 w-3" /> Complete
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </>
        )}
      </div>
    </DepartmentToolShell>
  );
}
