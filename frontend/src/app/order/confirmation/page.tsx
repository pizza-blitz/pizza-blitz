"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  ReceiptText,
  ShoppingBag,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const ORDERS_API = getApiUrl("/api/v1/restaurant/orders");

type ConfirmedOrder = {
  id: number;
  order_type: string;
  fulfillment_type?: string | null;
  customer_name?: string | null;
  items: {
    name: string;
    quantity: number;
    price: number;
    selected_options?: { option_name: string; price_delta?: number }[];
  }[];
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  tip_amount?: number;
  delivery_fee?: number;
  total_amount: number;
  payment_status: string;
  payment_method?: string | null;
  status: string;
  eta_window?: string | null;
  scheduled_label?: string | null;
  delivery_address?: string | null;
  created_at?: string | null;
};

function money(value: number) {
  return `Rs ${Number(value || 0).toFixed(2)}`;
}

export default function OrderConfirmationPage() {
  const [orderId, setOrderId] = useState("");
  const [phone, setPhone] = useState("");
  const [eta, setEta] = useState("");
  const [order, setOrder] = useState<ConfirmedOrder | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderParam = params.get("order") || "";
    const phoneParam = params.get("phone") || "";
    const etaParam = params.get("eta") || "";
    setOrderId(orderParam);
    setPhone(phoneParam);
    setEta(etaParam);

    if (!orderParam || !phoneParam) {
      setMessage("Open the confirmation link from your order so we can show its details.");
      setIsLoading(false);
      return;
    }

    let active = true;
    const loadOrder = async () => {
      try {
        const response = await fetch(
          `${ORDERS_API}/customer-receipt/${encodeURIComponent(
            orderParam
          )}?phone=${encodeURIComponent(phoneParam)}`,
          { cache: "no-store" }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.detail || "Could not load this order.");
        }
        if (active) setOrder(data);
      } catch (error) {
        if (active) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Could not load this order. Your order number and tracking link still work."
          );
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void loadOrder();
    return () => {
      active = false;
    };
  }, []);

  const trackingHref =
    orderId && phone
      ? `/track?order=${encodeURIComponent(orderId)}&phone=${encodeURIComponent(phone)}`
      : "/track";
  const receiptHref =
    orderId && phone
      ? `/receipt/${encodeURIComponent(orderId)}?phone=${encodeURIComponent(phone)}`
      : "/account";
  const displayEta = order?.eta_window || eta || "Confirmed by the store";
  const isPrepaidPending =
    (order?.payment_method || "").toLowerCase() === "prepaid" &&
    (order?.payment_status || "").toLowerCase() !== "paid";

  return (
    <main className="min-h-screen bg-[#faf6ef] text-[#17130f]">
      <header className="border-b border-[#17130f]/10 bg-[#17130f] text-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-5 py-4 md:px-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-red-600 text-lg font-black">
              PB
            </span>
            <span className="text-lg font-black tracking-tight">Pizza Blitz</span>
          </Link>
          <Link
            href="/order"
            className="inline-flex items-center gap-2 rounded-lg border border-white/30 px-4 py-2 text-sm font-bold hover:bg-white hover:text-[#17130f]"
          >
            <ShoppingBag className="h-4 w-4" /> Order again
          </Link>
        </div>
      </header>

      <div
        data-testid="order-confirmation-page"
        className="mx-auto max-w-4xl px-5 py-10 md:px-8 md:py-14"
      >
        <section className="rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm md:p-8">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-7 w-7" />
            </span>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">
                Order confirmed
              </p>
              <h1 className="mt-1 text-3xl font-black tracking-tight md:text-4xl">
                Order #{order?.id || orderId || "--"}
              </h1>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#5a4f45]">
                {order?.scheduled_label
                  ? `Scheduled for ${order.scheduled_label}.`
                  : "The kitchen has your order. Keep this page or the tracking link handy."}
              </p>
            </div>
          </div>

          {isLoading && (
            <p className="mt-6 flex items-center gap-2 text-sm font-bold text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading order details
            </p>
          )}

          {message && (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
              {message}
            </div>
          )}

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-[#17130f]/10 bg-[#faf6ef] p-4">
              <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
                <Clock className="h-3.5 w-3.5 text-red-700" /> ETA
              </p>
              <p className="mt-1 text-lg font-black">{displayEta}</p>
            </div>
            <div className="rounded-xl border border-[#17130f]/10 bg-[#faf6ef] p-4">
              <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
                <MapPin className="h-3.5 w-3.5 text-red-700" /> Fulfillment
              </p>
              <p className="mt-1 text-lg font-black capitalize">
                {order?.fulfillment_type || order?.order_type || "Pickup"}
              </p>
            </div>
            <div className="rounded-xl border border-[#17130f]/10 bg-[#faf6ef] p-4">
              <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#8a7a6a]">
                <ReceiptText className="h-3.5 w-3.5 text-red-700" /> Payment
              </p>
              <p className="mt-1 text-lg font-black capitalize">
                {isPrepaidPending
                  ? "Pending"
                  : order?.payment_method || "Cash"}
              </p>
            </div>
          </div>

          {order && (
            <div className="mt-6 rounded-xl border border-[#17130f]/10">
              <div className="divide-y divide-[#17130f]/10">
                {order.items.map((item, index) => (
                  <div
                    key={`${item.name}-${index}`}
                    className="flex items-start justify-between gap-4 px-4 py-3 text-sm"
                  >
                    <div>
                      <p className="font-bold">
                        {item.quantity} x {item.name}
                      </p>
                      {!!item.selected_options?.length && (
                        <p className="mt-1 text-xs font-semibold text-[#8a7a6a]">
                          {item.selected_options
                            .map((option) => option.option_name)
                            .join(", ")}
                        </p>
                      )}
                    </div>
                    <p className="shrink-0 font-bold">
                      {money(item.price * item.quantity)}
                    </p>
                  </div>
                ))}
              </div>
              <div className="space-y-1 border-t border-[#17130f]/10 bg-[#faf6ef] px-4 py-3 text-sm font-semibold text-[#5a4f45]">
                <p className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{money(order.subtotal)}</span>
                </p>
                {Number(order.discount_amount || 0) > 0 && (
                  <p className="flex justify-between text-emerald-700">
                    <span>Discount</span>
                    <span>-{money(order.discount_amount)}</span>
                  </p>
                )}
                <p className="flex justify-between">
                  <span>Tax</span>
                  <span>{money(order.tax_amount)}</span>
                </p>
                {Number(order.delivery_fee || 0) > 0 && (
                  <p className="flex justify-between">
                    <span>Delivery</span>
                    <span>{money(order.delivery_fee || 0)}</span>
                  </p>
                )}
                {Number(order.tip_amount || 0) > 0 && (
                  <p className="flex justify-between">
                    <span>Tip</span>
                    <span>{money(order.tip_amount || 0)}</span>
                  </p>
                )}
                <p className="flex justify-between border-t border-[#17130f]/10 pt-2 text-lg font-black text-[#17130f]">
                  <span>Total</span>
                  <span>{money(order.total_amount)}</span>
                </p>
              </div>
            </div>
          )}

          {order?.delivery_address && (
            <p className="mt-4 flex items-start gap-2 rounded-xl bg-[#faf6ef] px-4 py-3 text-sm font-semibold text-[#5a4f45]">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
              {order.delivery_address}
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={trackingHref}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white hover:bg-red-500"
            >
              Track this order
            </Link>
            <Link
              href={receiptHref}
              className="inline-flex items-center gap-2 rounded-xl border border-[#17130f]/15 bg-white px-5 py-3 text-sm font-black text-[#17130f] hover:border-red-600 hover:text-red-700"
            >
              View receipt
            </Link>
            <Link
              href="/account"
              prefetch={false}
              className="inline-flex items-center gap-2 rounded-xl border border-[#17130f]/15 bg-white px-5 py-3 text-sm font-black text-[#17130f] hover:border-red-600 hover:text-red-700"
            >
              My orders
            </Link>
          </div>

          <p className="mt-5 text-xs font-semibold leading-5 text-[#8a7a6a]">
            Tracking refreshes automatically. Keep the phone used for this order handy if
            you need to look it up again.
          </p>
        </section>
      </div>
    </main>
  );
}
