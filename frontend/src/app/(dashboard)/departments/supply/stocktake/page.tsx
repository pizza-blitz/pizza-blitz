"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Save,
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

type StoreRow = { id: number; name: string };

type Stocktake = {
  id: number;
  store_id: number;
  title: string;
  status: string;
  counted_by?: string | null;
  notes?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  variance_value?: number | null;
  line_count: number;
  counted_lines: number;
  created_at?: string | null;
  updated_at?: string | null;
};

type StocktakeSummary = {
  total: number;
  draft: number;
  counting: number;
  completed: number;
  last_completed_at?: string | null;
  total_variance_value?: number | null;
};

type StocktakeLine = {
  id: number;
  item_id: number;
  item_name: string;
  unit?: string | null;
  expected_qty: number;
  counted_qty: number | null;
  variance_qty: number | null;
  unit_cost: number;
  variance_value: number | null;
  note?: string | null;
};

type StocktakeDetailSummary = {
  line_count: number;
  counted_lines: number;
  variance_lines: number;
  variance_value: number;
  expected_value: number;
  counted_value: number;
};

type StocktakeDetail = {
  session: Stocktake;
  lines: StocktakeLine[];
  summary: StocktakeDetailSummary;
};

type StocktakeListResponse = {
  items: Stocktake[];
  summary: StocktakeSummary | null;
};

type StocktakeCreateResponse = {
  session?: Stocktake;
  stocktake?: Stocktake;
  id?: number;
};

type LineDraft = {
  counted_qty: string;
  note: string;
};

