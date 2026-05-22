"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
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

const MENU_API = getApiUrl("/api/v1/restaurant/menu/menu");
const ORDER_API = getApiUrl("/api/v1/restaurant/orders/");
const COUPON_API = getApiUrl("/api/v1/restaurant/promotions/validate-code");
const ACTIVE_PROMOS_API = getApiUrl("/api/v1/restaurant/promotions/active");
const CUSTOMER_STORAGE_KEY = "pizza_blitz_customer";
const REORDER_STORAGE_KEY = "pizza_blitz_reorder";

type MenuItem = {
  id: number;
  name: string;
  category: string;
  selling_price: number;
  cost_price: number;
  is_available: boolean;
};

type CartItem = MenuItem & {
  quantity: number;
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

type PendingPayment = {
  orderId: number;
  total: number;
  provider: string;
  reference: string;
  sessionId?: string;
  checkoutUrl?: string | null;
  sessionStatus?: string;
};

type ReorderDraft = {
  customer?: {
    name?: string;
    phone?: string;
    email?: string;
    opt_in_marketing?: boolean;
  };
  items?: { name?: string; quantity?: number }[];
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

export default function PublicOrderPage() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [activePromotions, setActivePromotions] = useState<ActivePromotion[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
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
  const [coupon, setCoupon] = useState<CouponResult | null>(null);
  const [message, setMessage] = useState("");
  const [orderId, setOrderId] = useState<number | null>(null);
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);

  useEffect(() => {
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

  const applySavedReorder = (availableMenu: MenuItem[]) => {
    const savedReorder = window.localStorage.getItem(REORDER_STORAGE_KEY);
    if (!savedReorder) return;

    try {
      const draft = JSON.parse(savedReorder) as ReorderDraft;
      const requestedQuantities = new Map<string, number>();
      (draft.items || []).forEach((item) => {
        const name = String(item.name || "").trim().toLowerCase();
        const quantity = Number(item.quantity || 0);
        if (name && quantity > 0) {
          requestedQuantities.set(name, (requestedQuantities.get(name) || 0) + quantity);
        }
      });

      if (draft.customer) {
        setCustomerName(draft.customer.name || "");
        setCustomerPhone(draft.customer.phone || "");
        setCustomerEmail(draft.customer.email || "");
        setOptInMarketing(draft.customer.opt_in_marketing ?? true);
      }

      const nextCart = availableMenu
        .map((item) => {
          const quantity = requestedQuantities.get(item.name.trim().toLowerCase()) || 0;
          return quantity > 0 ? { ...item, quantity } : null;
        })
        .filter((item): item is CartItem => item !== null);

      if (!nextCart.length) {
        setMessage("Previous order items are not available right now.");
        return;
      }

      const missingCount = Math.max(requestedQuantities.size - nextCart.length, 0);
      setCart(nextCart);
      setCoupon(null);
      setCouponCode("");
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
  const total = coupon ? coupon.total : roundMoney(taxableSubtotal + tax);
  const eta = orderType === "pickup" ? "20-25 min" : "35-45 min";

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
  const trackingHref =
    orderId && customerPhone.trim()
      ? `/track?order=${orderId}&phone=${encodeURIComponent(customerPhone.trim())}`
      : "/account";

  const addToCart = (item: MenuItem) => {
    setOrderId(null);
    setPendingPayment(null);
    setMessage("");
    setCoupon(null);
    setCart((current) => {
      const existing = current.find((cartItem) => cartItem.id === item.id);
      if (existing) {
        return current.map((cartItem) =>
          cartItem.id === item.id
            ? { ...cartItem, quantity: cartItem.quantity + 1 }
            : cartItem
        );
      }
      return [...current, { ...item, quantity: 1 }];
    });
  };

  const updateQuantity = (itemId: number, delta: number) => {
    setCoupon(null);
    setCart((current) =>
      current
        .map((item) =>
          item.id === itemId ? { ...item, quantity: Math.max(item.quantity + delta, 0) } : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const applyCouponCode = async (code: string) => {
    const nextCode = code.trim();
    if (!nextCode) {
      setMessage("Enter a coupon code.");
      return;
    }
    setCouponCode(nextCode);
    if (!cart.length) {
      setCoupon(null);
      setMessage("Add items before applying a coupon.");
      return;
    }
    const response = await fetch(COUPON_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: nextCode, subtotal }),
    });
    const data = await response.json();
    if (!response.ok) {
      setCoupon(null);
      setMessage(data.detail || "Coupon could not be applied.");
      return;
    }
    setCoupon(data);
    setCouponCode(data.promotion.code || nextCode.toUpperCase());
    setMessage(`Applied ${data.promotion.code || nextCode.toUpperCase()}.`);
  };

  const applyCoupon = async () => {
    await applyCouponCode(couponCode);
  };

  const applyPromotion = async (promotion: ActivePromotion) => {
    if (!promotion.code) {
      setMessage("This offer is active but does not have a coupon code yet.");
      return;
    }
    await applyCouponCode(promotion.code);
  };

  const placeOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!cart.length) {
      setMessage("Add at least one item.");
      return;
    }
    if (orderType === "delivery" && !address.trim()) {
      setMessage("Delivery address is required.");
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
        notes: [
          `Customer website order`,
          `Fulfillment: ${orderType}`,
          `ETA: ${eta}`,
          address ? `Address: ${address}` : "",
          coupon ? `Coupon: ${coupon.promotion.code || couponCode.toUpperCase()}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
        items: cart.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          price: item.selling_price,
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
    if (paymentMethod === "prepaid") {
      const orderId = Number(data.order_id);
      const sessionResponse = await fetch(`${ORDER_API}${orderId}/payment-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "manual",
          return_url: `${window.location.origin}/account`,
        }),
      });
      const sessionData = await sessionResponse.json();

      if (!sessionResponse.ok) {
        setMessage(sessionData.detail || "Payment session could not be created.");
        return;
      }

      const paymentSession = sessionData.payment_session;
      const paymentReferenceValue = paymentSession.session_id || `WEB-${orderId}-${Date.now()}`;
      setOrderId(orderId);
      setCart([]);
      setCoupon(null);
      setCouponCode("");
      setPaymentReference(paymentReferenceValue);
      setPendingPayment({
        orderId,
        total: Number(data.total || 0),
        provider: paymentSession.provider || "manual",
        reference: paymentReferenceValue,
        sessionId: paymentSession.session_id,
        checkoutUrl: paymentSession.checkout_url,
        sessionStatus: paymentSession.status,
      });
      setMessage(`Order #${orderId} created. Confirm prepaid payment to mark it paid.`);
    } else {
      const orderId = Number(data.order_id);
      setOrderId(orderId);
      setCart([]);
      setCoupon(null);
      setCouponCode("");
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

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-5 py-6 xl:grid-cols-12">
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
                {activePromotions.slice(0, 4).map((promotion) => (
                  <button
                    key={promotion.id}
                    type="button"
                    onClick={() => applyPromotion(promotion)}
                    className={`rounded-md border p-4 text-left transition ${
                      coupon?.promotion.code === promotion.code
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
                      <span className="rounded-md bg-red-700 px-2 py-1 text-xs font-black text-white">
                        {promotion.code}
                      </span>
                    </div>
                    <p className="mt-3 text-xs font-bold text-slate-500">
                      {offerLabel(promotion)} until {promotion.end_date}
                    </p>
                  </button>
                ))}
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
            {filteredMenu.map((item) => (
              <article
                key={item.id}
                className="grid grid-cols-12 overflow-hidden rounded-lg border border-slate-200 bg-white"
              >
                <img
                  src={categoryImages[item.category] || fallbackImage}
                  alt={item.name}
                  className="col-span-4 h-full min-h-36 object-cover"
                />
                <div className="col-span-8 p-4">
                  <p className="text-xs font-bold text-red-700">{item.category}</p>
                  <h3 className="mt-1 min-h-12 text-lg font-black leading-6">{item.name}</h3>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="text-lg font-black">Rs {item.selling_price}</span>
                    <button
                      onClick={() => addToCart(item)}
                      className="flex items-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-sm font-bold text-white hover:bg-red-700"
                    >
                      <Plus className="h-4 w-4" /> Add
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside id="checkout" className="xl:col-span-4">
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
                  <CheckCircle2 className="h-4 w-4" /> Order #{orderId} confirmed
                </div>
                <Link
                  href={trackingHref}
                  className="mt-2 inline-flex text-sm font-black text-green-900 underline"
                >
                  Track this order
                </Link>
              </div>
            )}

            {pendingPayment && (
              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-4">
                <p className="font-black text-amber-900">Prepaid payment pending</p>
                <p className="mt-1 text-sm font-semibold text-amber-800">
                  Amount: Rs {pendingPayment.total}. Session: {pendingPayment.sessionStatus || "ready"}.
                </p>
                {pendingPayment.checkoutUrl && (
                  <a
                    href={pendingPayment.checkoutUrl}
                    className="mt-2 inline-flex text-sm font-black text-amber-900 underline"
                  >
                    Open payment return page
                  </a>
                )}
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
              </div>
            )}

            <div className="mb-4 grid grid-cols-2 gap-2">
              <SegmentButton
                active={orderType === "pickup"}
                label="Pickup"
                onClick={() => setOrderType("pickup")}
              />
              <SegmentButton
                active={orderType === "delivery"}
                label="Delivery"
                onClick={() => setOrderType("delivery")}
              />
            </div>

            <div className="mb-5 space-y-3">
              {cart.map((item) => (
                <div key={item.id} className="grid grid-cols-12 items-center gap-3">
                  <div className="col-span-6">
                    <p className="font-bold leading-5">{item.name}</p>
                    <p className="text-sm text-slate-500">Rs {item.selling_price}</p>
                  </div>
                  <div className="col-span-3 flex items-center justify-center gap-1">
                    <IconButton label="Decrease" onClick={() => updateQuantity(item.id, -1)} icon={Minus} />
                    <span className="w-6 text-center text-sm font-black">{item.quantity}</span>
                    <IconButton label="Increase" onClick={() => updateQuantity(item.id, 1)} icon={Plus} />
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
                  onChange={(event) => setCouponCode(event.target.value)}
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
                  className="rounded-md bg-slate-950 px-4 font-bold text-white hover:bg-red-700"
                >
                  Apply
                </button>
              )}
            </div>

            {activePromotions.length > 0 && (
              <div className="mb-5 flex flex-wrap gap-2">
                {activePromotions.slice(0, 3).map((promotion) => (
                  <button
                    key={`checkout-${promotion.id}`}
                    type="button"
                    onClick={() => applyPromotion(promotion)}
                    className="rounded-full border border-red-100 bg-red-50 px-3 py-1 text-xs font-black text-red-700 hover:border-red-700"
                  >
                    Use {promotion.code}
                  </button>
                ))}
              </div>
            )}

            <div className="mb-5 space-y-2 border-y border-slate-200 py-4 text-sm">
              <PriceRow label="Subtotal" value={subtotal} />
              <PriceRow label="Discount" value={discount} />
              <PriceRow label="Tax" value={tax} />
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
                <FieldIcon icon={MapPin}>
                  <input
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder="Delivery address"
                    className="w-full outline-none"
                  />
                </FieldIcon>
              )}
              <div className="grid grid-cols-2 gap-2">
                <SegmentButton
                  active={paymentMethod === "prepaid"}
                  label="Prepaid"
                  onClick={() => setPaymentMethod("prepaid")}
                />
                <SegmentButton
                  active={paymentMethod === "cash"}
                  label="Cash"
                  onClick={() => setPaymentMethod("cash")}
                />
              </div>
              <button
                disabled={isSubmitting || !cart.length}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-red-700 px-5 py-4 font-black text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <CreditCard className="h-5 w-5" />
                {isSubmitting ? "Placing Order" : "Place Order"}
              </button>
            </div>
          </form>
        </aside>
      </main>
    </div>
  );
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function offerLabel(promotion: ActivePromotion) {
  const value = Number(promotion.discount_value || 0).toLocaleString();
  return promotion.discount_type === "percentage" ? `${value}% off` : `Rs ${value} off`;
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
