"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  CreditCard,
  MapPin,
  Mail,
  Minus,
  Percent,
  Phone,
  Plus,
  Search,
  ShoppingBag,
  User,
  X,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

const MENU_API = getApiUrl("/api/v1/restaurant/menu/menu-with-customizations");
const ORDER_API = getApiUrl("/api/v1/restaurant/orders/");
const COUPON_API = getApiUrl("/api/v1/restaurant/promotions/validate-code");
const ACTIVE_PROMOS_API = getApiUrl("/api/v1/restaurant/promotions/active");
const DELIVERY_ZONES_API = getApiUrl("/api/v1/restaurant/delivery/zones");
const DELIVERY_QUOTE_API = getApiUrl("/api/v1/restaurant/delivery/quote");
const CUSTOMER_STORAGE_KEY = "pizza_blitz_customer";
const REORDER_STORAGE_KEY = "pizza_blitz_reorder";

type MenuItem = {
  id: number;
  name: string;
  category: string;
  selling_price: number;
  cost_price: number;
  is_available: boolean;
  customization_groups?: CustomizationGroup[];
};

type CartItem = MenuItem & {
  cart_key: string;
  quantity: number;
  base_price: number;
  customization_total: number;
  selected_options: SelectedOption[];
};

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

type CouponResult = {
  discount: number;
  tax: number;
  total: number;
  promotion: {
    code?: string | null;
    name: string;
  };
};

type ActivePromotion = {
  id: number;
  name: string;
  code?: string | null;
  end_date: string;
  description?: string | null;
  discount_type: "percentage" | "fixed";
  discount_value: number;
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
    minimum_gap?: number;
    delivery_fee: number;
    total_with_delivery: number;
  };
};

type PendingPayment = {
  orderId: number;
  total: number;
  provider: string;
  reference: string;
  sessionId?: string;
  providerOrderId?: string | null;
  paymentSessionId?: string | null;
  checkoutUrl?: string | null;
  checkoutPayload?: CheckoutPayload | null;
  sessionStatus?: string;
  message?: string;
};

type CheckoutPayload = {
  provider?: string;
  mode?: string;
  payment_session_id?: string;
  provider_order_id?: string;
  key?: string;
  amount?: number;
  currency?: string;
  name?: string;
  description?: string;
  order_id?: string;
  prefill?: {
    name?: string;
    contact?: string;
    email?: string;
  };
};

type ReorderDraft = {
  customer?: {
    name?: string;
    phone?: string;
    email?: string;
    opt_in_marketing?: boolean;
  };
  items?: { name?: string; quantity?: number; selected_options?: SelectedOption[] }[];
  source_order_id?: number;
};

const categoryImages: Record<string, string> = {
  Pizza:
    "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=900&q=80",
  Sides:
    "https://images.unsplash.com/photo-1630384060421-cb20d0e0649d?auto=format&fit=crop&w=900&q=80",
  Burgers:
    "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80",
  Sandwiches:
    "https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=80",
  Beverages:
    "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=900&q=80",
  Desserts:
    "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=900&q=80",
};

const fallbackImage =
  "https://images.unsplash.com/photo-1548365328-9f547fb09530?auto=format&fit=crop&w=900&q=80";

const loadExternalScript = (src: string) =>
  new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${src}"]`);
    if (existingScript) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.body.appendChild(script);
  });

