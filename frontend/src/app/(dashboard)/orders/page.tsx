"use client";

import { type ComponentType, useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Coins,
  CreditCard,
  FileText,
  Globe2,
  MapPin,
  Minus,
  Plus,
  Printer,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  ShoppingBag,
  Truck,
  Utensils,
  Users,
  MessageCircle,
  X,
  Zap,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const ORDERS_API = getApiUrl("/api/v1/restaurant/orders");
const MENU_API = getApiUrl("/api/v1/restaurant/menu/menu-with-customizations");
const QUICK_BUILDS_API = getApiUrl("/api/v1/restaurant/menu/customizations/quick-builds");
const DELIVERY_API = getApiUrl("/api/v1/restaurant/delivery");

type CustomizationOption = {
  id: number;
  name: string;
  price_delta: number;
  is_default: boolean;
};

type CustomizationGroup = {
  id: number;
  name: string;
  selection_type: "single" | "multiple";
  min_select: number;
  max_select: number;
  options: CustomizationOption[];
};

type SelectedOption = {
  group_id: number;
  group_name: string;
  option_id: number;
  option_name: string;
  price_delta: number;
};

type MenuItem = {
  id: number;
  name: string;
  category: string;
  selling_price: number;
  is_available: boolean;
  customization_groups?: CustomizationGroup[];
  customization_draft?: Record<number, number[]>;
  quantity?: number;
};

type SelectedMenuItem = MenuItem & {
  unit_price: number;
  base_price: number;
  customization_total: number;
  selected_options: SelectedOption[];
};

type QuickBuild = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  item: {
    id: number;
    name: string;
    category: string;
    base_price: number;
  };
  base_price: number;
  customization_total: number;
  unit_price: number;
  selected_options: SelectedOption[];
  option_count: number;
  operator_steps: string[];
};

type Table = {
  id: number;
  table_number: string;
  capacity: number;
  status: string;
  current_order_id?: number | null;
};

type DeliveryZone = {
  id: number;
  name: string;
  delivery_fee: number;
  minimum_order_amount: number;
  eta_window: string;
  is_active: boolean;
};

type DeliveryQuote = {
  is_deliverable: boolean;
  reason?: string | null;
  address: string;
  zone?: DeliveryZone | null;
  delivery_fee: number;
  eta_window?: string | null;
  address_validation?: {
    quality: string;
    score: number;
    matched_keyword?: string | null;
    warnings: string[];
    requires_review: boolean;
  };
  charge_breakdown?: {
    subtotal: number;
    minimum_order_amount: number;
    delivery_fee: number;
    total_with_delivery: number;
  };
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
  } | null;
  eta_window?: string | null;
  scheduled_for?: string | null;
  scheduled_label?: string | null;
  payment_due?: boolean;
  table_number?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
    selected_options?: {
      group_name?: string;
      option_name: string;
      price_delta: number;
    }[];
  }>;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  tip_amount?: number;
  total_amount: number;
  payment_status: string;
  payment_method?: string | null;
  payment_provider?: string | null;
  payment_reference?: string | null;
  payment_confirmed_at?: string | null;
  payment_proof_required?: boolean;
  status: string;
  can_close?: boolean;
  close_blockers?: string[];
  created_at?: string | null;
};

const emptyCustomer = {
  customer_name: "",
  customer_phone: "",
  payment_method: "cash",
  discount_amount: 0,
  tip_amount: 0,
  delivery_address: "",
  notes: "",
};

type LastCreatedOrder = {
  id: number;
  isDelivery: boolean;
  paymentMethod: string;
  itemCount: number;
  total: number;
  status: "sent" | "closed";
};

type PickupNotificationLog = {
  orderId: number;
  customerName: string;
  customerPhone: string;
  total: number;
  href: string;
  createdAt: string;
};

const PICKUP_NOTIFICATION_LOG_KEY = "pizza-blitz-counter-pickup-notifications";
const PAYMENT_PROOF_METHODS = new Set(["upi", "card", "mixed", "direct_bank"]);

function optionSummary(option: NonNullable<Order["items"][number]["selected_options"]>[number]) {
  const delta = Number(option.price_delta || 0);
  const suffix = delta > 0 ? ` +Rs ${delta}` : "";
  return `${option.group_name || "Option"}: ${option.option_name}${suffix}`;
}

function whatsappPhone(value?: string | null) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

