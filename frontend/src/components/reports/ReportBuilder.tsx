"use client";

import { useEffect, useState } from "react";
import {
  CalendarDays,
  Download,
  Loader2,
  Play,
  Save,
  Send,
  Table2,
  Trash2,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const METRICS = [
  { key: "revenue", label: "Revenue" },
  { key: "orders", label: "Orders" },
  { key: "avg_order_value", label: "Avg order" },
  { key: "tax", label: "Tax" },
  { key: "discount", label: "Discount" },
  { key: "tips", label: "Tips" },
  { key: "refunds", label: "Refunds" },
];
const DIMENSIONS = [
  { key: "day", label: "Day" },
  { key: "order_type", label: "Order type" },
  { key: "payment_method", label: "Payment" },
  { key: "status", label: "Status" },
];
const LABELS: Record<string, string> = {
  day: "Day",
  order_type: "Order type",
  payment_method: "Payment",
  status: "Status",
  revenue: "Revenue",
  orders: "Orders",
  avg_order_value: "Avg order",
  tax: "Tax",
  discount: "Discount",
  tips: "Tips",
  refunds: "Refunds",
};

type ReportData = {
  start_date: string;
  end_date: string;
  columns: string[];
  dimensions: string[];
  rows: Record<string, string | number>[];
  totals: Record<string, number>;
  row_count: number;
};

type SavedReport = {
  id: number;
  name: string;
  metrics: string[];
  dimensions: string[];
  range_days: number;
  schedule: string;
  recipients?: string | null;
  status: string;
  last_run_at?: string | null;
  last_delivery_status?: string | null;
  last_delivery_error?: string | null;
  next_run_at?: string | null;
};

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function formatCell(column: string, value: string | number) {
  if (typeof value !== "number") return String(value ?? "");
  if (["revenue", "tax", "discount", "tips", "refunds", "avg_order_value"].includes(column)) {
    return `Rs ${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  }
  return value.toLocaleString("en-IN");
}

export default function ReportBuilder() {
  const [metrics, setMetrics] = useState<string[]>(["revenue", "orders"]);
  const [dimensions, setDimensions] = useState<string[]>(["day"]);
  const [startDate, setStartDate] = useState(isoDaysAgo(29));
  const [endDate, setEndDate] = useState(isoDaysAgo(0));
  const [report, setReport] = useState<ReportData | null>(null);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [name, setName] = useState("Owner daily board");
  const [schedule, setSchedule] = useState("none");
  const [recipients, setRecipients] = useState("");
  const [rangeDays, setRangeDays] = useState(30);
  const [message, setMessage] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const toggle = (
    value: string,
    current: string[],
    setter: (next: string[]) => void
  ) => {
    setter(
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  };

  const loadSaved = async () => {
    const response = await fetch(
      getApiUrl("/api/v1/restaurant/reports/saved"),
      { credentials: "include", cache: "no-store" }
    );
    const data = await response.json().catch(() => []);
    if (response.ok && Array.isArray(data)) setSaved(data);
  };

  useEffect(() => {
    void loadSaved();
  }, []);

  const run = async () => {
    setIsRunning(true);
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/reports/custom"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            start_date: startDate,
            end_date: endDate,
            metrics,
            dimensions,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Report could not be built.");
      setReport(data);
      setMessage(`${data.row_count} row${data.row_count === 1 ? "" : "s"} generated.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Report could not be built.");
    } finally {
      setIsRunning(false);
    }
  };

  const save = async () => {
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/reports/saved"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            metrics,
            dimensions,
            range_days: rangeDays,
            schedule,
            recipients: recipients.trim() || null,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Report could not be saved.");
      setMessage("Saved report created.");
      await loadSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Report could not be saved.");
    } finally {
      setIsSaving(false);
    }
  };

  const runSaved = async (reportId: number) => {
    setBusyId(reportId);
    setMessage("");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/reports/saved/${reportId}/run`),
        { method: "POST", credentials: "include" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Report could not be run.");
      setReport(data);
      await loadSaved();
      setMessage("Saved report refreshed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Report could not be run.");
    } finally {
      setBusyId(null);
    }
  };

  const deliver = async (reportId: number) => {
    setBusyId(reportId);
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/reports/saved/${reportId}/deliver`),
        { method: "POST", credentials: "include" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Report could not be sent.");
      setMessage(
        data.delivery_status === "sent"
          ? "Report emailed."
          : `Delivery ${data.delivery_status || "skipped"}: ${data.delivery_error || "provider not configured"}`
      );
      await loadSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Report could not be sent.");
    } finally {
      setBusyId(null);
    }
  };

  const download = async (reportId: number) => {
    setBusyId(reportId);
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/reports/saved/${reportId}/export`),
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("CSV download failed.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `pizza-blitz-report-${reportId}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "CSV download failed.");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (reportId: number) => {
    setBusyId(reportId);
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/reports/saved/${reportId}`),
        { method: "DELETE", credentials: "include" }
      );
      if (!response.ok) throw new Error("Report could not be deleted.");
      await loadSaved();
      setMessage("Saved report deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Report could not be deleted.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      data-testid="report-builder"
      className="rounded-[2rem] border border-gray-100 bg-white p-5 shadow-sm sm:p-8"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
            <Table2 className="h-4 w-4" /> Custom report builder
          </p>
          <h2 className="mt-1 text-xl font-black text-gray-950">
            Build, save, export, and schedule your own reports
          </h2>
          <p className="mt-1 text-sm font-semibold text-gray-500">
            Pick metrics and dimensions, then save the view for the team.
          </p>
        </div>
      </div>

      {message && (
        <p className="mt-4 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600">
          {message}
        </p>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_320px]">
        <div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Metrics
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {METRICS.map((metric) => (
                  <button
                    key={metric.key}
                    type="button"
                    onClick={() => toggle(metric.key, metrics, setMetrics)}
                    className={`rounded-full border px-3 py-1.5 text-[11px] font-black ${
                      metrics.includes(metric.key)
                        ? "border-gray-950 bg-gray-950 text-white"
                        : "border-gray-200 bg-white text-gray-600"
                    }`}
                  >
                    {metric.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Group by
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {DIMENSIONS.map((dimension) => (
                  <button
                    key={dimension.key}
                    type="button"
                    onClick={() =>
                      toggle(dimension.key, dimensions, setDimensions)
                    }
                    className={`rounded-full border px-3 py-1.5 text-[11px] font-black ${
                      dimensions.includes(dimension.key)
                        ? "border-orange-500 bg-orange-50 text-orange-700"
                        : "border-gray-200 bg-white text-gray-600"
                    }`}
                  >
                    {dimension.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              From
              <input
                type="date"
                aria-label="Report start date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="mt-1 block rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-bold text-gray-900"
              />
            </label>
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              To
              <input
                type="date"
                aria-label="Report end date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="mt-1 block rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-bold text-gray-900"
              />
            </label>
            <button
              type="button"
              data-testid="report-builder-run"
              onClick={run}
              disabled={isRunning || !metrics.length}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-gray-950 px-4 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600 disabled:opacity-50"
            >
              {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Run report
            </button>
          </div>

          {report && (
            <div className="mt-5 overflow-hidden rounded-xl border border-gray-100">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-500">
                    <tr>
                      {report.columns.map((column) => (
                        <th key={column} className="px-3 py-2">
                          {LABELS[column] || column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {report.rows.length ? (
                      report.rows.map((row, index) => (
                        <tr key={`report-row-${index}`}>
                          {report.columns.map((column) => (
                            <td key={`${index}-${column}`} className="px-3 py-2 font-bold text-gray-800">
                              {formatCell(column, row[column])}
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={report.columns.length}
                          className="px-3 py-8 text-center text-sm font-bold text-gray-400"
                        >
                          No orders in this range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot className="bg-orange-50/60">
                    <tr>
                      <td className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-orange-700" colSpan={Math.max(report.dimensions.length, 1)}>
                        Totals
                      </td>
                      {report.columns.slice(report.dimensions.length).map((column) => (
                        <td key={`total-${column}`} className="px-3 py-2 font-black text-orange-800">
                          {formatCell(column, report.totals[column] || 0)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>

        <aside className="rounded-xl border border-gray-100 bg-gray-50/70 p-4">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
            <Save className="h-4 w-4 text-orange-600" /> Save this view
          </p>
          <label className="mt-3 block text-[10px] font-black uppercase tracking-widest text-gray-400">
            Report name
            <input
              aria-label="Saved report name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900"
            />
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              Range (days)
              <input
                type="number"
                min={1}
                max={365}
                aria-label="Saved report range days"
                value={rangeDays}
                onChange={(event) => setRangeDays(Number(event.target.value) || 30)}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900"
              />
            </label>
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              Schedule
              <select
                aria-label="Saved report schedule"
                value={schedule}
                onChange={(event) => setSchedule(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm font-bold text-gray-900"
              >
                <option value="none">None</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
          </div>
          {schedule !== "none" && (
            <label className="mt-2 block text-[10px] font-black uppercase tracking-widest text-gray-400">
              Recipients
              <input
                aria-label="Saved report recipients"
                value={recipients}
                onChange={(event) => setRecipients(event.target.value)}
                placeholder="owner@example.com"
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>
          )}
          <button
            type="button"
            data-testid="report-builder-save"
            onClick={save}
            disabled={isSaving || !metrics.length}
            className="mt-3 w-full rounded-lg bg-orange-600 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {isSaving ? "Saving" : "Save report"}
          </button>
        </aside>
      </div>

      <div className="mt-6 border-t border-gray-100 pt-5">
        <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
          <CalendarDays className="h-4 w-4 text-orange-600" /> Saved reports
        </p>
        {saved.length ? (
          <div className="mt-3 grid gap-2">
            {saved.map((item) => (
              <div
                key={item.id}
                data-testid={`saved-report-${item.id}`}
                className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-gray-900">{item.name}</p>
                  <p className="mt-0.5 text-[11px] font-semibold text-gray-500">
                    {item.metrics.map((metric) => LABELS[metric] || metric).join(", ")}
                    {item.dimensions.length
                      ? ` · by ${item.dimensions.map((dimension) => LABELS[dimension] || dimension).join(", ")}`
                      : ""}
                    {` · ${item.range_days} days`}
                  </p>
                  <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    {item.schedule === "none"
                      ? "Manual"
                      : `${item.schedule} · next ${item.next_run_at ? new Date(item.next_run_at).toLocaleDateString() : "pending"}`}
                    {item.last_delivery_status
                      ? ` · last delivery ${item.last_delivery_status}`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => void runSaved(item.id)}
                    disabled={busyId === item.id}
                    aria-label={`Run ${item.name}`}
                    className="inline-flex h-9 items-center gap-1 rounded-lg bg-gray-950 px-3 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" /> Run
                  </button>
                  <button
                    type="button"
                    onClick={() => void download(item.id)}
                    disabled={busyId === item.id}
                    aria-label={`Export ${item.name}`}
                    className="inline-flex h-9 items-center gap-1 rounded-lg border border-gray-200 px-3 text-[10px] font-black uppercase tracking-widest text-gray-700 disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" /> CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => void deliver(item.id)}
                    disabled={busyId === item.id || !item.recipients}
                    aria-label={`Email ${item.name}`}
                    className="inline-flex h-9 items-center gap-1 rounded-lg border border-gray-200 px-3 text-[10px] font-black uppercase tracking-widest text-gray-700 disabled:opacity-40"
                  >
                    <Send className="h-3.5 w-3.5" /> Send
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(item.id)}
                    disabled={busyId === item.id}
                    aria-label={`Delete ${item.name}`}
                    className="grid h-9 w-9 place-items-center rounded-lg border border-gray-200 text-red-600 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-gray-200 px-3 py-4 text-sm font-semibold text-gray-400">
            No saved reports yet. Build a view and save it for the team.
          </p>
        )}
      </div>
    </section>
  );
}
