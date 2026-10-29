"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Check, Plus, ShoppingBag } from "lucide-react";

import {
  addItemToOrderDraft,
  openBlaze,
  orderDraftCount,
  ORDER_DRAFT_EVENT,
} from "./events";

/** One-tap add used on the landing menu cards. */
export function QuickAddButton({
  itemId,
  itemName,
  label = "Add to order",
  className = "",
}: {
  itemId: number;
  itemName: string;
  label?: string;
  className?: string;
}) {
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!added) return;
    const timer = window.setTimeout(() => setAdded(false), 2400);
    return () => window.clearTimeout(timer);
  }, [added]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => {
          addItemToOrderDraft({ id: itemId });
          setAdded(true);
        }}
        className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-black transition ${
          added
            ? "bg-emerald-600 text-white"
            : "bg-red-600 text-white hover:bg-red-700"
        } ${className}`}
        aria-label={added ? `${itemName} added to your order` : `Add ${itemName} to your order`}
      >
        {added ? <Check className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
        {added ? "Added" : label}
      </button>
      <Link
        href="/order"
        className="text-xs font-bold text-[#5a4f45] underline-offset-2 hover:text-red-700 hover:underline"
      >
        Customise
      </Link>
      <span className="sr-only" aria-live="polite">
        {added ? `${itemName} added to your order` : ""}
      </span>
    </div>
  );
}

/** Opens the live Blaze concierge with an optional starter prompt. */
export function AskBlazeButton({
  seed,
  className = "",
  children,
  ariaLabel,
}: {
  seed?: string;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => openBlaze(seed)}
      className={className}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}

/** Header order button that turns into a live cart count after a quick-add. */
export function LandingCartLink({ className = "" }: { className?: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const sync = () => setCount(orderDraftCount());
    sync();
    window.addEventListener(ORDER_DRAFT_EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener("pageshow", sync);
    return () => {
      window.removeEventListener(ORDER_DRAFT_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("pageshow", sync);
    };
  }, []);

  return (
    <Link href="/order" className={className}>
      {count > 0 ? (
        <>
          <ShoppingBag className="h-4 w-4" aria-hidden="true" />
          Cart · {count}
        </>
      ) : (
        <>
          Order now <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </>
      )}
    </Link>
  );
}

/**
 * Mobile-only sticky order bar. It appears once the customer has items in the
 * saved draft, keeping the "review order" action one thumb-tap away.
 */
export function LandingMobileOrderBar() {
  const [count, setCount] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setCount(orderDraftCount());
    sync();
    setReady(true);
    window.addEventListener(ORDER_DRAFT_EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener("pageshow", sync);
    return () => {
      window.removeEventListener(ORDER_DRAFT_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("pageshow", sync);
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined" || !ready) return;
    const visible = count > 0;
    document.body.classList.toggle("blaze-cart-open", visible);
    return () => document.body.classList.remove("blaze-cart-open");
  }, [count, ready]);

  if (!ready || count === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[65] border-t border-[#17130f]/10 bg-white/[0.97] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-3 shadow-[0_-12px_36px_rgba(23,19,15,0.16)] backdrop-blur sm:hidden">
      <div className="mx-auto flex max-w-md items-center gap-3">
        <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#17130f] text-amber-300">
          <ShoppingBag className="h-5 w-5" aria-hidden="true" />
          <span className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-red-600 px-1 text-[10px] font-black text-white">
            {count}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black leading-tight text-[#17130f]">
            {count} item{count === 1 ? "" : "s"} in your order
          </p>
          <p className="mt-0.5 text-[11px] font-semibold text-[#8a7a6a]">
            Saved on this device · customise at checkout
          </p>
        </div>
        <Link
          href="/order"
          className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white hover:bg-red-700"
        >
          View order <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
