"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Phone, ShoppingBag } from "lucide-react";

export default function CustomerLoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("");

    const response = await fetch("/api/customer-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const data = await response.json().catch(() => ({}));
    setIsSubmitting(false);

    if (!response.ok) {
      setMessage(data.detail || "Could not find an account for this phone number.");
      return;
    }

    const next = new URLSearchParams(window.location.search).get("next");
    router.push(next || "/account");
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-red-700">Pizza Blitz</p>
            <h1 className="text-2xl font-black">Customer Login</h1>
          </div>
          <Link
            href="/order"
            className="flex items-center gap-2 rounded-md bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800"
          >
            <ShoppingBag className="h-4 w-4" /> Order Food
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl justify-center px-5 py-10">
        <form
          onSubmit={signIn}
          className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6"
        >
          <p className="text-sm font-black uppercase tracking-widest text-red-700">
            My orders
          </p>
          <h2 className="mt-2 text-3xl font-black">Sign in with your order phone.</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Use the phone number you entered during checkout to view your saved order history.
          </p>

          {message && (
            <div className="mt-5 rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
              {message}
            </div>
          )}

          <label className="mt-6 flex items-center gap-3 rounded-md border border-slate-300 px-3 py-3 focus-within:border-red-600">
            <Phone className="h-4 w-4 text-slate-400" />
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="Phone number"
              required
              className="w-full outline-none"
            />
          </label>

          <button
            disabled={isSubmitting}
            className="mt-4 w-full rounded-md bg-slate-950 px-5 py-3 font-black text-white hover:bg-red-700 disabled:bg-slate-300"
          >
            {isSubmitting ? "Checking" : "View My Orders"}
          </button>
        </form>
      </main>
    </div>
  );
}
