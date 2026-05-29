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
  XCircle,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const ORDERS_API = getApiUrl("/api/v1/restaurant/orders");
const DELIVERY_API = getApiUrl("/api/v1/restaurant/delivery");
const STATION_COMMAND_API = getApiUrl("/api/v1/restaurant/orders/station-command");

type OrderItem = {
  name: string;
  quantity: number;
  price: number;
  kitchen_station?: string | null;
  kitchen_station_label?: string | null;
  station_status?: string | null;
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

type DeliveryMissionSummary = DeliveryQueueSummary & {
  overall_status: string;
  next_action: string;
  active_zone_count: number;
  inactive_zone_count: number;
  lowest_fee: number;
  highest_fee: number;
  average_fee: number;
  longest_eta_minutes: number;
  minimum_order_zone_count: number;
  coverage_keyword_count: number;
  open_delivery_value: number;
  dispatch_ready_count: number;
  ready_to_close_count: number;
};

type DeliveryMissionControlItem = {
  label: string;
  status: string;
  count: number;
  detail: string;
};

type DeliveryMissionZone = {
  id: number;
  name: string;
  delivery_fee: number;
  minimum_order_amount: number;
  eta_window?: string;
  eta_min_minutes?: number;
  eta_max_minutes?: number;
  keywords?: string[];
  is_active: boolean;
};

type DeliveryMissionOrder = {
  id: number;
  customer_name?: string | null;
  delivery_address?: string | null;
  delivery_zone?: string | null;
  delivery_fee?: string | number | null;
  eta_window?: string | null;
  total_amount: number;
  payment_due: boolean;
  assignment_status: string;
  assigned_to?: string | null;
  requires_address_review: boolean;
  next_action: string;
};

type DeliveryMissionControl = {
  generated_at?: string;
  summary: DeliveryMissionSummary;
  controls: DeliveryMissionControlItem[];
  zones: DeliveryMissionZone[];
  priority_orders: DeliveryMissionOrder[];
  next_actions: string[];
};

type OrderFlowRow = {
  id: number;
  stage: string;
  status: string;
  payment_due: boolean;
  ready_to_close: boolean;
  receipt_ready: boolean;
  invoice_generated: boolean;
  customized: boolean;
  customized_line_count: number;
  receipt_url: string;
  next_action: string;
};

type OrderFlowReadiness = {
  summary: {
    today_order_count: number;
    active_order_count: number;
    open_count: number;
    preparing_count: number;
    ready_count: number;
    ready_to_close_count: number;
    payment_due_count: number;
    receipt_ready_count: number;
    customized_line_count: number;
    closed_count: number;
    cancelled_count?: number;
  };
  orders: OrderFlowRow[];
  ready_to_close: OrderFlowRow[];
  payment_due: OrderFlowRow[];
  next_actions: string[];
};

type StationCommandLine = {
  line_id: string;
  order_id: number;
  station_key: string;
  station_label: string;
  routing_source: string;
  name: string;
  quantity: number;
  selected_options?: {
    group_name?: string;
    option_name?: string;
    price_delta?: number;
  }[];
  option_count: number;
  status: string;
  order_type: string;
  fulfillment_type?: string | null;
  table_number?: string | null;
  customer_name?: string | null;
  payment_status: string;
  created_at?: string | null;
  age_minutes: number;
  sla_minutes: number;
  priority: string;
  next_action: string;
  ticket_url: string;
};

type StationCommandOrder = {
  order_id: number;
  status: string;
  order_type: string;
  fulfillment_type?: string | null;
  table_number?: string | null;
  customer_name?: string | null;
  payment_status: string;
  created_at?: string | null;
  age_minutes: number;
  priority: string;
  line_count: number;
  item_quantity: number;
  lines: StationCommandLine[];
  ticket_url: string;
};

type StationCommandStation = {
  key: string;
  label: string;
  sla_minutes: number;
  active_order_count: number;
  line_count: number;
  item_quantity: number;
  over_sla_count: number;
  ready_line_count: number;
  preparing_line_count: number;
  next_action: string;
  orders: StationCommandOrder[];
};

type StationCommand = {
  generated_at?: string;
  summary: {
    active_order_count: number;
    station_count: number;
    active_station_count: number;
    routed_line_count: number;
    unrouted_line_count: number;
    over_sla_count: number;
    ready_line_count: number;
    preparing_line_count: number;
    oldest_age_minutes: number;
    overall_status: string;
    next_action: string;
  };
  controls: {
    label: string;
    status: string;
    count: number;
    detail: string;
  }[];
  stations: StationCommandStation[];
  next_actions: string[];
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
  { id: "cancelled", label: "Cancelled" },
];

const riderPresets = ["Ravi Rider", "Anita Rider", "Mohan Rider", "Backup Rider"];

const defaultKitchenStations = [
  { key: "oven", label: "Oven Station" },
  { key: "fryer", label: "Fryer / Sides" },
  { key: "cold", label: "Cold / Drinks" },
  { key: "prep", label: "Prep Station" },
];

const kitchenStatusPriority: Record<string, number> = {
  open: 0,
  preparing: 1,
  ready: 2,
};

function money(value: number | string | null | undefined) {
  const numeric = Number(value || 0);
  return `Rs ${Math.round(Number.isFinite(numeric) ? numeric : 0).toLocaleString()}`;
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
  if (status === "cancelled") return "bg-rose-50 text-rose-700 border-rose-200";
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

function deliveryStatusClass(status?: string | null) {
  if (status === "delivered") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "out_for_delivery") return "border-orange-200 bg-orange-50 text-orange-700";
  if (status === "assigned") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-red-200 bg-red-50 text-red-700";
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

function kitchenStationKey(item: OrderItem) {
  const rawKey = (item.kitchen_station || "prep").toString().trim().toLowerCase();
  return rawKey.replace(/[^a-z0-9_-]/g, "-") || "prep";
}

function kitchenStationLabel(item: OrderItem) {
  const key = kitchenStationKey(item);
  const configuredStation = defaultKitchenStations.find((station) => station.key === key);
  return item.kitchen_station_label || configuredStation?.label || key.replaceAll("-", " ");
}

function itemStationStatus(item: OrderItem, order: Order) {
  const rawStatus = (item.station_status || "").toString().trim().toLowerCase();
  if (["open", "preparing", "ready"].includes(rawStatus)) return rawStatus;
  if (["open", "preparing", "ready"].includes(order.status)) return order.status;
  return "open";
}

function aggregateStationStatus(statuses: string[]) {
  if (statuses.length > 0 && statuses.every((status) => status === "ready")) return "ready";
  if (statuses.some((status) => status === "preparing" || status === "ready")) return "preparing";
  return "open";
}

function isDeliveryOrder(order: Order) {
  return (order.fulfillment_type || order.order_type) === "delivery";
}

function isPrepaidPaymentDue(order: Order) {
  return (
    (order.payment_method || "").toLowerCase() === "prepaid" &&
    order.payment_status !== "paid"
  );
}

function needsAddressReview(order: Order) {
  return Boolean(order.requires_address_review || order.address_validation?.requires_review);
}

function deliveryPriorityScore(order: Order) {
  const status = order.delivery_assignment?.status || "unassigned";
  if (needsAddressReview(order)) return 0;
  if (isPrepaidPaymentDue(order)) return 1;
  if (!order.delivery_assignment?.assigned_to) return 2;
  if (status === "assigned") return 3;
  if (status === "out_for_delivery") return 4;
  if (status === "failed") return 5;
  if (status === "delivered") return 6;
  return 7;
}

function deliveryPriorityLabel(order: Order) {
  const status = order.delivery_assignment?.status || "unassigned";
  if (needsAddressReview(order)) return "Address review";
  if (isPrepaidPaymentDue(order)) return "Payment due";
  if (!order.delivery_assignment?.assigned_to) return "Assign rider";
  if (status === "assigned") return "Ready to dispatch";
  if (status === "out_for_delivery") return "Out for delivery";
  if (status === "failed") return "Failed delivery";
  if (status === "delivered") return "Delivered";
  return "Monitor";
}

function deliveryControlClass(status: string) {
  if (status === "blocked") return "border-rose-200 bg-rose-50 text-rose-800";
  if (status === "watch") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function stationPriorityClass(priority: string) {
  if (priority === "rush") return "border-rose-200 bg-rose-50 text-rose-800";
  if (priority === "watch") return "border-amber-200 bg-amber-50 text-amber-800";
  if (priority === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (priority === "cooking") return "border-sky-200 bg-sky-50 text-sky-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function stationControlClass(status: string) {
  if (status === "rush") return "border-rose-200 bg-rose-50 text-rose-800";
  if (status === "watch") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function stationLineSummary(line: StationCommandLine) {
  const optionNames = (line.selected_options || [])
    .map((option) => {
      const group = option.group_name ? `${option.group_name}: ` : "";
      const delta = Number(option.price_delta || 0);
      const suffix = delta > 0 ? ` +Rs ${delta}` : "";
      return `${group}${option.option_name || "Option"}${suffix}`;
    })
    .filter(Boolean);
  return optionNames.length
    ? `${line.quantity}x ${line.name} (${optionNames.join(", ")})`
    : `${line.quantity}x ${line.name}`;
}

function readableStatus(status?: string | null) {
  return (status || "stable").replaceAll("_", " ");
}

function missionOrderLabel(order: DeliveryMissionOrder) {
  if (order.requires_address_review) return "Address review";
  if (order.payment_due) return "Payment due";
  if (!order.assigned_to) return "Assign rider";
  if (order.assignment_status === "assigned") return "Ready to dispatch";
  if (order.assignment_status === "out_for_delivery") return "Out for delivery";
  if (order.assignment_status === "failed") return "Failed delivery";
  if (order.assignment_status === "delivered") return "Delivered";
  return "Monitor";
}

function closeBlockers(order: Order) {
  const blockers: string[] = [];
  if (order.status === "cancelled") blockers.push("cancelled");
  if (isPrepaidPaymentDue(order)) blockers.push("payment due");
  if (isDeliveryOrder(order)) {
    if (needsAddressReview(order)) {
      blockers.push("address review");
    }
    if (order.delivery_assignment?.status !== "delivered") {
      blockers.push(order.delivery_assignment?.assigned_to ? "delivery pending" : "rider missing");
    }
  }
  return blockers;
}

function flowStepClass(isComplete: boolean, isCurrent: boolean) {
  if (isComplete) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (isCurrent) return "border-orange-200 bg-orange-50 text-orange-700";
  return "border-slate-200 bg-slate-50 text-slate-400";
}

export default function OperationsPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState("active");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [deliveryQueueSummary, setDeliveryQueueSummary] = useState<DeliveryQueueSummary | null>(null);
  const [deliveryMission, setDeliveryMission] = useState<DeliveryMissionControl | null>(null);
  const [orderFlow, setOrderFlow] = useState<OrderFlowReadiness | null>(null);
  const [stationCommand, setStationCommand] = useState<StationCommand | null>(null);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<number, string>>({});
  const [assignmentNoteDrafts, setAssignmentNoteDrafts] = useState<Record<number, string>>({});

  const activeOrders = orders.filter(
    (order) => !["closed", "cancelled"].includes(order.status)
  );
  const paymentDueOrders = activeOrders.filter(
    (order) =>
      (order.payment_method || "").toLowerCase() === "prepaid" &&
      order.payment_status !== "paid"
  );
  const deliveryOrders = activeOrders.filter(
    (order) => isDeliveryOrder(order)
  );
  const addressReviewOrders = deliveryOrders.filter(
    (order) => needsAddressReview(order)
  );
  const sortedDeliveryOrders = useMemo(
    () =>
      [...deliveryOrders].sort((left, right) => {
        const priority = deliveryPriorityScore(left) - deliveryPriorityScore(right);
        if (priority !== 0) return priority;
        const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
        const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
        if (leftTime !== rightTime) return leftTime - rightTime;
        return left.id - right.id;
      }),
    [deliveryOrders]
  );
  const orderFlowById = useMemo(
    () => new Map((orderFlow?.orders || []).map((row) => [row.id, row])),
    [orderFlow]
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
  const deliveryActionCounts = useMemo(
    () => ({
      needsRider: deliveryOrders.filter((order) => !order.delivery_assignment?.assigned_to).length,
      readyToDispatch: deliveryOrders.filter(
        (order) =>
          order.delivery_assignment?.assigned_to &&
          (order.delivery_assignment?.status || "unassigned") === "assigned"
      ).length,
      outForDelivery: deliveryOrders.filter(
        (order) => order.delivery_assignment?.status === "out_for_delivery"
      ).length,
      blocked: deliveryOrders.filter(
        (order) =>
          isPrepaidPaymentDue(order) ||
          needsAddressReview(order)
      ).length,
    }),
    [deliveryOrders]
  );
  const nextDeliveryOrder = sortedDeliveryOrders[0] || null;
  const deliveryMissionActions = useMemo(
    () => [
      {
        label: "Address Review",
        count: deliveryStats.addressReview,
        detail: "Call before dispatch",
        filter: "address_review",
        testId: "delivery-priority-address-review",
        tone: "border-amber-200 bg-amber-50 text-amber-800",
      },
      {
        label: "Need Rider",
        count: deliveryActionCounts.needsRider,
        detail: "Assign from roster",
        filter: "delivery",
        testId: "delivery-priority-need-rider",
        tone: "border-red-200 bg-red-50 text-red-700",
      },
      {
        label: "Ready Dispatch",
        count: deliveryActionCounts.readyToDispatch,
        detail: "Rider can leave",
        filter: "delivery",
        testId: "delivery-priority-ready-dispatch",
        tone: "border-sky-200 bg-sky-50 text-sky-700",
      },
      {
        label: "Out Now",
        count: deliveryActionCounts.outForDelivery,
        detail: "Track handoff",
        filter: "delivery",
        testId: "delivery-priority-out-now",
        tone: "border-orange-200 bg-orange-50 text-orange-700",
      },
    ],
    [deliveryActionCounts, deliveryStats.addressReview]
  );
  const deliveryMissionSummary = deliveryMission?.summary || null;
  const missionControls = deliveryMission?.controls || [];
  const missionPriorityOrders = deliveryMission?.priority_orders || [];
  const activeMissionZones = (deliveryMission?.zones || []).filter((zone) => zone.is_active);

  const visibleOrders = useMemo(() => {
    if (filter === "active") return activeOrders;
    if (filter === "delivery") return sortedDeliveryOrders;
    if (filter === "address_review") return sortedDeliveryOrders.filter((order) => needsAddressReview(order));
    if (filter === "payment_due") return paymentDueOrders;
    return orders.filter((order) => order.status === filter);
  }, [activeOrders, filter, orders, paymentDueOrders, sortedDeliveryOrders]);
  const kitchenLanes = useMemo(
    () => [
      {
        key: "open",
        label: "New",
        tone: "border-orange-200 bg-orange-50",
        orders: activeOrders.filter((order) => order.status === "open"),
      },
      {
        key: "preparing",
        label: "Preparing",
        tone: "border-sky-200 bg-sky-50",
        orders: activeOrders.filter((order) => order.status === "preparing"),
      },
      {
        key: "ready",
        label: "Ready",
        tone: "border-emerald-200 bg-emerald-50",
        orders: activeOrders.filter((order) => order.status === "ready"),
      },
      {
        key: "closed",
        label: "Closed",
        tone: "border-slate-200 bg-slate-50",
        orders: orders.filter((order) => order.status === "closed").slice(0, 6),
      },
      {
        key: "cancelled",
        label: "Cancelled",
        tone: "border-rose-200 bg-rose-50",
        orders: orders.filter((order) => order.status === "cancelled").slice(0, 6),
      },
    ],
    [activeOrders, orders]
  );
  const kitchenFocus = useMemo(() => {
    const readyOrders = activeOrders.filter((order) => order.status === "ready");
    return {
      active: activeOrders.length,
      readyToBill: readyOrders.filter((order) => closeBlockers(order).length === 0).length,
      blocked: activeOrders.filter((order) => closeBlockers(order).length > 0).length,
      deliveryHandoff: deliveryOrders.filter(
        (order) => order.status === "ready" && order.delivery_assignment?.status !== "delivered"
      ).length,
    };
  }, [activeOrders, deliveryOrders]);
  const kitchenStationBoard = useMemo(() => {
    const stationMap = new Map<
      string,
      {
        key: string;
        label: string;
        orders: {
          order: Order;
          items: OrderItem[];
          lineCount: number;
          quantity: number;
          stationStatus: string;
        }[];
      }
    >();

    defaultKitchenStations.forEach((station) => {
      stationMap.set(station.key, { ...station, orders: [] });
    });

    activeOrders.forEach((order) => {
      const groupedItems = new Map<
        string,
        { label: string; items: OrderItem[]; quantity: number; statuses: string[] }
      >();

      (order.items || []).forEach((item) => {
        const key = kitchenStationKey(item);
        const group =
          groupedItems.get(key) ||
          {
            label: kitchenStationLabel(item),
            items: [],
            quantity: 0,
            statuses: [],
          };
        group.items.push(item);
        group.quantity += Number(item.quantity || 0);
        group.statuses.push(itemStationStatus(item, order));
        groupedItems.set(key, group);
      });

      groupedItems.forEach((group, key) => {
        if (!stationMap.has(key)) {
          stationMap.set(key, { key, label: group.label, orders: [] });
        }
        stationMap.get(key)?.orders.push({
          order,
          items: group.items,
          lineCount: group.items.length,
          quantity: group.quantity,
          stationStatus: aggregateStationStatus(group.statuses),
        });
      });
    });

    return Array.from(stationMap.values()).map((station) => ({
      ...station,
      orders: [...station.orders].sort((left, right) => {
        const statusDelta =
          (kitchenStatusPriority[left.stationStatus] ?? 9) -
          (kitchenStatusPriority[right.stationStatus] ?? 9);
        if (statusDelta !== 0) return statusDelta;
        const leftTime = left.order.created_at ? new Date(left.order.created_at).getTime() : 0;
        const rightTime = right.order.created_at ? new Date(right.order.created_at).getTime() : 0;
        return rightTime - leftTime;
      }),
    }));
  }, [activeOrders]);
  const kitchenStationSummary = useMemo(() => {
    const orderIds = new Set<number>();
    const summary = {
      activeStationCount: 0,
      routedOrderCount: 0,
      lineCount: 0,
      itemQuantity: 0,
      urgentOrderCount: 0,
    };

    kitchenStationBoard.forEach((station) => {
      if (station.orders.length > 0) summary.activeStationCount += 1;
      station.orders.forEach((entry) => {
        orderIds.add(entry.order.id);
        summary.lineCount += entry.lineCount;
        summary.itemQuantity += entry.quantity;
        if (entry.order.status === "open") summary.urgentOrderCount += 1;
      });
    });

    summary.routedOrderCount = orderIds.size;
    return summary;
  }, [kitchenStationBoard]);
  const stationSummaryMetrics = stationCommand
    ? [
        ["Active Stations", stationCommand.summary.active_station_count],
        ["Routed Lines", stationCommand.summary.routed_line_count],
        ["Over SLA", stationCommand.summary.over_sla_count],
        ["Oldest Ticket", `${stationCommand.summary.oldest_age_minutes} min`],
      ]
    : [
        ["Active Stations", kitchenStationSummary.activeStationCount],
        ["Routed Orders", kitchenStationSummary.routedOrderCount],
        ["Station Lines", kitchenStationSummary.lineCount],
        ["Items Qty", kitchenStationSummary.itemQuantity],
      ];

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async (options?: { preserveMessage?: boolean; silent?: boolean }) => {
    if (!options?.silent) setIsLoading(true);
    try {
      const readJson = async (request: Response) => {
        try {
          return await request.json();
        } catch {
          return {};
        }
      };
      const [response, queueResponse, flowResponse, missionResponse, stationResponse] = await Promise.all([
        fetch(`${ORDERS_API}/today`, {
          cache: "no-store",
          credentials: "include",
        }),
        fetch(`${DELIVERY_API}/queue`, {
          cache: "no-store",
          credentials: "include",
        }),
        fetch(`${ORDERS_API}/flow-readiness`, {
          cache: "no-store",
          credentials: "include",
        }),
        fetch(`${DELIVERY_API}/mission-control`, {
          cache: "no-store",
          credentials: "include",
        }),
        fetch(STATION_COMMAND_API, {
          cache: "no-store",
          credentials: "include",
        }),
      ]);
      const data = await readJson(response);
      const queueData = await readJson(queueResponse);
      const flowData = await readJson(flowResponse);
      const missionData = await readJson(missionResponse);
      const stationData = await readJson(stationResponse);
      if (!response.ok) throw new Error(data.detail || "Could not load orders.");

      const optionalWarnings = [
        !queueResponse.ok
          ? queueData.detail || "Delivery queue is temporarily unavailable."
          : "",
        !flowResponse.ok
          ? flowData.detail || "Order flow readiness is temporarily unavailable."
          : "",
        !missionResponse.ok
          ? missionData.detail || "Delivery mission control is temporarily unavailable."
          : "",
        !stationResponse.ok
          ? stationData.detail || "Kitchen station command is temporarily unavailable."
          : "",
      ].filter(Boolean);

      const queueOrders = queueResponse.ok ? queueData.orders || [] : [];
      const queueById = new Map<number, any>(
        queueOrders.map((order: any) => [order.id, order])
      );
      setDeliveryQueueSummary(queueResponse.ok ? queueData.summary || null : null);
      setDeliveryMission(missionResponse.ok ? missionData || null : null);
      setOrderFlow(flowResponse.ok ? flowData || null : null);
      setStationCommand(stationResponse.ok ? stationData || null : null);
      setLastRefreshedAt(
        new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
      );
      const todaysOrders: Order[] = data.orders || [];
      const mergedOrders = todaysOrders.map((order: Order) => {
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
      });
      const mergedOrderIds = new Set(mergedOrders.map((order) => order.id));
      const queueOnlyOrders: Order[] = queueOrders
        .filter((queueOrder: any) => !mergedOrderIds.has(queueOrder.id))
        .map((queueOrder: any) => ({
          id: queueOrder.id,
          order_type: "delivery",
          source: "delivery_queue",
          fulfillment_type: "delivery",
          delivery_address: queueOrder.delivery_address ?? null,
          delivery_zone: queueOrder.delivery_zone ?? null,
          delivery_fee: Number(queueOrder.delivery_fee || 0),
          delivery_assignment: queueOrder.assignment ?? null,
          eta_window: queueOrder.eta_window ?? null,
          address_validation: queueOrder.address_validation ?? null,
          requires_address_review: Boolean(queueOrder.requires_address_review),
          delivery_next_action: queueOrder.next_action,
          payment_due: Boolean(queueOrder.payment_due),
          table_number: null,
          customer_name: queueOrder.customer_name ?? "Delivery customer",
          customer_phone: queueOrder.customer_phone ?? null,
          items: [],
          subtotal: 0,
          discount_amount: 0,
          tax_amount: 0,
          total_amount: Number(queueOrder.total_amount || 0),
          payment_status: queueOrder.payment_status ?? "pending",
          payment_method: null,
          status: queueOrder.order_status ?? "open",
          notes: queueOrder.notes ?? null,
          created_at: null,
          closed_at: null,
        }));
      setOrders(
        [...mergedOrders, ...queueOnlyOrders].sort((left, right) => right.id - left.id)
      );
      if (!options?.preserveMessage) {
        setMessage(
          optionalWarnings.length
            ? `Kitchen queue loaded. ${optionalWarnings.join(" ")}`
            : ""
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load orders.");
    } finally {
      if (!options?.silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(() => {
      if (!busyAction) {
        void fetchOrders({ preserveMessage: true, silent: true });
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, busyAction]);

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

  const updateStationStatus = async (
    orderId: number,
    stationKey: string,
    stationLabel: string,
    status: "open" | "preparing" | "ready"
  ) => {
    const actionKey = `${orderId}-${stationKey}-${status}`;
    setBusyAction(actionKey);
    try {
      const response = await fetch(
        `${ORDERS_API}/${orderId}/stations/${encodeURIComponent(stationKey)}/status`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not move station.");
      setMessage(
        `${stationLabel} for order #${orderId} moved to ${status}. Order is now ${readableStatus(
          data.order_status
        )}.`
      );
      await fetchOrders({ preserveMessage: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not move station.");
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
    const blockers = closeBlockers(order);
    if (blockers.length) {
      setMessage(`Order #${order.id} cannot close yet: ${blockers.join(", ")}.`);
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

  const cancelOrder = async (order: Order) => {
    if (["closed", "cancelled"].includes(order.status)) {
      setMessage(`Order #${order.id} is already ${order.status}.`);
      return;
    }
    const reason = window.prompt(
      `Reason for voiding order #${order.id}?`,
      "Customer cancelled"
    );
    if (reason === null) return;

    setBusyAction(`${order.id}-cancel`);
    try {
      const response = await fetch(`${ORDERS_API}/${order.id}/cancel`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || "Cancelled from operations" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not void order.");
      setMessage(
        data.refund_required
          ? `Order #${order.id} cancelled and marked refund due. No sales or inventory posted.`
          : `Order #${order.id} voided. No sales or inventory posted.`
      );
      await fetchOrders({ preserveMessage: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not void order.");
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
            <h2 className="text-xl font-black text-gray-950">Kitchen Board</h2>
            <p className="text-sm text-gray-500">
              Simple lane view for cooking, ready handoff, and closing orders.
            </p>
          </div>
          <div className="text-right text-xs font-bold uppercase tracking-wide text-gray-500">
            <p>{autoRefresh ? "Auto refresh on" : "Auto refresh off"}</p>
            <p className="mt-1 text-gray-400">
              {lastRefreshedAt ? `Updated ${lastRefreshedAt}` : "Loading live queue"}
            </p>
          </div>
        </div>

        <div
          data-testid="kitchen-command-strip"
          className="grid gap-2 rounded-lg border border-gray-200 bg-white p-2 shadow-sm md:grid-cols-3 xl:grid-cols-6"
        >
          <button
            onClick={() => setFilter("active")}
            className="flex h-12 items-center justify-between rounded-md bg-gray-950 px-3 text-sm font-black text-white"
          >
            <span>Active</span>
            <span>{kitchenFocus.active}</span>
          </button>
          <button
            onClick={() => setFilter("ready")}
            className="flex h-12 items-center justify-between rounded-md bg-emerald-50 px-3 text-sm font-black text-emerald-700 hover:bg-emerald-100"
          >
            <span>Ready To Bill</span>
            <span>{kitchenFocus.readyToBill}</span>
          </button>
          <button
            onClick={() => setFilter("payment_due")}
            className="flex h-12 items-center justify-between rounded-md bg-amber-50 px-3 text-sm font-black text-amber-700 hover:bg-amber-100"
          >
            <span>Blocked</span>
            <span>{kitchenFocus.blocked}</span>
          </button>
          <button
            onClick={() => setFilter("delivery")}
            className="flex h-12 items-center justify-between rounded-md bg-red-50 px-3 text-sm font-black text-red-700 hover:bg-red-100"
          >
            <span>Handoff</span>
            <span>{kitchenFocus.deliveryHandoff}</span>
          </button>
          <button
            onClick={() => fetchOrders()}
            disabled={isLoading}
            className="flex h-12 items-center justify-center gap-2 rounded-md border border-gray-200 px-3 text-sm font-black text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={() => setAutoRefresh((current) => !current)}
            className={`flex h-12 items-center justify-center gap-2 rounded-md px-3 text-sm font-black ${
              autoRefresh
                ? "bg-sky-50 text-sky-700 hover:bg-sky-100"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <TimerReset className="h-4 w-4" />
            Auto {autoRefresh ? "On" : "Off"}
          </button>
        </div>

        <div
          data-testid="kitchen-station-board"
          className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Utensils className="h-5 w-5 text-gray-800" />
                <h3 className="text-lg font-black text-gray-950">Station Kitchen Board</h3>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Every live order line is routed to the station that has to cook or pack it.
              </p>
            </div>
            <Link
              href="/orders"
              className="inline-flex h-10 items-center justify-center rounded-md border border-gray-200 px-3 text-sm font-black text-gray-700 hover:bg-gray-50"
            >
              Counter POS
            </Link>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {stationSummaryMetrics.map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg border border-slate-200 bg-slate-50 p-3"
              >
                <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                  {label}
                </p>
                <p className="mt-1 text-2xl font-black text-slate-950">{value}</p>
              </div>
            ))}
          </div>

          <div
            data-testid="kitchen-station-command"
            className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-wide text-gray-500">
                  Backend station command
                </p>
                <h4
                  data-testid="station-command-status"
                  className="mt-1 text-base font-black text-gray-950"
                >
                  {stationCommand
                    ? stationCommand.summary.next_action
                    : "Using browser station fallback until command API responds."}
                </h4>
              </div>
              <span className="rounded-md bg-white px-2 py-1 text-xs font-black text-gray-700 shadow-sm">
                {stationCommand ? readableStatus(stationCommand.summary.overall_status) : "fallback"}
              </span>
            </div>

            {stationCommand && (
              <>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {stationCommand.controls.map((control) => (
                    <div
                      key={control.label}
                      className={`rounded-md border px-3 py-2 ${stationControlClass(control.status)}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-black uppercase tracking-wide">
                          {control.label}
                        </p>
                        <span className="text-sm font-black">{control.count}</span>
                      </div>
                      <p className="mt-1 text-xs font-semibold leading-5 opacity-80">
                        {control.detail}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-3 grid gap-3 xl:grid-cols-4">
                  {stationCommand.stations.map((station) => (
                    <div
                      key={station.key}
                      data-testid={`station-command-station-${station.key}`}
                      className="rounded-lg border border-white bg-white p-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h5 className="text-sm font-black uppercase tracking-wide text-gray-950">
                            {station.label}
                          </h5>
                          <p className="mt-1 text-xs font-semibold text-gray-500">
                            SLA {station.sla_minutes} min | {station.line_count} line
                            {station.line_count === 1 ? "" : "s"}
                          </p>
                        </div>
                        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-700">
                          {station.active_order_count}
                        </span>
                      </div>
                      <p className="mt-2 text-xs font-bold leading-5 text-gray-600">
                        {station.next_action}
                      </p>

                      <div className="mt-3 space-y-2">
                        {station.orders.slice(0, 3).map((order) => (
                          <div
                            key={`${station.key}-${order.order_id}`}
                            data-testid={`station-command-order-${station.key}-${order.order_id}`}
                            className="rounded-md border border-slate-100 bg-slate-50 p-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-black text-gray-950">
                                  #{order.order_id}
                                </p>
                                <p className="text-[11px] font-bold uppercase text-gray-500">
                                  {order.table_number
                                    ? `Table ${order.table_number}`
                                    : order.fulfillment_type || order.order_type}
                                </p>
                              </div>
                              <span
                                className={`rounded-md border px-2 py-1 text-[11px] font-black ${stationPriorityClass(order.priority)}`}
                              >
                                {readableStatus(order.priority)}
                              </span>
                            </div>
                            <div className="mt-2 space-y-1">
                              {order.lines.slice(0, 3).map((line) => (
                                <p
                                  key={line.line_id}
                                  data-testid={`station-command-line-${line.line_id}`}
                                  className="text-xs font-semibold leading-5 text-gray-700"
                                >
                                  {stationLineSummary(line)}
                                </p>
                              ))}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <span className="rounded-md bg-white px-2 py-1 text-[11px] font-black text-slate-700">
                                {order.age_minutes} min
                              </span>
                              <span className={`rounded-md border px-2 py-1 text-[11px] font-black ${paymentClass(order.payment_status)}`}>
                                {readableStatus(order.payment_status)}
                              </span>
                              <Link
                                href={order.ticket_url}
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-black text-slate-700 hover:bg-slate-50"
                              >
                                KOT
                              </Link>
                            </div>
                          </div>
                        ))}
                        {!station.orders.length && (
                          <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs font-bold text-slate-500">
                            Clear.
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-4">
            {kitchenStationBoard.map((station) => {
              const stationLineCount = station.orders.reduce(
                (sum, entry) => sum + entry.lineCount,
                0
              );
              const stationQuantity = station.orders.reduce(
                (sum, entry) => sum + entry.quantity,
                0
              );
              return (
                <div
                  key={station.key}
                  data-testid={`kitchen-station-${station.key}`}
                  className="min-h-64 rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-black uppercase tracking-wide text-slate-950">
                        {station.label}
                      </h4>
                      <p className="mt-1 text-xs font-semibold text-slate-500">
                        {stationLineCount} line{stationLineCount === 1 ? "" : "s"} |{" "}
                        {stationQuantity} item{stationQuantity === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className="rounded-md bg-white px-2 py-1 text-xs font-black text-slate-800 shadow-sm">
                      {station.orders.length}
                    </span>
                  </div>

                  <div className="mt-3 space-y-3">
                    {station.orders.slice(0, 5).map((entry) => {
                      const order = entry.order;
                      return (
                        <article
                          key={`${station.key}-${order.id}`}
                          data-testid={`kitchen-station-order-${station.key}-${order.id}`}
                          className="rounded-lg border border-white bg-white p-3 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-base font-black text-gray-950">
                                #{order.id}
                              </p>
                              <p className="mt-0.5 text-xs font-bold uppercase text-gray-500">
                                {order.table_number
                                  ? `Table ${order.table_number}`
                                  : order.fulfillment_type || order.order_type}
                              </p>
                            </div>
                            <span className={`rounded-md border px-2 py-1 text-xs font-black ${statusClass(entry.stationStatus)}`}>
                              {entry.stationStatus}
                            </span>
                          </div>

                          <div
                            data-testid={`kitchen-station-lines-${station.key}-${order.id}`}
                            className="mt-3 space-y-1"
                          >
                            {entry.items.map((item, index) => (
                              <p
                                key={`${station.key}-${order.id}-${item.name}-${index}`}
                                className="text-sm font-semibold leading-5 text-gray-700"
                              >
                                {itemSummary(item)}
                              </p>
                            ))}
                          </div>

                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-700">
                              {ageLabel(order.created_at)}
                            </span>
                            <span className={`rounded-md border px-2 py-1 text-xs font-black ${paymentClass(order.payment_status)}`}>
                              {order.payment_status.replaceAll("_", " ")}
                            </span>
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <Link
                              data-testid={`kitchen-station-ticket-${station.key}-${order.id}`}
                              href={`/kitchen-ticket/${order.id}?station=${station.key}`}
                              className="flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 hover:bg-slate-50"
                            >
                              KOT
                            </Link>
                            {entry.stationStatus === "open" && (
                              <button
                                data-testid={`kitchen-station-start-${station.key}-${order.id}`}
                                onClick={() => updateStationStatus(order.id, station.key, station.label, "preparing")}
                                disabled={busyAction === `${order.id}-${station.key}-preparing`}
                                className="h-10 rounded-md bg-sky-600 px-3 text-sm font-black text-white hover:bg-sky-700 disabled:opacity-50"
                              >
                                Start
                              </button>
                            )}
                            {entry.stationStatus === "preparing" && (
                              <button
                                data-testid={`kitchen-station-ready-${station.key}-${order.id}`}
                                onClick={() => updateStationStatus(order.id, station.key, station.label, "ready")}
                                disabled={busyAction === `${order.id}-${station.key}-ready`}
                                className="h-10 rounded-md bg-emerald-600 px-3 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                Ready
                              </button>
                            )}
                            {entry.stationStatus === "ready" && order.status !== "ready" && (
                              <span className="flex h-10 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-black text-emerald-700">
                                Station Ready
                              </span>
                            )}
                            {entry.stationStatus === "ready" && order.status === "ready" && (
                              <Link
                                href={`/receipt/${order.id}`}
                                className="flex h-10 items-center justify-center rounded-md bg-emerald-600 px-3 text-sm font-black text-white hover:bg-emerald-700"
                              >
                                Bill
                              </Link>
                            )}
                          </div>
                        </article>
                      );
                    })}
                    {station.orders.length > 5 && (
                      <p className="rounded-md bg-white px-3 py-2 text-xs font-black text-slate-600">
                        +{station.orders.length - 5} more station order
                        {station.orders.length - 5 === 1 ? "" : "s"}
                      </p>
                    )}
                    {!station.orders.length && (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-white/70 p-5 text-center text-sm font-semibold text-slate-500">
                        Clear.
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-5">
          {kitchenLanes.map((lane) => (
            <div
              key={lane.key}
              data-testid={`kitchen-lane-${lane.key}`}
              className={`min-h-64 rounded-lg border p-3 shadow-sm ${lane.tone}`}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-black uppercase tracking-wide text-gray-900">
                  {lane.label}
                </h3>
                <span className="rounded-md bg-white px-2 py-1 text-xs font-black text-gray-800 shadow-sm">
                  {lane.orders.length}
                </span>
              </div>
              <div className="space-y-3">
                {lane.orders.map((order) => {
                  const blockers = closeBlockers(order);
                  const deliveryOrder = isDeliveryOrder(order);
                  const deliveryStatus =
                    order.delivery_assignment?.status?.replaceAll("_", " ") || "unassigned";
                  const hiddenItemCount = Math.max(order.items.length - 4, 0);
                  return (
                    <article
                      key={`${lane.key}-${order.id}`}
                      className="rounded-lg border border-white/70 bg-white p-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-base font-black text-gray-950">#{order.id}</p>
                          <p className="mt-0.5 text-xs font-bold uppercase text-gray-500">
                            {order.table_number
                              ? `Table ${order.table_number}`
                              : order.fulfillment_type || order.order_type}
                          </p>
                        </div>
                        <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-black text-gray-700">
                          {ageLabel(order.created_at)}
                        </span>
                      </div>
                      <div className="mt-3 space-y-1">
                        {order.items.slice(0, 4).map((item, index) => (
                          <p
                            key={`${order.id}-${item.name}-${index}`}
                            className="text-sm font-semibold leading-5 text-gray-700"
                          >
                            {itemSummary(item)}
                          </p>
                        ))}
                        {hiddenItemCount > 0 && (
                          <p className="text-xs font-black text-gray-500">
                            +{hiddenItemCount} more item{hiddenItemCount === 1 ? "" : "s"}
                          </p>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-black text-gray-700">
                          {money(order.total_amount)}
                        </span>
                        <span className={`rounded-md border px-2 py-1 text-xs font-black ${paymentClass(order.payment_status)}`}>
                          {order.payment_status.replaceAll("_", " ")}
                        </span>
                        {deliveryOrder && (
                          <span className="rounded-md border border-red-100 bg-red-50 px-2 py-1 text-xs font-black text-red-700">
                            {deliveryStatus}
                          </span>
                        )}
                        {blockers.map((blocker) => (
                          <span
                            key={`${order.id}-${blocker}`}
                            className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-black text-amber-800"
                          >
                            {blocker}
                          </span>
                        ))}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {order.status === "open" && (
                          <button
                            onClick={() => updateStatus(order, "preparing")}
                            disabled={busyAction === `${order.id}-preparing`}
                            className="col-span-2 h-12 rounded-md bg-sky-600 px-3 text-sm font-black text-white hover:bg-sky-700 disabled:opacity-50"
                          >
                            Start Prep
                          </button>
                        )}
                        {order.status === "preparing" && (
                          <button
                            onClick={() => updateStatus(order, "ready")}
                            disabled={busyAction === `${order.id}-ready`}
                            className="col-span-2 h-12 rounded-md bg-emerald-600 px-3 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            Mark Ready
                          </button>
                        )}
                        {order.status === "ready" && (
                          <>
                            {deliveryOrder && deliveryStatus !== "delivered" && (
                              <button
                                onClick={() => setFilter("delivery")}
                                className="col-span-2 h-11 rounded-md bg-red-600 px-3 text-sm font-black text-white hover:bg-red-700"
                              >
                                Delivery Handoff
                              </button>
                            )}
                            <Link
                              href={`/receipt/${order.id}`}
                              className="flex h-11 items-center justify-center rounded-md border border-gray-200 bg-white px-3 text-center text-sm font-black text-gray-700 hover:bg-gray-50"
                            >
                              Bill
                            </Link>
                            <button
                              onClick={() => closeOrder(order)}
                              disabled={blockers.length > 0 || busyAction === `${order.id}-close`}
                              className="h-11 rounded-md bg-gray-950 px-3 text-sm font-black text-white hover:bg-gray-800 disabled:bg-gray-300"
                            >
                              Close
                            </button>
                            {blockers.length > 0 && (
                              <p className="col-span-2 text-xs font-bold leading-5 text-amber-800">
                                Close blocked until {blockers.join(", ")} is complete.
                              </p>
                            )}
                          </>
                        )}
                        {order.status === "closed" && (
                          <Link
                            href={`/receipt/${order.id}`}
                            className="col-span-2 flex h-11 items-center justify-center rounded-md border border-gray-200 bg-white px-3 text-center text-sm font-black text-gray-700 hover:bg-gray-50"
                          >
                            Receipt
                          </Link>
                        )}
                        {order.status === "cancelled" && (
                          <span className="col-span-2 flex h-11 items-center justify-center rounded-md border border-rose-200 bg-rose-50 px-3 text-center text-sm font-black text-rose-700">
                            Voided
                          </span>
                        )}
                        {!["closed", "cancelled"].includes(order.status) && (
                          <button
                            data-testid={`operations-void-card-${order.id}`}
                            onClick={() => cancelOrder(order)}
                            disabled={busyAction === `${order.id}-cancel`}
                            className="col-span-2 flex h-10 items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 text-sm font-black text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                          >
                            {busyAction === `${order.id}-cancel` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <XCircle className="h-4 w-4" />
                            )}
                            Void
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
                {!lane.orders.length && (
                  <div className="rounded-lg border border-dashed border-white/80 bg-white/60 p-5 text-center text-sm font-semibold text-gray-500">
                    No orders.
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section data-testid="operations-order-flow-watch" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-gray-950">Order Flow Watch</h2>
            <p className="text-sm text-gray-500">
              Close-ready orders, payment blockers, receipts and handoff actions.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilter("ready")}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-black text-emerald-700 hover:bg-emerald-100"
            >
              <CheckCircle2 className="h-4 w-4" />
              Ready To Close
            </button>
            <button
              onClick={() => setFilter("payment_due")}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 text-sm font-black text-amber-700 hover:bg-amber-100"
            >
              <CreditCard className="h-4 w-4" />
              Payment Blocks
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {[
            ["Active Orders", orderFlow?.summary.active_order_count ?? activeOrders.length, "text-gray-950"],
            ["Ready To Close", orderFlow?.summary.ready_to_close_count ?? stats.ready, "text-emerald-700"],
            ["Payment Blocks", orderFlow?.summary.payment_due_count ?? paymentDueOrders.length, "text-amber-700"],
            ["Receipts Ready", orderFlow?.summary.receipt_ready_count ?? activeOrders.length, "text-sky-700"],
            ["Custom Lines", orderFlow?.summary.customized_line_count ?? 0, "text-violet-700"],
            ["Closed Today", orderFlow?.summary.closed_count ?? 0, "text-slate-700"],
          ].map(([label, value, tone]) => (
            <div key={label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-500">{label}</p>
              <p className={`mt-2 text-2xl font-black ${tone}`}>{value}</p>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wide text-gray-500">
            Flow Next Actions
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {(orderFlow?.next_actions || ["Loading order-flow actions."]).map((action) => (
              <p key={action} className="rounded-md bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                {action}
              </p>
            ))}
          </div>
        </div>
      </section>

      <section
        data-testid="delivery-operations-mission-control"
        className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-black text-gray-950">
                Delivery Operations Mission Control
              </h2>
              <span
                data-testid="delivery-mission-status"
                className="rounded-md bg-white px-2 py-1 text-xs font-black uppercase text-slate-700"
              >
                {readableStatus(deliveryMissionSummary?.overall_status)}
              </span>
            </div>
            <p
              data-testid="delivery-mission-next-action"
              className="mt-1 text-sm font-semibold text-gray-600"
            >
              {deliveryMissionSummary?.next_action ||
                "Loading delivery charges, zones, address review, and rider assignment."}
            </p>
          </div>
          <button
            onClick={() => setFilter("delivery")}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-black text-slate-800 hover:bg-slate-100"
          >
            <Truck className="h-4 w-4" />
            Open Queue
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {[
            {
              label: "Zone Rules",
              value: deliveryMissionSummary?.active_zone_count ?? 0,
              detail: `${deliveryMissionSummary?.minimum_order_zone_count ?? 0} min rules`,
              tone: "text-slate-950",
            },
            {
              label: "Open Deliveries",
              value: deliveryMissionSummary?.open_delivery_count ?? deliveryStats.total,
              detail: money(deliveryMissionSummary?.open_delivery_value ?? 0),
              tone: "text-gray-950",
            },
            {
              label: "Needs Rider",
              value: deliveryMissionSummary?.unassigned_count ?? deliveryStats.unassigned,
              detail: "assignment gate",
              tone: "text-red-700",
            },
            {
              label: "Address Review",
              value: deliveryMissionSummary?.address_review_count ?? deliveryStats.addressReview,
              detail: "confirm first",
              tone: "text-amber-700",
            },
            {
              label: "Dispatch Ready",
              value: deliveryMissionSummary?.dispatch_ready_count ?? deliveryActionCounts.readyToDispatch,
              detail: "rider can leave",
              tone: "text-sky-700",
            },
            {
              label: "Payment Blocks",
              value: deliveryMissionSummary?.payment_due_count ?? deliveryStats.paymentDue,
              detail: "close blocker",
              tone: "text-violet-700",
            },
          ].map((metric) => (
            <div key={metric.label} className="rounded-lg border border-white bg-white p-3 shadow-sm">
              <p className="text-[11px] font-black uppercase tracking-wide text-gray-500">
                {metric.label}
              </p>
              <p className={`mt-2 text-2xl font-black ${metric.tone}`}>{metric.value}</p>
              <p className="mt-1 text-xs font-semibold text-gray-500">{metric.detail}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.2fr_1fr]">
          <div className="grid gap-2 md:grid-cols-5">
            {missionControls.length ? (
              missionControls.map((control) => (
                <div
                  key={control.label}
                  data-testid={`delivery-control-${control.label.toLowerCase().replaceAll(" ", "-")}`}
                  className={`rounded-lg border p-3 shadow-sm ${deliveryControlClass(control.status)}`}
                >
                  <p className="text-[11px] font-black uppercase tracking-wide">
                    {control.label}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xl font-black">{control.count}</span>
                    <span className="rounded-md bg-white/70 px-2 py-1 text-[10px] font-black uppercase">
                      {control.status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs font-semibold leading-5">{control.detail}</p>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm font-semibold text-slate-500 md:col-span-5">
                Loading delivery mission controls.
              </div>
            )}
          </div>

          <div
            data-testid="delivery-zone-coverage"
            className="rounded-lg border border-white bg-white p-4 shadow-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-gray-500">
                  Zone Coverage
                </p>
                <p className="mt-1 text-sm font-semibold text-gray-600">
                  {deliveryMissionSummary?.coverage_keyword_count ?? 0} coverage keywords | longest ETA{" "}
                  {deliveryMissionSummary?.longest_eta_minutes ?? 0} min
                </p>
              </div>
              <MapPin className="h-5 w-5 text-red-600" />
            </div>
            <div className="mt-3 grid gap-2">
              {activeMissionZones.slice(0, 3).map((zone) => (
                <div
                  key={zone.id}
                  className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-black text-slate-950">{zone.name}</p>
                    <p className="text-xs font-semibold text-slate-500">
                      Min {money(zone.minimum_order_amount || 0)} |{" "}
                      {zone.eta_window ||
                        `${zone.eta_min_minutes || 0}-${zone.eta_max_minutes || 0} min`}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-md bg-white px-2 py-1 text-xs font-black text-slate-700">
                    {money(zone.delivery_fee || 0)}
                  </span>
                </div>
              ))}
              {!activeMissionZones.length && (
                <p className="rounded-md bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                  No active delivery zone is ready.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.4fr_1fr]">
          <div
            data-testid="delivery-mission-priority-orders"
            className="rounded-lg border border-white bg-white p-4 shadow-sm"
          >
            <p className="text-xs font-black uppercase tracking-wide text-gray-500">
              Priority Orders
            </p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {missionPriorityOrders.slice(0, 4).map((order) => (
                <article
                  key={`mission-${order.id}`}
                  data-testid={`delivery-mission-order-${order.id}`}
                  className="rounded-md border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-slate-950">Order #{order.id}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">
                        {order.customer_name || "Delivery customer"} | {order.delivery_zone || "Zone pending"}
                      </p>
                    </div>
                    <span className="rounded-md bg-white px-2 py-1 text-[11px] font-black text-slate-700">
                      {missionOrderLabel(order)}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-slate-600">
                    {order.next_action}
                  </p>
                  <p className="mt-2 text-xs font-bold text-slate-500">
                    Fee {money(Number(order.delivery_fee || 0))} | {order.eta_window || "ETA pending"} |{" "}
                    {money(order.total_amount || 0)}
                  </p>
                </article>
              ))}
              {!missionPriorityOrders.length && (
                <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-4 text-sm font-semibold text-slate-500 md:col-span-2">
                  No active delivery priority right now.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-white bg-white p-4 shadow-sm">
            <p className="text-xs font-black uppercase tracking-wide text-gray-500">
              Delivery Next Actions
            </p>
            <div className="mt-3 grid gap-2">
              {(deliveryMission?.next_actions || ["Loading delivery next actions."]).map((action) => (
                <p key={action} className="rounded-md bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                  {action}
                </p>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section data-testid="delivery-dispatch-board" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-gray-950">Delivery Dispatch Board</h2>
            <p className="text-sm text-gray-500">
              Fast rider handoff for delivery orders that need assignment, dispatch, or close.
            </p>
          </div>
          <button
            onClick={() => setFilter("delivery")}
            className="inline-flex h-11 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-black text-red-700 hover:bg-red-100"
          >
            <Truck className="h-4 w-4" />
            Show Delivery Queue
          </button>
        </div>
        <div className="grid gap-2 md:grid-cols-4">
          {[
            ["Needs Rider", deliveryActionCounts.needsRider, "bg-red-50 text-red-700"],
            ["Ready Dispatch", deliveryActionCounts.readyToDispatch, "bg-sky-50 text-sky-700"],
            ["Out For Delivery", deliveryActionCounts.outForDelivery, "bg-orange-50 text-orange-700"],
            ["Blocked", deliveryActionCounts.blocked, "bg-amber-50 text-amber-700"],
          ].map(([label, value, tone]) => (
            <button
              key={label}
              onClick={() => setFilter(label === "Blocked" ? "address_review" : "delivery")}
              className={`flex h-14 items-center justify-between rounded-lg px-4 text-sm font-black ${tone}`}
            >
              <span>{label}</span>
              <span className="text-xl">{value}</span>
            </button>
          ))}
        </div>
        <div
          data-testid="delivery-mission-control"
          className="grid gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm xl:grid-cols-[1.2fr_1.8fr]"
        >
          <div
            data-testid="delivery-next-priority"
            className="rounded-lg border border-slate-200 bg-slate-50 p-4"
          >
            <p className="text-xs font-black uppercase tracking-wide text-slate-500">
              Next Delivery Priority
            </p>
            {nextDeliveryOrder ? (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xl font-black text-slate-950">
                    Order #{nextDeliveryOrder.id}
                  </span>
                  <span
                    className={`rounded-md border px-2 py-1 text-xs font-black ${deliveryStatusClass(
                      nextDeliveryOrder.delivery_assignment?.status || "unassigned"
                    )}`}
                  >
                    {deliveryPriorityLabel(nextDeliveryOrder)}
                  </span>
                </div>
                <p className="text-sm font-semibold text-slate-600">
                  {nextDeliveryOrder.delivery_next_action ||
                    nextDeliveryOrder.delivery_assignment?.next_action ||
                    "Assign rider and move the order through dispatch."}
                </p>
                <p className="flex items-center gap-1 text-xs font-semibold text-slate-500">
                  <MapPin className="h-3.5 w-3.5 text-red-600" />
                  <span className="truncate">
                    {nextDeliveryOrder.delivery_address || "Address pending"}
                  </span>
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm font-semibold text-slate-500">
                No active delivery priority right now.
              </p>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {deliveryMissionActions.map((action) => (
              <button
                key={action.label}
                data-testid={action.testId}
                type="button"
                onClick={() => setFilter(action.filter)}
                className={`rounded-lg border p-4 text-left shadow-sm transition hover:brightness-95 ${action.tone}`}
              >
                <span className="block text-xs font-black uppercase tracking-wide">
                  {action.label}
                </span>
                <span className="mt-2 block text-2xl font-black">{action.count}</span>
                <span className="mt-1 block text-xs font-semibold">{action.detail}</span>
              </button>
            ))}
          </div>
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
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-gray-950">Rider Handoff</h2>
              <p className="text-sm text-gray-500">
                Assign, dispatch, confirm delivery, or mark a failed delivery from one compact card.
              </p>
            </div>
            <span className="rounded-md bg-red-50 px-3 py-2 text-xs font-black uppercase text-red-700">
              {deliveryOrders.length} active
            </span>
          </div>
          <div data-testid="delivery-handoff-board" className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            {sortedDeliveryOrders.map((order) => {
              const assignment = order.delivery_assignment;
              const assignmentStatus = assignment?.status || "unassigned";
              const assignmentLabel = assignmentStatus.replaceAll("_", " ");
              const addressValidation = order.address_validation;
              const addressWarnings = addressValidation?.warnings || [];
              const orderNeedsAddressReview = needsAddressReview(order);
              const paymentDue = isPrepaidPaymentDue(order);
              const riderValue = assignmentDrafts[order.id] ?? assignment?.assigned_to ?? "";
              const noteValue = assignmentNoteDrafts[order.id] ?? assignment?.notes ?? "";
              const canAssign = Boolean(riderValue.trim());
              const canDispatch = Boolean(riderValue.trim()) && !orderNeedsAddressReview;
              const canDeliver = Boolean(riderValue.trim()) && !orderNeedsAddressReview && !paymentDue;
              const canFail = Boolean(noteValue.trim());
              const statusRail = [
                { key: "unassigned", label: "Rider", complete: Boolean(riderValue.trim()) },
                {
                  key: "assigned",
                  label: "Assigned",
                  complete: ["assigned", "out_for_delivery", "delivered"].includes(assignmentStatus),
                },
                {
                  key: "out_for_delivery",
                  label: "Out",
                  complete: ["out_for_delivery", "delivered"].includes(assignmentStatus),
                },
                { key: "delivered", label: "Done", complete: assignmentStatus === "delivered" },
              ];
              return (
                <article
                  key={`delivery-${order.id}`}
                  data-testid={`delivery-handoff-order-${order.id}`}
                  className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-black text-gray-950">Order #{order.id}</p>
                      <p className="mt-1 text-xs font-bold uppercase text-gray-500">
                        {order.customer_name || "Customer"} {order.customer_phone ? `| ${order.customer_phone}` : ""}
                      </p>
                    </div>
                    <span
                      data-testid={`delivery-assignment-status-${order.id}`}
                      className={`rounded-md border px-2 py-1 text-xs font-black ${deliveryStatusClass(assignmentStatus)}`}
                    >
                      {assignmentLabel}
                    </span>
                  </div>
                  <div
                    data-testid={`delivery-status-rail-${order.id}`}
                    className="mt-3 grid grid-cols-4 gap-1"
                  >
                    {statusRail.map((step) => (
                      <span
                        key={`${order.id}-${step.key}`}
                        className={`rounded-md border px-2 py-1 text-center text-[11px] font-black uppercase ${
                          step.complete
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-slate-50 text-slate-400"
                        }`}
                      >
                        {step.label}
                      </span>
                    ))}
                  </div>

                  <div className="mt-3 rounded-md bg-slate-50 p-3">
                    <p className="line-clamp-2 text-sm font-semibold text-gray-700">
                      {order.items
                        .slice(0, 3)
                        .map((item) => itemSummary(item))
                        .join(" | ")}
                    </p>
                    <p className="mt-2 text-xs font-bold text-gray-500">
                      {order.delivery_zone || "Zone pending"} | Fee {money(order.delivery_fee || 0)} | {order.eta_window || "ETA pending"} | {money(order.total_amount)}
                    </p>
                  </div>

                  <div className="mt-3 space-y-2">
                    <p className="text-sm font-semibold text-gray-600">
                      <MapPin className="mr-1 inline h-3.5 w-3.5 text-red-600" />
                      <span className="align-middle">
                        {order.delivery_address || "Address pending"}
                      </span>
                    </p>
                    {orderNeedsAddressReview && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <div>
                            <p className="font-black uppercase">Address Review Required</p>
                            <p
                              data-testid={`delivery-address-score-${order.id}`}
                              className="mt-1 font-black"
                            >
                              Address score {addressValidation?.score ?? 0}/100
                            </p>
                            {addressWarnings.slice(0, 2).map((warning) => (
                              <p key={warning} className="mt-1 leading-5">
                                {warning}
                              </p>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    {paymentDue && (
                      <div className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-800">
                        Confirm prepaid payment before closing this delivery.
                      </div>
                    )}
                  </div>

                  <div className="mt-4 grid gap-2">
                    <input
                      value={riderValue}
                      onChange={(event) =>
                        setAssignmentDrafts((current) => ({
                          ...current,
                          [order.id]: event.target.value,
                        }))
                      }
                      placeholder="Delivery partner"
                      className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold outline-none focus:border-red-600"
                    />
                    <div
                      data-testid={`delivery-rider-roster-${order.id}`}
                      className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2"
                    >
                      {riderPresets.map((rider) => (
                        <button
                          key={`${order.id}-${rider}`}
                          type="button"
                          data-testid={`delivery-rider-${order.id}-${rider.toLowerCase().replaceAll(" ", "-")}`}
                          onClick={() =>
                            setAssignmentDrafts((current) => ({
                              ...current,
                              [order.id]: rider,
                            }))
                          }
                          className={`h-9 rounded-md border px-2 text-xs font-black ${
                            riderValue === rider
                              ? "border-slate-950 bg-slate-950 text-white"
                              : "border-slate-200 bg-white text-slate-600 hover:border-red-500 hover:text-red-700"
                          }`}
                        >
                          {rider}
                        </button>
                      ))}
                    </div>
                    <input
                      value={noteValue}
                      onChange={(event) =>
                        setAssignmentNoteDrafts((current) => ({
                          ...current,
                          [order.id]: event.target.value,
                        }))
                      }
                      placeholder="Handoff note or failure reason"
                      className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold outline-none focus:border-red-600"
                    />
                  </div>

                  <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                    <span className="font-black text-slate-900">Next action:</span>{" "}
                    {order.delivery_next_action || assignment?.notes || "Add rider, assign, then dispatch."}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      data-testid={`delivery-assign-${order.id}`}
                      onClick={() => updateDeliveryAssignment(order, "assigned")}
                      disabled={!canAssign || busyAction === `${order.id}-delivery-assigned`}
                      className="h-11 rounded-md bg-slate-950 px-3 text-sm font-black text-white hover:bg-red-700 disabled:bg-slate-300"
                    >
                      Assign
                    </button>
                    <button
                      data-testid={`delivery-dispatch-${order.id}`}
                      onClick={() => updateDeliveryAssignment(order, "out_for_delivery")}
                      disabled={!canDispatch || busyAction === `${order.id}-delivery-out_for_delivery`}
                      className="h-11 rounded-md border border-sky-200 bg-sky-50 px-3 text-sm font-black text-sky-700 hover:bg-sky-100 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      Dispatch
                    </button>
                    <button
                      data-testid={`delivery-delivered-${order.id}`}
                      onClick={() => updateDeliveryAssignment(order, "delivered")}
                      disabled={!canDeliver || busyAction === `${order.id}-delivery-delivered`}
                      className="h-11 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-black text-emerald-700 hover:bg-emerald-100 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      Delivered & Close
                    </button>
                    <button
                      data-testid={`delivery-failed-${order.id}`}
                      onClick={() => updateDeliveryAssignment(order, "failed")}
                      disabled={!canFail || busyAction === `${order.id}-delivery-failed`}
                      className="h-11 rounded-md border border-rose-200 bg-rose-50 px-3 text-sm font-black text-rose-700 hover:bg-rose-100 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      Failed
                    </button>
                  </div>
                  {(!riderValue.trim() || orderNeedsAddressReview || paymentDue) && (
                    <p className="mt-2 text-xs font-bold leading-5 text-amber-800">
                      {!riderValue.trim()
                        ? "Add rider before dispatch. "
                        : ""}
                      {orderNeedsAddressReview ? "Review address before dispatch. " : ""}
                      {paymentDue ? "Confirm payment before delivered-close." : ""}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[1fr_140px_150px_270px] gap-4 border-b border-gray-200 bg-gray-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-gray-500">
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
              const blockers = closeBlockers(order);
              const canClose = order.status !== "closed" && blockers.length === 0;
              const canVoid = !["closed", "cancelled"].includes(order.status);
              const flow = orderFlowById.get(order.id);
              const flowSteps = [
                {
                  key: "received",
                  label: "Received",
                  complete: true,
                  current: order.status === "open",
                },
                {
                  key: "prep",
                  label: "Prep",
                  complete: ["preparing", "ready", "closed"].includes(order.status),
                  current: order.status === "preparing",
                },
                {
                  key: "ready",
                  label: "Ready",
                  complete: ["ready", "closed"].includes(order.status),
                  current: order.status === "ready",
                },
                {
                  key: "closed",
                  label: "Closed",
                  complete: order.status === "closed",
                  current: false,
                },
                ...(order.status === "cancelled"
                  ? [
                      {
                        key: "cancelled",
                        label: "Voided",
                        complete: true,
                        current: false,
                      },
                    ]
                  : []),
              ];
              const primaryLocation = order.table_number
                ? `Table ${order.table_number}`
                : (order.fulfillment_type || order.order_type).replace("-", " ");
              const isOnlineOrder = order.source === "customer_website";

              return (
                <div
                  key={order.id}
                  data-testid={`operations-order-row-${order.id}`}
                  className="grid grid-cols-[1fr_140px_150px_270px] gap-4 border-b border-gray-100 px-4 py-4 last:border-b-0"
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
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {flowSteps.map((step) => (
                      <span
                        key={`${order.id}-${step.key}`}
                        className={`rounded-md border px-2 py-1 text-[11px] font-black uppercase ${flowStepClass(step.complete, step.current)}`}
                      >
                        {step.label}
                      </span>
                    ))}
                  </div>
                  {flow?.next_action && (
                    <p className="mt-2 text-xs font-semibold text-slate-500">
                      Flow: {flow.next_action}
                    </p>
                  )}
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
                    title={blockers.length ? `Blocked: ${blockers.join(", ")}` : "Close order"}
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
                  <button
                    data-testid={`operations-void-${order.id}`}
                    title="Void order"
                    aria-label={`Void order ${order.id}`}
                    onClick={() => cancelOrder(order)}
                    disabled={!canVoid || busyAction === `${order.id}-cancel`}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyAction === `${order.id}-cancel` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <XCircle className="h-4 w-4" />
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