function errorDetail(payload: unknown, fallback: string) {
  if (typeof payload === "object" && payload !== null) {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return fallback;
}

function parseStores(payload: unknown): StoreRow[] {
  let entries: unknown[] = [];
  if (Array.isArray(payload)) {
    entries = payload;
  } else if (typeof payload === "object" && payload !== null) {
    const record = payload as { items?: unknown; stores?: unknown };
    if (Array.isArray(record.items)) entries = record.items;
    else if (Array.isArray(record.stores)) entries = record.stores;
  }
  return entries.filter((entry): entry is StoreRow => {
    if (typeof entry !== "object" || entry === null) return false;
    const row = entry as { id?: unknown; name?: unknown };
    return typeof row.id === "number" && typeof row.name === "string";
  });
}

function parseQty(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatQty(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function signedQty(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value > 0 ? "+" : ""}${formatQty(value)}`;
}

function formatVarianceMoney(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value > 0 ? `+${formatMoney(value)}` : formatMoney(value);
}

function varianceTone(value: number | null | undefined) {
  if (value === null || value === undefined || Math.abs(value) < 0.0001) {
    return "text-gray-500";
  }
  return value > 0 ? "text-emerald-600" : "text-red-600";
}

function buildDrafts(lines: StocktakeLine[]): Record<number, LineDraft> {
  const next: Record<number, LineDraft> = {};
  for (const line of lines) {
    next[line.id] = {
      counted_qty:
        line.counted_qty === null || line.counted_qty === undefined
          ? ""
          : String(line.counted_qty),
      note: line.note ?? "",
    };
  }
  return next;
}

export default function StocktakePage() {
  const [sessions, setSessions] = useState<Stocktake[]>([]);
  const [summary, setSummary] = useState<StocktakeSummary | null>(null);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [startForm, setStartForm] = useState({ title: "", store_id: "1" });
  const [starting, setStarting] = useState(false);

  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<StocktakeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailNotice, setDetailNotice] = useState("");
  const [drafts, setDrafts] = useState<Record<number, LineDraft>>({});
  const [savingLineId, setSavingLineId] = useState<number | null>(null);
  const [headerForm, setHeaderForm] = useState({
    title: "",
    counted_by: "",
    notes: "",
  });
  const [savingHeader, setSavingHeader] = useState(false);
  const [applyAdjustments, setApplyAdjustments] = useState(true);
  const [completing, setCompleting] = useState(false);

  const load = async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/company/supply/stocktakes"),
        { credentials: "include", cache: "no-store" }
      );
      const data: unknown = await response.json();
      if (!response.ok) {
        throw new Error(errorDetail(data, "Stocktakes failed to load."));
      }
      const payload = data as StocktakeListResponse;
      setSessions(payload.items ?? []);
      setSummary(payload.summary ?? null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Stocktakes failed to load."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const loadStores = async () => {
    try {
      const response = await fetch(getApiUrl("/api/v1/restaurant/stores/"), {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) return;
      const data: unknown = await response.json();
      const rows = parseStores(data);
      setStores(rows);
      if (rows.length > 0) {
        setStartForm((current) =>
          rows.some((store) => String(store.id) === current.store_id)
            ? current
            : { ...current, store_id: String(rows[0].id) }
        );
      }
    } catch {
      // Store lookup is optional; the form keeps the default store 1.
      setStores([]);
    }
  };

  useEffect(() => {
    void load();
    void loadStores();
    // Initial bootstrap only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const storeName = (storeId: number) =>
    stores.find((store) => store.id === storeId)?.name || `Store ${storeId}`;

  const fetchDetail = async (id: number, keepDrafts = false) => {
    setDetailLoading(true);
    setDetailError("");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/company/supply/stocktakes/${id}`),
        { credentials: "include", cache: "no-store" }
      );
      const data: unknown = await response.json();
      if (!response.ok) {
        throw new Error(errorDetail(data, "The stocktake session failed to load."));
      }
      const payload = data as StocktakeDetail;
      setDetail(payload);
      const serverDrafts = buildDrafts(payload.lines ?? []);
      if (keepDrafts) {
        setDrafts((current) => {
          const merged: Record<number, LineDraft> = { ...serverDrafts };
          for (const line of payload.lines ?? []) {
            const existing = current[line.id];
            if (existing) merged[line.id] = existing;
          }
          return merged;
        });
      } else {
        setDrafts(serverDrafts);
        setHeaderForm({
          title: payload.session.title,
          counted_by: payload.session.counted_by ?? "",
          notes: payload.session.notes ?? "",
        });
        setApplyAdjustments(true);
      }
    } catch (loadError) {
      setDetailError(
        loadError instanceof Error
          ? loadError.message
          : "The stocktake session failed to load."
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const openSession = (id: number) => {
    setOpenId(id);
    setDetail(null);
    setDrafts({});
    setDetailError("");
    setDetailNotice("");
    setNotice("");
    void fetchDetail(id);
  };

  const closeSession = () => {
    setOpenId(null);
    setDetail(null);
    setDetailError("");
    setDetailNotice("");
  };

  const startStocktake = async () => {
    if (!startForm.title.trim()) {
      setError("Give the stocktake a title.");
      return;
    }
    const storeId = Number(startForm.store_id);
    if (!Number.isFinite(storeId) || storeId <= 0) {
      setError("Choose a valid store.");
      return;
    }
    setStarting(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/company/supply/stocktakes"),
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: startForm.title.trim(),
            store_id: storeId,
          }),
        }
      );
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(errorDetail(data, "The stocktake could not be started."));
      }
      const payload = data as StocktakeCreateResponse;
      const createdId =
        payload.session?.id ??
        payload.stocktake?.id ??
        (typeof payload.id === "number" ? payload.id : null);
      setStartForm({ title: "", store_id: startForm.store_id });
      setNotice("Stocktake started. Count each line and save as you go.");
      await load();
      if (createdId !== null) openSession(createdId);
    } catch (startError) {
      setError(
        startError instanceof Error
          ? startError.message
          : "The stocktake could not be started."
      );
    } finally {
      setStarting(false);
    }
  };

  const updateDraft = (line: StocktakeLine, patch: Partial<LineDraft>) => {
    setDrafts((current) => {
      const existing = current[line.id] ?? {
        counted_qty:
          line.counted_qty === null || line.counted_qty === undefined
            ? ""
            : String(line.counted_qty),
        note: line.note ?? "",
      };
      return { ...current, [line.id]: { ...existing, ...patch } };
    });
  };

  const saveHeader = async () => {
    if (openId === null) return;
    if (!headerForm.title.trim()) {
      setDetailError("The stocktake needs a title.");
      return;
    }
    setSavingHeader(true);
    setDetailError("");
    setDetailNotice("");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/company/supply/stocktakes/${openId}`),
        {
          method: "PATCH",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: headerForm.title.trim(),
            counted_by: headerForm.counted_by.trim() || null,
            notes: headerForm.notes.trim() || null,
          }),
        }
      );
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(errorDetail(data, "The session header could not be saved."));
      }
      await fetchDetail(openId, true);
      await load();
      setDetailNotice("Session header saved.");
    } catch (saveError) {
      setDetailError(
        saveError instanceof Error
          ? saveError.message
          : "The session header could not be saved."
      );
    } finally {
      setSavingHeader(false);
    }
  };

  const saveLine = async (line: StocktakeLine) => {
    if (openId === null) return;
    const draft = drafts[line.id];
    const counted = parseQty(draft?.counted_qty ?? "");
    if (counted === null || counted < 0) {
      setDetailError(
        `Enter a valid counted quantity of zero or more for ${line.item_name}.`
      );
      return;
    }
    setSavingLineId(line.id);
    setDetailError("");
    setDetailNotice("");
    try {
      const response = await fetch(
        getApiUrl(
          `/api/v1/restaurant/company/supply/stocktakes/${openId}/lines/${line.id}`
        ),
        {
          method: "PATCH",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            counted_qty: counted,
            note: (draft?.note ?? "").trim() || null,
          }),
        }
      );
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(errorDetail(data, "The counted line could not be saved."));
      }
      await fetchDetail(openId, true);
      await load();
      setDetailNotice(`${line.item_name} saved.`);
    } catch (saveError) {
      setDetailError(
        saveError instanceof Error
          ? saveError.message
          : "The counted line could not be saved."
      );
    } finally {
      setSavingLineId(null);
    }
  };

  const completeStocktake = async () => {
    if (openId === null || !detail) return;
    const warning = applyAdjustments
      ? `Complete "${detail.session.title}" and apply stock adjustments?\n\nCurrent stock will be overwritten with the counted quantities for every variance line. This cannot be undone.`
      : `Complete "${detail.session.title}" without adjusting stock?`;
    if (!window.confirm(warning)) return;
    setCompleting(true);
    setDetailError("");
    setDetailNotice("");
    try {
      const response = await fetch(
        getApiUrl(
          `/api/v1/restaurant/company/supply/stocktakes/${openId}/complete`
        ),
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apply_adjustments: applyAdjustments }),
        }
      );
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(errorDetail(data, "The stocktake could not be completed."));
      }
      const completedTitle = detail.session.title;
      await fetchDetail(openId);
      await load();
      setNotice(`Stocktake "${completedTitle}" completed.`);
      setDetailNotice("Stocktake completed and locked for editing.");
    } catch (completeError) {
      setDetailError(
        completeError instanceof Error
          ? completeError.message
          : "The stocktake could not be completed."
      );
    } finally {
      setCompleting(false);
    }
  };

  const activeSession =
    detail?.session ?? sessions.find((session) => session.id === openId) ?? null;
  const isCompleted = activeSession?.status === "completed";
  const progress =
    activeSession && activeSession.line_count > 0
      ? Math.min(
          100,
          Math.round((activeSession.counted_lines / activeSession.line_count) * 100)
        )
      : 0;

  return (
    <DepartmentToolShell
      departmentKey="supply"
      departmentLabel="Supply"
      title="Stocktake"
      subtitle="Count inventory against expected quantities, review every variance and decide whether to overwrite stock on hand."
    >
      <div data-testid="stocktake-page" className="space-y-5">
        <ErrorNote message={error} />

        {notice ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            {notice}
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Total sessions"
            value={summary?.total ?? 0}
            hint={`${summary?.draft ?? 0} draft`}
          />
          <StatCard
            label="Counting"
            value={summary?.counting ?? 0}
            hint="Open count sheets"
            tone="info"
          />
          <StatCard
            label="Completed"
            value={summary?.completed ?? 0}
            hint={`Last ${formatDate(summary?.last_completed_at)}`}
            tone="good"
          />
          <StatCard
            label="Total variance value"
            value={formatVarianceMoney(summary?.total_variance_value ?? 0)}
            hint="Across completed and open counts"
            tone={
              (summary?.total_variance_value ?? 0) < 0
                ? "bad"
                : (summary?.total_variance_value ?? 0) > 0
                  ? "good"
                  : "neutral"
            }
          />
        </section>

        <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
          <Panel
            title="Start stocktake"
            description="Create a count sheet for one store. Item selection is left blank, so every inventory item is included."
          >
            <form
              data-testid="stocktake-start-form"
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void startStocktake();
              }}
            >
              <label className={`block ${labelClass}`}>
                Title
                <input
                  data-testid="stocktake-title"
                  value={startForm.title}
                  onChange={(event) =>
                    setStartForm({ ...startForm, title: event.target.value })
                  }
                  placeholder="e.g. October full count"
                  className={`mt-1 ${inputClass}`}
                />
              </label>
              <label className={`block ${labelClass}`}>
                Store
                <select
                  data-testid="stocktake-store"
                  value={startForm.store_id}
                  onChange={(event) =>
                    setStartForm({ ...startForm, store_id: event.target.value })
                  }
                  className={`mt-1 ${inputClass}`}
                >
                  {stores.length === 0 ? (
                    <option value="1">Store 1</option>
                  ) : (
                    stores.map((store) => (
                      <option key={store.id} value={store.id}>
                        {store.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] font-semibold text-gray-500">
                Leave item selection blank to count every inventory item.
              </p>
              <button
                type="submit"
                data-testid="stocktake-start"
                disabled={starting}
                className={`inline-flex items-center gap-2 ${primaryButtonClass}`}
              >
                {starting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Start stocktake
              </button>
            </form>
          </Panel>

          <Panel
            title="Stocktake sessions"
            description="Open a session to count lines. Completed sessions stay available read-only."
            actions={
              <button
                type="button"
                onClick={() => void load()}
                disabled={isLoading}
                className={`inline-flex items-center gap-1.5 ${secondaryButtonClass}`}
              >
                <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            }
          >
            {isLoading ? (
              <LoadingRow label="Loading stocktakes..." />
            ) : sessions.length === 0 ? (
              <EmptyState
                title="No stocktakes yet"
                body="Start a count sheet to compare expected inventory with what is on the shelf."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                      <th className="px-2 py-2">Session</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2">Progress</th>
                      <th className="px-2 py-2">Variance</th>
                      <th className="px-2 py-2">Started</th>
                      <th className="px-2 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((session) => {
                      const rowProgress =
                        session.line_count > 0
                          ? Math.min(
                              100,
                              Math.round(
                                (session.counted_lines / session.line_count) * 100
                              )
                            )
                          : 0;
                      return (
                        <tr
                          key={session.id}
                          data-testid={`stocktake-row-${session.id}`}
                          className="border-b border-gray-50 text-sm"
                        >
                          <td className="px-2 py-3">
                            <p className="font-black text-gray-900">{session.title}</p>
                            <p className="text-[10px] font-semibold text-gray-400">
                              {storeName(session.store_id)}
                              {session.counted_by ? ` · ${session.counted_by}` : ""}
                            </p>
                          </td>
                          <td className="px-2 py-3">
                            <StatusBadge label={session.status} />
                          </td>
                          <td className="px-2 py-3">
                            <div className="flex min-w-[120px] items-center gap-2">
                              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-100">
                                <div
                                  className="h-full rounded-full bg-gray-900"
                                  style={{ width: `${rowProgress}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-bold text-gray-500">
                                {session.counted_lines}/{session.line_count}
                              </span>
                            </div>
                          </td>
                          <td
                            className={`px-2 py-3 font-black ${varianceTone(
                              session.variance_value
                            )}`}
                          >
                            {formatVarianceMoney(session.variance_value)}
                          </td>
                          <td className="px-2 py-3 text-xs font-semibold text-gray-600">
                            {formatDate(session.started_at || session.created_at)}
                          </td>
                          <td className="px-2 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => openSession(session.id)}
                              className={secondaryButtonClass}
                            >
                              Open
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
        </div>

        {openId !== null ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-2 sm:items-center sm:p-4">
            <div
              data-testid="stocktake-detail"
              role="dialog"
              aria-modal="true"
              aria-label={`Stocktake ${activeSession?.title ?? ""}`}
              className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl sm:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className={labelClass}>Stocktake session</p>
                  <h2 className="mt-1 text-xl font-black text-gray-950">
                    {activeSession?.title ?? "Stocktake"}
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    {activeSession ? <StatusBadge label={activeSession.status} /> : null}
                    <span>{activeSession ? storeName(activeSession.store_id) : ""}</span>
                    <span>Started {formatDate(activeSession?.started_at)}</span>
                    {isCompleted ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <Lock className="h-3 w-3" /> Completed{" "}
                        {formatDate(activeSession?.completed_at)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Close stocktake session"
                  onClick={closeSession}
                  className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {activeSession ? (
                <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                  <div className="flex min-w-[160px] flex-1 items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-gray-900"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-black text-gray-500">
                      {activeSession.counted_lines}/{activeSession.line_count} counted
                    </span>
                  </div>
                  {detail ? (
                    <>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                        {detail.summary.variance_lines} variance lines
                      </span>
                      <span
                        className={`text-xs font-black ${varianceTone(
                          detail.summary.variance_value
                        )}`}
                      >
                        {formatVarianceMoney(detail.summary.variance_value)}
                      </span>
                    </>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-3">
                <ErrorNote message={detailError} />
              </div>
              {detailNotice ? (
                <p className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                  {detailNotice}
                </p>
              ) : null}

              {detailLoading && !detail ? (
                <LoadingRow label="Loading count sheet..." />
              ) : detail ? (
                <>
                  {isCompleted ? (
                    <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                      <p className="flex items-start gap-2 text-xs font-semibold text-emerald-900">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                        This count is complete and read-only. Variance value{" "}
                        {formatMoney(detail.summary.variance_value)} across{" "}
                        {detail.summary.variance_lines} lines, completed{" "}
                        {formatDate(activeSession?.completed_at)}.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-xl border border-gray-100 p-3">
                      <div className="grid gap-2 sm:grid-cols-3">
                        <label className={`sm:col-span-2 ${labelClass}`}>
                          Title
                          <input
                            value={headerForm.title}
                            onChange={(event) =>
                              setHeaderForm({
                                ...headerForm,
                                title: event.target.value,
                              })
                            }
                            className={`mt-1 ${inputClass}`}
                          />
                        </label>
                        <label className={labelClass}>
                          Counted by
                          <input
                            value={headerForm.counted_by}
                            onChange={(event) =>
                              setHeaderForm({
                                ...headerForm,
                                counted_by: event.target.value,
                              })
                            }
                            placeholder="Who is counting?"
                            className={`mt-1 ${inputClass}`}
                          />
                        </label>
                        <label className={`sm:col-span-3 ${labelClass}`}>
                          Session notes
                          <textarea
                            rows={2}
                            value={headerForm.notes}
                            onChange={(event) =>
                              setHeaderForm({
                                ...headerForm,
                                notes: event.target.value,
                              })
                            }
                            placeholder="Shift, aisle coverage or anything the next counter should know"
                            className={`mt-1 ${inputClass}`}
                          />
                        </label>
                      </div>
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => void saveHeader()}
                          disabled={savingHeader}
                          className={`inline-flex items-center gap-1.5 ${secondaryButtonClass}`}
                        >
                          {savingHeader ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          Save header
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full text-left">
                      <thead>
                        <tr className="border-b border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400">
                          <th className="px-2 py-2">Item</th>
                          <th className="px-2 py-2">Expected</th>
                          <th className="px-2 py-2">Counted</th>
                          <th className="px-2 py-2">Variance</th>
                          <th className="px-2 py-2">Variance value</th>
                          <th className="px-2 py-2">Note</th>
                          {!isCompleted ? <th className="px-2 py-2" /> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {detail.lines.map((line) => {
                          const draft = drafts[line.id];
                          const typedCount = parseQty(draft?.counted_qty ?? "");
                          const liveVariance =
                            typedCount === null ? null : typedCount - line.expected_qty;
                          const liveVarianceValue =
                            liveVariance === null ? null : liveVariance * line.unit_cost;
                          return (
                            <tr
                              key={line.id}
                              data-testid={`stocktake-line-${line.id}`}
                              className="border-b border-gray-50 align-top text-sm"
                            >
                              <td className="px-2 py-3">
                                <p className="font-black text-gray-900">{line.item_name}</p>
                                <p className="text-[10px] font-semibold text-gray-400">
                                  {line.unit || "unit"} · cost{" "}
                                  {formatMoney(line.unit_cost)}
                                </p>
                              </td>
                              <td className="px-2 py-3 font-semibold text-gray-600">
                                {formatQty(line.expected_qty)}
                              </td>
                              <td className="px-2 py-3">
                                {isCompleted ? (
                                  <span className="font-black text-gray-900">
                                    {formatQty(line.counted_qty)}
                                  </span>
                                ) : (
                                  <input
                                    data-testid={`stocktake-counted-${line.id}`}
                                    aria-label={`Counted quantity for ${line.item_name}`}
                                    type="number"
                                    min="0"
                                    step="any"
                                    inputMode="decimal"
                                    value={draft?.counted_qty ?? ""}
                                    onChange={(event) =>
                                      updateDraft(line, {
                                        counted_qty: event.target.value,
                                      })
                                    }
                                    className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-sm font-bold text-gray-900 outline-none focus:border-gray-400"
                                  />
                                )}
                              </td>
                              <td
                                className={`px-2 py-3 font-black ${varianceTone(
                                  liveVariance
                                )}`}
                              >
                                {signedQty(liveVariance)}
                              </td>
                              <td
                                className={`px-2 py-3 font-black ${varianceTone(
                                  liveVarianceValue
                                )}`}
                              >
                                {formatVarianceMoney(liveVarianceValue)}
                              </td>
                              <td className="px-2 py-3">
                                {isCompleted ? (
                                  <span className="text-xs font-semibold text-gray-500">
                                    {line.note || "—"}
                                  </span>
                                ) : (
                                  <input
                                    aria-label={`Note for ${line.item_name}`}
                                    value={draft?.note ?? ""}
                                    onChange={(event) =>
                                      updateDraft(line, { note: event.target.value })
                                    }
                                    placeholder="Optional note"
                                    className="w-full min-w-[140px] rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-semibold text-gray-700 outline-none focus:border-gray-400"
                                  />
                                )}
                              </td>
                              {!isCompleted ? (
                                <td className="px-2 py-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() => void saveLine(line)}
                                    disabled={savingLineId === line.id}
                                    className={`inline-flex items-center gap-1 ${secondaryButtonClass}`}
                                  >
                                    {savingLineId === line.id ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Save className="h-3 w-3" />
                                    )}
                                    Save
                                  </button>
                                </td>
                              ) : null}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {!isCompleted ? (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm font-black text-amber-950">
                        Complete stocktake
                      </p>
                      <label className="mt-2 flex items-start gap-2 text-xs font-bold text-amber-900">
                        <input
                          type="checkbox"
                          checked={applyAdjustments}
                          onChange={(event) =>
                            setApplyAdjustments(event.target.checked)
                          }
                          className="mt-0.5 h-4 w-4 rounded border-amber-300"
                        />
                        Apply stock adjustments
                      </label>
                      <p className="mt-1 pl-6 text-[11px] font-semibold text-amber-800">
                        When applied, current stock is overwritten with the counted
                        quantities for every variance line. This cannot be undone.
                      </p>
                      <button
                        type="button"
                        data-testid="stocktake-complete"
                        onClick={() => void completeStocktake()}
                        disabled={completing}
                        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-900 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-amber-800 disabled:opacity-50"
                      >
                        {completing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ClipboardList className="h-3.5 w-3.5" />
                        )}
                        Complete stocktake
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3 sm:grid-cols-3">
                      <div>
                        <p className={labelClass}>Expected value</p>
                        <p className="mt-1 text-sm font-black text-gray-800">
                          {formatMoney(detail.summary.expected_value)}
                        </p>
                      </div>
                      <div>
                        <p className={labelClass}>Counted value</p>
                        <p className="mt-1 text-sm font-black text-gray-800">
                          {formatMoney(detail.summary.counted_value)}
                        </p>
                      </div>
                      <div>
                        <p className={labelClass}>Variance value</p>
                        <p
                          className={`mt-1 text-sm font-black ${varianceTone(
                            detail.summary.variance_value
                          )}`}
                        >
                          {formatVarianceMoney(detail.summary.variance_value)}
                        </p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-gray-400">
                    Count sheet could not be loaded. Close this panel and try again.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </DepartmentToolShell>
  );
}
