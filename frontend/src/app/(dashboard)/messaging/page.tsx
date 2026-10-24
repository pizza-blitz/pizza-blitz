"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Loader2,
  Mail,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  Smartphone,
  X,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const API = getApiUrl("/api/v1/restaurant/messaging");

type Channel = "whatsapp" | "sms" | "email" | "instagram";
type Thread = {
  id: number;
  channel: Channel;
  destination: string;
  contact_name?: string | null;
  status: "open" | "pending" | "closed";
  unread_count: number;
  last_message?: string | null;
  last_direction?: string | null;
  last_message_at?: string | null;
};
type Message = {
  id: number;
  direction: "inbound" | "outbound";
  channel: Channel;
  body: string;
  subject?: string | null;
  status: string;
  provider?: string | null;
  error?: string | null;
  created_at?: string | null;
};
type Template = {
  id: number;
  name: string;
  channel: Channel;
  subject?: string | null;
  body: string;
  category: string;
  status: string;
};
type Readiness = {
  channels: Record<
    string,
    { configured: boolean; missing_settings: string[]; source: string }
  >;
  webhook_configured: boolean;
};

const channelIcon = (channel: Channel) => {
  if (channel === "email") return Mail;
  if (channel === "sms") return Smartphone;
  return MessageCircle;
};

const channelLabel = (channel: Channel) =>
  channel === "whatsapp" ? "WhatsApp" : channel === "sms" ? "SMS" : channel === "email" ? "Email" : "Instagram";

const timeLabel = (value?: string | null) => {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
};

const emptyNewThread = {
  channel: "whatsapp" as Channel,
  destination: "",
  contact_name: "",
  body: "",
};

