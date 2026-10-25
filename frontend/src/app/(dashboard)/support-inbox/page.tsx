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

type Summary = {
  counts: Record<string, number>;
  urgent_open: number;
};

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

  const load = useCallback(async () => {
    const [listRes, summaryRes] = await Promise.all([
      fetch(`${API}/tickets?status=${encodeURIComponent(filter)}`, {
        credentials: "include",
        cache: "no-store",
      }),
      fetch(`${API}/summary`, { credentials: "include", cache: "no-store" }),
    ]);
    const listData = await listRes.json();
    const summaryData = await summaryRes.json();
    if (!listRes.ok) throw new Error(listData.detail || "Support inbox failed to load.");
    setTickets(listData.tickets || []);
    setSummary(summaryRes.ok ? summaryData : null);
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
    </div>
  );
}