declare global {
  interface Window {
    Cashfree?: (options: { mode: string }) => {
      checkout: (options: { paymentSessionId: string; redirectTarget?: string }) => unknown;
    };
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

export default function PublicOrderPage() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [activePromotions, setActivePromotions] = useState<ActivePromotion[]>([]);
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
  const [selectedDeliveryZoneId, setSelectedDeliveryZoneId] = useState<number | null>(null);
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customizationDrafts, setCustomizationDrafts] = useState<Record<number, Record<number, number[]>>>({});
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [orderType, setOrderType] = useState<"pickup" | "delivery">("pickup");
  const [paymentMethod, setPaymentMethod] = useState<"prepaid" | "cash">("prepaid");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [optInMarketing, setOptInMarketing] = useState(true);
  const [address, setAddress] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [queuedCouponCode, setQueuedCouponCode] = useState("");
  const [coupon, setCoupon] = useState<CouponResult | null>(null);
  const [message, setMessage] = useState("");
  const [orderId, setOrderId] = useState<number | null>(null);
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);
  const [isStartingGatewayPayment, setIsStartingGatewayPayment] = useState(false);
  const [isQuotingDelivery, setIsQuotingDelivery] = useState(false);
  const [isCheckoutVisible, setIsCheckoutVisible] = useState(false);
  const checkoutRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const linkedCoupon = new URLSearchParams(window.location.search).get("coupon");
    if (linkedCoupon) {
      const normalizedCoupon = linkedCoupon.trim().toUpperCase();
      setCouponCode(normalizedCoupon);
      setQueuedCouponCode(normalizedCoupon);
      setMessage(`${normalizedCoupon} selected from this offer link. Add any item and it will apply automatically.`);
    }

    fetch(MENU_API)
      .then((response) => response.json())
      .then((data: MenuItem[]) => {
        const availableMenu = data.filter((item) => item.is_available);
        setMenu(availableMenu);
        applySavedReorder(availableMenu);
      })
      .catch(() => setMessage("Menu is not available right now."));

    fetch(ACTIVE_PROMOS_API)
      .then((response) => response.json())
      .then((data: ActivePromotion[]) => setActivePromotions(data.filter((promotion) => promotion.code)))
      .catch(() => setActivePromotions([]));

    fetch(DELIVERY_ZONES_API)
      .then((response) => response.json())
      .then((data: DeliveryZone[]) => {
        const activeZones = data.filter((zone) => zone.is_active);
        setDeliveryZones(activeZones);
        if (activeZones[0]) {
          setSelectedDeliveryZoneId(activeZones[0].id);
        }
      })
      .catch(() => setDeliveryZones([]));

    const savedCustomer = window.localStorage.getItem(CUSTOMER_STORAGE_KEY);
    if (savedCustomer) {
      try {
        const parsed = JSON.parse(savedCustomer);
        setCustomerName(parsed.name || "");
        setCustomerPhone(parsed.phone || "");
        setCustomerEmail(parsed.email || "");
        setOptInMarketing(parsed.opt_in_marketing ?? true);
      } catch {
        window.localStorage.removeItem(CUSTOMER_STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    const checkoutElement = checkoutRef.current;
    if (!checkoutElement || !("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsCheckoutVisible(entry.isIntersecting),
      { threshold: 0.18 }
    );
    observer.observe(checkoutElement);
    return () => observer.disconnect();
  }, []);

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

  const draftForItem = (item: MenuItem) =>
    customizationDrafts[item.id] || defaultDraftForItem(item);

  const selectedOptionsForItem = (item: MenuItem, draft = draftForItem(item)) => {
    const selected: SelectedOption[] = [];
    (item.customization_groups || []).forEach((group) => {
      const optionIds = new Set(draft[group.id] || []);
      group.options
        .filter((option) => optionIds.has(option.id))
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

  const draftFromSavedOptions = (
    item: MenuItem,
    savedOptions: SelectedOption[] = []
  ) => {
    const nextDraft = defaultDraftForItem(item);
    (item.customization_groups || []).forEach((group) => {
      const matchedOptionIds = group.options
        .filter((option) =>
          savedOptions.some(
            (savedOption) =>
              savedOption.group_name === group.name &&
              savedOption.option_name === option.name
          )
        )
        .map((option) => option.id);
      if (matchedOptionIds.length) {
        nextDraft[group.id] =
          group.selection_type === "single"
            ? [matchedOptionIds[0]]
            : matchedOptionIds.slice(0, group.max_select || matchedOptionIds.length);
      }
    });
    return nextDraft;
  };

  const customizationTotalForItem = (item: MenuItem, draft = draftForItem(item)) =>
    roundMoney(
      selectedOptionsForItem(item, draft).reduce(
        (total, option) => total + Number(option.price_delta || 0),
        0
      )
    );

  const configuredPriceForItem = (item: MenuItem, draft = draftForItem(item)) =>
    roundMoney(Number(item.selling_price || 0) + customizationTotalForItem(item, draft));

  const cartKeyFor = (itemId: number, selectedOptions: SelectedOption[]) =>
    `${itemId}:${selectedOptions
      .map((option) => option.option_id)
      .sort((a, b) => a - b)
      .join("-")}`;

  const updateCustomization = (
    item: MenuItem,
    group: CustomizationGroup,
    option: CustomizationOption
  ) => {
    setOrderId(null);
    setPendingPayment(null);
    setCoupon(null);
    setCustomizationDrafts((current) => {
      const currentDraft = current[item.id] || defaultDraftForItem(item);
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
        ...current,
        [item.id]: {
          ...currentDraft,
          [group.id]: nextSelection,
        },
      };
    });
  };

  const applySavedReorder = (availableMenu: MenuItem[]) => {
    const savedReorder = window.localStorage.getItem(REORDER_STORAGE_KEY);
    if (!savedReorder) return;

    try {
      const draft = JSON.parse(savedReorder) as ReorderDraft;
      if (draft.customer) {
        setCustomerName(draft.customer.name || "");
        setCustomerPhone(draft.customer.phone || "");
        setCustomerEmail(draft.customer.email || "");
        setOptInMarketing(draft.customer.opt_in_marketing ?? true);
      }

      const nextCart = (draft.items || [])
        .map((draftItem) => {
          const item = availableMenu.find(
            (menuItem) =>
              menuItem.name.trim().toLowerCase() ===
              String(draftItem.name || "").trim().toLowerCase()
          );
          if (!item) return null;
          const quantity = Number(draftItem.quantity || 0);
          if (quantity <= 0) return null;
          const itemDraft = draftFromSavedOptions(item, draftItem.selected_options || []);
          const selectedOptions = selectedOptionsForItem(item, itemDraft);
          const customizationTotal = roundMoney(
            selectedOptions.reduce(
              (total, option) => total + Number(option.price_delta || 0),
              0
            )
          );
          return {
            ...item,
            cart_key: cartKeyFor(item.id, selectedOptions),
            quantity,
            base_price: Number(item.selling_price || 0),
            customization_total: customizationTotal,
            selected_options: selectedOptions,
            selling_price: roundMoney(Number(item.selling_price || 0) + customizationTotal),
          };
        })
        .filter((item): item is CartItem => item !== null);

      if (!nextCart.length) {
        setMessage("Previous order items are not available right now.");
        return;
      }

      const missingCount = Math.max((draft.items || []).length - nextCart.length, 0);
      setCart(nextCart);
      setCoupon(null);
      setCouponCode("");
      setQueuedCouponCode("");
      setOrderId(null);
      setPendingPayment(null);
      setMessage(
        `Loaded ${nextCart.length} item${nextCart.length === 1 ? "" : "s"} from order #${
          draft.source_order_id || "history"
        }${missingCount ? `; ${missingCount} unavailable item${missingCount === 1 ? "" : "s"} skipped` : ""}.`
      );
    } catch {
      setMessage("Could not load previous order.");
    } finally {
      window.localStorage.removeItem(REORDER_STORAGE_KEY);
    }
  };

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(menu.map((item) => item.category)))],
    [menu]
  );

  const subtotal = useMemo(
    () => roundMoney(cart.reduce((total, item) => total + item.selling_price * item.quantity, 0)),
    [cart]
  );

  const discount = coupon ? coupon.discount : 0;
  const taxableSubtotal = Math.max(roundMoney(subtotal - discount), 0);
  const tax = coupon ? coupon.tax : roundMoney(taxableSubtotal * 0.05);
  const deliveryFee =
    orderType === "delivery" && deliveryQuote?.is_deliverable
      ? Number(deliveryQuote.delivery_fee || 0)
      : 0;
  const deliveryMinimumGap = Math.max(
    Number(deliveryQuote?.charge_breakdown?.minimum_gap || 0),
    0
  );
  const total = coupon
    ? roundMoney(coupon.total + deliveryFee)
    : roundMoney(taxableSubtotal + tax + deliveryFee);
  const selectedDeliveryZone = deliveryZones.find(
    (zone) => zone.id === selectedDeliveryZoneId
  );
  const eta =
    orderType === "pickup"
      ? "20-25 min"
      : deliveryQuote?.eta_window || selectedDeliveryZone?.eta_window || "35-45 min";
  const phoneDigits = customerPhone.replace(/\D/g, "");
  const contactReady = customerName.trim().length >= 2 && phoneDigits.length >= 10;
  const fulfillmentReady =
    orderType === "pickup" ||
    (Boolean(address.trim()) &&
      Boolean(selectedDeliveryZoneId) &&
      Boolean(deliveryQuote?.is_deliverable) &&
      !isQuotingDelivery);
  const paymentReady = paymentMethod === "cash" || paymentMethod === "prepaid";
  const canSubmitOrder = Boolean(cart.length) && contactReady && fulfillmentReady && paymentReady && !isSubmitting;
  const fulfillmentStatus =
    orderType === "pickup"
      ? "Pickup promise ready"
      : isQuotingDelivery
        ? "Checking delivery fee"
        : deliveryQuote?.is_deliverable
          ? `${deliveryQuote.zone?.name || selectedDeliveryZone?.name || "Delivery"} - Rs ${deliveryFee}, ${eta}`
          : address.trim()
            ? `${deliveryQuote?.reason || "Address needs review"}${
                deliveryMinimumGap ? ` Add Rs ${Math.round(deliveryMinimumGap)} more.` : ""
              }`
            : "Enter address for delivery fee";
  const checkoutSteps = [
    {
      label: "Cart",
      detail: cart.length ? `${cart.length} item${cart.length === 1 ? "" : "s"}` : "Add menu items",
      complete: cart.length > 0,
    },
    {
      label: "Contact",
      detail: contactReady ? "Name and phone ready" : "Name and 10 digit phone",
      complete: contactReady,
    },
    {
      label: "Fulfillment",
      detail: fulfillmentStatus,
      complete: fulfillmentReady,
    },
    {
      label: "Payment",
      detail: paymentMethod === "prepaid" ? "Prepaid session after order" : "Cash on pickup/delivery",
      complete: paymentReady,
    },
  ];

  const filteredMenu = useMemo(
    () =>
      menu.filter((item) => {
        const query = search.toLowerCase();
        const matchesCategory = category === "All" || item.category === category;
        const matchesSearch =
          item.name.toLowerCase().includes(query) || item.category.toLowerCase().includes(query);
        return matchesCategory && matchesSearch;
      }),
    [menu, search, category]
  );
  const highlightedPromotions = useMemo(
    () => prioritizePromotions(activePromotions, coupon?.promotion.code || queuedCouponCode, 4),
    [activePromotions, coupon?.promotion.code, queuedCouponCode]
  );
  const checkoutPromotions = useMemo(
    () => prioritizePromotions(activePromotions, coupon?.promotion.code || queuedCouponCode, 3),
    [activePromotions, coupon?.promotion.code, queuedCouponCode]
  );
  const trackingHref =
    orderId && customerPhone.trim()
      ? `/track?order=${orderId}&phone=${encodeURIComponent(customerPhone.trim())}`
      : "/account";
  const receiptHref = trackingHref;

  useEffect(() => {
    if (orderType !== "delivery") {
      setDeliveryQuote(null);
      return;
    }
    if (!address.trim() || !selectedDeliveryZoneId) {
      setDeliveryQuote(null);
      return;
    }

    const quoteTimer = window.setTimeout(async () => {
      setIsQuotingDelivery(true);
      try {
        const response = await fetch(DELIVERY_QUOTE_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address,
            subtotal,
            zone_id: selectedDeliveryZoneId,
          }),
        });
        const data = await response.json();
        setDeliveryQuote(data);
      } catch {
        setDeliveryQuote({
          is_deliverable: false,
          reason: "Delivery quote is not available right now.",
          address,
          delivery_fee: 0,
        });
      } finally {
        setIsQuotingDelivery(false);
      }
    }, 350);

    return () => window.clearTimeout(quoteTimer);
  }, [address, orderType, selectedDeliveryZoneId, subtotal]);

  const saveCustomerSession = async () => {
    if (!customerPhone.trim()) return;
    await fetch("/api/customer-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: customerName,
        phone: customerPhone,
        email: customerEmail || null,
      }),
    }).catch(() => undefined);
  };

  const addToCart = (item: MenuItem) => {
    setOrderId(null);
    setPendingPayment(null);
    setMessage("");
    setCoupon(null);
    const draft = draftForItem(item);
    const selectedOptions = selectedOptionsForItem(item, draft);
    const customizationTotal = customizationTotalForItem(item, draft);
    const unitPrice = configuredPriceForItem(item, draft);
    const cartKey = cartKeyFor(item.id, selectedOptions);
    setCart((current) => {
      const existing = current.find((cartItem) => cartItem.cart_key === cartKey);
      if (existing) {
        return current.map((cartItem) =>
          cartItem.cart_key === cartKey
            ? { ...cartItem, quantity: cartItem.quantity + 1 }
            : cartItem
        );
      }
      return [
        ...current,
        {
          ...item,
          cart_key: cartKey,
          quantity: 1,
          base_price: Number(item.selling_price || 0),
          customization_total: customizationTotal,
          selected_options: selectedOptions,
          selling_price: unitPrice,
        },
      ];
    });
  };

  const updateQuantity = (cartKey: string, delta: number) => {
    setCoupon(null);
    setCart((current) =>
      current
        .map((item) =>
          item.cart_key === cartKey ? { ...item, quantity: Math.max(item.quantity + delta, 0) } : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const applyCouponCode = async (
    code: string,
    options: { queueIfEmpty?: boolean; quiet?: boolean } = {}
  ) => {
    const nextCode = code.trim().toUpperCase();
    if (!nextCode) {
      setMessage("Enter a coupon code.");
      return;
    }
    setCouponCode(nextCode);
    setQueuedCouponCode(nextCode);
    if (!cart.length) {
      setCoupon(null);
      setMessage(
        options.queueIfEmpty
          ? `${nextCode} selected. Add any menu item and the offer will apply automatically.`
          : "Add items before applying a coupon."
      );
      return;
    }
    setIsApplyingCoupon(true);
    try {
      const response = await fetch(COUPON_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: nextCode, subtotal }),
      });
      const data = await response.json();
      if (!response.ok) {
        setCoupon(null);
        setQueuedCouponCode("");
        if (!options.quiet) {
          setMessage(data.detail || "Coupon could not be applied.");
        }
        return;
      }
      const appliedCode = data.promotion.code || nextCode;
      setCoupon(data);
      setCouponCode(appliedCode);
      setQueuedCouponCode(appliedCode);
      if (!options.quiet) {
        setMessage(`Applied ${appliedCode}.`);
      }
    } finally {
      setIsApplyingCoupon(false);
    }
  };

  const applyCoupon = async () => {
    await applyCouponCode(couponCode);
  };

  const applyPromotion = async (promotion: ActivePromotion) => {
    if (!promotion.code) {
      setMessage("This offer is active but does not have a coupon code yet.");
      return;
    }
    await applyCouponCode(promotion.code, { queueIfEmpty: true });
  };

  useEffect(() => {
    if (!queuedCouponCode || !cart.length || subtotal <= 0) return;
    if (coupon?.promotion.code === queuedCouponCode) return;

    const timer = window.setTimeout(() => {
      void applyCouponCode(queuedCouponCode);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [cart.length, coupon?.promotion.code, queuedCouponCode, subtotal]);

  const placeOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!cart.length) {
      setMessage("Add at least one item.");
      return;
    }
    if (!contactReady) {
      setMessage("Enter a customer name and a valid 10 digit phone number.");
      return;
    }
    if (orderType === "delivery" && !address.trim()) {
      setMessage("Delivery address is required.");
      return;
    }
    if (orderType === "delivery" && !selectedDeliveryZoneId) {
      setMessage("Choose a delivery zone.");
      return;
    }
    if (orderType === "delivery" && (isQuotingDelivery || !deliveryQuote)) {
      setMessage("Wait for the delivery fee and ETA before placing the order.");
      return;
    }
    if (orderType === "delivery" && !deliveryQuote.is_deliverable) {
      setMessage(deliveryQuote.reason || "This address is outside the delivery area.");
      return;
    }

    setIsSubmitting(true);
    const response = await fetch(ORDER_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_type: orderType,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_email: customerEmail || null,
        opt_in_marketing: optInMarketing,
        payment_method: paymentMethod,
        discount_amount: discount,
        coupon_code: coupon ? coupon.promotion.code || couponCode : null,
        delivery_address: address,
        delivery_zone_id: selectedDeliveryZoneId,
        notes: [
          `Customer website order`,
          `Fulfillment: ${orderType}`,
          `ETA: ${eta}`,
          address ? `Address: ${address}` : "",
          orderType === "delivery" && selectedDeliveryZone
            ? `Delivery Zone: ${selectedDeliveryZone.name}`
            : "",
          coupon ? `Coupon: ${coupon.promotion.code || couponCode.toUpperCase()}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
        items: cart.map((item) => ({
          menu_item_id: item.id,
          name: item.name,
          quantity: item.quantity,
          price: item.selling_price,
          base_price: item.base_price,
          customization_total: item.customization_total,
          selected_options: item.selected_options,
        })),
      }),
    });
    const data = await response.json();
    setIsSubmitting(false);

    if (!response.ok) {
      setMessage(data.detail || "Order could not be placed.");
      return;
    }

    window.localStorage.setItem(
      CUSTOMER_STORAGE_KEY,
      JSON.stringify({
        name: customerName,
        phone: customerPhone,
        email: customerEmail,
        opt_in_marketing: optInMarketing,
      })
    );
    await saveCustomerSession();
    if (paymentMethod === "prepaid") {
      const orderId = Number(data.order_id);
      const sessionResponse = await fetch(`${ORDER_API}${orderId}/payment-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          return_url: `${window.location.origin}/account`,
        }),
      });
      const sessionData = await sessionResponse.json();

      if (!sessionResponse.ok) {
        setMessage(sessionData.detail || "Payment session could not be created.");
        return;
      }

      const paymentSession = sessionData.payment_session;
      const paymentReferenceValue =
        paymentSession.provider_order_id ||
        paymentSession.session_id ||
        `WEB-${orderId}-${Date.now()}`;
      setOrderId(orderId);
      setCart([]);
      setCoupon(null);
      setCouponCode("");
      setQueuedCouponCode("");
      setPaymentReference(paymentReferenceValue);
      setPendingPayment({
        orderId,
        total: Number(data.total || 0),
        provider: paymentSession.provider || "manual",
        reference: paymentReferenceValue,
        sessionId: paymentSession.session_id,
        providerOrderId: paymentSession.provider_order_id,
        paymentSessionId: paymentSession.payment_session_id,
        checkoutUrl: paymentSession.checkout_url,
        checkoutPayload: paymentSession.checkout_payload,
        sessionStatus: paymentSession.status,
        message: paymentSession.message,
      });
      setMessage(`Order #${orderId} created. Confirm prepaid payment to mark it paid.`);
    } else {
      const orderId = Number(data.order_id);
      setOrderId(orderId);
      setCart([]);
      setCoupon(null);
      setCouponCode("");
      setQueuedCouponCode("");
      setPendingPayment(null);
      setMessage(`Order #${orderId} placed. Estimated ${eta}.`);
    }
  };

  const confirmPayment = async () => {
    if (!pendingPayment) return;

    setIsConfirmingPayment(true);
    const response = await fetch(`${ORDER_API}${pendingPayment.orderId}/payment-confirmation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payment_provider: pendingPayment.provider,
        payment_reference: paymentReference || pendingPayment.reference,
        paid_amount: pendingPayment.total,
      }),
    });
    const data = await response.json();
    setIsConfirmingPayment(false);

    if (!response.ok) {
      setMessage(data.detail || "Payment could not be confirmed.");
      return;
    }

    setPendingPayment(null);
    setMessage(`Payment confirmed for order #${data.id}. Estimated ${eta}.`);
  };

  const startGatewayPayment = async () => {
    if (!pendingPayment) return;

    const provider = pendingPayment.provider.toLowerCase();
    const checkoutPayload = pendingPayment.checkoutPayload;
    setIsStartingGatewayPayment(true);

    try {
      if (provider === "cashfree" && pendingPayment.paymentSessionId) {
        await loadExternalScript("https://sdk.cashfree.com/js/v3/cashfree.js");
        const cashfree = window.Cashfree?.({
          mode: checkoutPayload?.mode === "production" ? "production" : "sandbox",
        });
        if (!cashfree) {
          throw new Error("Cashfree checkout was not available.");
        }
        cashfree.checkout({
          paymentSessionId: pendingPayment.paymentSessionId,
          redirectTarget: "_modal",
        });
        setMessage("Cashfree payment window opened.");
        return;
      }

      if (provider === "razorpay" && checkoutPayload?.order_id) {
        await loadExternalScript("https://checkout.razorpay.com/v1/checkout.js");
        if (!window.Razorpay) {
          throw new Error("Razorpay checkout was not available.");
        }
        const checkout = new window.Razorpay({
          ...checkoutPayload,
          handler: async (response: Record<string, string>) => {
            setIsConfirmingPayment(true);
            try {
              const verificationResponse = await fetch(
                `${ORDER_API}${pendingPayment.orderId}/payment-verification`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    provider: "razorpay",
                    provider_order_id: response.razorpay_order_id || checkoutPayload.order_id,
                    provider_payment_id: response.razorpay_payment_id,
                    provider_signature: response.razorpay_signature,
                    paid_amount: pendingPayment.total,
                  }),
                }
              );
              const verificationData = await verificationResponse.json();

              if (!verificationResponse.ok) {
                setMessage(verificationData.detail || "Payment verification failed.");
                return;
              }

              setPendingPayment(null);
              setMessage(`Payment confirmed for order #${verificationData.id}. Estimated ${eta}.`);
            } catch {
              setMessage("Payment verification failed.");
            } finally {
              setIsConfirmingPayment(false);
            }
          },
          modal: {
            ondismiss: () => setMessage("Payment window closed."),
          },
        });
        checkout.open();
        setMessage("Razorpay payment window opened.");
        return;
      }

      setMessage("Online checkout is not ready for this payment session.");
    } catch {
      setMessage("Payment window could not be opened.");
    } finally {
      setIsStartingGatewayPayment(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-red-700">Pizza Blitz</p>
            <h1 className="text-2xl font-black">Order Online</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/account"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:border-red-600 hover:text-red-700"
            >
              My Orders
            </Link>
            <Link
              href="/login"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:border-red-600 hover:text-red-700"
            >
              Admin Portal
            </Link>
            <a
              href="#checkout"
              className="flex items-center gap-2 rounded-md bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800"
            >
              <ShoppingBag className="h-4 w-4" /> Cart {cart.length}
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-5 py-6 pb-24 xl:grid-cols-12 xl:pb-6">
        <section className="xl:col-span-8">
          <div className="mb-6 grid grid-cols-1 overflow-hidden rounded-lg border border-slate-200 bg-white md:grid-cols-12">
            <div className="p-5 md:col-span-7">
              <p className="mb-2 text-sm font-bold text-red-700">Fresh today</p>
              <h2 className="text-3xl font-black">Pizza, sides, drinks, and quick pickup.</h2>
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <InfoBadge icon={Clock} label={eta} />
                <InfoBadge icon={MapPin} label={orderType === "pickup" ? "Pickup" : "Delivery"} />
              </div>
            </div>
            <img
              src={categoryImages.Pizza}
              alt="Pizza fresh from the oven"
              className="h-64 w-full object-cover md:col-span-5 md:h-full"
            />
          </div>

          {activePromotions.length > 0 && (
            <div className="mb-5 rounded-lg border border-red-100 bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-red-700">
                    Live Offers
                  </p>
                  <h3 className="text-lg font-black">Tap a coupon and apply it at checkout</h3>
                </div>
                <Percent className="h-5 w-5 text-red-700" />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {highlightedPromotions.map((promotion) => {
                  const isApplied = coupon?.promotion.code === promotion.code;
                  const isSelected = queuedCouponCode === promotion.code;
                  return (
                    <button
                      key={promotion.id}
                      type="button"
                      onClick={() => applyPromotion(promotion)}
                      className={`rounded-md border p-4 text-left transition ${
                        isApplied || isSelected
                          ? "border-red-700 bg-red-50"
                          : "border-slate-200 bg-slate-50 hover:border-red-600 hover:bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-black text-slate-950">{promotion.name}</p>
                          <p className="mt-1 text-sm font-semibold text-slate-600">
                            {promotion.description || offerLabel(promotion)}
                          </p>
                        </div>
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-black ${
                            isApplied || isSelected
                              ? "bg-slate-950 text-white"
                              : "bg-red-700 text-white"
                          }`}
                        >
                          {isApplied ? "APPLIED" : isSelected ? "SELECTED" : promotion.code}
                        </span>
                      </div>
                      <p className="mt-3 text-xs font-bold text-slate-500">
                        {isSelected && !coupon
                          ? "Add any item to activate this offer automatically."
                          : `${offerLabel(promotion)} until ${promotion.end_date}`}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search menu"
                className="w-full rounded-md border border-slate-300 bg-white py-3 pl-10 pr-4 outline-none focus:border-red-600"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {categories.map((itemCategory) => (
                <button
                  key={itemCategory}
                  onClick={() => setCategory(itemCategory)}
                  className={`whitespace-nowrap rounded-md border px-4 py-3 text-sm font-bold ${
                    category === itemCategory
                      ? "border-red-700 bg-red-700 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:border-red-600"
                  }`}
                >
                  {itemCategory}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {filteredMenu.map((item) => {
              const draft = draftForItem(item);
              const selectedOptions = selectedOptionsForItem(item, draft);
              const configuredPrice = configuredPriceForItem(item, draft);
              return (
                <article
                  key={item.id}
                  className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                >
                  <div className="grid grid-cols-12">
                    <img
                      src={categoryImages[item.category] || fallbackImage}
                      alt={item.name}
                      className="col-span-4 h-full min-h-36 object-cover"
                    />
                    <div className="col-span-8 p-4">
                      <p className="text-xs font-bold text-red-700">{item.category}</p>
                      <h3 className="mt-1 min-h-12 text-lg font-black leading-6">{item.name}</h3>
                      {selectedOptions.length > 0 && (
                        <p className="mt-2 line-clamp-2 text-xs font-semibold text-slate-500">
                          {selectedOptions.map(optionLabel).join(" | ")}
                        </p>
                      )}
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <span className="text-lg font-black">Rs {configuredPrice}</span>
                        <button
                          onClick={() => addToCart(item)}
                          className="flex items-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-sm font-bold text-white hover:bg-red-700"
                        >
                          <Plus className="h-4 w-4" /> Add
                        </button>
                      </div>
                    </div>
                  </div>
                  {(item.customization_groups || []).length > 0 && (
                    <div className="space-y-3 border-t border-slate-100 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600">
                        <span>Build this item</span>
                        <span>
                          Base Rs {Number(item.selling_price || 0).toLocaleString()} + upgrades Rs {customizationTotalForItem(item, draft).toLocaleString()}
                        </span>
                      </div>
                      {item.customization_groups?.map((group) => {
                        const selectedIds = new Set(draft[group.id] || []);
                        return (
                          <div key={`${item.id}-${group.id}`}>
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <p className="text-xs font-black uppercase tracking-widest text-slate-500">
                                {group.name}
                              </p>
                              {group.min_select > 0 ? (
                                <span className="text-xs font-bold text-red-700">
                                  required
                                </span>
                              ) : group.selection_type === "multiple" ? (
                                <span className="text-xs font-bold text-slate-400">
                                  up to {group.max_select}
                                </span>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {group.options.map((option) => {
                                const active = selectedIds.has(option.id);
                                return (
                                  <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => updateCustomization(item, group, option)}
                                    className={`rounded-md border px-3 py-2 text-xs font-black ${
                                      active
                                        ? "border-red-700 bg-red-700 text-white"
                                        : "border-slate-300 bg-white text-slate-700 hover:border-red-600"
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
                </article>
              );
            })}
          </div>
        </section>

        <aside id="checkout" ref={checkoutRef} className="xl:col-span-4">
          <form
            onSubmit={placeOrder}
            className="sticky top-5 rounded-lg border border-slate-200 bg-white p-5"
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xl font-black">
                <ShoppingBag className="h-5 w-5 text-red-700" /> Checkout
              </h2>
              <span className="text-sm font-bold text-slate-500">{eta}</span>
            </div>

            {message && (
              <div className="mb-4 rounded-md border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
                {message}
              </div>
            )}

            {orderId && (
              <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-green-800">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" /> Order #{orderId} {pendingPayment ? "created" : "confirmed"}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border border-green-200 bg-white px-3 py-2">
                    <p className="font-black uppercase text-green-900">Kitchen</p>
                    <p className="mt-1 font-semibold text-green-700">Sent to operations</p>
                  </div>
                  <div className="rounded-md border border-green-200 bg-white px-3 py-2">
                    <p className="font-black uppercase text-green-900">Bill</p>
                    <p className="mt-1 font-semibold text-green-700">Receipt ready</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-3">
                  <Link
                    href={trackingHref}
                    className="inline-flex text-sm font-black text-green-900 underline"
                  >
                    Track this order
                  </Link>
                  <Link
                    href={receiptHref}
                    className="inline-flex text-sm font-black text-green-900 underline"
                  >
                    View receipt
                  </Link>
                </div>
              </div>
            )}

            <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                    Checkout Progress
                  </p>
                  <p className="text-sm font-semibold text-slate-600">
                    Cart, contact, fulfillment and payment must be ready before placing the order.
                  </p>
                </div>
                <span className="rounded-md bg-white px-2.5 py-1 text-xs font-black text-slate-700">
                  {checkoutSteps.filter((step) => step.complete).length}/{checkoutSteps.length}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {checkoutSteps.map((step) => (
                  <div
                    key={step.label}
                    className={`rounded-md border px-3 py-2 ${
                      step.complete
                        ? "border-emerald-200 bg-white text-emerald-800"
                        : "border-slate-200 bg-white text-slate-600"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {step.complete ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <Clock className="h-4 w-4 text-slate-400" />
                      )}
                      <p className="text-sm font-black">{step.label}</p>
                    </div>
                    <p className="mt-1 text-xs font-semibold">{step.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            {pendingPayment && (
              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-4">
                <p className="font-black text-amber-900">Prepaid payment pending</p>
                <p className="mt-1 text-sm font-semibold text-amber-800">
                  Amount: Rs {pendingPayment.total}. Provider: {pendingPayment.provider.toUpperCase()}.
                </p>
                <div className="mt-2 grid gap-1 text-xs font-bold text-amber-900">
                  <span>Session: {pendingPayment.sessionStatus || "ready"}</span>
                  {pendingPayment.providerOrderId && (
                    <span className="break-all">Provider order: {pendingPayment.providerOrderId}</span>
                  )}
                  {pendingPayment.paymentSessionId &&
                    pendingPayment.paymentSessionId !== pendingPayment.providerOrderId && (
                      <span className="break-all">Payment session: {pendingPayment.paymentSessionId}</span>
                    )}
                </div>
                {pendingPayment.provider !== "manual" && pendingPayment.sessionStatus === "ready" && (
                  <button
                    type="button"
                    onClick={startGatewayPayment}
                    disabled={isStartingGatewayPayment || isConfirmingPayment}
                    className="mt-3 w-full rounded-md bg-slate-950 px-4 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:bg-slate-300"
                  >
                    {isStartingGatewayPayment ? "Opening Gateway" : "Pay Online"}
                  </button>
                )}
                {pendingPayment.provider !== "manual" && pendingPayment.checkoutUrl && (
                  <a
                    href={pendingPayment.checkoutUrl}
                    className="mt-2 inline-flex text-sm font-black text-amber-900 underline"
                  >
                    Open payment page
                  </a>
                )}
                {(pendingPayment.provider === "manual" || pendingPayment.sessionStatus !== "ready") && (
                  <>
                    <input
                      value={paymentReference}
                      onChange={(event) => setPaymentReference(event.target.value)}
                      className="mt-3 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-600"
                      placeholder="Payment reference"
                    />
                    <button
                      type="button"
                      onClick={confirmPayment}
                      disabled={isConfirmingPayment}
                      className="mt-3 w-full rounded-md bg-amber-600 px-4 py-3 text-sm font-black text-white hover:bg-amber-700 disabled:bg-slate-300"
                    >
                      {isConfirmingPayment ? "Confirming" : "Confirm Payment"}
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="mb-4 grid grid-cols-2 gap-2">
              <SegmentButton
                active={orderType === "pickup"}
                label="Pickup"
                onClick={() => {
                  setOrderType("pickup");
                  setMessage("");
                }}
              />
              <SegmentButton
                active={orderType === "delivery"}
                label="Delivery"
                onClick={() => {
                  setOrderType("delivery");
                  setMessage("");
                }}
              />
            </div>

            <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div
                className={`rounded-md border p-3 ${
                  orderType === "pickup"
                    ? "border-red-200 bg-red-50"
                    : "border-slate-200 bg-slate-50"
                }`}
              >
                <p className="text-sm font-black text-slate-900">Pickup</p>
                <p className="mt-1 text-xs font-semibold text-slate-600">
                  Ready around 20-25 min. Pay online or at counter.
                </p>
              </div>
              <div
                className={`rounded-md border p-3 ${
                  orderType === "delivery"
                    ? "border-red-200 bg-red-50"
                    : "border-slate-200 bg-slate-50"
                }`}
              >
                <p className="text-sm font-black text-slate-900">Delivery</p>
                <p className="mt-1 text-xs font-semibold text-slate-600">
                  Fee and ETA are checked from address and zone before order.
                </p>
              </div>
            </div>

            <div className="mb-5 space-y-3">
              {cart.map((item) => (
                <div key={item.cart_key} className="grid grid-cols-12 items-center gap-3">
                  <div className="col-span-6">
                    <p className="font-bold leading-5">{item.name}</p>
                    <p className="text-sm text-slate-500">Rs {item.selling_price}</p>
                    {item.selected_options.length > 0 && (
                      <p className="mt-1 text-xs font-semibold text-slate-500">
                        {item.selected_options
                          .map(optionLabel)
                          .join(" | ")}
                      </p>
                    )}
                  </div>
                  <div className="col-span-3 flex items-center justify-center gap-1">
                    <IconButton label="Decrease" onClick={() => updateQuantity(item.cart_key, -1)} icon={Minus} />
                    <span className="w-6 text-center text-sm font-black">{item.quantity}</span>
                    <IconButton label="Increase" onClick={() => updateQuantity(item.cart_key, 1)} icon={Plus} />
                  </div>
                  <div className="col-span-3 text-right font-black">
                    Rs {roundMoney(item.quantity * item.selling_price)}
                  </div>
                </div>
              ))}
              {!cart.length && (
                <div className="rounded-md border border-dashed border-slate-300 p-5 text-center text-sm font-semibold text-slate-500">
                  Cart is empty.
                </div>
              )}
            </div>

            <div className="mb-5 flex gap-2">
              <div className="relative flex-1">
                <Percent className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={couponCode}
                  onChange={(event) => {
                    setCouponCode(event.target.value);
                    setQueuedCouponCode("");
                    setCoupon(null);
                  }}
                  placeholder="Coupon"
                  className="w-full rounded-md border border-slate-300 py-3 pl-10 pr-3 outline-none focus:border-red-600"
                />
              </div>
              {coupon ? (
                <button
                  type="button"
                  onClick={() => {
                    setCoupon(null);
                    setCouponCode("");
                    setQueuedCouponCode("");
                  }}
                  className="rounded-md border border-slate-300 px-3 text-slate-700 hover:border-red-600"
                  title="Remove coupon"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={applyCoupon}
                  disabled={isApplyingCoupon}
                  className="rounded-md bg-slate-950 px-4 font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isApplyingCoupon ? "Applying" : "Apply"}
                </button>
              )}
            </div>

            {queuedCouponCode && !coupon && (
              <div className="mb-5 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-800">
                {queuedCouponCode} is selected. Add items or update the cart and it will apply automatically.
              </div>
            )}

            {activePromotions.length > 0 && (
              <div className="mb-5 flex flex-wrap gap-2">
                {checkoutPromotions.map((promotion) => {
                  const isApplied = coupon?.promotion.code === promotion.code;
                  const isSelected = queuedCouponCode === promotion.code;
                  return (
                    <button
                      key={`checkout-${promotion.id}`}
                      type="button"
                      onClick={() => applyPromotion(promotion)}
                      className={`rounded-full border px-3 py-1 text-xs font-black hover:border-red-700 ${
                        isApplied || isSelected
                          ? "border-red-700 bg-red-700 text-white"
                          : "border-red-100 bg-red-50 text-red-700"
                      }`}
                    >
                      {isApplied ? "Applied" : isSelected ? "Selected" : "Use"} {promotion.code}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mb-5 space-y-2 border-y border-slate-200 py-4 text-sm">
              <PriceRow label="Subtotal" value={subtotal} />
              <PriceRow label="Discount" value={discount} />
              <PriceRow label="Tax" value={tax} />
              {orderType === "delivery" && (
                <PriceRow label="Delivery" value={deliveryFee} />
              )}
              <div className="flex justify-between text-lg font-black">
                <span>Total</span>
                <span>Rs {total}</span>
              </div>
            </div>

            <div className="space-y-3">
              <FieldIcon icon={User}>
                <input
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  placeholder="Name"
                  required
                  className="w-full outline-none"
                />
              </FieldIcon>
              <FieldIcon icon={Phone}>
                <input
                  value={customerPhone}
                  onChange={(event) => setCustomerPhone(event.target.value)}
                  placeholder="Phone"
                  required
                  className="w-full outline-none"
                />
              </FieldIcon>
              <FieldIcon icon={Mail}>
                <input
                  value={customerEmail}
                  onChange={(event) => setCustomerEmail(event.target.value)}
                  placeholder="Email for receipts and offers"
                  type="email"
                  className="w-full outline-none"
                />
              </FieldIcon>
              <label className="flex items-start gap-3 rounded-md border border-slate-300 px-3 py-3 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={optInMarketing}
                  onChange={(event) => setOptInMarketing(event.target.checked)}
                  className="mt-1"
                />
                Send me Pizza Blitz offers and order updates on my saved contact details.
              </label>
              {orderType === "delivery" && (
                <>
                  <FieldIcon icon={MapPin}>
                    <input
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                      placeholder="Delivery address"
                      className="w-full outline-none"
                    />
                  </FieldIcon>
                  <select
                    value={selectedDeliveryZoneId || ""}
                    onChange={(event) =>
                      setSelectedDeliveryZoneId(Number(event.target.value) || null)
                    }
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm font-bold text-slate-700 outline-none focus:border-red-600"
                  >
                    {deliveryZones.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.name} | Rs {zone.delivery_fee} | Min Rs {Math.round(zone.minimum_order_amount || 0)} | {zone.eta_window}
                      </option>
                    ))}
                  </select>
                  <div
                    className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                      deliveryQuote?.is_deliverable
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-slate-50 text-slate-600"
                    }`}
                  >
                    {isQuotingDelivery
                      ? "Checking delivery"
                      : deliveryQuote?.is_deliverable
                      ? `Delivery ${deliveryQuote.zone?.name || ""}: Rs ${deliveryFee}, ETA ${eta}`
                      : `${deliveryQuote?.reason || "Delivery fee appears after address and zone."}${
                          deliveryMinimumGap ? ` Add Rs ${Math.round(deliveryMinimumGap)} more.` : ""
                        }`}
                  </div>
                  {deliveryQuote?.address_validation && (
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                        <p className="font-black uppercase text-slate-400">Score</p>
                        <p className="mt-1 font-black text-slate-900">
                          {deliveryQuote.address_validation.score}/100
                        </p>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                        <p className="font-black uppercase text-slate-400">Area</p>
                        <p className="mt-1 truncate font-black text-slate-900">
                          {deliveryQuote.address_validation.matched_keyword || "Selected"}
                        </p>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                        <p className="font-black uppercase text-slate-400">With Fee</p>
                        <p className="mt-1 font-black text-slate-900">
                          Rs {Math.round(deliveryQuote.charge_breakdown?.total_with_delivery || total)}
                        </p>
                      </div>
                    </div>
                  )}
                  {!!deliveryQuote?.address_validation?.warnings?.length && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                      {deliveryQuote.address_validation.warnings.join(" ")}
                    </div>
                  )}
                </>
              )}
              <div className="grid grid-cols-2 gap-2">
                <SegmentButton
                  active={paymentMethod === "prepaid"}
                  label="Prepaid"
                  onClick={() => {
                    setPaymentMethod("prepaid");
                    setMessage("");
                  }}
                />
                <SegmentButton
                  active={paymentMethod === "cash"}
                  label="Cash"
                  onClick={() => {
                    setPaymentMethod("cash");
                    setMessage("");
                  }}
                />
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                {paymentMethod === "prepaid"
                  ? "Prepaid creates a payment session first; manual mode can be confirmed immediately for controlled testing."
                  : "Cash keeps the order open for counter or delivery collection."}
              </div>
              <button
                disabled={!canSubmitOrder}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-red-700 px-5 py-4 font-black text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <CreditCard className="h-5 w-5" />
                {isSubmitting ? "Placing Order" : "Place Order"}
              </button>
            </div>
          </form>
        </aside>
      </main>

      {!!cart.length && !isCheckoutVisible && (
        <a
          href="#checkout"
          className="fixed inset-x-3 bottom-3 z-40 flex items-center justify-between rounded-lg bg-slate-950 px-4 py-3 text-white shadow-2xl md:hidden"
        >
          <span className="flex items-center gap-2 text-sm font-black">
            <ShoppingBag className="h-4 w-4 text-red-300" />
            {cart.length} item{cart.length === 1 ? "" : "s"}
          </span>
          <span className="text-sm font-black">Checkout Rs {total}</span>
        </a>
      )}
    </div>
  );
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function optionLabel(option: SelectedOption) {
  const delta = Number(option.price_delta || 0);
  const suffix = delta > 0 ? ` +Rs ${delta}` : "";
  return `${option.group_name}: ${option.option_name}${suffix}`;
}

function offerLabel(promotion: ActivePromotion) {
  const value = Number(promotion.discount_value || 0).toLocaleString();
  return promotion.discount_type === "percentage" ? `${value}% off` : `Rs ${value} off`;
}

function prioritizePromotions(
  promotions: ActivePromotion[],
  selectedCode: string,
  limit: number
) {
  const selectedPromotion = promotions.find((promotion) => promotion.code === selectedCode);
  const remainingPromotions = promotions.filter((promotion) => promotion.id !== selectedPromotion?.id);
  return selectedPromotion
    ? [selectedPromotion, ...remainingPromotions].slice(0, limit)
    : remainingPromotions.slice(0, limit);
}

function InfoBadge({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-bold">
      <Icon className="h-4 w-4 text-red-700" /> {label}
    </div>
  );
}

function SegmentButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-3 text-sm font-bold ${
        active
          ? "border-red-700 bg-red-700 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:border-red-600"
      }`}
    >
      {label}
    </button>
  );
}

function IconButton({
  label,
  onClick,
  icon: Icon,
}: {
  label: string;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:border-red-600 hover:text-red-700"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function PriceRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-slate-600">
      <span>{label}</span>
      <span>Rs {value}</span>
    </div>
  );
}

function FieldIcon({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-3 rounded-md border border-slate-300 px-3 py-3 focus-within:border-red-600">
      <Icon className="h-4 w-4 text-slate-400" />
      {children}
    </label>
  );
}
