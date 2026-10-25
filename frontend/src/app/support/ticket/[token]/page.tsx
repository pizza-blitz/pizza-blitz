"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { getApiUrl } from "@/lib/api";

type Message = {
  id: number;
  author_type: string;
  author_name?: string | null;
  body: string;
  created_at?: string | null;
};

type Ticket = {
  customer_name: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  order_id?: number | null;
  messages: Message[];
};

const statusTone: Record<string, string> = {
  open: "bg-amber-100 text-amber-800",
  pending: "bg-sky-100 text-sky-800",
  resolved: "bg-emerald-100 text-emerald-800",
  closed: "bg-gray-200 text-gray-600",
};

export default function SupportTicketPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token || "";
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const response = await fetch(
      getApiUrl(`/api/v1/restaurant/support/ticket/${token}`),
      { cache: "no-store" }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Ticket could not be loaded.");
    setTicket(data.ticket);
  };

  useEffect(() => {
    if (!token) return;
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : "Ticket could not be loaded.")
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const reply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        getApiUrl(`/api/v1/restaurant/support/ticket/${token}/reply`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Reply failed.");
      setTicket(data.ticket);
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reply failed.");
    } finally {
      setBusy(false);
    }
  };

  if (error && !ticket) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-20">
        <div className="rounded-3xl border border-red-100 bg-white p-8 text-center">
          <h1 className="text-2xl font-black text-gray-950">Ticket unavailable</h1>
          <p className="mt-2 text-sm font-semibold text-gray-500">{error}</p>
          <Link href="/support" className="mt-4 inline-block text-xs font-black text-orange-700 underline">
            Open a new request
          </Link>
        </div>
      </main>
    );
  }

  if (!ticket) {
    return (
      <main className="flex min-h-screen items-center justify-center gap-2 text-sm font-bold text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading ticket...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f2e9] px-4 py-10 text-[#17130f]">
      <div className="mx-auto max-w-2xl">
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e64a19] text-sm font-black text-white">
              PB
            </span>
            <span className="text-sm font-black">Pizza Blitz</span>
          </Link>
          <span
            className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${
              statusTone[ticket.status] || "bg-gray-100 text-gray-600"
            }`}
          >
            {ticket.status}
          </span>
        </header>

        <section
          data-testid="public-support-ticket"
          className="mt-6 rounded-3xl border border-[#17130f]/10 bg-white p-6 md:p-8"
        >
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e64a19]">
            Support ticket
          </p>
          <h1 className="mt-2 text-2xl font-black">{ticket.subject}</h1>
          <p className="mt-1 text-xs font-semibold text-[#8a7a6a]">
            {ticket.customer_name} · {ticket.category}
            {ticket.order_id ? ` · order #${ticket.order_id}` : ""}
          </p>

          <div className="mt-6 space-y-3">
            {ticket.messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  message.author_type === "customer"
                    ? "ml-auto bg-[#e64a19] text-white"
                    : "bg-[#faf6ef] text-[#4c4138]"
                }`}
              >
                <p className="text-[9px] font-black uppercase tracking-widest opacity-70">
                  {message.author_type === "customer" ? "You" : "Pizza Blitz"}
                </p>
                <p className="mt-1 whitespace-pre-line text-sm font-medium leading-6">
                  {message.body}
                </p>
              </div>
            ))}
          </div>

          {ticket.status === "closed" ? (
            <p className="mt-6 rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-600">
              This ticket is closed. Start a new request if you still need help.
            </p>
          ) : (
            <form onSubmit={reply} className="mt-6 border-t border-[#17130f]/10 pt-4">
              <label className="block text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
                Reply
                <textarea
                  data-testid="support-reply-body"
                  rows={3}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-[#17130f]/15 px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#e64a19]"
                  placeholder="Add more detail or answer the team"
                />
              </label>
              {error && <p className="mt-2 text-xs font-bold text-red-700">{error}</p>}
              <button
                type="submit"
                data-testid="support-reply-submit"
                disabled={busy || !body.trim()}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#17130f] px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send reply
              </button>
            </form>
          )}
        </section>
        <p className="mt-4 flex items-center justify-center gap-1 text-[10px] font-semibold text-[#8a7a6a]">
          <MessageCircle className="h-3.5 w-3.5" /> Keep this private link to follow updates.
        </p>
      </div>
    </main>
  );
}
