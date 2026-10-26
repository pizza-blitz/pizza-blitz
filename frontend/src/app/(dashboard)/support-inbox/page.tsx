"use client";

import { useCallback, useEffect, useState } from "react";
import { Headphones, Loader2, Send } from "lucide-react";
import { getApiUrl } from "@/lib/api";

const API = getApiUrl("/api/v1/restaurant/support");

type Ticket = {
  id: number;
  customer_name: string;
  email?: string | null;
  phone?: string | null;
  subject: string;
  category: string;
  priority: string;
  status: string;
  order_id?: number | null;
  assigned_to?: string | null;
  last_message?: string | null;
  last_message_at?: string | null;
  sla_due_at?: string | null;
  first_response_due_at?: string | null;
  first_response_at?: string | null;
  resolved_at?: string | null;
  sla_state?: string;
  response_state?: string;
  sla_remaining_minutes?: number | null;
  sla_target_hours?: number;
  messages?: Message[];
};

type Message = {
  id: number;
  author_type: string;
  author_name?: string | null;
  body: string;
  internal: boolean;
  created_at?: string | null;
};

type SlaPolicy = {
  priority: string;
  response_minutes: number;
  resolution_minutes: number;
  response_hours: number;
  resolution_hours: number;
};

type SupportAlert = {
  id: number;
  ticket_id: number;
  kind: string;
  message: string;
  delivery_status?: string;
  delivery_channels?: string | null;
  delivery_error?: string | null;
  delivery_attempts?: number;
  next_retry_at?: string | null;
  last_attempt_at?: string | null;
  delivered_at?: string | null;
  created_at?: string | null;
  read_at?: string | null;
  ticket_subject: string;
  ticket_priority: string;
  ticket_status: string;
};

type Summary = {
  counts: Record<string, number>;
  urgent_open: number;
  notifications_unread: number;
  sla: {
    overdue: number;
    due_soon: number;
    first_response_overdue: number;
    breached_resolved: number;
    avg_first_response_minutes: number;
    avg_resolution_minutes: number;
    targets_hours: Record<string, number>;
    targets_minutes: Record<string, { response: number; resolution: number }>;
    policies: SlaPolicy[];
  };
};

const SLA_TONE: Record<string, string> = {
  overdue: "bg-red-100 text-red-700",
  due_soon: "bg-amber-100 text-amber-800",
  on_track: "bg-emerald-100 text-emerald-800",
  met: "bg-emerald-100 text-emerald-800",
  breached: "bg-red-100 text-red-700",
  closed: "bg-gray-200 text-gray-600",
  no_target: "bg-gray-100 text-gray-500",
};

function slaLabel(ticket: Ticket): string {
  if (ticket.sla_state === "overdue") {
    const minutes = Math.abs(ticket.sla_remaining_minutes || 0);
    return `Overdue ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }
  if (ticket.sla_state === "due_soon") {
    const minutes = Math.max(ticket.sla_remaining_minutes || 0, 0);
    return `Due soon ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }
  if (ticket.sla_state === "met" || ticket.sla_state === "breached") {
    return ticket.sla_state === "met" ? "SLA met" : "SLA breached";
  }
  return ticket.sla_state === "on_track" ? "On track" : "";
}

const STATUS_TONE: Record<string, string> = {
  open: "bg-amber-100 text-amber-800",
  pending: "bg-sky-100 text-sky-800",
  resolved: "bg-emerald-100 text-emerald-800",
  closed: "bg-gray-200 text-gray-600",
};

