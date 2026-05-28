"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  Clock,
  CreditCard,
  Loader2,
  MapPin,
  Phone,
  ReceiptText,
  Search,
  ShoppingBag,
  Truck,
  Utensils,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const TRACK_API = getApiUrl("/api/v1/restaurant/orders/track");
const REORDER_STORAGE_KEY = "pizza_blitz_reorder";

type TrackingStep = {
  key: string;
  label: string;
  complete: boolean;
};

type TrackedOrder = {
  id: number;
  order_type: string;
  fulfillment_type?: string | null;
  delivery_address?: string | null;
  delivery_zone?: string | null;
  delivery_fee?: number;
  delivery_assignment?: {
    assigned_to?: string | null;
    status: string;
    notes?: string | null;
    next_action?: string | null;
    assigned_at?: string | null;
    out_for_delivery_at?: string | null;
    delivered_at?: string | null;
  } | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  items: {
    name: string;
    quantity: number;
    price: number;
    selected_options?: {
      group_id?: number;
      group_name?: string;
      option_id?: number;
      option_name: string;
      price_delta: number;
    }[];
  }[];
  total_amount: number;
  payment_status: string;
  payment_method?: string | null;
  payment_provider?: string | null;
  payment_reference?: string | null;
  payment_confirmed_at?: string | null;
  status: string;
  eta_window: string;
  next_action: string;
  tracking_steps: TrackingStep[];
  created_at?: string | null;
};

function formatTrackingTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function TrackOrderPage() {
  const [orderId, setOrderId] = useState("");
  const [phone, setPhone] = useState("");
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [paymentReference, setPaymentReference] = useState("");
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderParam = params.get("order") || "";
    const phoneParam = params.get("phone") || "";
    if (orderParam) setOrderId(orderParam);
    if (phoneParam) setPhone(phoneParam);
    if (orderParam && phoneParam) {
      lookupOrder(orderParam, phoneParam);
    }
  }, []);

  const placedAt = useMemo(() => {
    if (!order?.created_at) return "";
    return new Date(order.created_at).toLocaleString();
  }, [order?.created_at]);
  const isDeliveryOrder = (order?.fulfillment_type || order?.order_type || "").toLowerCase() === "delivery";
  const rawDeliveryStatus = (order?.delivery_assignment?.status || "unassigned").toLowerCase();
  const deliveryStatus = rawDeliveryStatus.replaceAll("_", " ");
  const isPaymentPending =
    (order?.payment_method || "").toLowerCase() === "prepaid" &&
    (order?.payment_status || "").toLowerCase() !== "paid";
  const deliveryTimeline = useMemo(() => {
    if (!order || !isDeliveryOrder) return [];
    const assignment = order.delivery_assignment;
    const status = (assignment?.status || "unassigned").toLowerCase();
    const delivered = status === "delivered" || order.status === "closed";
    return [
      {
        label: "Address confirmed",
        detail: order.delivery_zone || "Delivery zone selected",
        complete: true,
        time: placedAt,
      },
      {
        label: "Rider assigned",
        detail: assignment?.assigned_to || "Store team is assigning a rider",
        complete: ["assigned", "out_for_delivery", "delivered"].includes(status),
        time: formatTrackingTime(assignment?.assigned_at),
      },
      {
        label: "Out for delivery",
        detail: status === "out_for_delivery" || delivered ? "Rider is on the way" : "Waiting for dispatch",
        complete: ["out_for_delivery", "delivered"].includes(status),
        time: formatTrackingTime(assignment?.out_for_delivery_at),
      },
      {
        label: "Delivered",
        detail: delivered ? "Order handed over" : "Not completed yet",
        complete: delivered,
        time: formatTrackingTime(assignment?.delivered_at),
      },
    ];
  }, [isDeliveryOrder, order, placedAt]);
  const deliveryInstruction = useMemo(() => {
    if (!isDeliveryOrder) return "";
    if (rawDeliveryStatus === "assigned") return "Your rider is assigned. Keep your phone reachable for dispatch.";
    if (rawDeliveryStatus === "out_for_delivery") return "Your rider is on the way. Please keep your phone reachable and payment ready if needed.";
    if (rawDeliveryStatus === "delivered") return "Delivery is complete. Thank you for ordering from Pizza Blitz.";
    if (rawDeliveryStatus === "failed") return "Delivery needs help. The store team may contact you to resolve it.";
    return "We have your address. The store team is assigning a delivery partner.";
  }, [isDeliveryOrder, rawDeliveryStatus]);
  const completedDeliveryTimelineSteps = deliveryTimeline.filter((step) => step.complete).length;

  const lookupOrder = async (nextOrderId = orderId, nextPhone = phone) => {
    const trimmedOrderId = nextOrderId.trim();
    const trimmedPhone = nextPhone.trim();
    if (!trimmedOrderId || !trimmedPhone) {
      setMessage("Order ID and phone are required.");
      return;
    }

    setIsLoading(true);
    setMessage("");
    setOrder(null);
    const response = await fetch(
      `${TRACK_API}/${encodeURIComponent(trimmedOrderId)}?phone=${encodeURIComponent(trimmedPhone)}`,
      { cache: "no-store" }
    );
    const data = await response.json();
    setIsLoading(false);

    if (!response.ok) {
      setMessage(data.detail || "Order could not be found.");
      return;
    }
    setOrder(data);
    if ((data.payment_method || "").toLowerCase() === "prepaid" && data.payment_status !== "paid") {
      setPaymentReference(data.payment_reference || `TRACK-${data.id}`);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    lookupOrder();
  };

  const confirmTrackedPayment = async () => {
    if (!order) return;
    if (!phone.trim()) {
      setMessage("Phone number is required to confirm this payment.");
      return;
    }

    setIsConfirmingPayment(true);
    setMessage("");
    const response = await fetch(`${TRACK_API}/${order.id}/payment-confirmation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: phone.trim(),
        payment_provider: "manual",
        payment_reference: paymentReference.trim(),
        paid_amount: order.total_amount,
      }),
    });
    const data = await response.json();
    setIsConfirmingPayment(false);

    if (!response.ok) {
      setMessage(data.detail || "Payment could not be confirmed.");
      return;
    }

    setOrder(data);
    setPaymentReference(data.payment_reference || "");
    setMessage(`Payment confirmed for order #${data.id}.`);
  };

  const saveReorderDraft = () => {
    if (!order || typeof window === "undefined") return;

    window.localStorage.setItem(
      REORDER_STORAGE_KEY,
      JSON.stringify({
        source_order_id: order.id,
        customer: {
          name: order.customer_name || "",
          phone: order.customer_phone || phone,
          opt_in_marketing: true,
        },
        items: order.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          selected_options: item.selected_options || [],
        })),
      })
    );
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-red-700">Pizza Blitz</p>
            <h1 className="text-2xl font-black">Track Order</h1>
          </div>
          <div className="flex gap-3">
            <Link
              href="/order"
              className="flex items-center gap-2 rounded-md bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800"
            >
              <ShoppingBag className="h-4 w-4" /> Order Food
            </Link>
            <Link
              href="/account"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:border-red-600 hover:text-red-700"
            >
              My Orders
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        <section className="grid overflow-hidden rounded-lg border border-slate-200 bg-white md:grid-cols-12">
          <div className="p-6 md:col-span-7">
            <p className="mb-2 text-sm font-bold text-red-700">Live status</p>
            <h2 className="text-3xl font-black">Order #{order?.id || orderId || "--"}</h2>
            <form onSubmit={handleSubmit} className="mt-6 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <label className="flex items-center gap-3 rounded-md border border-slate-300 bg-white px-3 py-3 focus-within:border-red-600">
                <ReceiptText className="h-4 w-4 text-slate-400" />
                <input
                  value={orderId}
                  onChange={(event) => setOrderId(event.target.value)}
                  placeholder="Order ID"
                  inputMode="numeric"
                  className="w-full outline-none"
                />
              </label>
              <label className="flex items-center gap-3 rounded-md border border-slate-300 bg-white px-3 py-3 focus-within:border-red-600">
                <Phone className="h-4 w-4 text-slate-400" />
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="Phone number"
                  className="w-full outline-none"
                />
              </label>
              <button className="flex items-center justify-center gap-2 rounded-md bg-slate-950 px-5 py-3 font-bold text-white hover:bg-red-700">
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Track
              </button>
            </form>
          </div>
          <img
            src="https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=900&q=80"
            alt="Fresh pizza on table"
            className="hidden h-64 w-full object-cover md:col-span-5 md:block md:h-full"
          />
        </section>

        {message && (
          <div className="mt-6 rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
            {message}
          </div>
        )}

        {order && (
          <div className="mt-6 grid gap-6 lg:grid-cols-12">
            <section className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-8">
              <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-red-700">{order.order_type}</p>
                  <h3 className="mt-1 text-2xl font-black">{order.next_action}</h3>
                  {placedAt && (
                    <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                      <Clock className="h-4 w-4" /> {placedAt}
                    </p>
                  )}
                </div>
                <div className="rounded-md bg-slate-950 px-4 py-3 text-right text-white">
                  <p className="text-xs font-bold uppercase text-slate-300">ETA</p>
                  <p className="text-xl font-black">{order.eta_window}</p>
                </div>
              </div>

              <div
                className={`grid gap-3 ${isDeliveryOrder ? "md:grid-cols-3 xl:grid-cols-6" : "md:grid-cols-5"}`}
              >
                {order.tracking_steps.map((step) => (
                  <div
                    key={step.key}
                    className={`rounded-md border p-3 ${
                      step.complete
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-slate-50 text-slate-500"
                    }`}
                  >
                    <div
                      className={`mb-3 flex h-8 w-8 items-center justify-center rounded-full ${
                        step.complete ? "bg-emerald-600 text-white" : "bg-white text-slate-400"
                      }`}
                    >
                      <Check className="h-4 w-4" />
                    </div>
                    <p className="text-sm font-black">{step.label}</p>
                  </div>
                ))}
              </div>

              {isPaymentPending && (
                <div
                  data-testid="track-payment-rescue"
                  className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4"
                >
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-amber-700">
                        Payment Pending
                      </p>
                      <h4 className="mt-1 text-lg font-black text-amber-950">
                        Confirm prepaid payment
                      </h4>
                    </div>
                    <CreditCard className="h-5 w-5 text-amber-700" />
                  </div>
                  <p className="text-sm font-semibold leading-6 text-amber-900">
                    If payment is already completed, enter the UPI, gateway, or staff reference so the order can move ahead.
                  </p>
                  <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                    <input
                      value={paymentReference}
                      onChange={(event) => setPaymentReference(event.target.value)}
                      className="rounded-md border border-amber-200 bg-white px-3 py-3 text-sm font-semibold outline-none focus:border-amber-600"
                      placeholder="Payment reference"
                    />
                    <button
                      type="button"
                      onClick={confirmTrackedPayment}
                      disabled={isConfirmingPayment}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-amber-600 px-4 py-3 text-sm font-black text-white hover:bg-amber-700 disabled:bg-slate-300"
                    >
                      {isConfirmingPayment ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                      {isConfirmingPayment ? "Confirming" : "Confirm Payment"}
                    </button>
                  </div>
                </div>
              )}

              {order.payment_confirmed_at && (
                <div
                  data-testid="track-payment-confirmed"
                  className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900"
                >
                  Payment confirmed via {(order.payment_provider || "manual").toUpperCase()}.
                  {order.payment_reference ? ` Reference: ${order.payment_reference}.` : ""}
                </div>
              )}

              {isDeliveryOrder && (
                <div
                  data-testid="track-delivery-status"
                  className="mt-5 rounded-lg border border-red-100 bg-red-50 p-4"
                >
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-red-700">
                        Delivery Handoff
                      </p>
                      <h4 className="mt-1 text-lg font-black text-red-950">
                        {order.delivery_assignment?.next_action || deliveryInstruction}
                      </h4>
                      <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-red-900">
                        {deliveryInstruction}
                      </p>
                    </div>
                    <Truck className="h-5 w-5 text-red-700" />
                  </div>
                  <div className="grid gap-3 text-sm md:grid-cols-4">
                    <Detail
                      label="Rider"
                      value={order.delivery_assignment?.assigned_to || "Assigning"}
                      testId="track-delivery-rider"
                    />
                    <Detail
                      label="Status"
                      value={deliveryStatus}
                      testId="track-delivery-assignment-status"
                    />
                    <Detail
                      label="Zone"
                      value={order.delivery_zone || "Selected"}
                    />
                    <Detail
                      label="Fee"
                      value={`Rs ${Number(order.delivery_fee || 0).toLocaleString()}`}
                    />
                  </div>
                  <div
                    data-testid="track-delivery-timeline"
                    className="mt-4 rounded-lg border border-red-100 bg-white p-4"
                  >
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-widest text-slate-500">
                          Delivery Timeline
                        </p>
                        <h5 className="mt-1 font-black text-slate-950">
                          {completedDeliveryTimelineSteps}/{deliveryTimeline.length} delivery steps complete
                        </h5>
                      </div>
                      <span className="rounded-md bg-red-50 px-3 py-2 text-xs font-black uppercase text-red-700">
                        {order.eta_window}
                      </span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                      {deliveryTimeline.map((step) => (
                        <div
                          key={step.label}
                          className={`rounded-md border px-3 py-3 ${
                            step.complete
                              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                              : "border-slate-200 bg-slate-50 text-slate-600"
                          }`}
                        >
                          <div
                            className={`mb-3 flex h-8 w-8 items-center justify-center rounded-full ${
                              step.complete ? "bg-emerald-600 text-white" : "bg-white text-slate-400"
                            }`}
                          >
                            <Check className="h-4 w-4" />
                          </div>
                          <p className="text-sm font-black">{step.label}</p>
                          <p className="mt-1 text-xs font-semibold leading-5">{step.detail}</p>
                          {step.time && (
                            <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                              {step.time}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  {order.delivery_address && (
                    <p className="mt-3 flex items-start gap-2 rounded-md bg-white px-3 py-2 text-sm font-semibold text-red-900">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                      {order.delivery_address}
                    </p>
                  )}
                </div>
              )}
            </section>

            <aside className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-4">
              <h3 className="mb-4 flex items-center gap-2 text-lg font-black">
                <Utensils className="h-5 w-5 text-red-700" /> Order Details
              </h3>
              <div className="divide-y divide-slate-100 border-y border-slate-100">
                {order.items.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="flex justify-between py-3 text-sm">
                    <span className="font-semibold">
                      {item.quantity} x {item.name}
                      {!!item.selected_options?.length && (
                        <span className="mt-1 block text-xs text-slate-500">
                          {item.selected_options
                            .map((option) => option.option_name)
                            .join(", ")}
                        </span>
                      )}
                    </span>
                    <span>Rs {Number(item.price * item.quantity).toLocaleString()}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <Detail label="Total" value={`Rs ${Number(order.total_amount || 0).toLocaleString()}`} />
                <Detail label="Status" value={order.status} />
                <Detail label="Payment" value={order.payment_method || "Pending"} />
                <Detail label="Paid" value={order.payment_status} />
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-md bg-slate-50 px-3 py-3 text-sm font-bold text-slate-700">
                <CreditCard className="h-4 w-4 text-red-700" />
                {order.payment_status.replace("_", " ")}
              </div>
              {!!order.items.length && (
                <div
                  data-testid="track-reorder-command"
                  className="mt-4 rounded-lg border border-red-100 bg-red-50 p-4"
                >
                  <p className="text-xs font-black uppercase tracking-widest text-red-700">
                    Order Again
                  </p>
                  <h4 className="mt-1 text-lg font-black text-red-950">
                    Reorder this cart in one click
                  </h4>
                  <p className="mt-2 text-sm font-semibold leading-6 text-red-900">
                    Loads these items, quantities, and selected customizations into checkout.
                  </p>
                  <Link
                    data-testid="track-reorder-link"
                    href="/order"
                    onClick={saveReorderDraft}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-red-700 px-4 py-3 text-sm font-black text-white hover:bg-red-800"
                  >
                    <ShoppingBag className="h-4 w-4" /> Reorder same items
                  </Link>
                </div>
              )}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

function Detail({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-3" data-testid={testId}>
      <p className="text-xs font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 break-words font-bold capitalize">{value}</p>
    </div>
  );
}
