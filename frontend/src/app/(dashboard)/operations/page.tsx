"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  CreditCard,
  FileText,
  Flame,
  Globe2,
  Loader2,
  MapPin,
  ReceiptText,
  RefreshCw,
  TimerReset,
  Truck,
  Utensils,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const ORDERS_API = getApiUrl("/api/v1/restaurant/orders");
const DELIVERY_API = getApiUrl("/api/v1/restaurant/delivery");

type OrderItem = {
  name: string;
  quantity: number;
  price: number;
  selected_options?: {
    group_name: string;
    option_name: string;
    price_delta: number;
  }[];
};

type AddressValidation = {
  quality: string;
  score: number;
  matched_keyword?: string | null;
  warnings?: string[];
  requires_review?: boolean;
};

type Order = {
  id: number;
  order_type: string;
  source?: string | null;
  fulfillment_type?: string | null;
  delivery_address?: string | null;
  delivery_zone?: string | null;
  delivery_fee?: number;
  delivery_assignment?: {
    assigned_to?: string | null;
    status: string;
    notes?: string | null;
    assigned_at?: string | null;
    out_for_delivery_at?: string | null;
    delivered_at?: string | null;
    next_action?: string | null;
  } | null;
  eta_window?: string | null;
  address_validation?: AddressValidation | null;
  requires_address_review?: boolean;
  delivery_next_action?: string | null;
  payment_due?: boolean;
  table_number?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  items: OrderItem[];
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  payment_status: string;
  payment_method?: string | null;
  payment_provider?: string | null;
  payment_reference?: string | null;
  status: string;
  notes?: string | null;
  created_at?: string | null;
  closed_at?: string | null;
};

type DeliveryQueueSummary = {
  open_delivery_count: number;
  unassigned_count: number;
  assigned_count: number;
  out_for_delivery_count: number;
  delivered_count: number;
  failed_count: number;
  address_review_count: number;
  payment_due_count: number;
};

const filters = [
  { id: "active", label: "Active" },
  { id: "open", label: "New" },
  { id: "preparing", label: "Preparing" },
  { id: "ready", label: "Ready" },
  { id: "delivery", label: "Delivery" },
  { id: "address_review", label: "Address Review" },
  { id: "payment_due", label: "Payment Due" },
  { id: "closed", label: "Closed" },
];

function money(value: number) {
  return `Rs ${Math.round(Number(value || 0)).toLocaleString()}`;
}

