"use client";

import { useEffect, useState } from "react";
import { Database, Download, Info, Loader2, RefreshCw } from "lucide-react";
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
  labelClass,
  secondaryButtonClass,
  todayIso,
} from "@/components/department-tools";

type DatabaseInfo = {
  engine: string;
  table_count: number;
};

type CountRow = {
  key: string;
  label: string;
  count: number;
};

type FreshnessRow = {
  key: string;
  label: string;
  at: string | null;
};

type CheckRow = {
  key: string;
  label: string;
  status: string;
  count: number;
  detail?: string | null;
};

type ExportRow = {
  dataset: string;
  label: string;
  row_count: number;
};

type TechnologyOverview = {
  database: DatabaseInfo;
  counts: CountRow[];
  freshness: FreshnessRow[];
  checks: CheckRow[];
  exports: ExportRow[];
  generated_at: string;
};

function errorDetail(payload: unknown, fallback: string) {
  if (typeof payload === "object" && payload !== null) {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return fallback;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relativeTime(value: string | null | undefined) {
  if (!value) return "Never";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function filenameFromDisposition(disposition: string | null, dataset: string) {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded?.[1]) {
    const value = encoded[1].trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  const plain = disposition?.match(/filename="?([^";]+)"?/i);
  return plain?.[1]?.trim() || `pizza-blitz-${dataset}-${todayIso()}.csv`;
}

async function responseError(response: Response, fallback: string) {
  const contentType = response.headers.get("Content-Type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const payload: unknown = await response.json();
      return errorDetail(payload, fallback);
    }
    const text = await response.text();
    return text.trim() || fallback;
  } catch {
    return fallback;
  }
}

export default function DataBiPage() {
  const [overview, setOverview] = useState<TechnologyOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/company/technology/overview"),
        { credentials: "include", cache: "no-store" }
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(errorDetail(payload, "The data overview failed to load."));
      }
      setOverview(payload as TechnologyOverview);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "The data overview failed to load."
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Initial load only; refresh is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloadExport = async (dataset: string, label: string) => {
    setDownloading(dataset);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        getApiUrl(
          `/api/v1/restaurant/company/technology/export?dataset=${encodeURIComponent(
            dataset
          )}`
        ),
        { credentials: "include", cache: "no-store" }
      );
      if (!response.ok) {
        throw new Error(await responseError(response, `The ${label} export failed.`));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filenameFromDisposition(
        response.headers.get("Content-Disposition"),
        dataset
      );
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice(`${label} CSV downloaded.`);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : `The ${label} export failed.`
      );
    } finally {
      setDownloading(null);
    }
  };

  const totalRows =
    overview?.counts.reduce((total, row) => total + row.count, 0) ?? 0;

  return (
    <DepartmentToolShell
      departmentKey="technology"
      departmentLabel="Technology"
      title="Data & BI"
      subtitle="The operational database, its freshest records and the exports the business runs on — read directly from the source of truth."
    >
      <div data-testid="data-page" className="space-y-5">
        <ErrorNote message={error} />

        {notice ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            {notice}
          </div>
        ) : null}

        <section className="rounded-2xl border border-gray-100 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-gray-950 p-2.5 text-white">
                <Database className="h-5 w-5" />
              </span>
              <div>
                <p className={labelClass}>Connected database</p>
                <p className="mt-1 text-xl font-black text-gray-950">
                  {overview?.database.engine ?? "—"}
                </p>
                <p className="mt-0.5 text-[11px] font-semibold text-gray-400">
                  {overview?.database.table_count ?? 0} tables ·{" "}
                  {totalRows.toLocaleString("en-IN")} records counted
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-right">
                <p className={labelClass}>Generated</p>
                <p className="mt-1 text-xs font-bold text-gray-600">
                  {formatDateTime(overview?.generated_at)}
                </p>
              </div>
              <button
                type="button"
                data-testid="data-refresh"
                onClick={() => void load()}
                disabled={isLoading}
                className={`inline-flex items-center gap-1.5 ${secondaryButtonClass}`}
              >
                <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>
        </section>

        {isLoading && !overview ? (
          <LoadingRow label="Reading the live database..." />
        ) : overview ? (
          <>
            <Panel
              title="Record counts"
              description="Live row counts for the datasets the portal reports on."
            >
              {overview.counts.length === 0 ? (
                <EmptyState
                  title="No counts returned"
                  body="The overview did not include any dataset counts."
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {overview.counts.map((row) => (
                    <StatCard
                      key={row.key}
                      label={row.label}
                      value={row.count.toLocaleString("en-IN")}
                    />
                  ))}
                </div>
              )}
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel
                title="Freshness"
                description="When each dataset last received a record."
              >
                {overview.freshness.length === 0 ? (
                  <EmptyState
                    title="No freshness data"
                    body="The overview did not report any dataset timestamps."
                  />
                ) : (
                  <div className="divide-y divide-gray-50">
                    {overview.freshness.map((row) => (
                      <div
                        key={row.key}
                        data-testid={`data-freshness-${row.key}`}
                        className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                      >
                        <div>
                          <p className="text-sm font-black text-gray-800">{row.label}</p>
                          <p className="text-[10px] font-semibold text-gray-400">
                            {formatDate(row.at)} · {formatTime(row.at)}
                          </p>
                        </div>
                        <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-gray-600">
                          {relativeTime(row.at)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel
                title="Quality checks"
                description="Referential and ledger checks run against the same live data."
              >
                {overview.checks.length === 0 ? (
                  <EmptyState
                    title="No checks reported"
                    body="The overview did not return any quality checks."
                  />
                ) : (
                  <div className="grid gap-2">
                    {overview.checks.map((check) => (
                      <div
                        key={check.key}
                        data-testid={`data-check-${check.key}`}
                        className="rounded-xl border border-gray-100 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <StatusBadge label={check.status} />
                            <p className="text-sm font-black text-gray-800">
                              {check.label}
                            </p>
                          </div>
                          <span className="text-lg font-black text-gray-950">
                            {check.count.toLocaleString("en-IN")}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] font-semibold text-gray-500">
                          {check.detail || "No exceptions reported."}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>

            <Panel
              title="Exports"
              description="CSV files generated from the live database. Row counts are current as of the generated time."
            >
              {overview.exports.length === 0 ? (
                <EmptyState
                  title="No exports available"
                  body="No export datasets are configured for this restaurant."
                />
              ) : (
                <div className="divide-y divide-gray-50">
                  {overview.exports.map((row) => (
                    <div
                      key={row.dataset}
                      data-testid={`export-${row.dataset}`}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div>
                        <p className="text-sm font-black text-gray-800">{row.label}</p>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                          {row.dataset} · {row.row_count.toLocaleString("en-IN")} rows
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void downloadExport(row.dataset, row.label)}
                        disabled={downloading !== null}
                        className={`inline-flex items-center gap-1.5 ${secondaryButtonClass}`}
                      >
                        {downloading === row.dataset ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        {downloading === row.dataset ? "Preparing..." : "Download CSV"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <div className="flex items-start gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] font-semibold text-gray-500">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                This page reads the live database; no data is cached or invented. Exports are
                generated on demand and reflect the same rows shown above.
              </p>
            </div>
          </>
        ) : (
          <EmptyState
            title="Data overview unavailable"
            body="The live database overview could not be loaded. Refresh to try again."
          />
        )}
      </div>
    </DepartmentToolShell>
  );
}