function pickupNotificationHref(order: Order) {
  const phone = whatsappPhone(order.customer_phone);
  if (!phone) return "";
  const origin = typeof window !== "undefined" ? window.location.origin : "https://pizza-blitz.vercel.app";
  const receiptUrl = `${origin}/receipt/${order.id}?phone=${encodeURIComponent(order.customer_phone || "")}`;
  const message = `Pizza Blitz update: Order #${order.id} is ready for pickup. Bill: ${receiptUrl}`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function normalizedPaymentMethod(order: Pick<Order, "payment_method">) {
  return (order.payment_method || "cash").toLowerCase();
}

function needsPaymentProof(order: Order) {
  if (order.payment_proof_required !== undefined) return order.payment_proof_required;
  return (
    order.payment_status !== "paid" &&
    PAYMENT_PROOF_METHODS.has(normalizedPaymentMethod(order))
  );
}

function paymentProviderForMethod(method: string) {
  if (method === "upi" || method === "direct_bank") return "direct_bank";
  return "manual";
}

function paymentReferencePlaceholder(order: Order) {
  const method = normalizedPaymentMethod(order).toUpperCase();
  if (method === "UPI" || method === "DIRECT_BANK") return "UPI / bank reference";
  if (method === "CARD") return "Card approval / slip no.";
  if (method === "MIXED") return "Cash + UPI/card proof";
  return `${method} reference`;
}

function notificationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function OrdersPage() {
  const [tables, setTables] = useState<Table[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [quickBuilds, setQuickBuilds] = useState<QuickBuild[]>([]);
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
  const [selectedDeliveryZoneId, setSelectedDeliveryZoneId] = useState<number | null>(null);
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [orderMode, setOrderMode] = useState<"takeaway" | "delivery">("takeaway");
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [formData, setFormData] = useState(emptyCustomer);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastCreatedOrder, setLastCreatedOrder] = useState<LastCreatedOrder | null>(null);
  const [postOrderBusy, setPostOrderBusy] = useState(false);
  const [isQuotingDelivery, setIsQuotingDelivery] = useState(false);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<number, string>>({});
  const [assignmentNoteDrafts, setAssignmentNoteDrafts] = useState<Record<number, string>>({});
  const [busyDeliveryAction, setBusyDeliveryAction] = useState<string | null>(null);
  const [paymentReferenceDrafts, setPaymentReferenceDrafts] = useState<Record<number, string>>({});
  const [busyPaymentAction, setBusyPaymentAction] = useState<number | null>(null);
  const [pickupNotificationLog, setPickupNotificationLog] = useState<PickupNotificationLog[]>([]);
  const [menuSearch, setMenuSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [cashTendered, setCashTendered] = useState<number | "">("");
  const [isHydrated, setIsHydrated] = useState(false);

  const defaultDraftForItem = (item: MenuItem) => {
    const draft: Record<number, number[]> = {};
    (item.customization_groups || []).forEach((group) => {
      if (group.selection_type === "single") {
        const defaultOption = group.options.find((option) => option.is_default) || group.options[0];
        draft[group.id] = defaultOption ? [defaultOption.id] : [];
      } else {
        draft[group.id] = group.options
          .filter((option) => option.is_default)
          .slice(0, group.max_select || group.options.length)
          .map((option) => option.id);
      }
    });
    return draft;
  };

  const draftForItem = (item: MenuItem) => item.customization_draft || defaultDraftForItem(item);

  const selectedOptionsForItem = (item: MenuItem, draft = draftForItem(item)) => {
    const selected: SelectedOption[] = [];
    (item.customization_groups || []).forEach((group) => {
      const selectedIds = new Set(draft[group.id] || []);
      group.options
        .filter((option) => selectedIds.has(option.id))
        .forEach((option) => {
          if (group.name === "Combo" && option.name === "No Combo") return;
          selected.push({
            group_id: group.id,
            group_name: group.name,
            option_id: option.id,
            option_name: option.name,
            price_delta: Number(option.price_delta || 0),
          });
        });
    });
    return selected;
  };

  const draftFromSelectedOptions = (
    item: MenuItem,
    selectedOptions: SelectedOption[]
  ) => {
    const draft = defaultDraftForItem(item);
    (item.customization_groups || []).forEach((group) => {
      const optionIds = group.options
        .filter((option) =>
          selectedOptions.some(
            (selectedOption) =>
              selectedOption.group_name === group.name &&
              selectedOption.option_name === option.name
          )
        )
        .map((option) => option.id);

      if (!optionIds.length) return;
      draft[group.id] =
        group.selection_type === "single"
          ? [optionIds[0]]
          : optionIds.slice(0, group.max_select || optionIds.length);
    });
    return draft;
  };

  const customizationTotalForItem = (item: MenuItem) =>
    selectedOptionsForItem(item).reduce(
      (sum, option) => sum + Number(option.price_delta || 0),
      0
    );

  const configuredPriceForItem = (item: MenuItem) =>
    Number(item.selling_price || 0) + customizationTotalForItem(item);

  const selectedItems = menuItems
    .filter((item) => Number(item.quantity || 0) > 0)
    .map((item) => {
      const selectedOptions = selectedOptionsForItem(item);
      const customizationTotal = selectedOptions.reduce(
        (sum, option) => sum + Number(option.price_delta || 0),
        0
      );
      return {
        ...item,
        unit_price: Number(item.selling_price || 0) + customizationTotal,
        base_price: Number(item.selling_price || 0),
        customization_total: customizationTotal,
        selected_options: selectedOptions,
      };
    }) as SelectedMenuItem[];
  const menuCategories = [
    "All",
    ...Array.from(new Set(menuItems.map((item) => item.category).filter(Boolean))).sort(),
  ];
  const filteredMenuItems = menuItems.filter((item) => {
    const matchesCategory = activeCategory === "All" || item.category === activeCategory;
    const query = menuSearch.trim().toLowerCase();
    const matchesSearch =
      !query ||
      item.name.toLowerCase().includes(query) ||
      item.category.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  });
  const subtotal = selectedItems.reduce(
    (sum, item) => sum + Number(item.unit_price || 0) * Number(item.quantity || 0),
    0
  );
  const discount = Math.max(Number(formData.discount_amount || 0), 0);
  const tip = Math.min(Math.max(Number(formData.tip_amount || 0), 0), 2000);
  const taxableSubtotal = Math.max(subtotal - discount, 0);
  const tax = taxableSubtotal * 0.05;
  const isDeliveryOrder = !selectedTable && orderMode === "delivery";
  const deliveryFee =
    isDeliveryOrder && deliveryQuote?.is_deliverable
      ? Number(deliveryQuote.delivery_fee || 0)
      : 0;
  const total = taxableSubtotal + tax + deliveryFee + tip;
  const roundedTotal = Math.round(total);
  const cashTenderedAmount =
    typeof cashTendered === "number" ? cashTendered : Number(cashTendered || 0);
  const cashChangeDue =
    formData.payment_method === "cash" && cashTenderedAmount > 0
      ? Math.max(cashTenderedAmount - roundedTotal, 0)
      : 0;
  const cashTenderPresets =
    roundedTotal > 0
      ? Array.from(
          new Set(
            [roundedTotal, 200, 500, 1000, 2000].filter(
              (value) => value > 0 && value >= roundedTotal
            )
          )
        ).slice(0, 4)
      : [];
  const selectedItemCount = selectedItems.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0
  );
  const quickPaymentMethods = ["cash", "upi", "card", "mixed"];
  const quickMenuItems = [...menuItems]
    .filter((item) => item.is_available)
    .sort((a, b) => {
      const aPizza = `${a.name} ${a.category}`.toLowerCase().includes("pizza") ? 0 : 1;
      const bPizza = `${b.name} ${b.category}`.toLowerCase().includes("pizza") ? 0 : 1;
      return aPizza - bPizza || Number(a.selling_price || 0) - Number(b.selling_price || 0);
    })
    .slice(0, 6);
  const canStartExpressWalkIn = isHydrated && quickMenuItems.length > 0;
  const deliveryReady =
    !isDeliveryOrder ||
    Boolean(
      formData.delivery_address.trim() &&
        selectedDeliveryZoneId &&
        deliveryQuote?.is_deliverable &&
        !isQuotingDelivery
    );
  const canSendOrder = selectedItems.length > 0 && deliveryReady && !saving;
  const sendBlockReason = !selectedItems.length
    ? "Add item"
    : isDeliveryOrder && !formData.delivery_address.trim()
    ? "Address"
    : isDeliveryOrder && isQuotingDelivery
    ? "Quote"
    : isDeliveryOrder && !deliveryQuote?.is_deliverable
    ? "Delivery"
    : "Ready";
  const nextCounterAction = !selectedItemCount
    ? "Tap a preset or menu item"
    : isDeliveryOrder && !formData.delivery_address.trim()
    ? "Enter delivery address"
    : isDeliveryOrder && isQuotingDelivery
    ? "Wait for delivery quote"
    : isDeliveryOrder && !deliveryQuote?.is_deliverable
    ? "Confirm deliverable zone"
    : formData.payment_method === "cash" && !cashTenderedAmount
    ? "Take cash or press Exact"
    : "Send to kitchen";
  const sendButtonCopy = saving
    ? "Sending..."
    : canSendOrder
    ? isDeliveryOrder
      ? "Send Delivery"
      : "Send Order"
    : `Need: ${sendBlockReason}`;
  const counterStepCards = [
    {
      label: "Items",
      value: selectedItemCount ? `${selectedItemCount} selected` : "Empty bill",
      active: selectedItemCount > 0,
      icon: ShoppingBag,
    },
    {
      label: isDeliveryOrder ? "Delivery" : "Mode",
      value: isDeliveryOrder
        ? deliveryReady
          ? deliveryQuote?.eta_window || "Ready"
          : sendBlockReason
        : selectedTable
        ? `Table ${selectedTable}`
        : "Takeaway",
      active: deliveryReady,
      icon: isDeliveryOrder ? Truck : Utensils,
    },
    {
      label: "Payment",
      value: formData.payment_method.toUpperCase(),
      active: true,
      icon: ReceiptText,
    },
  ];
  const openOrders = orders.filter(
    (order) => !["closed", "cancelled"].includes(order.status)
  );
  const deliveryOrders = openOrders.filter(
    (order) => (order.fulfillment_type || order.order_type) === "delivery"
  );
  const takeawayOrders = openOrders.filter(
    (order) => (order.fulfillment_type || order.order_type) !== "delivery"
  );
  const unassignedDeliveryCount = deliveryOrders.filter(
    (order) => !order.delivery_assignment?.assigned_to
  ).length;
  const readyCounterOrders = takeawayOrders
    .filter((order) => order.status === "ready")
    .sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
  const readyToBillCount = openOrders.filter((order) => order.status === "ready").length;
  const paymentDueCount = openOrders.filter(
    (order) =>
      order.payment_due ||
      order.payment_status === "awaiting_payment" ||
      needsPaymentProof(order)
  ).length;
  const voidedTodayCount = orders.filter((order) => order.status === "cancelled").length;
  const tipsToday = orders
    .filter((order) => order.status !== "cancelled")
    .reduce((sum, order) => sum + Number(order.tip_amount || 0), 0);
  const closedTotal = orders
    .filter((order) => order.status === "closed")
    .reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
  const lastCreatedOrderRow = lastCreatedOrder
    ? orders.find((order) => order.id === lastCreatedOrder.id)
    : null;
  const lastCreatedCloseBlockers =
    lastCreatedOrder?.status === "closed"
      ? []
      : lastCreatedOrderRow?.close_blockers || ["kitchen not ready"];

  const closeBlockersForOrder = (order: Order) => {
    if (order.status === "closed") return [];
    if (order.close_blockers?.length) return order.close_blockers;
    const blockers: string[] = [];
    if (order.status === "cancelled") blockers.push("cancelled");
    if (order.status !== "ready") blockers.push("kitchen not ready");
    if (order.payment_due || order.payment_status === "awaiting_payment") {
      blockers.push("payment due");
    } else if (needsPaymentProof(order)) {
      blockers.push("payment proof required");
    }
    if ((order.fulfillment_type || order.order_type) === "delivery") {
      const assignmentStatus = order.delivery_assignment?.status || "unassigned";
      if (assignmentStatus !== "delivered") blockers.push("delivery not completed");
    }
    return blockers;
  };

  useEffect(() => {
    setIsHydrated(true);
    try {
      const storedLog = JSON.parse(
        window.localStorage.getItem(PICKUP_NOTIFICATION_LOG_KEY) || "[]"
      );
      if (Array.isArray(storedLog)) {
        setPickupNotificationLog(storedLog.slice(0, 6));
      }
    } catch {
      setPickupNotificationLog([]);
    }
    fetchData();
  }, []);

  const fetchData = async () => {
    const [tablesRes, menuRes, todayRes, zonesRes, quickBuildsRes] = await Promise.all([
      fetch(`${ORDERS_API}/tables`, { credentials: "include" }),
      fetch(MENU_API),
      fetch(`${ORDERS_API}/today`, { credentials: "include" }),
      fetch(`${DELIVERY_API}/zones`),
      fetch(QUICK_BUILDS_API),
    ]);

    setTables(await tablesRes.json());
    const menu = await menuRes.json();
    setMenuItems(
      menu
        .filter((item: MenuItem) => item.is_available)
        .map((item: MenuItem) => ({
          ...item,
          quantity: 0,
          customization_draft: defaultDraftForItem(item),
        }))
    );
    const today = await todayRes.json();
    setOrders(today.orders || []);
    const zones = await zonesRes.json();
    const activeZones = Array.isArray(zones)
      ? zones.filter((zone: DeliveryZone) => zone.is_active)
      : [];
    setDeliveryZones(activeZones);
    setSelectedDeliveryZoneId((current) => current || activeZones[0]?.id || null);
    const quickBuildPayload = await quickBuildsRes.json();
    setQuickBuilds(Array.isArray(quickBuildPayload.builds) ? quickBuildPayload.builds : []);
  };

  const resetOrderForm = () => {
    setFormData(emptyCustomer);
    setDeliveryQuote(null);
    setMenuSearch("");
    setActiveCategory("All");
    setCashTendered("");
    setMenuItems((current) =>
      current.map((item) => ({
        ...item,
        quantity: 0,
        customization_draft: defaultDraftForItem(item),
      }))
    );
  };

  const openOrderModal = (table?: Table, mode: "takeaway" | "delivery" = "takeaway") => {
    if (table?.status === "occupied") {
      setMessage(`Table ${table.table_number} already has order #${table.current_order_id}. Close it before starting another.`);
      return;
    }
    setSelectedTable(table?.table_number || null);
    setOrderMode(table ? "takeaway" : mode);
    resetOrderForm();
    setShowOrderModal(true);
    setMessage("");
  };

  const startExpressWalkIn = () => {
    const build = quickBuilds.find((candidate) =>
      menuItems.some((item) => item.id === candidate.item.id && item.is_available)
    );
    const targetItem =
      (build ? menuItems.find((item) => item.id === build.item.id) : null) ||
      quickMenuItems[0] ||
      menuItems.find((item) => item.is_available);

    if (!targetItem) {
      setMessage("Menu is still loading. Try Express Walk-in again in a moment.");
      return;
    }

    const targetDraft = build
      ? draftFromSelectedOptions(targetItem, build.selected_options)
      : defaultDraftForItem(targetItem);

    setSelectedTable(null);
    setOrderMode("takeaway");
    setDeliveryQuote(null);
    setFormData({
      ...emptyCustomer,
      payment_method: "cash",
      notes: "Express walk-in",
    });
    setCashTendered("");
    setMenuSearch("");
    setActiveCategory(targetItem.category || "All");
    setMenuItems((current) =>
      current.map((item) => ({
        ...item,
        quantity: item.id === targetItem.id ? 1 : 0,
        customization_draft:
          item.id === targetItem.id ? targetDraft : defaultDraftForItem(item),
      }))
    );
    setShowOrderModal(true);
    setMessage(`${build?.name || targetItem.name} loaded for express walk-in.`);
  };

  const selectPaymentMethod = (method: string) => {
    setFormData({ ...formData, payment_method: method });
    if (method !== "cash") setCashTendered("");
  };

  const updateQuantity = (id: number, quantity: number) => {
    setMenuItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, quantity: Math.max(quantity, 0) } : item
      )
    );
  };

  const applyQuickBuild = (build: QuickBuild) => {
    const targetItem = menuItems.find((item) => item.id === build.item.id);
    if (!targetItem) {
      setMessage(`${build.name} is not available in the current menu.`);
      return;
    }
    const nextDraft = draftFromSelectedOptions(targetItem, build.selected_options);
    setMenuItems((current) =>
      current.map((item) =>
        item.id === build.item.id
          ? {
              ...item,
              quantity: Number(item.quantity || 0) + 1,
              customization_draft: nextDraft,
            }
          : item
      )
    );
    setActiveCategory(build.item.category || "All");
    setMenuSearch("");
    setMessage(`${build.name} added to the bill.`);
  };

  const updateCustomization = (
    itemId: number,
    group: CustomizationGroup,
    option: CustomizationOption
  ) => {
    setMenuItems((current) =>
      current.map((item) => {
        if (item.id !== itemId) return item;
        const currentDraft = item.customization_draft || defaultDraftForItem(item);
        const selected = currentDraft[group.id] || [];
        let nextSelection: number[];

        if (group.selection_type === "single") {
          nextSelection = [option.id];
        } else if (selected.includes(option.id)) {
          nextSelection = selected.filter((id) => id !== option.id);
        } else if (selected.length >= group.max_select) {
          setMessage(`Choose up to ${group.max_select} ${group.name.toLowerCase()} options.`);
          nextSelection = selected;
        } else {
          nextSelection = [...selected, option.id];
        }

        return {
          ...item,
          customization_draft: {
            ...currentDraft,
            [group.id]: nextSelection,
          },
        };
      })
    );
  };

  useEffect(() => {
    if (!isDeliveryOrder) {
      setDeliveryQuote(null);
      return;
    }

    const address = formData.delivery_address.trim();
    if (!address || !selectedDeliveryZoneId) {
      setDeliveryQuote(null);
      return;
    }

    const quoteTimer = window.setTimeout(async () => {
      setIsQuotingDelivery(true);
      try {
        const response = await fetch(`${DELIVERY_API}/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address,
            subtotal,
            zone_id: selectedDeliveryZoneId,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          setDeliveryQuote({
            is_deliverable: false,
            reason: data.detail || "Address could not be validated.",
            address,
            delivery_fee: 0,
          });
          return;
        }
        setDeliveryQuote(data);
      } catch {
        setDeliveryQuote({
          is_deliverable: false,
          reason: "Delivery quote API is not available right now.",
          address,
          delivery_fee: 0,
        });
      } finally {
        setIsQuotingDelivery(false);
      }
    }, 350);

    return () => window.clearTimeout(quoteTimer);
  }, [formData.delivery_address, isDeliveryOrder, selectedDeliveryZoneId, subtotal]);

  const createOrder = async () => {
    if (!selectedItems.length) {
      setMessage("Add at least one item before sending the order.");
      return;
    }
    if (isDeliveryOrder && !formData.delivery_address.trim()) {
      setMessage("Add the delivery address before sending the order.");
      return;
    }
    if (isDeliveryOrder && !selectedDeliveryZoneId) {
      setMessage("Choose a delivery zone before sending the order.");
      return;
    }
    if (isDeliveryOrder && isQuotingDelivery) {
      setMessage("Delivery quote is still being checked.");
      return;
    }
    if (isDeliveryOrder && (!deliveryQuote || !deliveryQuote.is_deliverable)) {
      setMessage(deliveryQuote?.reason || "Confirm a deliverable address before sending the order.");
      return;
    }

    setSaving(true);
    const orderType = selectedTable ? "dine-in" : orderMode;
    const notes = [
      formData.notes || "",
      formData.payment_method === "cash" && cashTenderedAmount > 0
        ? `Cash tendered Rs ${cashTenderedAmount}; change Rs ${cashChangeDue}`
        : "",
      isDeliveryOrder ? "Counter delivery order" : "",
      isDeliveryOrder ? "Fulfillment: delivery" : "",
    ]
      .filter(Boolean)
      .join(" | ");
    const response = await fetch(`${ORDERS_API}/`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_type: orderType,
        table_number: selectedTable,
        customer_name: formData.customer_name || null,
        customer_phone: formData.customer_phone || null,
        payment_method: formData.payment_method,
        discount_amount: discount,
        tip_amount: tip,
        delivery_address: isDeliveryOrder ? formData.delivery_address : null,
        delivery_zone_id: isDeliveryOrder ? selectedDeliveryZoneId : null,
        notes: notes || null,
        items: selectedItems.map((item) => ({
          menu_item_id: item.id,
          name: item.name,
          quantity: Number(item.quantity || 0),
          price: Number(item.unit_price || 0),
          base_price: Number(item.base_price || 0),
          customization_total: Number(item.customization_total || 0),
          selected_options: item.selected_options,
        })),
      }),
    });
    const data = await response.json();
    setSaving(false);

    if (!response.ok) {
      setMessage(data.detail || "Could not create order.");
      return;
    }

    const createdOrderId = Number(data.order_id || data.id);
    if (createdOrderId > 0) {
      setLastCreatedOrder({
        id: createdOrderId,
        isDelivery: isDeliveryOrder,
        paymentMethod: formData.payment_method,
        itemCount: selectedItemCount,
        total,
        status: "sent",
      });
    }
    setMessage(
      isDeliveryOrder
        ? `Delivery order #${data.order_id} sent to kitchen with ${data.delivery_zone || "delivery"} fee.`
        : `Order #${data.order_id} sent to kitchen.`
    );
    setShowOrderModal(false);
    await fetchData();
  };

  const closeOrder = async (order: Order) => {
    const blockers = closeBlockersForOrder(order);
    if (blockers.length) {
      setMessage(`Order #${order.id} cannot close yet: ${blockers.join(", ")}.`);
      return;
    }
    const paymentMethod = order.payment_method || "cash";
    const response = await fetch(
      `${ORDERS_API}/${order.id}/close?payment_method=${encodeURIComponent(paymentMethod)}`,
      { method: "PATCH", credentials: "include" }
    );
    const data = await response.json();
    const usageCount = Array.isArray(data.inventory_usage) ? data.inventory_usage.length : 0;
    setMessage(
      response.ok
        ? `Order #${order.id} closed${usageCount ? ` and ${usageCount} ingredients updated.` : "."}`
        : data.detail || "Could not close order."
    );
    if (response.ok) {
      setLastCreatedOrder((current) =>
        current?.id === order.id ? { ...current, status: "closed" } : current
      );
    }
    await fetchData();
  };

  const confirmCounterPayment = async (order: Order) => {
    const reference = (paymentReferenceDrafts[order.id] || "").trim();
    if (needsPaymentProof(order) && !reference) {
      setMessage(`Add payment reference before closing order #${order.id}.`);
      return;
    }

    const paymentMethod = normalizedPaymentMethod(order);
    setBusyPaymentAction(order.id);
    const response = await fetch(`${ORDERS_API}/${order.id}/payment-confirmation`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payment_provider: paymentProviderForMethod(paymentMethod),
        payment_reference: reference || `${paymentMethod.toUpperCase()}-${order.id}`,
        paid_amount: Number(order.total_amount || 0),
      }),
    });
    const data = await response.json();
    setBusyPaymentAction(null);

    if (!response.ok) {
      setMessage(data.detail || `Could not confirm payment for order #${order.id}.`);
      return;
    }

    setPaymentReferenceDrafts((current) => {
      const next = { ...current };
      delete next[order.id];
      return next;
    });
    setMessage(
      `Payment confirmed for order #${order.id}${data.payment_reference ? ` (${data.payment_reference})` : ""}.`
    );
    await fetchData();
  };

  const recordPickupNotification = (order: Order) => {
    const href = pickupNotificationHref(order);
    if (!href) return;

    const entry: PickupNotificationLog = {
      orderId: order.id,
      customerName: order.customer_name || "Counter pickup",
      customerPhone: order.customer_phone || "",
      total: Number(order.total_amount || 0),
      href,
      createdAt: new Date().toISOString(),
    };

    setPickupNotificationLog((current) => {
      const next = [
        entry,
        ...current.filter((item) => item.orderId !== order.id),
      ].slice(0, 6);
      window.localStorage.setItem(PICKUP_NOTIFICATION_LOG_KEY, JSON.stringify(next));
      return next;
    });
    setMessage(`Pickup notification prepared for order #${order.id}.`);
  };

  const closeLastCreatedOrder = async () => {
    if (!lastCreatedOrder || lastCreatedOrder.status === "closed") return;
    if (lastCreatedCloseBlockers.length) {
      setMessage(`Order #${lastCreatedOrder.id} cannot close yet: ${lastCreatedCloseBlockers.join(", ")}.`);
      return;
    }
    setPostOrderBusy(true);
    const response = await fetch(
      `${ORDERS_API}/${lastCreatedOrder.id}/close?payment_method=${encodeURIComponent(lastCreatedOrder.paymentMethod || "cash")}`,
      { method: "PATCH", credentials: "include" }
    );
    const data = await response.json();
    setPostOrderBusy(false);
    const usageCount = Array.isArray(data.inventory_usage) ? data.inventory_usage.length : 0;
    if (!response.ok) {
      setMessage(data.detail || "Could not close order.");
      return;
    }
    setLastCreatedOrder({ ...lastCreatedOrder, status: "closed" });
    setMessage(
      `Order #${lastCreatedOrder.id} closed and payment marked paid${usageCount ? ` with ${usageCount} ingredients updated.` : "."}`
    );
    await fetchData();
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

    const response = await fetch(`${ORDERS_API}/${order.id}/cancel`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() || "Cancelled from counter" }),
    });
    const data = await response.json();
    setMessage(
      response.ok
        ? data.refund_required
          ? `Order #${order.id} cancelled and marked refund due. No sales or inventory posted.`
          : `Order #${order.id} voided. No sales or inventory posted.`
        : data.detail || "Could not void order."
    );
    await fetchData();
  };

  const generateInvoice = async (order: Order) => {
    const params = new URLSearchParams();
    if (order.customer_name) params.set("customer_name", order.customer_name);
    const response = await fetch(`${ORDERS_API}/${order.id}/invoice?${params.toString()}`, {
      method: "POST",
      credentials: "include",
    });
    const data = await response.json();
    setMessage(
      response.ok
        ? `Invoice ${data.invoice_number} generated for order #${order.id}.`
        : data.detail || "Could not generate invoice."
    );
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

    setBusyDeliveryAction(`${order.id}-${status}`);
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
    setBusyDeliveryAction(null);

    if (!response.ok) {
      setMessage(data.detail || "Could not update delivery assignment.");
      return;
    }

    if (status === "delivered") {
      if (
        (order.payment_method || "").toLowerCase() === "prepaid" &&
        order.payment_status !== "paid"
      ) {
        setMessage(`Delivery for order #${order.id} is delivered. Confirm prepaid payment before closing.`);
        await fetchData();
        return;
      }
      if (needsPaymentProof(order)) {
        setMessage(`Delivery for order #${order.id} is delivered. Add payment proof before closing.`);
        await fetchData();
        return;
      }

      const paymentMethod = order.payment_method || "cash";
      const closeResponse = await fetch(
        `${ORDERS_API}/${order.id}/close?payment_method=${encodeURIComponent(paymentMethod)}`,
        { method: "PATCH", credentials: "include" }
      );
      const closeData = await closeResponse.json();
      if (!closeResponse.ok) {
        setMessage(closeData.detail || "Delivery delivered, but order could not be closed.");
        await fetchData();
        return;
      }
      const usageCount = Array.isArray(closeData.inventory_usage)
        ? closeData.inventory_usage.length
        : 0;
      setMessage(
        `Delivery for order #${order.id} delivered and order closed${usageCount ? ` with ${usageCount} ingredients updated.` : "."}`
      );
      await fetchData();
      return;
    }

    setMessage(`Delivery for order #${order.id} moved to ${status.replaceAll("_", " ")}.`);
    await fetchData();
  };

  return (
    <div className="p-8 bg-[#0a0a0b] min-h-screen text-white">
      <div className="flex flex-wrap justify-between gap-4 items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-orange-400 underline decoration-orange-500/20 underline-offset-8">
            Counter POS
          </h1>
          <p className="text-sm text-gray-500 mt-3">
            Open orders: {openOrders.length} | Closed today: Rs {Math.round(closedTotal).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            disabled={!isHydrated}
            onClick={fetchData}
            className="bg-white/5 text-white px-4 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-white/10 transition-all disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button
            data-testid="counter-express-walkin"
            disabled={!canStartExpressWalkIn}
            onClick={startExpressWalkIn}
            className="bg-emerald-500 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-emerald-600 transition-all shadow-lg active:scale-95 disabled:cursor-wait disabled:opacity-60"
          >
            <Zap className="w-5 h-5" /> {canStartExpressWalkIn ? "Express Walk-in" : "Loading Menu"}
          </button>
          <button
            data-testid="counter-new-takeaway"
            disabled={!isHydrated}
            onClick={() => openOrderModal()}
            className="bg-white text-black px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-orange-500 hover:text-white transition-all shadow-lg active:scale-95 disabled:cursor-wait disabled:opacity-60"
          >
            <Plus className="w-5 h-5" /> Takeaway
          </button>
          <button
            disabled={!isHydrated}
            onClick={() => openOrderModal(undefined, "delivery")}
            className="bg-orange-500 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-orange-600 transition-all shadow-lg active:scale-95 disabled:cursor-wait disabled:opacity-60"
          >
            <Truck className="w-5 h-5" /> Delivery
          </button>
        </div>
      </div>

      {message && (
        <div
          data-testid="counter-pos-message"
          className="mb-6 rounded-xl border border-orange-500/20 bg-orange-500/10 px-5 py-3 text-sm text-orange-100"
        >
          {message}
        </div>
      )}

      {lastCreatedOrder && (
        <section
          data-testid="counter-post-order-panel"
          className="mb-6 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-4"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-200/80">
                Last Order
              </p>
              <h2 className="mt-1 text-xl font-black text-white">
                Order #{lastCreatedOrder.id} {lastCreatedOrder.status === "closed" ? "closed" : "sent to kitchen"}
              </h2>
              <p className="mt-1 text-sm font-semibold text-emerald-50/80">
                {lastCreatedOrder.itemCount} item{lastCreatedOrder.itemCount === 1 ? "" : "s"} | Rs{" "}
                {Math.round(lastCreatedOrder.total).toLocaleString()} | {lastCreatedOrder.paymentMethod.toUpperCase()}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <Link
                data-testid="counter-post-order-kitchen-ticket"
                href={`/kitchen-ticket/${lastCreatedOrder.id}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-orange-400/30 bg-orange-500 px-4 py-3 text-sm font-black text-white hover:bg-orange-600"
              >
                <Utensils className="h-4 w-4" /> Kitchen
              </Link>
              <Link
                data-testid="counter-post-order-receipt"
                href={`/receipt/${lastCreatedOrder.id}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white px-4 py-3 text-sm font-black text-black hover:bg-emerald-50"
              >
                <ReceiptText className="h-4 w-4" /> Bill
              </Link>
              <button
                data-testid="counter-post-order-close"
                type="button"
                onClick={closeLastCreatedOrder}
                disabled={
                  lastCreatedOrder.isDelivery ||
                  lastCreatedOrder.status === "closed" ||
                  postOrderBusy ||
                  lastCreatedCloseBlockers.length > 0
                }
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-500 px-4 py-3 text-sm font-black text-white hover:bg-green-600 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-gray-500"
              >
                <CheckCircle2 className="h-4 w-4" />
                {lastCreatedOrder.status === "closed"
                  ? "Closed"
                  : postOrderBusy
                  ? "Closing"
                  : lastCreatedCloseBlockers.length
                  ? lastCreatedCloseBlockers.includes("payment proof required")
                    ? "Payment Proof"
                    : "Kitchen Pending"
                  : "Close & Paid"}
              </button>
              <button
                data-testid="counter-post-order-next-express"
                type="button"
                onClick={startExpressWalkIn}
                disabled={!canStartExpressWalkIn}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500 px-4 py-3 text-sm font-black text-white hover:bg-emerald-600 disabled:cursor-wait disabled:opacity-60"
              >
                <Zap className="h-4 w-4" /> Next Express
              </button>
            </div>
          </div>
          {lastCreatedOrder.isDelivery && (
            <p className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs font-semibold text-emerald-50/80">
              Delivery orders close from Delivery Handoff after rider completion.
            </p>
          )}
          {!lastCreatedOrder.isDelivery && lastCreatedCloseBlockers.length > 0 && (
            <p
              data-testid="counter-post-order-close-blockers"
              className="mt-3 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100"
            >
              Close blocked until {lastCreatedCloseBlockers.join(", ")}.
            </p>
          )}
          {lastCreatedOrderRow && needsPaymentProof(lastCreatedOrderRow) && (
            <div
              data-testid="counter-post-order-payment-proof"
              className="mt-3 rounded-lg border border-sky-400/20 bg-sky-500/10 p-3"
            >
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-sky-200">
                <CreditCard className="h-4 w-4" /> Payment proof
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  data-testid="counter-post-order-payment-reference"
                  value={paymentReferenceDrafts[lastCreatedOrderRow.id] ?? ""}
                  onChange={(event) =>
                    setPaymentReferenceDrafts((current) => ({
                      ...current,
                      [lastCreatedOrderRow.id]: event.target.value,
                    }))
                  }
                  placeholder={paymentReferencePlaceholder(lastCreatedOrderRow)}
                  className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm font-semibold text-white outline-none placeholder:text-gray-500 focus:border-sky-300"
                />
                <button
                  data-testid="counter-post-order-confirm-payment"
                  type="button"
                  onClick={() => confirmCounterPayment(lastCreatedOrderRow)}
                  disabled={
                    busyPaymentAction === lastCreatedOrderRow.id ||
                    !(paymentReferenceDrafts[lastCreatedOrderRow.id] || "").trim()
                  }
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-black text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-gray-500"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {busyPaymentAction === lastCreatedOrderRow.id ? "Saving" : "Confirm Payment"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <section
        data-testid="counter-order-e2e-command"
        className="mb-6 rounded-xl border border-white/5 bg-[#1a1a1c] p-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Counter Ready
            </p>
            <h2 className="text-lg font-black text-white">
              Take order, print bill, send to kitchen
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
            <div className="rounded-lg bg-black/30 px-4 py-2">
              <p className="text-lg font-black">{openOrders.length}</p>
              <p className="text-[10px] font-bold uppercase text-gray-500">Open</p>
            </div>
            <div className="rounded-lg bg-black/30 px-4 py-2">
              <p className="text-lg font-black">{deliveryOrders.length}</p>
              <p className="text-[10px] font-bold uppercase text-gray-500">Delivery</p>
            </div>
            <div className="rounded-lg bg-black/30 px-4 py-2">
              <p className="text-lg font-black">{readyToBillCount}</p>
              <p className="text-[10px] font-bold uppercase text-gray-500">Ready</p>
            </div>
            <div className="rounded-lg bg-black/30 px-4 py-2">
              <p className="text-lg font-black">{paymentDueCount}</p>
              <p className="text-[10px] font-bold uppercase text-gray-500">Payment</p>
            </div>
            <div className="rounded-lg bg-black/30 px-4 py-2">
              <p className="text-lg font-black">Rs {Math.round(closedTotal).toLocaleString()}</p>
              <p className="text-[10px] font-bold uppercase text-gray-500">Closed</p>
            </div>
          </div>
        </div>
        <div
          data-testid="counter-operator-board"
          className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4"
        >
          <button
            data-testid="counter-command-express-walkin"
            aria-label="Express Walk-in"
            disabled={!canStartExpressWalkIn}
            onClick={startExpressWalkIn}
            className="rounded-xl border border-emerald-400/30 bg-emerald-500 px-4 py-4 text-left text-white shadow-lg transition hover:bg-emerald-600 disabled:cursor-wait disabled:opacity-60"
          >
            <span className="flex items-center gap-2 text-sm font-black">
              <Zap className="h-4 w-4" /> Express Walk-in
            </span>
            <span className="mt-2 block text-xs font-bold opacity-85">
              Loads cash, takeaway, and a popular item.
            </span>
          </button>
          <button
            data-testid="counter-command-takeaway"
            disabled={!isHydrated}
            onClick={() => openOrderModal(undefined, "takeaway")}
            className="rounded-xl border border-white/10 bg-white px-4 py-4 text-left text-black shadow-lg transition hover:bg-orange-500 hover:text-white disabled:cursor-wait disabled:opacity-60"
          >
            <span className="flex items-center gap-2 text-sm font-black">
              <ShoppingBag className="h-4 w-4" /> New Takeaway
            </span>
            <span className="mt-2 block text-xs font-bold opacity-70">
              Pickup and counter orders in one drawer.
            </span>
          </button>
          <button
            data-testid="counter-command-delivery"
            disabled={!isHydrated}
            onClick={() => openOrderModal(undefined, "delivery")}
            className="rounded-xl border border-orange-400/30 bg-orange-500 px-4 py-4 text-left text-white shadow-lg transition hover:bg-orange-600 disabled:cursor-wait disabled:opacity-60"
          >
            <span className="flex items-center gap-2 text-sm font-black">
              <Truck className="h-4 w-4" /> New Delivery
            </span>
            <span className="mt-2 block text-xs font-bold opacity-80">
              Quote fee, ETA, and send to kitchen.
            </span>
          </button>
          <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Takeaway Queue
            </p>
            <p className="mt-2 text-2xl font-black">{takeawayOrders.length}</p>
            <p className="mt-1 text-xs font-semibold text-gray-500">
              Ready bills: {readyToBillCount}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
              Safety
            </p>
            <p className="mt-2 text-2xl font-black">{voidedTodayCount}</p>
            <p className="mt-1 text-xs font-semibold text-gray-500">
              Voided today, excluded from sales.
            </p>
          </div>
          <div
            data-testid="counter-tips-today"
            className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-4"
          >
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-200/80">
              Tips Today
            </p>
            <p className="mt-2 text-2xl font-black text-emerald-100">
              Rs {Math.round(tipsToday).toLocaleString()}
            </p>
            <p className="mt-1 text-xs font-semibold text-emerald-200/70">
              Captured at the counter and online.
            </p>
          </div>
        </div>
      </section>

      <section
        data-testid="counter-ready-handoff-panel"
        className="mb-6 rounded-xl border border-green-400/20 bg-green-500/10 p-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-green-200/80">
              Ready To Bill
            </p>
            <h2 className="text-lg font-black text-white">
              Kitchen-ready orders waiting at counter
            </h2>
          </div>
          <span className="rounded-lg bg-green-500 px-3 py-2 text-sm font-black text-white">
            {readyCounterOrders.length} ready
          </span>
        </div>

        {readyCounterOrders.length > 0 ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {readyCounterOrders.slice(0, 8).map((order) => {
              const blockers = closeBlockersForOrder(order);
              const proofRequired = needsPaymentProof(order);
              return (
                <article
                  key={`ready-counter-${order.id}`}
                  data-testid={`counter-ready-order-${order.id}`}
                  className="rounded-xl border border-white/10 bg-black/25 p-4"
                >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xl font-black">Order #{order.id}</p>
                    <p className="mt-1 text-xs font-semibold text-gray-400">
                      {order.table_number ? `Table ${order.table_number}` : order.customer_name || "Counter pickup"}
                    </p>
                  </div>
                  <span className="rounded-md bg-green-500/15 px-3 py-1 text-xs font-black uppercase text-green-200">
                    Ready
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-gray-400">
                  <span>{order.items.length} item types</span>
                  <span>Rs {Math.round(order.total_amount || 0).toLocaleString()}</span>
                  <span>{(order.payment_method || "cash").toUpperCase()}</span>
                  {order.payment_reference && <span>Ref {order.payment_reference}</span>}
                </div>
                {proofRequired && (
                  <div
                    data-testid={`counter-ready-payment-proof-${order.id}`}
                    className="mt-4 rounded-lg border border-sky-400/20 bg-sky-500/10 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-sky-200">
                        <CreditCard className="h-4 w-4" /> Collect payment proof
                      </p>
                      <span className="text-xs font-black text-sky-100">
                        Rs {Math.round(order.total_amount || 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                      <input
                        data-testid={`counter-ready-payment-reference-${order.id}`}
                        value={paymentReferenceDrafts[order.id] ?? ""}
                        onChange={(event) =>
                          setPaymentReferenceDrafts((current) => ({
                            ...current,
                            [order.id]: event.target.value,
                          }))
                        }
                        placeholder={paymentReferencePlaceholder(order)}
                        className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm font-semibold text-white outline-none placeholder:text-gray-500 focus:border-sky-300"
                      />
                      <button
                        data-testid={`counter-ready-confirm-payment-${order.id}`}
                        type="button"
                        onClick={() => confirmCounterPayment(order)}
                        disabled={
                          busyPaymentAction === order.id ||
                          !(paymentReferenceDrafts[order.id] || "").trim()
                        }
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-black text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-gray-500"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {busyPaymentAction === order.id ? "Saving" : "Confirm Payment"}
                      </button>
                    </div>
                  </div>
                )}
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Link
                    data-testid={`counter-ready-kitchen-${order.id}`}
                    href={`/kitchen-ticket/${order.id}`}
                    className="flex items-center justify-center gap-2 rounded-lg bg-orange-500/15 py-2 text-xs font-bold text-orange-200 hover:bg-orange-500/25"
                  >
                    <Utensils className="h-4 w-4" /> Kitchen
                  </Link>
                  <Link
                    data-testid={`counter-ready-bill-${order.id}`}
                    href={`/receipt/${order.id}`}
                    className="flex items-center justify-center gap-2 rounded-lg bg-white/5 py-2 text-xs font-bold text-gray-200 hover:bg-white/10"
                  >
                    <ReceiptText className="h-4 w-4" /> Bill
                  </Link>
                  {pickupNotificationHref(order) ? (
                    <a
                      data-testid={`counter-ready-notify-${order.id}`}
                      href={pickupNotificationHref(order)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => recordPickupNotification(order)}
                      className="flex items-center justify-center gap-2 rounded-lg bg-sky-500/15 py-2 text-xs font-bold text-sky-200 hover:bg-sky-500/25"
                    >
                      <MessageCircle className="h-4 w-4" /> Notify
                    </a>
                  ) : (
                    <span
                      data-testid={`counter-ready-notify-missing-${order.id}`}
                      className="flex items-center justify-center gap-2 rounded-lg bg-white/5 py-2 text-xs font-bold text-gray-500"
                    >
                      <MessageCircle className="h-4 w-4" /> No Phone
                    </span>
                  )}
                  <button
                    data-testid={`counter-ready-close-${order.id}`}
                    type="button"
                    onClick={() => closeOrder(order)}
                    disabled={blockers.length > 0}
                    className="flex items-center justify-center gap-2 rounded-lg bg-green-500 px-3 py-2 text-xs font-black text-white hover:bg-green-600 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-gray-500"
                  >
                    <CheckCircle2 className="h-4 w-4" /> Close
                  </button>
                </div>
                {blockers.length > 0 && (
                  <p
                    data-testid={`counter-ready-close-blockers-${order.id}`}
                    className="mt-3 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100"
                  >
                    Close blocked until {blockers.join(", ")}.
                  </p>
                )}
              </article>
              );
            })}
          </div>
        ) : (
          <div
            data-testid="counter-ready-handoff-empty"
            className="mt-4 rounded-xl border border-dashed border-white/10 p-5 text-center text-sm font-semibold text-gray-400"
          >
            No kitchen-ready counter orders yet.
          </div>
        )}
      </section>

      <section
        data-testid="counter-notification-log-panel"
        className="mb-6 rounded-xl border border-sky-400/20 bg-sky-500/10 p-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-sky-200/80">
              Pickup Messages
            </p>
            <h2 className="text-lg font-black text-white">
              Recent ready notifications
            </h2>
          </div>
          <span className="rounded-lg bg-sky-500 px-3 py-2 text-sm font-black text-white">
            {pickupNotificationLog.length} prepared
          </span>
        </div>

        {pickupNotificationLog.length > 0 ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {pickupNotificationLog.slice(0, 4).map((entry) => (
              <article
                key={`${entry.orderId}-${entry.createdAt}`}
                data-testid={`counter-notification-log-entry-${entry.orderId}`}
                className="rounded-xl border border-white/10 bg-black/25 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-black text-white">
                      Order #{entry.orderId}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-gray-400">
                      {entry.customerName} · {entry.customerPhone || "No phone"}
                    </p>
                  </div>
                  <span className="rounded-md bg-sky-500/15 px-3 py-1 text-xs font-black uppercase text-sky-200">
                    WhatsApp
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-gray-400">
                  <span>Ready message</span>
                  <span>Rs {Math.round(entry.total || 0).toLocaleString()}</span>
                  <span>{notificationTime(entry.createdAt)}</span>
                </div>
                <a
                  data-testid={`counter-notification-log-open-${entry.orderId}`}
                  href={entry.href}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-sky-500/15 px-3 py-2 text-xs font-bold text-sky-200 hover:bg-sky-500/25"
                >
                  <MessageCircle className="h-4 w-4" /> Open message
                </a>
              </article>
            ))}
          </div>
        ) : (
          <div
            data-testid="counter-notification-log-empty"
            className="mt-4 rounded-xl border border-dashed border-white/10 p-5 text-center text-sm font-semibold text-gray-400"
          >
            No pickup notifications prepared yet.
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        <section className="xl:col-span-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {tables.map((table) => (
              <button
                key={table.id}
                onClick={() => openOrderModal(table)}
                className={`text-left group relative p-6 rounded-xl border transition-all duration-300 ${
                  table.status === "occupied"
                    ? "bg-orange-500/10 border-orange-500/30"
                    : "bg-[#1a1a1c] border-white/5 hover:border-orange-500/30 hover:bg-[#1e1e21]"
                }`}
              >
                <div className="flex justify-between items-start mb-5">
                  <span className={`text-4xl font-black ${table.status === "occupied" ? "text-orange-500" : "text-gray-700"}`}>
                    {table.table_number}
                  </span>
                  <div className={`p-2 rounded-xl ${table.status === "occupied" ? "bg-orange-500/20" : "bg-white/5"}`}>
                    <Utensils className={`w-5 h-5 ${table.status === "occupied" ? "text-orange-500" : "text-gray-500"}`} />
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs font-bold text-gray-500 tracking-widest uppercase">
                  <Users className="w-4 h-4" /> {table.capacity} Seater
                </div>

                <div className={`mt-4 flex items-center gap-1.5 text-[10px] font-black uppercase ${table.status === "occupied" ? "text-orange-400" : "text-green-500"}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${table.status === "occupied" ? "bg-orange-500 animate-pulse" : "bg-green-500"}`} />
                  {table.status}
                </div>
              </button>
            ))}
          </div>
        </section>

        <aside className="space-y-4 xl:col-span-4">
          <section className="rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <Truck className="h-5 w-5 text-orange-400" /> Delivery Handoff
              </h2>
              <span className="text-xs font-bold text-gray-500">
                {unassignedDeliveryCount} unassigned
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/5 bg-black/25 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Active</p>
                <p className="mt-2 text-2xl font-black">{deliveryOrders.length}</p>
              </div>
              <div className="rounded-xl border border-white/5 bg-black/25 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Need Rider</p>
                <p className="mt-2 text-2xl font-black text-orange-400">{unassignedDeliveryCount}</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {deliveryOrders.slice(0, 3).map((order) => {
                const assignment = order.delivery_assignment;
                const deliveryStatus = assignment?.status?.replaceAll("_", " ") || "unassigned";
                return (
                  <div key={`delivery-${order.id}`} className="rounded-xl border border-white/5 bg-black/25 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black">Order #{order.id}</p>
                        <p className="mt-1 line-clamp-2 text-xs font-semibold text-gray-500">
                          {order.delivery_address || "Address pending"}
                        </p>
                        <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-gray-600">
                          {order.delivery_zone || "Zone pending"} | {order.eta_window || "ETA pending"}
                        </p>
                      </div>
                      <span className="rounded-full bg-orange-500/10 px-3 py-1 text-[10px] font-black uppercase text-orange-300">
                        {deliveryStatus}
                      </span>
                    </div>
                    {assignment?.notes && (
                      <p className="mt-3 rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-xs font-semibold text-gray-400">
                        {assignment.notes}
                      </p>
                    )}
                    <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                      <input
                        value={assignmentDrafts[order.id] ?? assignment?.assigned_to ?? ""}
                        onChange={(event) =>
                          setAssignmentDrafts((current) => ({
                            ...current,
                            [order.id]: event.target.value,
                          }))
                        }
                        placeholder="Rider name"
                        className="min-w-0 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm font-semibold outline-none focus:border-orange-500"
                      />
                      <button
                        onClick={() => updateDeliveryAssignment(order, "assigned")}
                        disabled={busyDeliveryAction === `${order.id}-assigned`}
                        className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-black text-white hover:bg-orange-600 disabled:opacity-50"
                      >
                        Assign
                      </button>
                    </div>
                    <input
                      value={assignmentNoteDrafts[order.id] ?? assignment?.notes ?? ""}
                      onChange={(event) =>
                        setAssignmentNoteDrafts((current) => ({
                          ...current,
                          [order.id]: event.target.value,
                        }))
                      }
                      placeholder="Delivery note / failure reason"
                      className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm font-semibold outline-none focus:border-orange-500"
                    />
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <button
                        onClick={() => updateDeliveryAssignment(order, "out_for_delivery")}
                        disabled={busyDeliveryAction === `${order.id}-out_for_delivery`}
                        className="flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 py-2 text-xs font-bold text-gray-200 hover:bg-white/10 disabled:opacity-50"
                      >
                        <Send className="h-3.5 w-3.5" /> Dispatch
                      </button>
                      <button
                        onClick={() => updateDeliveryAssignment(order, "delivered")}
                        disabled={busyDeliveryAction === `${order.id}-delivered`}
                        className="flex items-center justify-center gap-2 rounded-lg bg-green-500/15 py-2 text-xs font-bold text-green-300 hover:bg-green-500/25 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                      </button>
                      <button
                        onClick={() => updateDeliveryAssignment(order, "failed")}
                        disabled={busyDeliveryAction === `${order.id}-failed`}
                        className="flex items-center justify-center gap-2 rounded-lg bg-red-500/15 py-2 text-xs font-bold text-red-300 hover:bg-red-500/25 disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" /> Failed
                      </button>
                    </div>
                  </div>
                );
              })}
              {!deliveryOrders.length && (
                <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-sm font-semibold text-gray-500">
                  No active delivery orders.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-white/5 bg-[#1a1a1c] p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <Clock className="h-5 w-5 text-orange-400" /> Today Orders
              </h2>
              <span className="text-xs font-bold text-gray-500">{orders.length} total</span>
            </div>
            <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
              {orders.map((order) => {
                const blockers = closeBlockersForOrder(order);
                return (
                  <div
                    key={order.id}
                    data-testid={`counter-order-card-${order.id}`}
                    className="rounded-xl border border-white/5 bg-black/25 p-4"
                  >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black">Order #{order.id}</p>
                      <p className="text-xs text-gray-500">
                        {order.table_number
                          ? `Table ${order.table_number}`
                          : order.fulfillment_type || order.order_type || "Takeaway"}
                        {order.customer_name ? ` | ${order.customer_name}` : ""}
                      </p>
                    </div>
                    <span
                      data-testid={`counter-order-status-${order.id}`}
                      className={`text-[10px] font-black uppercase ${
                        order.status === "closed"
                          ? "text-green-400"
                          : order.status === "cancelled"
                          ? "text-red-300"
                          : "text-orange-400"
                      }`}
                    >
                      {order.status}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-sm text-gray-400">{order.items.length} item types</span>
                    <span className="font-black">Rs {Math.round(order.total_amount || 0).toLocaleString()}</span>
                  </div>
                  {order.items.some((item) => item.selected_options?.length) && (
                    <div className="mt-2 space-y-1 rounded-lg border border-white/5 bg-black/20 px-3 py-2">
                      {order.items
                        .filter((item) => item.selected_options?.length)
                        .slice(0, 2)
                        .map((item, index) => (
                          <p
                            key={`${order.id}-${item.name}-${index}`}
                            className="text-xs font-semibold leading-5 text-orange-100/80"
                          >
                            {item.quantity}x {item.name}: {item.selected_options?.map(optionSummary).join(" | ")}
                          </p>
                        ))}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {order.source === "customer_website" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-3 py-1 text-xs font-black text-orange-300">
                        <Globe2 className="h-3 w-3" /> Online
                      </span>
                    )}
                    {order.eta_window && !order.scheduled_label && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-3 py-1 text-xs font-bold text-gray-400">
                        <Clock className="h-3 w-3" /> {order.eta_window}
                      </span>
                    )}
                    {order.delivery_assignment?.assigned_to && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-3 py-1 text-xs font-black text-green-300">
                        <Truck className="h-3 w-3" /> {order.delivery_assignment.assigned_to}
                      </span>
                    )}
                    {order.scheduled_label && (
                      <span
                        data-testid={`counter-order-scheduled-${order.id}`}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-black text-amber-300"
                      >
                        <CalendarClock className="h-3 w-3" /> Scheduled · {order.scheduled_label}
                      </span>
                    )}
                    {Number(order.tip_amount || 0) > 0 && (
                      <span
                        data-testid={`counter-order-tip-${order.id}`}
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-black text-emerald-300"
                      >
                        <Coins className="h-3 w-3" /> Tip Rs {Math.round(Number(order.tip_amount))}
                      </span>
                    )}
                    {order.payment_due && (
                      <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-black text-amber-300">
                        Payment due
                      </span>
                    )}
                    {needsPaymentProof(order) && (
                      <span className="rounded-full bg-sky-500/10 px-3 py-1 text-xs font-black text-sky-300">
                        Proof needed
                      </span>
                    )}
                  </div>
                  {order.delivery_address && (
                    <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-gray-500">
                      <MapPin className="h-3 w-3 text-orange-400" />
                      {order.delivery_address}
                    </p>
                  )}
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Link
                      data-testid={`counter-kitchen-ticket-${order.id}`}
                      href={`/kitchen-ticket/${order.id}`}
                      className="flex items-center justify-center gap-2 rounded-lg bg-orange-500/15 py-2 text-xs font-bold text-orange-200 hover:bg-orange-500/25"
                    >
                      <Utensils className="h-4 w-4" /> Kitchen
                    </Link>
                    <Link
                      data-testid={`counter-bill-${order.id}`}
                      href={`/receipt/${order.id}`}
                      className="flex items-center justify-center gap-2 rounded-lg bg-white/5 py-2 text-xs font-bold text-gray-200 hover:bg-white/10"
                    >
                      <ReceiptText className="h-4 w-4" /> Bill
                    </Link>
                    <button
                      onClick={() => generateInvoice(order)}
                      className="col-span-2 flex items-center justify-center gap-2 rounded-lg bg-white/5 py-2 text-xs font-bold text-gray-200 hover:bg-white/10"
                    >
                      <FileText className="h-4 w-4" /> Invoice
                    </button>
                    <button
                      data-testid={`counter-close-${order.id}`}
                      onClick={() => closeOrder(order)}
                      disabled={["closed", "cancelled"].includes(order.status) || blockers.length > 0}
                      className="col-span-2 flex items-center justify-center gap-2 rounded-lg bg-green-500/15 py-2 text-xs font-bold text-green-300 hover:bg-green-500/25 disabled:opacity-40"
                    >
                      <CheckCircle2 className="h-4 w-4" /> {blockers.length ? "Close Blocked" : "Close"}
                    </button>
                    <button
                      data-testid={`counter-void-${order.id}`}
                      onClick={() => cancelOrder(order)}
                      disabled={["closed", "cancelled"].includes(order.status)}
                      className="col-span-2 flex items-center justify-center gap-2 rounded-lg bg-red-500/15 py-2 text-xs font-bold text-red-300 hover:bg-red-500/25 disabled:opacity-40"
                    >
                      <X className="h-4 w-4" /> Void Order
                    </button>
                  </div>
                  {!!blockers.length && !["closed", "cancelled"].includes(order.status) && (
                    <p
                      data-testid={`counter-close-blockers-${order.id}`}
                      className="mt-3 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100"
                    >
                      Close blocked until {blockers.join(", ")}.
                    </p>
                  )}
                </div>
                );
              })}
              {!orders.length && (
                <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-gray-500">
                  No orders yet today.
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>

      {showOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-6xl h-full bg-[#1a1a1c] border-l border-white/10 p-6 flex flex-col shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold flex items-center gap-2 text-orange-400">
                <ShoppingBag className="w-6 h-6" />
                {selectedTable ? `Table ${selectedTable}` : isDeliveryOrder ? "Delivery" : "Takeaway"} Order
              </h2>
              <button onClick={() => setShowOrderModal(false)} className="p-2 hover:bg-white/5 rounded-xl">
                <X />
              </button>
            </div>

            <section
              data-testid="counter-mode-switch"
              className="mb-5 grid grid-cols-2 gap-3 rounded-xl border border-white/10 bg-black/30 p-2"
            >
              <button
                data-testid="counter-mode-takeaway"
                type="button"
                onClick={() => {
                  setSelectedTable(null);
                  setOrderMode("takeaway");
                  setDeliveryQuote(null);
                }}
                className={`flex min-h-16 items-center justify-between rounded-lg px-4 text-left transition ${
                  !isDeliveryOrder
                    ? "bg-white text-black"
                    : "bg-white/5 text-gray-300 hover:bg-white/10"
                }`}
              >
                <span>
                  <span className="block text-sm font-black">Takeaway / Pickup</span>
                  <span className="mt-1 block text-xs font-bold opacity-70">
                    Fast counter sale
                  </span>
                </span>
                <ShoppingBag className="h-5 w-5" />
              </button>
              <button
                data-testid="counter-mode-delivery"
                type="button"
                onClick={() => {
                  setSelectedTable(null);
                  setOrderMode("delivery");
                }}
                className={`flex min-h-16 items-center justify-between rounded-lg px-4 text-left transition ${
                  isDeliveryOrder
                    ? "bg-orange-500 text-white"
                    : "bg-white/5 text-gray-300 hover:bg-white/10"
                }`}
              >
                <span>
                  <span className="block text-sm font-black">Delivery</span>
                  <span className="mt-1 block text-xs font-bold opacity-80">
                    Address, fee, ETA
                  </span>
                </span>
                <Truck className="h-5 w-5" />
              </button>
            </section>

            <section
              data-testid="counter-speed-bar"
              className="mb-5 rounded-xl border border-white/10 bg-black/30 p-4"
            >
              <div data-testid="counter-touch-lane" className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {counterStepCards.map((step) => (
                    <CounterStepCard key={step.label} {...step} />
                  ))}
                </div>
                <div className="rounded-lg border border-orange-400/20 bg-orange-500/10 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-orange-200/80">
                    Next Touch
                  </p>
                  <p data-testid="counter-next-action" className="mt-1 text-sm font-black text-white">
                    {nextCounterAction}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setFormData({ ...formData, customer_name: "", customer_phone: "" });
                      setMessage("Walk-in customer selected.");
                    }}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-black uppercase text-gray-200 hover:bg-white/10"
                  >
                    Walk-in
                  </button>
                  <button
                    data-testid="counter-exact-cash"
                    type="button"
                    disabled={!roundedTotal}
                    onClick={() => {
                      setFormData({ ...formData, payment_method: "cash" });
                      setCashTendered(roundedTotal);
                      setMessage("Exact cash selected.");
                    }}
                    className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-black uppercase text-emerald-200 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Exact Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFormData({ ...formData, discount_amount: 0 });
                      setMessage("Discount cleared.");
                    }}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-black uppercase text-gray-200 hover:bg-white/10"
                  >
                    No Discount
                  </button>
                  <button
                    type="button"
                    onClick={resetOrderForm}
                    className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs font-black uppercase text-red-200 hover:bg-red-500/20"
                  >
                    Clear Bill
                  </button>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-black uppercase text-gray-500">
                    Quick Add
                  </p>
                  <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase ${canSendOrder ? "bg-green-500/15 text-green-300" : "bg-orange-500/15 text-orange-300"}`}>
                    {canSendOrder ? "Ready to send" : `Waiting: ${sendBlockReason}`}
                  </span>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {quickMenuItems.map((item) => (
                    <button
                      key={`quick-${item.id}`}
                      data-testid={`counter-quick-add-${item.id}`}
                      type="button"
                      onClick={() => updateQuantity(item.id, Number(item.quantity || 0) + 1)}
                      className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left hover:border-orange-400/60 hover:bg-orange-500/10"
                    >
                      <p className="max-w-36 truncate text-xs font-black text-white">{item.name}</p>
                      <p className="mt-1 text-[10px] font-bold text-gray-500">
                        Rs {Math.round(configuredPriceForItem(item)).toLocaleString()}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-black uppercase text-gray-500">
                    Preset Builds
                  </p>
                  <span className="rounded-md bg-white/5 px-2 py-1 text-[10px] font-black uppercase text-gray-400">
                    {quickBuilds.length} ready
                  </span>
                </div>
                <div
                  data-testid="counter-quick-builds"
                  className="grid gap-2 md:grid-cols-3"
                >
                  {quickBuilds.map((build) => (
                    <button
                      key={build.id}
                      data-testid={`counter-quick-build-${build.id}`}
                      type="button"
                      onClick={() => applyQuickBuild(build)}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-left hover:border-orange-400/60 hover:bg-orange-500/10"
                    >
                      <span className="block text-xs font-black text-white">
                        {build.name}
                      </span>
                      <span className="mt-1 block text-[11px] font-semibold text-gray-500">
                        {build.item.name} | Rs {Math.round(build.unit_price).toLocaleString()}
                      </span>
                      <span className="mt-2 flex flex-wrap gap-1">
                        {build.tags.slice(0, 2).map((tag) => (
                          <span
                            key={`${build.id}-${tag}`}
                            className="rounded bg-black/30 px-2 py-1 text-[10px] font-black uppercase text-orange-200"
                          >
                            {tag}
                          </span>
                        ))}
                        <span className="rounded bg-black/30 px-2 py-1 text-[10px] font-black uppercase text-gray-300">
                          {build.option_count} options
                        </span>
                      </span>
                    </button>
                  ))}
                  {!quickBuilds.length && (
                    <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-sm font-semibold text-gray-500 md:col-span-3">
                      Preset builds are loading.
                    </div>
                  )}
                </div>
              </div>
            </section>

            <div className="grid grid-cols-2 gap-3 mb-5">
              <input
                type="text"
                placeholder="Customer name"
                value={formData.customer_name}
                onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                className="bg-black/30 border border-white/10 p-3 rounded-xl outline-none focus:border-orange-500"
              />
              <input
                type="tel"
                placeholder="Customer phone"
                value={formData.customer_phone}
                onChange={(e) => setFormData({ ...formData, customer_phone: e.target.value })}
                className="bg-black/30 border border-white/10 p-3 rounded-xl outline-none focus:border-orange-500"
              />
              <input
                type="text"
                placeholder="Order note"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="bg-black/30 border border-white/10 p-3 rounded-xl outline-none focus:border-orange-500"
              />
              <input
                type="number"
                min="0"
                placeholder="Discount"
                value={formData.discount_amount}
                onChange={(e) => setFormData({ ...formData, discount_amount: Number(e.target.value) || 0 })}
                className="bg-black/30 border border-white/10 p-3 rounded-xl outline-none focus:border-orange-500"
              />
            </div>

            {isDeliveryOrder && (
              <div className="mb-5 rounded-xl border border-orange-500/20 bg-orange-500/10 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-black text-orange-200">
                    <Truck className="h-4 w-4" />
                    Delivery Details
                  </div>
                  <span className="text-xs font-bold text-orange-200/80">
                    {isQuotingDelivery
                      ? "Checking"
                      : deliveryQuote?.is_deliverable
                      ? `${deliveryQuote.zone?.name || "Delivery"} | ${deliveryQuote.eta_window}`
                      : "Quote pending"}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px]">
                  <input
                    type="text"
                    placeholder="House/building and area"
                    value={formData.delivery_address}
                    onChange={(e) =>
                      setFormData({ ...formData, delivery_address: e.target.value })
                    }
                    className="bg-black/30 border border-white/10 p-3 rounded-xl outline-none focus:border-orange-500"
                  />
                  <select
                    value={selectedDeliveryZoneId || ""}
                    onChange={(e) => setSelectedDeliveryZoneId(Number(e.target.value) || null)}
                    className="bg-black/30 border border-white/10 p-3 rounded-xl outline-none focus:border-orange-500"
                  >
                    {deliveryZones.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.name} | Rs {zone.delivery_fee} | {zone.eta_window}
                      </option>
                    ))}
                  </select>
                </div>
                <div
                  className={`mt-3 rounded-lg border px-3 py-2 text-sm font-semibold ${
                    deliveryQuote?.is_deliverable
                      ? "border-green-500/20 bg-green-500/10 text-green-200"
                      : "border-white/10 bg-black/20 text-gray-400"
                  }`}
                >
                  {isQuotingDelivery
                    ? "Checking delivery charge and ETA..."
                    : deliveryQuote?.is_deliverable
                    ? `Delivery fee Rs ${Math.round(deliveryFee).toLocaleString()}, ETA ${deliveryQuote.eta_window}.`
                    : deliveryQuote?.reason || "Enter address and choose zone to calculate delivery."}
                </div>
                {deliveryQuote?.address_validation && (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                      <p className="font-black uppercase text-gray-500">Score</p>
                      <p className="mt-1 font-black text-white">
                        {deliveryQuote.address_validation.score}/100
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                      <p className="font-black uppercase text-gray-500">Match</p>
                      <p className="mt-1 font-black text-white">
                        {deliveryQuote.address_validation.matched_keyword || "Manual zone"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                      <p className="font-black uppercase text-gray-500">Total</p>
                      <p className="mt-1 font-black text-white">
                        Rs {Math.round(deliveryQuote.charge_breakdown?.total_with_delivery || total).toLocaleString()}
                      </p>
                    </div>
                  </div>
                )}
                {!!deliveryQuote?.address_validation?.warnings?.length && (
                  <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100">
                    {deliveryQuote.address_validation.warnings.join(" ")}
                  </div>
                )}
              </div>
            )}

            <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1.45fr)_360px]">
              <section className="flex min-h-0 flex-col">
            <div className="mb-4 space-y-3">
              <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-3">
                <Search className="h-4 w-4 text-gray-500" />
                <input
                  value={menuSearch}
                  onChange={(event) => setMenuSearch(event.target.value)}
                  placeholder="Search pizza, sides, drinks"
                  className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-gray-600"
                />
              </label>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {menuCategories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setActiveCategory(category)}
                    className={`shrink-0 rounded-full border px-4 py-2 text-xs font-black ${
                      activeCategory === category
                        ? "border-orange-400 bg-orange-500 text-white"
                        : "border-white/10 bg-black/25 text-gray-300"
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-2">
              {filteredMenuItems.map((item) => {
                const unitPrice = configuredPriceForItem(item);
                const selectedOptions = selectedOptionsForItem(item);
                const quantity = Number(item.quantity || 0);
                return (
                  <div
                    key={item.id}
                    data-testid={`counter-menu-item-${item.id}`}
                    className={`rounded-xl border p-4 transition-all ${
                      quantity > 0
                        ? "border-orange-400/40 bg-orange-500/10"
                        : "border-white/5 bg-white/5 hover:border-white/10"
                    }`}
                  >
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <p className="font-bold">{item.name}</p>
                        <p className="text-xs text-gray-500">
                          {item.category} | Rs {Math.round(unitPrice).toLocaleString()}
                          {unitPrice !== Number(item.selling_price || 0)
                            ? ` (base Rs ${Number(item.selling_price || 0).toLocaleString()})`
                            : ""}
                        </p>
                        {!!selectedOptions.length && (
                          <p className="mt-1 max-w-xl text-xs font-semibold text-orange-100/80">
                            {selectedOptions.map(optionSummary).join(" | ")}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-black/40 p-1">
                        <button
                          type="button"
                          aria-label={`Remove ${item.name}`}
                          onClick={() => updateQuantity(item.id, quantity - 1)}
                          className="grid h-9 w-9 place-items-center rounded-lg bg-white/5 text-gray-200 hover:bg-white/10"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <input
                          data-testid={`counter-item-quantity-${item.id}`}
                          type="number"
                          min="0"
                          value={quantity}
                          onChange={(e) => updateQuantity(item.id, parseInt(e.target.value, 10) || 0)}
                          className="h-9 w-12 bg-transparent text-center font-black outline-none"
                        />
                        <button
                          type="button"
                          aria-label={`Add ${item.name}`}
                          onClick={() => updateQuantity(item.id, quantity + 1)}
                          className="grid h-9 w-9 place-items-center rounded-lg bg-orange-500 text-white hover:bg-orange-600"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {quantity > 0 && !!(item.customization_groups || []).length && (
                      <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
                        {item.customization_groups?.map((group) => {
                          const selectedIds = new Set((draftForItem(item)[group.id] || []));
                          return (
                            <div key={`${item.id}-${group.id}`}>
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <p className="text-[11px] font-black uppercase text-gray-500">
                                  {group.name}
                                </p>
                                {group.selection_type === "multiple" && (
                                  <span className="text-[11px] font-bold text-gray-500">
                                    max {group.max_select}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {group.options.map((option) => {
                                  const active = selectedIds.has(option.id);
                                  return (
                                    <button
                                      key={option.id}
                                      data-testid={`counter-option-${item.id}-${option.id}`}
                                      type="button"
                                      onClick={() => updateCustomization(item.id, group, option)}
                                      className={`rounded-md border px-3 py-2 text-xs font-black ${
                                        active
                                          ? "border-orange-400 bg-orange-500 text-white"
                                          : "border-white/10 bg-black/25 text-gray-300 hover:border-orange-400/60"
                                      }`}
                                      >
                                        {option.name}
                                      {option.price_delta > 0 ? ` +Rs ${option.price_delta}` : ""}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {!filteredMenuItems.length && (
                <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm font-semibold text-gray-500">
                  No menu item found.
                </div>
              )}
            </div>
              </section>

              <aside className="flex min-h-0 max-h-full flex-col overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                      Current Bill
                    </p>
                    <h3 className="text-lg font-black text-white">
                      {selectedItemCount} item{selectedItemCount === 1 ? "" : "s"}
                    </h3>
                  </div>
                  <span className="rounded-lg bg-orange-500 px-3 py-2 text-sm font-black text-white">
                    Rs {Math.round(total).toLocaleString()}
                  </span>
                </div>

                <div className="mb-4 max-h-52 space-y-2 overflow-y-auto pr-1">
                  {selectedItems.map((item) => (
                    <div
                      key={`cart-${item.id}`}
                      className="rounded-lg border border-white/10 bg-black/25 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-black">{item.quantity}x {item.name}</p>
                          <p className="mt-1 text-xs font-semibold text-gray-500">
                            Rs {Math.round(item.unit_price).toLocaleString()} each
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.id, 0)}
                          className="rounded-md border border-white/10 px-2 py-1 text-[10px] font-black text-gray-300 hover:border-red-400 hover:text-red-300"
                        >
                          Remove
                        </button>
                      </div>
                      {!!item.selected_options.length && (
                        <p className="mt-2 text-xs font-semibold leading-5 text-orange-100/80">
                          {item.selected_options.map(optionSummary).join(" | ")}
                        </p>
                      )}
                    </div>
                  ))}
                  {!selectedItems.length && (
                    <div className="rounded-lg border border-dashed border-white/10 p-5 text-center text-sm font-semibold text-gray-500">
                      Tap plus on menu items to build the bill.
                    </div>
                  )}
                </div>

                <div className="mb-4">
                  <p className="mb-2 text-[11px] font-black uppercase tracking-widest text-gray-500">
                    Payment
                  </p>
                  <div data-testid="counter-payment-rail" className="grid grid-cols-4 gap-2">
                    {quickPaymentMethods.map((method) => (
                      <button
                        key={method}
                        data-testid={`counter-payment-${method}`}
                        type="button"
                        onClick={() => selectPaymentMethod(method)}
                        className={`rounded-lg border px-2 py-2 text-xs font-black uppercase ${
                          formData.payment_method === method
                            ? "border-orange-400 bg-orange-500 text-white"
                            : "border-white/10 bg-black/25 text-gray-300"
                        }`}
                      >
                        {method}
                      </button>
                    ))}
                  </div>
                </div>

                {formData.payment_method === "cash" && (
                  <div
                    data-testid="counter-cash-tender-panel"
                    className="mb-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3"
                  >                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-[11px] font-black uppercase tracking-widest text-emerald-200/80">
                        Cash Tender
                      </p>
                      <span
                        data-testid="counter-change-due"
                        className="rounded-lg bg-black/30 px-3 py-1 text-xs font-black text-emerald-100"
                      >
                        Change Rs {Math.round(cashChangeDue).toLocaleString()}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {cashTenderPresets.map((value) => (
                        <button
                          key={`cash-${value}`}
                          type="button"
                          onClick={() => setCashTendered(value)}
                          className={`rounded-lg border px-2 py-2 text-xs font-black ${
                            cashTenderedAmount === value
                              ? "border-emerald-300 bg-emerald-500 text-white"
                              : "border-white/10 bg-black/25 text-emerald-100 hover:border-emerald-300"
                          }`}
                        >
                          {value === roundedTotal ? "Exact" : `Rs ${value}`}
                        </button>
                      ))}
                    </div>
                    <input
                      data-testid="counter-tendered-cash"
                      type="number"
                      min="0"
                      value={cashTendered}
                      onChange={(event) =>
                        setCashTendered(
                          event.target.value === "" ? "" : Number(event.target.value) || 0
                        )
                      }
                      placeholder="Cash received"
                      className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm font-black text-white outline-none placeholder:text-gray-500 focus:border-emerald-300"
                    />
                  </div>
                )}

                <div className="mb-4 rounded-xl border border-white/10 bg-black/25 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-black uppercase tracking-widest text-gray-400">
                      Tip
                    </p>
                    <span className="text-xs font-black text-emerald-200">
                      Rs {Math.round(tip).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {[0, 20, 50, 100].map((value) => (
                      <button
                        key={`tip-${value}`}
                        type="button"
                        onClick={() => setFormData({ ...formData, tip_amount: value })}
                        className={`rounded-lg border px-2 py-2 text-xs font-black ${
                          Math.round(tip) === value
                            ? "border-emerald-300 bg-emerald-500 text-white"
                            : "border-white/10 bg-black/25 text-emerald-100 hover:border-emerald-300"
                        }`}
                      >
                        {value === 0 ? "No tip" : `Rs ${value}`}
                      </button>
                    ))}
                  </div>
                  <input
                    data-testid="counter-tip-amount"
                    type="number"
                    min="0"
                    max="2000"
                    value={formData.tip_amount || ""}
                    onChange={(event) =>
                      setFormData({
                        ...formData,
                        tip_amount:
                          event.target.value === "" ? 0 : Math.max(Number(event.target.value) || 0, 0),
                      })
                    }
                    placeholder="Custom tip"
                    className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm font-black text-white outline-none placeholder:text-gray-500 focus:border-emerald-300"
                  />
                </div>

            <div className="mt-6 rounded-xl bg-black/30 border border-white/10 p-4 space-y-2 text-sm">
              <div className="flex justify-between text-gray-400"><span>Subtotal</span><span>Rs {Math.round(subtotal).toLocaleString()}</span></div>
              <div className="flex justify-between text-gray-400"><span>Discount</span><span>Rs {Math.round(discount).toLocaleString()}</span></div>
              <div className="flex justify-between text-gray-400"><span>GST 5%</span><span>Rs {Math.round(tax).toLocaleString()}</span></div>
              {tip > 0 && (
                <div className="flex justify-between text-emerald-200">
                  <span>Tip</span>
                  <span>Rs {Math.round(tip).toLocaleString()}</span>
                </div>
              )}
              {isDeliveryOrder && (
                <div className="flex justify-between text-orange-200">
                  <span>Delivery Fee</span>
                  <span>Rs {Math.round(deliveryFee).toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between text-xl font-black text-white pt-2 border-t border-white/10">
                <span>Total</span><span>Rs {Math.round(total).toLocaleString()}</span>
              </div>
            </div>

            <button
              data-testid="counter-send-order"
              onClick={createOrder}
              disabled={!canSendOrder}
              className="mt-5 w-full bg-orange-500 p-4 rounded-xl font-bold text-lg hover:bg-orange-600 active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <Printer className="w-5 h-5" />
              {sendButtonCopy}
            </button>
              </aside>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CounterStepCard({
  icon: Icon,
  label,
  value,
  active,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${active ? "border-green-400/30 bg-green-500/10" : "border-white/10 bg-white/5"}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase text-gray-500">{label}</p>
          <p className={`mt-1 text-sm font-black ${active ? "text-green-200" : "text-gray-300"}`}>{value}</p>
        </div>
        <Icon className={`h-4 w-4 ${active ? "text-green-300" : "text-gray-500"}`} />
      </div>
    </div>
  );
}