function ageLabel(createdAt?: string | null) {
  if (!createdAt) return "Just now";
  const minutes = Math.max(
    Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000),
    0
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${remainder}m`;
}

function statusClass(status: string) {
  if (status === "ready") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "preparing") return "bg-sky-50 text-sky-700 border-sky-200";
  if (status === "closed") return "bg-slate-100 text-slate-600 border-slate-200";
  return "bg-orange-50 text-orange-700 border-orange-200";
}

function paymentClass(status: string) {
  if (status === "paid") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "awaiting_payment") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-zinc-100 text-zinc-700 border-zinc-200";
}

function optionSummary(option: NonNullable<OrderItem["selected_options"]>[number]) {
  const delta = Number(option.price_delta || 0);
  const suffix = delta > 0 ? ` +Rs ${delta}` : "";
  return `${option.group_name}: ${option.option_name}${suffix}`;
}

function itemSummary(item: OrderItem) {
  const optionNames = (item.selected_options || [])
    .map(optionSummary)
    .filter(Boolean);
  return optionNames.length
    ? `${item.quantity}x ${item.name} (${optionNames.join(", ")})`
    : `${item.quantity}x ${item.name}`;
}

export default function OperationsPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState("active");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [deliveryQueueSummary, setDeliveryQueueSummary] = useState<DeliveryQueueSummary | null>(null);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<number, string>>({});
  const [assignmentNoteDrafts, setAssignmentNoteDrafts] = useState<Record<number, string>>({});

  const activeOrders = orders.filter((order) => order.status !== "closed");
  const paymentDueOrders = activeOrders.filter(
    (order) =>
      (order.payment_method || "").toLowerCase() === "prepaid" &&
      order.payment_status !== "paid"
  );
  const deliveryOrders = activeOrders.filter(
    (order) => (order.fulfillment_type || order.order_type) === "delivery"
  );
  const addressReviewOrders = deliveryOrders.filter(
    (order) => order.requires_address_review || order.address_validation?.requires_review
  );

  const stats = useMemo(() => {
    const ready = activeOrders.filter((order) => order.status === "ready").length;
    const preparing = activeOrders.filter((order) => order.status === "preparing").length;
    const fresh = activeOrders.filter((order) => order.status === "open").length;
    const activeValue = activeOrders.reduce(
      (sum, order) => sum + Number(order.total_amount || 0),
      0
    );
    const unassignedDelivery = deliveryOrders.filter(
      (order) => !order.delivery_assignment?.assigned_to
    ).length;
    return {
      ready,
      preparing,
      fresh,
      activeValue,
      unassignedDelivery,
      addressReview: addressReviewOrders.length,
    };
  }, [activeOrders, addressReviewOrders.length, deliveryOrders]);

  const deliveryStats = useMemo(() => {
    const statusCounts = deliveryOrders.reduce(
      (counts, order) => {
        const status = order.delivery_assignment?.status || "unassigned";
        if (status === "assigned") counts.assigned += 1;
        else if (status === "out_for_delivery") counts.out += 1;
        else if (status === "delivered") counts.delivered += 1;
        else if (status === "failed") counts.failed += 1;
        else counts.unassigned += 1;
        return counts;
      },
      { unassigned: 0, assigned: 0, out: 0, delivered: 0, failed: 0 }
    );
    return {
      total: deliveryQueueSummary?.open_delivery_count ?? deliveryOrders.length,
      addressReview: deliveryQueueSummary?.address_review_count ?? addressReviewOrders.length,
      paymentDue: deliveryQueueSummary?.payment_due_count ?? paymentDueOrders.length,
      ...statusCounts,
      unassigned: deliveryQueueSummary?.unassigned_count ?? statusCounts.unassigned,
      assigned: deliveryQueueSummary?.assigned_count ?? statusCounts.assigned,
      out: deliveryQueueSummary?.out_for_delivery_count ?? statusCounts.out,
      delivered: deliveryQueueSummary?.delivered_count ?? statusCounts.delivered,
      failed: deliveryQueueSummary?.failed_count ?? statusCounts.failed,
    };
  }, [addressReviewOrders.length, deliveryOrders, deliveryQueueSummary, paymentDueOrders.length]);

  const visibleOrders = useMemo(() => {
    if (filter === "active") return activeOrders;
    if (filter === "delivery") return deliveryOrders;
    if (filter === "address_review") return addressReviewOrders;
    if (filter === "payment_due") return paymentDueOrders;
    return orders.filter((order) => order.status === filter);
  }, [activeOrders, addressReviewOrders, deliveryOrders, filter, orders, paymentDueOrders]);

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async (options?: { preserveMessage?: boolean }) => {
    setIsLoading(true);
    try {
      const [response, queueResponse] = await Promise.all([
        fetch(`${ORDERS_API}/today`, {
          cache: "no-store",
          credentials: "include",
        }),
        fetch(`${DELIVERY_API}/queue`, {
          cache: "no-store",
          credentials: "include",
        }),
      ]);
      const data = await response.json();
      const queueData = await queueResponse.json();
      if (!response.ok) throw new Error(data.detail || "Could not load orders.");
      if (!queueResponse.ok) throw new Error(queueData.detail || "Could not load delivery queue.");

      const queueById = new Map<number, any>(
        (queueData.orders || []).map((order: any) => [order.id, order])
      );
      setDeliveryQueueSummary(queueData.summary || null);
      setOrders(
        (data.orders || []).map((order: Order) => {
          const queueOrder = queueById.get(order.id);
          if (!queueOrder) return order;
          return {
            ...order,
            delivery_address: queueOrder.delivery_address ?? order.delivery_address,
            delivery_zone: queueOrder.delivery_zone ?? order.delivery_zone,
            delivery_fee: Number(queueOrder.delivery_fee ?? order.delivery_fee ?? 0),
            delivery_assignment: queueOrder.assignment ?? order.delivery_assignment,
            eta_window: queueOrder.eta_window ?? order.eta_window,
            address_validation: queueOrder.address_validation ?? null,
            requires_address_review: Boolean(queueOrder.requires_address_review),
            delivery_next_action: queueOrder.next_action,
            payment_due: Boolean(queueOrder.payment_due ?? order.payment_due),
          };
        })
      );
      if (!options?.preserveMessage) setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load orders.");
    } finally {
      setIsLoading(false);
    }
  };

  const updateStatus = async (order: Order, status: "open" | "preparing" | "ready") => {
    setBusyAction(`${order.id}-${status}`);
    try {
      const response = await fetch(`${ORDERS_API}/${order.id}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not move order.");
      setMessage(`Order #${order.id} moved to ${status}.`);
      await fetchOrders({ preserveMessage: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not move order.");
    } finally {
      setBusyAction(null);
    }
  };

  const generateInvoice = async (order: Order) => {
    setBusyAction(`${order.id}-invoice`);
    try {
      const params = new URLSearchParams();
      if (order.customer_name) params.set("customer_name", order.customer_name);
      const response = await fetch(`${ORDERS_API}/${order.id}/invoice?${params.toString()}`, {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not generate invoice.");
      setMessage(`Invoice ${data.invoice_number} generated for order #${order.id}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not generate invoice.");
    } finally {
      setBusyAction(null);
    }
  };

  const closeOrder = async (order: Order) => {
    if (
      (order.payment_method || "").toLowerCase() === "prepaid" &&
      order.payment_status !== "paid"
    ) {
      setMessage(`Order #${order.id} is still awaiting prepaid payment.`);
      return;
    }

    setBusyAction(`${order.id}-close`);
    try {
      const paymentMethod = order.payment_method || "cash";
      const response = await fetch(
        `${ORDERS_API}/${order.id}/close?payment_method=${encodeURIComponent(paymentMethod)}`,
        { method: "PATCH", credentials: "include" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not close order.");
      const usageCount = Array.isArray(data.inventory_usage) ? data.inventory_usage.length : 0;
      setMessage(
        `Order #${order.id} closed${usageCount ? ` and ${usageCount} ingredients updated.` : "."}`
      );
      await fetchOrders({ preserveMessage: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not close order.");
    } finally {
      setBusyAction(null);
    }
  };

  const updateDeliveryAssignment = async (
    order: Order,
    status: "assigned" | "out_for_delivery" | "delivered" | "failed"
  ) => {
    const assignedTo =
      assignmentDrafts[order.id] ??
      order.delivery_assignment?.assigned_to ??
      "";
    const assignmentNote =
      assignmentNoteDrafts[order.id] ??
      order.delivery_assignment?.notes ??
      "";
    if (["assigned", "out_for_delivery", "delivered"].includes(status) && !assignedTo.trim()) {
      setMessage(`Add a delivery partner for order #${order.id}.`);
      return;
    }
    if (status === "failed" && !assignmentNote.trim()) {
      setMessage(`Add a failure reason for order #${order.id}.`);
      return;
    }

    setBusyAction(`${order.id}-delivery-${status}`);
    try {
      const response = await fetch(`${DELIVERY_API}/orders/${order.id}/assignment`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assigned_to: assignedTo,
          status,
          notes: assignmentNote,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not update delivery.");

      if (status === "delivered") {
        if (
          (order.payment_method || "").toLowerCase() === "prepaid" &&
          order.payment_status !== "paid"
        ) {
          setMessage(`Delivery for order #${order.id} is delivered. Confirm prepaid payment before closing.`);
          await fetchOrders({ preserveMessage: true });
          return;
        }

        const paymentMethod = order.payment_method || "cash";
        const closeResponse = await fetch(
          `${ORDERS_API}/${order.id}/close?payment_method=${encodeURIComponent(paymentMethod)}`,
          { method: "PATCH", credentials: "include" }
        );
        const closeData = await closeResponse.json();
        if (!closeResponse.ok) {
          throw new Error(closeData.detail || "Could not close delivered order.");
        }
        const usageCount = Array.isArray(closeData.inventory_usage)
          ? closeData.inventory_usage.length
          : 0;
        setMessage(
          `Delivery for order #${order.id} delivered and order closed${usageCount ? ` with ${usageCount} ingredients updated.` : "."}`
        );
        await fetchOrders({ preserveMessage: true });
        return;
      }

      setMessage(`Delivery for order #${order.id} moved to ${status.replaceAll("_", " ")}.`);
      await fetchOrders({ preserveMessage: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update delivery.");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-950">Kitchen Operations</h1>
          <p className="mt-1 text-sm text-gray-500">
            Live order queue for prep, payment checks, invoices, and handoff.
          </p>
        </div>
        <button
          onClick={() => fetchOrders()}
          disabled={isLoading}
          className="flex h-10 items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">New</p>
          <div className="mt-2 flex items-end justify-between">
            <span className="text-2xl font-black text-gray-950">{stats.fresh}</span>
            <Clock3 className="h-5 w-5 text-orange-500" />
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Preparing</p>
          <div className="mt-2 flex items-end justify-between">
            <span className="text-2xl font-black text-gray-950">{stats.preparing}</span>
            <Flame className="h-5 w-5 text-sky-600" />
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Ready</p>
          <div className="mt-2 flex items-end justify-between">
            <span className="text-2xl font-black text-gray-950">{stats.ready}</span>
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Unassigned</p>
          <div className="mt-2 flex items-end justify-between">
            <span className="text-2xl font-black text-gray-950">{stats.unassignedDelivery}</span>
            <Truck className="h-5 w-5 text-red-600" />
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Address Review</p>
          <div className="mt-2 flex items-end justify-between">
            <span className="text-2xl font-black text-gray-950">{stats.addressReview}</span>
            <AlertTriangle className="h-5 w-5 text-amber-600" />
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Open Value</p>
          <div className="mt-2 flex items-end justify-between">
            <span className="text-2xl font-black text-gray-950">{money(stats.activeValue)}</span>
            <CreditCard className="h-5 w-5 text-violet-600" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
        {filters.map((item) => (
          <button
            key={item.id}
            onClick={() => setFilter(item.id)}
            className={`h-9 rounded-md px-4 text-sm font-semibold transition ${
              filter === item.id
                ? "bg-gray-950 text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {message && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-medium text-orange-800">
          {message}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-gray-950">Delivery Dispatch Board</h2>
            <p className="text-sm text-gray-500">
              Rider assignment health for active delivery orders.
            </p>
          </div>
          <button
            onClick={() => setFilter("delivery")}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-black text-red-700 hover:bg-red-100"
          >
            <Truck className="h-4 w-4" />
            Show Delivery Queue
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          {[
            ["Open Deliveries", deliveryStats.total, "text-gray-950"],
            ["Unassigned", deliveryStats.unassigned, "text-red-700"],
            ["Address Review", deliveryStats.addressReview, "text-amber-700"],
            ["Assigned", deliveryStats.assigned, "text-sky-700"],
            ["Out", deliveryStats.out, "text-orange-700"],
            ["Delivered", deliveryStats.delivered, "text-emerald-700"],
            ["Failed", deliveryStats.failed, "text-rose-700"],
            ["Payment Due", deliveryStats.paymentDue, "text-violet-700"],
          ].map(([label, value, tone]) => (
            <div
              key={label}
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
            >
              <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
                {label}
              </p>
              <p className={`mt-2 text-2xl font-black ${tone}`}>{value}</p>
            </div>
          ))}
        </div>
        {!deliveryOrders.length && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-5 text-sm font-semibold text-gray-500">
            No active delivery orders. New website or counter delivery orders will appear here for assignment.
          </div>
        )}
      </section>

      {deliveryOrders.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-gray-950">Delivery Assignment</h2>
              <p className="text-sm text-gray-500">
                Active delivery orders with rider handoff status.
              </p>
            </div>
            <Truck className="h-5 w-5 text-red-600" />
          </div>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {deliveryOrders.map((order) => {
              const assignment = order.delivery_assignment;
              const addressValidation = order.address_validation;
              const addressWarnings = addressValidation?.warnings || [];
              const needsAddressReview =
                order.requires_address_review || addressValidation?.requires_review;
              return (
                <article
                  key={`delivery-${order.id}`}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-gray-950">Order #{order.id}</p>
                      <p className="mt-1 max-w-md text-sm font-semibold text-gray-600">
                        {order.delivery_address || "Address pending"}
                      </p>
                      <p className="mt-1 text-xs font-bold text-gray-500">
                        {order.delivery_zone || "Zone pending"} | Fee {money(order.delivery_fee || 0)} | {order.eta_window}
                      </p>
                      {addressValidation && (
                        <p className="mt-1 text-xs font-black text-slate-600">
                          Address score {addressValidation.score}/100 | {addressValidation.quality}
                          {addressValidation.matched_keyword
                            ? ` | Matched ${addressValidation.matched_keyword}`
                            : ""}
                        </p>
                      )}
                    </div>
                    <span className="rounded-md border border-red-100 bg-red-50 px-2 py-1 text-xs font-black text-red-700">
                      {assignment?.status?.replaceAll("_", " ") || "unassigned"}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {needsAddressReview && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <div>
                            <p className="font-black uppercase">Address Review Required</p>
                            {addressWarnings.slice(0, 2).map((warning) => (
                              <p key={warning} className="mt-1 leading-5">
                                {warning}
                              </p>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
                      <span className="font-black text-slate-900">Next action:</span>{" "}
                      {order.delivery_next_action || assignment?.notes || "Assign a delivery partner."}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 md:grid-cols-2">
                    <input
                      value={assignmentDrafts[order.id] ?? assignment?.assigned_to ?? ""}
                      onChange={(event) =>
                        setAssignmentDrafts((current) => ({
                          ...current,
                          [order.id]: event.target.value,
                        }))
                      }
                      placeholder="Delivery partner"
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-red-600"
                    />
                    <input
                      value={assignmentNoteDrafts[order.id] ?? assignment?.notes ?? ""}
                      onChange={(event) =>
                        setAssignmentNoteDrafts((current) => ({
                          ...current,
                          [order.id]: event.target.value,
                        }))
                      }
                      placeholder="Handoff note or failure reason"
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-red-600"
                    />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <button
                      onClick={() => updateDeliveryAssignment(order, "assigned")}
                      disabled={busyAction === `${order.id}-delivery-assigned`}
                      className="rounded-md bg-slate-950 px-3 py-2 text-sm font-black text-white hover:bg-red-700 disabled:bg-slate-300"
                    >
                      Assign
                    </button>
                    <button
                      onClick={() => updateDeliveryAssignment(order, "out_for_delivery")}
                      disabled={busyAction === `${order.id}-delivery-out_for_delivery`}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-black text-slate-700 hover:border-red-600"
                    >
                      Dispatch
                    </button>
                    <button
                      onClick={() => updateDeliveryAssignment(order, "delivered")}
                      disabled={busyAction === `${order.id}-delivery-delivered`}
                      className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-700 hover:bg-emerald-100"
                    >
                      Delivered & Close
                    </button>
                    <button
                      onClick={() => updateDeliveryAssignment(order, "failed")}
                      disabled={busyAction === `${order.id}-delivery-failed`}
                      className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-black text-rose-700 hover:bg-rose-100"
                    >
                      Failed
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[1fr_140px_150px_230px] gap-4 border-b border-gray-200 bg-gray-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-gray-500">
            <span>Order</span>
            <span>Payment</span>
            <span>Status</span>
            <span className="text-right">Actions</span>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm font-medium text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading orders
            </div>
          )}

          {!isLoading && !visibleOrders.length && (
            <div className="px-4 py-10 text-center text-sm text-gray-500">
              No orders in this lane.
            </div>
          )}

          {!isLoading &&
            visibleOrders.map((order) => {
              const isPrepaidDue =
                (order.payment_method || "").toLowerCase() === "prepaid" &&
                order.payment_status !== "paid";
              const canClose = order.status !== "closed" && !isPrepaidDue;
              const primaryLocation = order.table_number
                ? `Table ${order.table_number}`
                : (order.fulfillment_type || order.order_type).replace("-", " ");
              const isOnlineOrder = order.source === "customer_website";

              return (
                <div
                  key={order.id}
                  className="grid grid-cols-[1fr_140px_150px_230px] gap-4 border-b border-gray-100 px-4 py-4 last:border-b-0"
                >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-gray-950">#{order.id}</span>
                    <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-bold text-gray-600">
                      {order.table_number ? (
                        <Utensils className="h-3.5 w-3.5" />
                      ) : (
                        <Truck className="h-3.5 w-3.5" />
                      )}
                      {primaryLocation}
                    </span>
                    {isOnlineOrder && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-red-100 bg-red-50 px-2 py-1 text-xs font-bold text-red-700">
                        <Globe2 className="h-3.5 w-3.5" />
                        Online
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500">
                      <TimerReset className="h-3.5 w-3.5" />
                      {ageLabel(order.created_at)}
                    </span>
                    {order.eta_window && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500">
                        <Clock3 className="h-3.5 w-3.5" />
                        ETA {order.eta_window}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 truncate text-sm text-gray-600">
                    {order.items
                      .map((item) => itemSummary(item))
                      .join(" | ")}
                  </p>
                  {order.delivery_address && (
                    <p className="mt-2 flex items-center gap-1 truncate text-xs font-semibold text-gray-500">
                      <MapPin className="h-3.5 w-3.5 text-red-600" />
                      {order.delivery_address}
                    </p>
                  )}
                  {(order.requires_address_review || order.address_validation?.requires_review) && (
                    <p className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Address review required
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                    <span>{order.customer_name || "Walk-in"}</span>
                    {order.customer_phone && <span>{order.customer_phone}</span>}
                    <span className="font-bold text-gray-950">{money(order.total_amount)}</span>
                  </div>
                </div>

                <div className="flex items-start">
                  <span className={`rounded-md border px-2 py-1 text-xs font-bold ${paymentClass(order.payment_status)}`}>
                    {order.payment_status.replace("_", " ")}
                  </span>
                </div>

                <div className="flex items-start">
                  <span className={`rounded-md border px-2 py-1 text-xs font-bold ${statusClass(order.status)}`}>
                    {order.status}
                  </span>
                </div>

                <div className="flex items-start justify-end gap-2">
                  <Link
                    title="Print bill"
                    aria-label={`Print bill for order ${order.id}`}
                    href={`/receipt/${order.id}`}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  >
                    <ReceiptText className="h-4 w-4" />
                  </Link>
                  <button
                    title="Mark preparing"
                    aria-label={`Mark order ${order.id} preparing`}
                    onClick={() => updateStatus(order, "preparing")}
                    disabled={order.status === "closed" || order.status === "preparing"}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyAction === `${order.id}-preparing` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Flame className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    title="Mark ready"
                    aria-label={`Mark order ${order.id} ready`}
                    onClick={() => updateStatus(order, "ready")}
                    disabled={order.status === "closed" || order.status === "ready"}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyAction === `${order.id}-ready` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    title="Generate invoice"
                    aria-label={`Generate invoice for order ${order.id}`}
                    onClick={() => generateInvoice(order)}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  >
                    {busyAction === `${order.id}-invoice` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    title={isPrepaidDue ? "Payment pending" : "Close order"}
                    aria-label={`Close order ${order.id}`}
                    onClick={() => closeOrder(order)}
                    disabled={!canClose}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-900 bg-gray-950 text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    {busyAction === `${order.id}-close` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                  </button>
                </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
