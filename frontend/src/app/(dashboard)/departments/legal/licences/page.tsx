"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Pencil, Plus, X } from "lucide-react";
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
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/department-tools";

type Licence = {
  id: number;
  name: string;
  category: string;
  licence_number: string | null;
  issuing_authority: string | null;
  issued_on: string | null;
  expires_on: string | null;
  status: string;
  stored_status: string | null;
  days_to_expiry: number | null;
  document_url: string | null;
  owner_staff_id: string | null;
  notes: string | null;
};

type LicenceSummary = {
  total: number;
  valid: number;
  due_soon: number;
  expired: number;
  void: number;
};

type LicencesPayload = {
  items: Licence[];
  summary: LicenceSummary;
};

type LicenceForm = {
  name: string;
  category: string;
  licence_number: string;
  issuing_authority: string;
  issued_on: string;
  expires_on: string;
  document_url: string;
  owner_staff_id: string;
  notes: string;
  status: string;
};

const EMPTY_LICENCE_FORM: LicenceForm = {
  name: "",
  category: "fssai",
  licence_number: "",
  issuing_authority: "",
  issued_on: "",
  expires_on: "",
  document_url: "",
  owner_staff_id: "",
  notes: "",
  status: "active",
};

const LICENCE_CATEGORIES = [
  "fssai",
  "fostac",
  "fire",
  "labour",
  "insurance",
  "trade",
  "other",
] as const;

const LICENCE_STATUSES = ["active", "void", "pending"] as const;
const FILTER_STATUSES = ["valid", "due_soon", "expired", "pending", "void"] as const;

function labelize(value: string) {
  return value.replace(/_/g, " ");
}

function expiryHint(days: number | null) {
  if (days === null) return "";
  const absolute = Math.abs(days);
  if (days < 0) {
    return `Expired ${absolute} day${absolute === 1 ? "" : "s"} ago`;
  }
  if (days === 0) return "Expires today";
  return `${absolute} day${absolute === 1 ? "" : "s"} left`;
}

function isExpired(licence: Licence) {
  return (
    licence.status === "expired" ||
    (licence.days_to_expiry !== null && licence.days_to_expiry < 0)
  );
}