export default function MessagingPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tab, setTab] = useState<"inbox" | "templates">("inbox");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [reply, setReply] = useState("");
  const [subject, setSubject] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newThread, setNewThread] = useState(emptyNewThread);
  const [templateDraft, setTemplateDraft] = useState({
    name: "",
    channel: "whatsapp" as Channel,
    category: "transactional",
    status: "draft",
    subject: "",
    body: "",
  });

  const loadThreads = async (preferredId?: number | null) => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (statusFilter) params.set("status", statusFilter);
    const response = await fetch(`${API}/threads?${params.toString()}`, {
      credentials: "include",
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Conversations failed to load.");
    setThreads(data.threads || []);
    const target = preferredId ?? selectedId ?? data.threads?.[0]?.id;
    if (target && !selectedId) void openThread(target);
  };

  const loadTemplates = async () => {
    const response = await fetch(`${API}/templates`, {
      credentials: "include",
      cache: "no-store",
    });
    const data = await response.json();
    if (response.ok) setTemplates(data.templates || []);
  };

  const loadReadiness = async () => {
    const response = await fetch(`${API}/readiness`, {
      credentials: "include",
      cache: "no-store",
    });
    const data = await response.json();
    if (response.ok) setReadiness(data);
  };

  const openThread = async (threadId: number) => {
    setSelectedId(threadId);
    setBusy("thread");
    try {
      const response = await fetch(`${API}/threads/${threadId}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Conversation failed to load.");
      setSelected(data.thread);
      setMessages(data.messages || []);
      setThreads((current) =>
        current.map((row) => (row.id === threadId ? { ...row, unread_count: 0 } : row))
      );
      await fetch(`${API}/threads/${threadId}/read`, {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Conversation failed to load.");
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    setHydrated(true);
    void Promise.all([loadThreads(), loadTemplates(), loadReadiness()]).catch((error) =>
      setMessage(error instanceof Error ? error.message : "Messaging failed to load.")
    );
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadThreads().catch(() => undefined);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [search, statusFilter]);

  const filteredTemplates = useMemo(
    () => templates.filter((template) => template.channel === selected?.channel),
    [templates, selected?.channel]
  );

  const sendReply = async () => {
    if (!selected || !reply.trim()) return;
    setBusy("send");
    setMessage("");
    try {
      const response = await fetch(`${API}/threads/${selected.id}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply.trim(), subject }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Message could not be sent.");
      setReply("");
      setTemplateId("");
      await openThread(selected.id);
      await loadThreads(selected.id);
      if (data.message?.status === "failed") {
        setMessage(`Delivery failed: ${data.error || "provider is not configured."}`);
      } else {
        setMessage("Reply sent.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Message could not be sent.");
    } finally {
      setBusy("");
    }
  };

  const setThreadStatus = async (status: "open" | "pending" | "closed") => {
    if (!selected) return;
    setBusy("status");
    try {
      const response = await fetch(`${API}/threads/${selected.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Status failed.");
      setSelected(data.thread);
      await loadThreads(selected.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Status failed.");
    } finally {
      setBusy("");
    }
  };

  const startThread = async () => {
    if (!newThread.destination.trim() || !newThread.body.trim()) return;
    setBusy("new");
    try {
      const response = await fetch(`${API}/threads`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newThread),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Conversation could not start.");
      setShowNew(false);
      setNewThread(emptyNewThread);
      setSelectedId(null);
      await loadThreads(data.thread.id);
      await openThread(data.thread.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Conversation could not start.");
    } finally {
      setBusy("");
    }
  };

  const createTemplate = async () => {
    if (!templateDraft.name.trim() || !templateDraft.body.trim()) return;
    setBusy("template");
    try {
      const response = await fetch(`${API}/templates`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(templateDraft),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Template could not be saved.");
      setTemplateDraft({
        name: "",
        channel: "whatsapp",
        category: "transactional",
        status: "draft",
        subject: "",
        body: "",
      });
      await loadTemplates();
      setMessage(`Template ${data.template.name} saved.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Template could not be saved.");
    } finally {
      setBusy("");
    }
  };

  const channelReady = selected
    ? Boolean(readiness?.channels?.[selected.channel]?.configured)
    : false;

  return (
    <div
      data-testid="messaging-page"
      data-hydrated={hydrated ? "true" : "false"}
      className="space-y-4 animate-in fade-in duration-300"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
            Marketing · conversations
          </p>
          <h1 className="text-3xl font-black text-gray-950">Messaging inbox</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            One shared inbox for WhatsApp, SMS and email replies, with templates and
            delivery status. Inbound webhooks create or update the same thread.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void Promise.all([loadThreads(), loadTemplates(), loadReadiness()])}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-gray-600"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button
            type="button"
            data-testid="messaging-new-thread"
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-orange-600"
          >
            <Plus className="h-4 w-4" /> New conversation
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["inbox", "templates"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`rounded-lg px-4 py-2 text-[10px] font-black uppercase tracking-widest ${
              tab === value
                ? "bg-gray-950 text-white"
                : "border border-gray-200 bg-white text-gray-600"
            }`}
          >
            {value === "inbox" ? "Inbox" : "Templates"}
          </button>
        ))}
        {readiness && !readiness.webhook_configured && (
          <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-800">
            Inbound webhook token is not configured.
          </span>
        )}
      </div>

      {message && (
        <p className="rounded-xl border border-gray-100 bg-white px-4 py-3 text-xs font-bold text-gray-700">
          {message}
        </p>
      )}

      {tab === "templates" ? (
        <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <section className="rounded-2xl border border-gray-100 bg-white p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              New template
            </p>
            <div className="mt-3 space-y-3">
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500">
                Name
                <input
                  data-testid="template-name"
                  value={templateDraft.name}
                  onChange={(event) =>
                    setTemplateDraft({ ...templateDraft, name: event.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500">
                  Channel
                  <select
                    value={templateDraft.channel}
                    onChange={(event) =>
                      setTemplateDraft({
                        ...templateDraft,
                        channel: event.target.value as Channel,
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                  >
                    {(["whatsapp", "sms", "email", "instagram"] as Channel[]).map((channel) => (
                      <option key={channel} value={channel}>
                        {channelLabel(channel)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500">
                  Category
                  <select
                    value={templateDraft.category}
                    onChange={(event) =>
                      setTemplateDraft({ ...templateDraft, category: event.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                  >
                    <option value="transactional">Transactional</option>
                    <option value="marketing">Marketing</option>
                    <option value="support">Support</option>
                  </select>
                </label>
              </div>
              {templateDraft.channel === "email" && (
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500">
                  Subject
                  <input
                    value={templateDraft.subject}
                    onChange={(event) =>
                      setTemplateDraft({ ...templateDraft, subject: event.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                  />
                </label>
              )}
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500">
                Body
                <textarea
                  data-testid="template-body"
                  rows={5}
                  value={templateDraft.body}
                  onChange={(event) =>
                    setTemplateDraft({ ...templateDraft, body: event.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                />
              </label>
              <div className="flex items-center gap-3">
                <select
                  value={templateDraft.status}
                  onChange={(event) =>
                    setTemplateDraft({ ...templateDraft, status: event.target.value })
                  }
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700"
                >
                  <option value="draft">Draft</option>
                  <option value="approved">Approved</option>
                </select>
                <button
                  type="button"
                  data-testid="template-save"
                  onClick={() => void createTemplate()}
                  disabled={busy === "template"}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gray-950 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
                >
                  Save template
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Saved templates
            </p>
            <div className="mt-3 space-y-2">
              {templates.length === 0 ? (
                <p className="text-sm font-semibold text-gray-400">No templates yet.</p>
              ) : (
                templates.map((template) => (
                  <article
                    key={template.id}
                    className="rounded-xl border border-gray-100 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-black text-gray-900">{template.name}</p>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-gray-500">
                        {template.channel} · {template.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">
                      {template.body}
                    </p>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="grid min-h-[620px] gap-3 lg:grid-cols-[340px_1fr]">
          <section className="flex min-h-0 flex-col rounded-2xl border border-gray-100 bg-white">
            <div className="space-y-2 border-b border-gray-100 p-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search conversations"
                  className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm font-semibold text-gray-700"
                />
              </label>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600"
              >
                <option value="">All statuses</option>
                <option value="open">Open</option>
                <option value="pending">Pending</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {threads.length === 0 ? (
                <p className="p-4 text-sm font-semibold text-gray-400">
                  No conversations yet. Inbound webhook replies will appear here.
                </p>
              ) : (
                threads.map((thread) => {
                  const Icon = channelIcon(thread.channel);
                  return (
                    <button
                      key={thread.id}
                      type="button"
                      data-testid={`thread-row-${thread.id}`}
                      onClick={() => void openThread(thread.id)}
                      className={`flex w-full items-start gap-3 border-b border-gray-50 p-3 text-left ${
                        selectedId === thread.id ? "bg-orange-50/60" : "hover:bg-gray-50"
                      }`}
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gray-100 text-gray-600">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-black text-gray-900">
                            {thread.contact_name || thread.destination}
                          </span>
                          {thread.unread_count > 0 && (
                            <span className="rounded-full bg-orange-600 px-1.5 py-0.5 text-[9px] font-black text-white">
                              {thread.unread_count}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] font-semibold text-gray-500">
                          {thread.last_message || "No messages"}
                        </span>
                        <span className="mt-1 flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-gray-400">
                          <span>{channelLabel(thread.channel)}</span>
                          <span>·</span>
                          <span>{thread.status}</span>
                          <span>·</span>
                          <span>{timeLabel(thread.last_message_at)}</span>
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="flex min-h-0 flex-col rounded-2xl border border-gray-100 bg-white">
            {!selected ? (
              <div className="grid flex-1 place-items-center p-8 text-center">
                <div>
                  <MessageCircle className="mx-auto h-10 w-10 text-gray-300" />
                  <p className="mt-3 text-sm font-bold text-gray-500">
                    Select a conversation to reply.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 p-4">
                  <div>
                    <p className="text-sm font-black text-gray-900">
                      {selected.contact_name || selected.destination}
                    </p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      {channelLabel(selected.channel)} · {selected.destination}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(["open", "pending", "closed"] as const).map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => void setThreadStatus(status)}
                        disabled={busy === "status"}
                        className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${
                          selected.status === status
                            ? "bg-gray-950 text-white"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#faf8f4] p-4">
                  {messages.map((item) => (
                    <div
                      key={item.id}
                      data-testid={`message-${item.id}`}
                      className={`flex ${item.direction === "outbound" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[78%] rounded-2xl px-4 py-2.5 ${
                          item.direction === "outbound"
                            ? "bg-gray-950 text-white"
                            : "border border-gray-100 bg-white text-gray-800"
                        }`}
                      >
                        {item.subject && (
                          <p className="mb-1 text-[10px] font-black uppercase tracking-widest opacity-70">
                            {item.subject}
                          </p>
                        )}
                        <p className="whitespace-pre-wrap text-sm font-medium leading-6">
                          {item.body}
                        </p>
                        <p
                          className={`mt-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest ${
                            item.direction === "outbound" ? "text-white/50" : "text-gray-400"
                          }`}
                        >
                          {item.direction === "outbound" ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <Clock3 className="h-3 w-3" />
                          )}
                          {item.status} · {timeLabel(item.created_at)}
                        </p>
                        {item.error && (
                          <p className="mt-1 text-[10px] font-semibold text-red-300">
                            {item.error}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-gray-100 p-3">
                  {!channelReady && (
                    <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-800">
                      {channelLabel(selected.channel)} provider is not ready. Configure it in
                      Settings → Providers before sending a reply.
                    </p>
                  )}
                  {filteredTemplates.length > 0 && (
                    <select
                      value={templateId}
                      onChange={(event) => {
                        setTemplateId(event.target.value);
                        const template = templates.find(
                          (row) => String(row.id) === event.target.value
                        );
                        if (template) {
                          setReply(template.body);
                          setSubject(template.subject || "");
                        }
                      }}
                      className="mb-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600"
                    >
                      <option value="">Use a template...</option>
                      {filteredTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {selected.channel === "email" && (
                    <input
                      value={subject}
                      onChange={(event) => setSubject(event.target.value)}
                      placeholder="Subject"
                      className="mb-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700"
                    />
                  )}
                  <div className="flex items-end gap-2">
                    <textarea
                      data-testid="message-composer"
                      value={reply}
                      onChange={(event) => setReply(event.target.value)}
                      rows={2}
                      placeholder={`Reply on ${channelLabel(selected.channel)}...`}
                      className="min-h-[52px] flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-800 outline-none focus:border-orange-400"
                    />
                    <button
                      type="button"
                      data-testid="message-send"
                      onClick={() => void sendReply()}
                      disabled={busy === "send" || !reply.trim()}
                      className="inline-flex h-[52px] items-center gap-1.5 rounded-lg bg-orange-600 px-4 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
                    >
                      {busy === "send" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Send
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-orange-600">
                  New conversation
                </p>
                <h2 className="text-2xl font-black text-gray-950">Start a thread</h2>
              </div>
              <button
                type="button"
                aria-label="Close new conversation"
                onClick={() => setShowNew(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  Channel
                  <select
                    value={newThread.channel}
                    onChange={(event) =>
                      setNewThread({ ...newThread, channel: event.target.value as Channel })
                    }
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                  >
                    {(["whatsapp", "sms", "email", "instagram"] as Channel[]).map((channel) => (
                      <option key={channel} value={channel}>
                        {channelLabel(channel)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  Name
                  <input
                    value={newThread.contact_name}
                    onChange={(event) =>
                      setNewThread({ ...newThread, contact_name: event.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                  />
                </label>
              </div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500">
                Destination
                <input
                  value={newThread.destination}
                  onChange={(event) =>
                    setNewThread({ ...newThread, destination: event.target.value })
                  }
                  placeholder="Phone or email"
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                />
              </label>
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500">
                First message
                <textarea
                  value={newThread.body}
                  onChange={(event) => setNewThread({ ...newThread, body: event.target.value })}
                  rows={4}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                />
              </label>
              <button
                type="button"
                onClick={() => void startThread()}
                disabled={busy === "new"}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
              >
                <ArrowUpRight className="h-4 w-4" /> Start conversation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
