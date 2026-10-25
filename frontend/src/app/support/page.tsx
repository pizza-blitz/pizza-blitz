"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, LifeBuoy, Loader2, Send } from "lucide-react";
import { getApiUrl } from "@/lib/api";

const CATEGORIES = [
  ["order", "Order issue"],
  ["delivery", "Delivery"],
  ["payment", "Payment / refund"],
  ["account", "Account"],
  ["other", "Something else"],
];

export default function SupportPage() {
  const [form, setForm] = useState({
    customer_name: "",
    email: "",
    phone: "",
    subject: "",
    message: "",
    category: "order",
    priority: "normal",
    order_id: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ticketUrl, setTicketUrl] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        getApiUrl("/api/v1/restaurant/support/tickets"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            order_id: form.order_id ? Number(form.order_id) : null,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Ticket could not be created.");
      setTicketUrl(data.ticket.ticket_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ticket could not be created.");
    } finally {
      setBusy(false);
    }
  };

  if (ticketUrl) {
    return (
      <main className="min-h-screen bg-[#f7f2e9] px-4 py-16 text-[#17130f]">
        <div
          data-testid="support-ticket-created"
          className="mx-auto max-w-xl rounded-3xl border border-[#17130f]/10 bg-white p-8 text-center shadow-sm"
        >
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
          <h1 className="mt-3 text-2xl font-black">We have your request</h1>
          <p className="mt-2 text-sm font-semibold text-[#6d5f52]">
            Keep this private link to follow the conversation. Our team replies in the same
            thread.
          </p>
          <Link
            data-testid="support-ticket-link"
            href={ticketUrl.replace(/^https?:\/\/[^/]+/, "")}
            className="mt-5 inline-flex rounded-xl bg-[#e64a19] px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-white"
          >
            Open my ticket
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f2e9] px-4 py-12 text-[#17130f]">
      <div className="mx-auto max-w-2xl">
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e64a19] text-sm font-black text-white">
              PB
            </span>
            <span className="text-sm font-black">Pizza Blitz</span>
          </Link>
          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
            <LifeBuoy className="h-4 w-4" /> Support
          </span>
        </header>

        <section className="mt-6 rounded-3xl border border-[#17130f]/10 bg-white p-7 shadow-[0_20px_60px_-40px_rgba(23,19,15,0.6)] md:p-10">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#e64a19]">
            Talk to the team
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">How can we help?</h1>
          <p className="mt-2 text-sm font-semibold text-[#6d5f52]">
            Tell us what happened. We create a private ticket link so you can follow every
            reply.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
                Your name
                <input
                  data-testid="support-name"
                  required
                  minLength={2}
                  value={form.customer_name}
                  onChange={(event) =>
                    setForm({ ...form, customer_name: event.target.value })
                  }
                  className="mt-1 w-full rounded-xl border border-[#17130f]/15 px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#e64a19]"
                />
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
                Phone
                <input
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-[#17130f]/15 px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#e64a19]"
                />
              </label>
            </div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
              Email
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                className="mt-1 w-full rounded-xl border border-[#17130f]/15 px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#e64a19]"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
                Topic
                <select
                  value={form.category}
                  onChange={(event) => setForm({ ...form, category: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-[#17130f]/15 px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#e64a19]"
                >
                  {CATEGORIES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
                Order number (optional)
                <input
                  type="number"
                  value={form.order_id}
                  onChange={(event) => setForm({ ...form, order_id: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-[#17130f]/15 px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#e64a19]"
                />
              </label>
            </div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
              Subject
              <input
                data-testid="support-subject"
                required
                minLength={3}
                value={form.subject}
                onChange={(event) => setForm({ ...form, subject: event.target.value })}
                className="mt-1 w-full rounded-xl border border-[#17130f]/15 px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#e64a19]"
              />
            </label>
            <label className="block text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
              What happened?
              <textarea
                data-testid="support-message"
                required
                minLength={5}
                rows={5}
                value={form.message}
                onChange={(event) => setForm({ ...form, message: event.target.value })}
                className="mt-1 w-full rounded-xl border border-[#17130f]/15 px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#e64a19]"
              />
            </label>
            <p className="text-[10px] font-semibold text-[#8a7a6a]">
              Add an email or phone so we can verify the ticket. No account needed.
            </p>
            {error && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
                {error}
              </p>
            )}
            <button
              type="submit"
              data-testid="support-submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-[#e64a19] px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send to support
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
