"use client";

import { useEffect, useState } from "react";
import { Clock3, Pizza, Sparkles } from "lucide-react";

export default function CustomerDisplayPage() {
  const [now, setNow] = useState("");

  useEffect(() => {
    const update = () =>
      setNow(
        new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
    update();
    const timer = window.setInterval(update, 30000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main
      data-testid="customer-display"
      className="flex min-h-screen flex-col justify-between bg-[#0a0a0b] p-8 text-white md:p-14"
    >
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-orange-500 text-black">
            <Pizza className="h-6 w-6" />
          </span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-orange-300">
              Pizza Blitz
            </p>
            <p className="text-lg font-black">Customer display</p>
          </div>
        </div>
        <p className="flex items-center gap-2 text-sm font-bold text-gray-400">
          <Clock3 className="h-4 w-4 text-orange-400" /> {now}
        </p>
      </header>

      <section className="mx-auto max-w-3xl text-center">
        <Sparkles className="mx-auto h-10 w-10 text-orange-400" />
        <h1 className="mt-6 text-4xl font-black leading-tight md:text-6xl">
          Welcome to Pizza Blitz
        </h1>
        <p className="mt-4 text-lg font-semibold text-gray-400 md:text-2xl">
          Your order and total will appear here when the counter starts your bill.
        </p>
        <div className="mx-auto mt-10 grid max-w-xl grid-cols-3 gap-3 text-center">
          {["Fresh dough", "Hot oven", "Fast handoff"].map((label) => (
            <div
              key={label}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm font-black text-orange-100"
            >
              {label}
            </div>
          ))}
        </div>
      </section>

      <footer className="text-center text-xs font-bold uppercase tracking-[0.25em] text-gray-600">
        Thank you for dining with us
      </footer>
    </main>
  );
}