export default function SupportInboxPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyDraft, setPolicyDraft] = useState<SlaPolicy[]>([]);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [alerts, setAlerts] = useState<SupportAlert[]>([]);
  const [alertsBusy, setAlertsBusy] = useState(false);

  const load = useCallback(async () => {
    const [listRes, summaryRes, alertRes] = await Promise.all([
      fetch(`${API}/tickets?status=${encodeURIComponent(filter)}`, {
        credentials: "include",
        cache: "no-store",
      }),
      fetch(`${API}/summary`, { credentials: "include", cache: "no-store" }),
      fetch(`${API}/notifications?unread_only=true`, {
        credentials: "include",
        cache: "no-store",
      }),
    ]);
    const listData = await listRes.json();
    const summaryData = await summaryRes.json();
    const alertData = await alertRes.json();
    if (!listRes.ok) throw new Error(listData.detail || "Support inbox failed to load.");
    setTickets(listData.tickets || []);
    setSummary(summaryRes.ok ? summaryData : null);
    setAlerts(alertRes.ok ? alertData.notifications || [] : []);
  }, [filter]);

  useEffect(() => {
    setHydrated(true);
    void load().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Support inbox failed to load.")
    );
  }, [load]);

  const openTicket = async (ticket: Ticket) => {
    const response = await fetch(`${API}/tickets/${ticket.id}`, {
      credentials: "include",
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.detail || "Ticket failed to load.");
      return;
    }
    setSelected(data.ticket);
    setReply("");
    setInternal(false);
  };

  const sendReply = async () => {
    if (!selected || !reply.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`${API}/tickets/${selected.id}/reply`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply, internal }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Reply failed.");
      setSelected(data.ticket);
      setReply("");
      setInternal(false);
      setMessage("Reply saved.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reply failed.");
    } finally {
      setBusy(false);
    }
  };

  const markAlertRead = async (id: number) => {
    setAlertsBusy(true);
    try {
      await fetch(`${API}/notifications/${id}/read`, {
        method: "POST",
        credentials: "include",
      });
      await load();
    } finally {
      setAlertsBusy(false);
    }
  };

  const retryAlert = async (id: number) => {
    setAlertsBusy(true);
    try {
      await fetch(`${API}/notifications/${id}/retry`, {
        method: "POST",
        credentials: "include",
      });
      await load();
    } finally {
      setAlertsBusy(false);
    }
  };

  const runSlaCheck = async () => {
    setAlertsBusy(true);
    try {
      await fetch(`${API}/notifications/run`, {
        method: "POST",
        credentials: "include",
      });
      await load();
    } finally {
      setAlertsBusy(false);
    }
  };

  const openPolicy = () => {
    setPolicyDraft(
      (summary?.sla.policies || []).map((policy) => ({ ...policy }))
    );
    setPolicyOpen(true);
  };

  const savePolicy = async () => {
    setPolicyBusy(true);
    setMessage("");
    try {
      for (const policy of policyDraft) {
        const response = await fetch(`${API}/sla-policy/${policy.priority}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            response_minutes: Number(policy.response_minutes),
            resolution_minutes: Number(policy.resolution_minutes),
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || "SLA policy save failed.");
      }
      setPolicyOpen(false);
      setMessage("SLA policy updated.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "SLA policy save failed.");
    } finally {
      setPolicyBusy(false);
    }
  };

  const updateTicket = async (patch: Record<string, string>) => {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch(`${API}/tickets/${selected.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Ticket update failed.");
      setSelected(data.ticket);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ticket update failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="support-inbox-page"
      data-hydrated={hydrated ? "true" : "false"}
      className="space-y-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
            Customers · support
          </p>
          <h1 className="text-3xl font-black text-gray-950">Support inbox</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Guest requests with a private reply link, staff notes, priority and resolution
            status.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="support-run-sla-check"
            onClick={() => void runSlaCheck()}
            disabled={alertsBusy}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[9px] font-black uppercase tracking-widest text-gray-600 disabled:opacity-50"
          >
            {alertsBusy ? "Checking..." : "Run SLA check"}
          </button>
          <button
            type="button"
            data-testid="support-sla-policy-button"
            onClick={openPolicy}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[9px] font-black uppercase tracking-widest text-gray-600"
          >
            SLA policy
          </button>
          {["open", "pending", "resolved", "closed"].map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setFilter(filter === status ? "" : status)}
              className={`rounded-lg px-3 py-2 text-[9px] font-black uppercase tracking-widest ${
                filter === status
                  ? "bg-gray-950 text-white"
                  : "border border-gray-200 bg-white text-gray-600"
              }`}
            >
              {status} · {summary?.counts[status] || 0}
            </button>
          ))}
        </div>
      </div>

      {message && (
        <p className="rounded-xl border border-gray-100 bg-white px-4 py-3 text-xs font-bold text-gray-700">
          {message}
        </p>
      )}

      {alerts.length > 0 && (
        <section
          data-testid="support-sla-alerts"
          className="rounded-2xl border border-red-100 bg-red-50 p-4"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-red-700">
              {summary?.notifications_unread || alerts.length} unread SLA alerts
            </p>
            <span className="text-[9px] font-bold uppercase tracking-widest text-red-500">
              Auto-checked every 15 minutes
            </span>
          </div>
          <div className="mt-2 space-y-1.5">
            {alerts.slice(0, 6).map((alert) => (
              <div
                key={alert.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2"
              >
                <div>
                  <p className="text-xs font-bold text-gray-800">{alert.message}</p>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400">
                    {alert.kind.replaceAll("_", " ")} · {alert.ticket_priority} ·{" "}
                    {alert.delivery_status === "sent"
                      ? `sent via ${alert.delivery_channels}`
                      : alert.delivery_status === "retrying"
                        ? `retry ${alert.delivery_attempts || 1} · next ${
                            alert.next_retry_at
                              ? new Date(alert.next_retry_at).toLocaleTimeString(
                                  "en-IN",
                                  { hour: "2-digit", minute: "2-digit" }
                                )
                              : "soon"
                          }`
                        : alert.delivery_status === "failed"
                          ? "delivery failed"
                          : "in-app only"}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {alert.delivery_status !== "sent" && (
                    <button
                      type="button"
                      data-testid={`support-alert-retry-${alert.id}`}
                      onClick={() => void retryAlert(alert.id)}
                      disabled={alertsBusy}
                      className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-amber-800 disabled:opacity-50"
                    >
                      Retry delivery
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid={`support-alert-read-${alert.id}`}
                    onClick={() => void markAlertRead(alert.id)}
                    disabled={alertsBusy}
                    className="rounded-lg border border-gray-200 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-gray-600 disabled:opacity-50"
                  >
                    Mark read
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section
        data-testid="support-sla-summary"
        className="grid gap-3 rounded-2xl border border-gray-100 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        {[
          ["Overdue", summary?.sla?.overdue || 0, "text-red-700"],
          ["Due soon", summary?.sla?.due_soon || 0, "text-amber-700"],
          [
            "First reply overdue",
            summary?.sla?.first_response_overdue || 0,
            "text-red-700",
          ],
          [
            "Avg first reply",
            `${summary?.sla?.avg_first_response_minutes || 0}m`,
            "text-gray-900",
          ],
          [
            "Avg resolution",
            `${summary?.sla?.avg_resolution_minutes || 0}m`,
            "text-gray-900",
          ],
          ["Breached resolved", summary?.sla?.breached_resolved || 0, "text-red-700"],
        ].map(([label, value, tone]) => (
          <div key={String(label)}>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
              {label}
            </p>
            <p className={`mt-1 text-xl font-black ${tone}`}>{value}</p>
          </div>
        ))}
        <p className="col-span-full text-[10px] font-semibold text-gray-400">
          Targets: urgent 2h · high 8h · normal 24h · low 48h. First reply excludes internal
          notes.
        </p>
      </section>

      <div className="grid gap-5 xl:grid-cols-[440px_1fr]">
        <section className="rounded-2xl border border-gray-100 bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Tickets
            </p>
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-black uppercase text-red-700">
              {summary?.urgent_open || 0} urgent
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {tickets.length === 0 ? (
              <p className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-xs font-semibold text-gray-400">
                No tickets in this view.
              </p>
            ) : (
              tickets.map((ticket) => (
                <button
                  key={ticket.id}
                  data-testid={`support-ticket-${ticket.id}`}
                  onClick={() => void openTicket(ticket)}
                  className={`w-full rounded-xl border p-3 text-left ${
                    selected?.id === ticket.id
                      ? "border-orange-300 bg-orange-50"
                      : "border-gray-100 hover:border-gray-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-black text-gray-900">{ticket.subject}</p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${
                        STATUS_TONE[ticket.status] || "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {ticket.status}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] font-semibold text-gray-500">
                    {ticket.customer_name} · {ticket.category} · {ticket.priority}
                  </p>
                  {ticket.sla_state && ticket.sla_state !== "closed" && (
                    <span
                      data-testid={`support-sla-${ticket.id}`}
                      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-widest ${
                        SLA_TONE[ticket.sla_state] || "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {slaLabel(ticket)}
                    </span>
                  )}
                  {ticket.last_message && (
                    <p className="mt-1 line-clamp-2 text-[10px] font-medium text-gray-400">
                      {ticket.last_message}
                    </p>
                  )}
                </button>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-5">
          {selected ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                    Ticket #{selected.id}
                  </p>
                  <h2 className="mt-1 text-xl font-black text-gray-950">
                    {selected.subject}
                  </h2>
                  <p className="mt-1 text-[10px] font-semibold text-gray-500">
                    {selected.customer_name}
                    {selected.email ? ` · ${selected.email}` : ""}
                    {selected.phone ? ` · ${selected.phone}` : ""}
                    {selected.order_id ? ` · order #${selected.order_id}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] font-bold text-gray-500">
                    <span
                      className={`rounded-full px-2 py-0.5 uppercase tracking-widest ${
                        SLA_TONE[selected.sla_state || "no_target"]
                      }`}
                    >
                      {selected.sla_state || "no target"}
                    </span>
                    {selected.sla_due_at && (
                      <span>
                        Resolution target{" "}
                        {new Date(selected.sla_due_at).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    )}
                    {selected.first_response_due_at && (
                      <span>
                        Reply target{" "}
                        {new Date(selected.first_response_due_at).toLocaleTimeString(
                          "en-IN",
                          { hour: "2-digit", minute: "2-digit" }
                        )}
                      </span>
                    )}
                    {selected.first_response_at && (
                      <span>
                        First reply{" "}
                        {new Date(selected.first_response_at).toLocaleTimeString("en-IN")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <select
                    aria-label="Ticket status"
                    value={selected.status}
                    onChange={(event) =>
                      void updateTicket({ status: event.target.value })
                    }
                    className="rounded-lg border border-gray-200 px-2 py-1.5 text-[10px] font-bold text-gray-600"
                  >
                    {["open", "pending", "resolved", "closed"].map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Ticket priority"
                    value={selected.priority}
                    onChange={(event) =>
                      void updateTicket({ priority: event.target.value })
                    }
                    className="rounded-lg border border-gray-200 px-2 py-1.5 text-[10px] font-bold text-gray-600"
                  >
                    {["low", "normal", "high", "urgent"].map((priority) => (
                      <option key={priority} value={priority}>
                        {priority}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto rounded-xl bg-gray-50 p-3">
                {(selected.messages || []).map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-xl px-3 py-2 ${
                      item.author_type === "customer"
                        ? "bg-white text-gray-700"
                        : item.internal
                          ? "bg-amber-100 text-amber-900"
                          : "bg-gray-950 text-white"
                    }`}
                  >
                    <p className="text-[9px] font-black uppercase tracking-widest opacity-60">
                      {item.author_type === "customer"
                        ? selected.customer_name
                        : item.internal
                          ? "Internal note"
                          : item.author_name || "Staff"}
                    </p>
                    <p className="mt-1 whitespace-pre-line text-xs font-medium leading-5">
                      {item.body}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-3">
                <textarea
                  data-testid="support-inbox-reply"
                  rows={3}
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder="Reply to the customer..."
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-[10px] font-bold text-gray-500">
                    <input
                      type="checkbox"
                      checked={internal}
                      onChange={(event) => setInternal(event.target.checked)}
                    />
                    Internal note (hidden from customer)
                  </label>
                  <button
                    type="button"
                    data-testid="support-inbox-send"
                    onClick={() => void sendReply()}
                    disabled={busy || !reply.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-gray-950 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-white disabled:opacity-50"
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Send reply
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="grid place-items-center py-20 text-center">
              <Headphones className="h-9 w-9 text-gray-300" />
              <p className="mt-3 text-sm font-bold text-gray-500">
                Select a ticket to read and reply.
              </p>
            </div>
          )}
        </section>
      </div>

      {policyOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div
            data-testid="support-sla-policy-modal"
            className="w-full max-w-lg rounded-2xl bg-white p-5"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-orange-600">
                  Support SLA
                </p>
                <h2 className="text-xl font-black text-gray-950">Response targets</h2>
                <p className="mt-1 text-xs font-semibold text-gray-500">
                  Minutes per priority. First response cannot exceed resolution.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close SLA policy"
                onClick={() => setPolicyOpen(false)}
                className="text-gray-400 hover:text-gray-700"
              >
                ×
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {policyDraft.map((policy, index) => (
                <div
                  key={policy.priority}
                  className="grid grid-cols-[90px_1fr_1fr] items-end gap-2 rounded-lg bg-gray-50 p-2"
                >
                  <p className="pb-2 text-[10px] font-black uppercase tracking-widest text-gray-600">
                    {policy.priority}
                  </p>
                  <label className="text-[8px] font-black uppercase tracking-widest text-gray-400">
                    First reply (min)
                    <input
                      type="number"
                      min={5}
                      max={10080}
                      value={policy.response_minutes}
                      onChange={(event) => {
                        const next = [...policyDraft];
                        next[index] = {
                          ...policy,
                          response_minutes: Number(event.target.value),
                        };
                        setPolicyDraft(next);
                      }}
                      className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-bold text-gray-800"
                    />
                  </label>
                  <label className="text-[8px] font-black uppercase tracking-widest text-gray-400">
                    Resolve (min)
                    <input
                      type="number"
                      min={5}
                      max={10080}
                      value={policy.resolution_minutes}
                      onChange={(event) => {
                        const next = [...policyDraft];
                        next[index] = {
                          ...policy,
                          resolution_minutes: Number(event.target.value),
                        };
                        setPolicyDraft(next);
                      }}
                      className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-bold text-gray-800"
                    />
                  </label>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPolicyOpen(false)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-gray-600"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="support-sla-policy-save"
                onClick={() => void savePolicy()}
                disabled={policyBusy}
                className="rounded-lg bg-gray-950 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-white disabled:opacity-50"
              >
                {policyBusy ? "Saving..." : "Save policy"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