function isDueSoon(licence: Licence) {
  return (
    !isExpired(licence) &&
    (licence.status === "due_soon" ||
      (licence.days_to_expiry !== null && licence.days_to_expiry <= 30))
  );
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

export default function LegalLicencesPage() {
  const [licences, setLicences] = useState<Licence[]>([]);
  const [summary, setSummary] = useState<LicenceSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Licence | null>(null);
  const [form, setForm] = useState<LicenceForm>(EMPTY_LICENCE_FORM);

  const loadLicences = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (categoryFilter) params.set("category", categoryFilter);
      if (statusFilter) params.set("status", statusFilter);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const data = await apiRequest<LicencesPayload>(
        `/api/v1/restaurant/company/quality/licences${suffix}`
      );
      setLicences(data.items || []);
      setSummary(data.summary || null);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Licences failed to load."
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadLicences();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, statusFilter]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_LICENCE_FORM);
    setShowForm(true);
    setMessage("");
    setNotice("");
  };

  const openEdit = (licence: Licence) => {
    setEditing(licence);
    setForm({
      name: licence.name,
      category: licence.category,
      licence_number: licence.licence_number || "",
      issuing_authority: licence.issuing_authority || "",
      issued_on: licence.issued_on ? licence.issued_on.slice(0, 10) : "",
      expires_on: licence.expires_on ? licence.expires_on.slice(0, 10) : "",
      document_url: licence.document_url || "",
      owner_staff_id:
        licence.owner_staff_id !== null ? String(licence.owner_staff_id) : "",
      notes: licence.notes || "",
      status:
        licence.status === "void" || licence.status === "pending"
          ? licence.status
          : "active",
    });
    setShowForm(true);
    setMessage("");
    setNotice("");
  };

  const saveLicence = async () => {
    const name = form.name.trim();
    if (!name) {
      setMessage("Licence name is required.");
      return;
    }
    const ownerValue = form.owner_staff_id.trim();
    const storedStatus = form.status === "active" ? "valid" : form.status;
    setBusyKey("licence");
    setMessage("");
    setNotice("");
    try {
      const payload: Record<string, string | null> = {
        name,
        category: form.category,
        licence_number: form.licence_number.trim() || null,
        issuing_authority: form.issuing_authority.trim() || null,
        issued_on: form.issued_on || null,
        expires_on: form.expires_on || null,
        document_url: form.document_url.trim() || null,
        owner_staff_id: ownerValue || null,
        notes: form.notes.trim() || null,
      };
      if (editing) payload.status = storedStatus;
      const saved = await apiRequest<Licence>(
        editing
          ? `/api/v1/restaurant/company/quality/licences/${editing.id}`
          : "/api/v1/restaurant/company/quality/licences",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!editing && storedStatus !== "valid" && saved.id) {
        await apiRequest<unknown>(
          `/api/v1/restaurant/company/quality/licences/${saved.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: storedStatus }),
          }
        );
      }
      setShowForm(false);
      setEditing(null);
      setForm(EMPTY_LICENCE_FORM);
      await loadLicences();
      setNotice(`${name} saved to the licence register.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Licence could not be saved."
      );
    } finally {
      setBusyKey("");
    }
  };

  const renewalRows = licences
    .filter((licence) => Boolean(licence.expires_on))
    .slice()
    .sort((a, b) => (a.expires_on || "").localeCompare(b.expires_on || ""))
    .slice(0, 5);

  return (
    <DepartmentToolShell
      departmentKey="legal"
      departmentLabel="Legal"
      title="Licences & contracts"
      subtitle="Keep FSSAI, fire, labour and insurance documents current with expiry tracking and renewals."
    >
      <div data-testid="licences-page" className="space-y-6">
        <ErrorNote message={message} />
        {notice ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
            {notice}
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Total licences" value={summary?.total ?? 0} />
          <StatCard label="Valid" value={summary?.valid ?? 0} tone="good" />
          <StatCard label="Due soon" value={summary?.due_soon ?? 0} tone="warn" />
          <StatCard label="Expired" value={summary?.expired ?? 0} tone="bad" />
          <StatCard label="Void" value={summary?.void ?? 0} />
        </section>

        {showForm ? (
          <Panel
            title={editing ? "Edit licence" : "Add licence"}
            description={
              editing
                ? editing.name
                : "Record the licence details and expiry so renewals never slip."
            }
            actions={
              <button
                type="button"
                aria-label="Close licence form"
                onClick={() => {
                  setShowForm(false);
                  setEditing(null);
                }}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-4 w-4" />
              </button>
            }
          >
            <form
              data-testid="licence-form"
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              onSubmit={(event) => {
                event.preventDefault();
                void saveLicence();
              }}
            >
              <label className="block">
                <span className={labelClass}>Name</span>
                <input
                  data-testid="licence-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  placeholder="FSSAI licence"
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Category</span>
                <select
                  value={form.category}
                  onChange={(event) =>
                    setForm({ ...form, category: event.target.value })
                  }
                  className={`${inputClass} mt-1`}
                >
                  {LICENCE_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={labelClass}>Licence number</span>
                <input
                  value={form.licence_number}
                  onChange={(event) =>
                    setForm({ ...form, licence_number: event.target.value })
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Issuing authority</span>
                <input
                  value={form.issuing_authority}
                  onChange={(event) =>
                    setForm({ ...form, issuing_authority: event.target.value })
                  }
                  placeholder="Food Safety and Standards Authority"
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Issued on</span>
                <input
                  type="date"
                  value={form.issued_on}
                  onChange={(event) =>
                    setForm({ ...form, issued_on: event.target.value })
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Expires on</span>
                <input
                  type="date"
                  value={form.expires_on}
                  onChange={(event) =>
                    setForm({ ...form, expires_on: event.target.value })
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className={labelClass}>Document URL</span>
                <input
                  type="url"
                  value={form.document_url}
                  onChange={(event) =>
                    setForm({ ...form, document_url: event.target.value })
                  }
                  placeholder="https://"
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Owner staff id</span>
                <input
                  value={form.owner_staff_id}
                  onChange={(event) =>
                    setForm({ ...form, owner_staff_id: event.target.value })
                  }
                  placeholder="Staff ID"
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Status</span>
                <select
                  value={form.status}
                  onChange={(event) =>
                    setForm({ ...form, status: event.target.value })
                  }
                  className={`${inputClass} mt-1`}
                >
                  {LICENCE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block sm:col-span-2 lg:col-span-3">
                <span className={labelClass}>Notes</span>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(event) =>
                    setForm({ ...form, notes: event.target.value })
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <div className="flex items-center justify-end gap-2 sm:col-span-2 lg:col-span-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditing(null);
                  }}
                  className={secondaryButtonClass}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="licence-save"
                  disabled={busyKey === "licence"}
                  className={`${primaryButtonClass} inline-flex items-center gap-1.5`}
                >
                  {busyKey === "licence" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  {editing ? "Save changes" : "Add licence"}
                </button>
              </div>
            </form>
          </Panel>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Panel
            title="Licence register"
            description="Expiry, authority and document links for every legal licence."
            actions={
              <button
                type="button"
                data-testid="licence-create-open"
                onClick={openCreate}
                className={`${primaryButtonClass} inline-flex items-center gap-1.5`}
              >
                <Plus className="h-3.5 w-3.5" /> Add licence
              </button>
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                aria-label="Filter licences by category"
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600"
              >
                <option value="">All categories</option>
                {LICENCE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category.toUpperCase()}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                aria-label="Filter licences by status"
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600"
              >
                <option value="">All statuses</option>
                {FILTER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {labelize(status)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void loadLicences()}
                className={secondaryButtonClass}
              >
                Refresh
              </button>
            </div>

            {isLoading ? (
              <LoadingRow label="Loading licences..." />
            ) : licences.length === 0 ? (
              <EmptyState
                title="No licences found"
                body="Add a licence or clear the filters to see the register."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                      <th className="px-2 py-2">Licence</th>
                      <th className="px-2 py-2">Number</th>
                      <th className="px-2 py-2">Authority</th>
                      <th className="px-2 py-2">Expiry</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2">Document</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {licences.map((licence) => {
                      const expired = isExpired(licence);
                      const dueSoon = isDueSoon(licence);
                      const safeUrl =
                        licence.document_url &&
                        /^https?:\/\//i.test(licence.document_url);
                      return (
                        <tr
                          key={licence.id}
                          data-testid={`licence-row-${licence.id}`}
                          className={`border-b border-gray-50 text-sm ${
                            expired
                              ? "bg-red-50/70"
                              : dueSoon
                                ? "bg-amber-50/60"
                                : ""
                          }`}
                        >
                          <td className="px-2 py-3">
                            <p className="font-black text-gray-900">
                              {licence.name}
                            </p>
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                              {licence.category}
                            </p>
                          </td>
                          <td className="px-2 py-3 text-xs font-bold text-gray-600">
                            {licence.licence_number || "—"}
                          </td>
                          <td className="px-2 py-3 text-xs font-semibold text-gray-500">
                            {licence.issuing_authority || "—"}
                          </td>
                          <td className="px-2 py-3">
                            <p className="text-xs font-bold text-gray-600">
                              {formatDate(licence.expires_on)}
                            </p>
                            <p
                              className={`text-[10px] font-black uppercase tracking-widest ${
                                expired
                                  ? "text-red-600"
                                  : dueSoon
                                    ? "text-amber-600"
                                    : "text-gray-400"
                              }`}
                            >
                              {expiryHint(licence.days_to_expiry)}
                            </p>
                          </td>
                          <td className="px-2 py-3">
                            <StatusBadge label={licence.status} />
                          </td>
                          <td className="px-2 py-3">
                            {safeUrl ? (
                              <a
                                href={licence.document_url || ""}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-blue-700 hover:underline"
                              >
                                <ExternalLink className="h-3 w-3" /> View
                              </a>
                            ) : (
                              <span className="text-xs font-semibold text-gray-400">
                                {licence.document_url ? "Link saved" : "—"}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-3 text-right">
                            <button
                              type="button"
                              data-testid={`licence-edit-${licence.id}`}
                              aria-label={`Edit ${licence.name}`}
                              onClick={() => openEdit(licence)}
                              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel
            title="Renewal calendar"
            description="Next five expiry dates, soonest first."
          >
            {renewalRows.length === 0 ? (
              <EmptyState
                title="No expiry dates"
                body="Add expiry dates to licences to build the renewal calendar."
              />
            ) : (
              <ol className="space-y-2">
                {renewalRows.map((licence) => {
                  const expired = isExpired(licence);
                  const dueSoon = isDueSoon(licence);
                  return (
                    <li
                      key={licence.id}
                      data-testid={`renewal-item-${licence.id}`}
                      className={`rounded-lg border px-3 py-2 ${
                        expired
                          ? "border-red-100 bg-red-50"
                          : dueSoon
                            ? "border-amber-100 bg-amber-50"
                            : "border-gray-100 bg-gray-50/60"
                      }`}
                    >
                      <p className="text-xs font-black text-gray-900">
                        {licence.name}
                      </p>
                      <p className="mt-0.5 text-[10px] font-semibold text-gray-500">
                        {formatDate(licence.expires_on)} ·{" "}
                        {expiryHint(licence.days_to_expiry)}
                      </p>
                      <p className="mt-1 text-[9px] font-black uppercase tracking-widest text-gray-400">
                        {licence.category}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </DepartmentToolShell>
  );
}
