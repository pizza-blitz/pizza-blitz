import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  BadgeCheck,
  ChefHat,
  Clock,
  CreditCard,
  Flame,
  Leaf,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Truck,
  Utensils,
} from "lucide-react";

import { BlazeDock, BlazeHeroCard } from "@/components/blaze/blaze-concierge";
import {
  AskBlazeButton,
  LandingCartLink,
  LandingMobileOrderBar,
  QuickAddButton,
} from "@/components/blaze/landing-order";
import { getServerApiUrl } from "@/lib/server-api";
import { storeMapHref, storeProfile } from "@/lib/store-profile";

export const revalidate = 60;

const heroImage =
  "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1800&q=85";
const storyImage =
  "https://images.unsplash.com/photo-1556910103-1c02745aae4d?auto=format&fit=crop&w=1200&q=80";

const categoryImages: Record<string, string> = {
  Pizza:
    "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=900&q=80",
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

const fallbackHighlights: StorefrontMenuItem[] = [
  { id: 1, name: "Margherita Pizza (R)", category: "Pizza", selling_price: 199, is_available: true },
  { id: 2, name: "Farmhouse Pizza (R)", category: "Pizza", selling_price: 249, is_available: true },
  { id: 3, name: "Garlic Bread", category: "Sides", selling_price: 119, is_available: true },
  { id: 4, name: "Cheese Burst Burger", category: "Burgers", selling_price: 149, is_available: true },
  { id: 5, name: "Cold Coffee", category: "Beverages", selling_price: 99, is_available: true },
  { id: 6, name: "Brownie", category: "Desserts", selling_price: 79, is_available: true },
];

type StorefrontMenuItem = {
  id: number;
  name: string;
  category: string;
  selling_price: number;
  is_available: boolean;
  image_url?: string | null;
  image_alt?: string | null;
};

type StorefrontPromotion = {
  code?: string | null;
  name?: string;
  description?: string | null;
  end_date?: string;
};

type StorefrontZone = {
  name?: string;
  eta_min_minutes?: number;
  eta_max_minutes?: number;
  minimum_order_amount?: number;
};

type StoreOpeningWindow = { open: string; close: string };

type StoreProfilePublic = {
  name?: string;
  tagline?: string | null;
  phone?: string | null;
  email?: string | null;
  address_line?: string | null;
  map_url?: string | null;
  instagram_url?: string | null;
  opening_hours?: Record<string, StoreOpeningWindow | null> | null;
  prep_time_minutes?: number;
  status?: {
    state?: "open" | "closed" | "paused";
    is_open?: boolean;
    accepting_orders?: boolean;
    message?: string;
    next_opening?: string | null;
    timezone?: string;
  };
};

type StorefrontContent = {
  hero_title?: string;
  hero_highlight?: string;
  hero_subtitle?: string;
  hero_image_url?: string | null;
  story_title?: string;
  story_body?: string;
  story_image_url?: string | null;
  category_images?: Record<string, string>;
};

type StorefrontPayload = {
  menu: StorefrontMenuItem[];
  active_promotions: StorefrontPromotion[];
  delivery_zones: StorefrontZone[];
  checkout_readiness?: { accepting_orders?: boolean };
  payment_checkout?: {
    prepaid_available?: boolean;
    cash_available?: boolean;
  };
  store_profile?: StoreProfilePublic;
  site_content?: StorefrontContent;
};

const emptyStorefront: StorefrontPayload = {
  menu: [],
  active_promotions: [],
  delivery_zones: [],
  checkout_readiness: { accepting_orders: true },
};

const siteUrl =
  process.env.PIZZA_BLITZ_SITE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "http://localhost:3011";

const DAY_ORDER = [
  ["mon", "Mon", "Monday"],
  ["tue", "Tue", "Tuesday"],
  ["wed", "Wed", "Wednesday"],
  ["thu", "Thu", "Thursday"],
  ["fri", "Fri", "Friday"],
  ["sat", "Sat", "Saturday"],
  ["sun", "Sun", "Sunday"],
] as const;

function formatOpeningHours(
  hours?: Record<string, StoreOpeningWindow | null> | null
): string {
  if (hours === null || hours === undefined) return "Open 24/7";
  const entries = DAY_ORDER.filter(([key]) => hours[key]);
  if (!entries.length) return "Closed every day";
  const windows = entries.map(([key]) => hours[key] as StoreOpeningWindow);
  const uniform =
    entries.length === 7 &&
    windows.every(
      (window) => window.open === windows[0].open && window.close === windows[0].close
    );
  if (uniform) return `Every day ${windows[0].open}–${windows[0].close}`;
  return entries
    .map(([key, short]) => `${short} ${hours[key]?.open}–${hours[key]?.close}`)
    .join(" · ");
}

function openingHoursSpecification(
  hours?: Record<string, StoreOpeningWindow | null> | null
) {
  if (!hours) return undefined;
  const specification = DAY_ORDER.filter(([key]) => hours[key]).map(([key, , full]) => ({
    "@type": "OpeningHoursSpecification" as const,
    dayOfWeek: full,
    opens: hours[key]?.open,
    closes: hours[key]?.close,
  }));
  return specification.length ? specification : undefined;
}

async function loadPublicProfile(): Promise<StoreProfilePublic | null> {
  try {
    const response = await fetch(getServerApiUrl("/api/v1/restaurant/storefront/profile"), {
      next: { revalidate: 60 },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { profile?: StoreProfilePublic };
    return payload.profile || null;
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const profile = await loadPublicProfile();
  const name = profile?.name || storeProfile.name;
  const tagline = profile?.tagline || "Hot pizza, pickup and delivery";
  const description = `Order pizza, sides, burgers, desserts and drinks from ${name}. Customise every item, apply offers, choose pickup or delivery, and follow your order live.`;
  return {
    title: { absolute: `${name} — ${tagline}` },
    description,
    alternates: { canonical: "/" },
    openGraph: {
      title: `${name} — ${tagline}`,
      description,
      type: "website",
      url: siteUrl,
      siteName: name,
      images: [{ url: heroImage, width: 1800, height: 1200, alt: `Fresh pizza at ${name}` }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${name} — ${tagline}`,
      description,
      images: [heroImage],
    },
  };
}

async function loadStorefront(): Promise<StorefrontPayload> {
  try {
    const response = await fetch(
      getServerApiUrl("/api/v1/restaurant/storefront/bootstrap"),
      { next: { revalidate: 60 } }
    );
    if (!response.ok) return emptyStorefront;
    const payload = (await response.json()) as Partial<StorefrontPayload>;
    return {
      menu: Array.isArray(payload.menu) ? payload.menu : [],
      active_promotions: Array.isArray(payload.active_promotions)
        ? payload.active_promotions
        : [],
      delivery_zones: Array.isArray(payload.delivery_zones) ? payload.delivery_zones : [],
      checkout_readiness: payload.checkout_readiness || { accepting_orders: true },
      payment_checkout: payload.payment_checkout,
      store_profile: payload.store_profile,
      site_content: payload.site_content,
    };
  } catch {
    return emptyStorefront;
  }
}

function highlightItems(menu: StorefrontMenuItem[]): StorefrontMenuItem[] {
  const available = menu.filter((item) => item.is_available);
  if (!available.length) return fallbackHighlights;
  const preferred = ["Pizza", "Sides", "Burgers", "Beverages", "Desserts", "Sandwiches"];
  const ordered = [...available].sort((left, right) => {
    const leftIndex = preferred.indexOf(left.category);
    const rightIndex = preferred.indexOf(right.category);
    return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
  });
  return ordered.slice(0, 6);
}

function formatPrice(value: number) {
  return `${storeProfile.currency} ${Math.round(Number(value || 0)).toLocaleString("en-IN")}`;
}

function pickupEtaLabel(prepTimeMinutes?: number | null): string {
  const prep = Number(prepTimeMinutes);
  if (!Number.isFinite(prep) || prep <= 0) return "20–25 min";
  const lower = Math.round(prep);
  return `${lower}–${lower + 5} min`;
}

function deliveryEtaLabel(zones: StorefrontZone[]): string {
  const zone = zones.find(
    (item) => Number(item.eta_min_minutes) > 0 && Number(item.eta_max_minutes) > 0
  );
  if (!zone) return "35–45 min";
  const lower = Math.round(Number(zone.eta_min_minutes));
  const upper = Math.round(Number(zone.eta_max_minutes));
  return upper > lower ? `${lower}–${upper} min` : `${upper} min`;
}

const faqs = [
  {
    question: "How long does pickup or delivery take?",
    answer:
      "The live pickup and delivery window is shown on this page and confirmed at checkout once you choose an address. It depends on the kitchen queue and your delivery zone, so we do not promise fixed times.",
  },
  {
    question: "How do I follow my order?",
    answer:
      "Every order gets a tracking link. Open Track Order, enter the order id and the phone number used for the order, and you will see the live kitchen and handoff status.",
  },
  {
    question: "Can I customise a pizza?",
    answer:
      "Yes. Choose a size, crust, toppings, dips, and combos on the product card. Prices update instantly and the kitchen receives the exact configuration.",
  },
  {
    question: "How do coupons work?",
    answer:
      "Apply a coupon in the cart or checkout. The discount is validated on the server against the current offer window, so the price you see is the price you pay.",
  },
  {
    question: "What payment methods are available?",
    answer:
      "Cash on pickup or delivery, and prepaid online payments when the gateway is enabled. Payments are processed by the configured provider; the store never stores card data.",
  },
  {
    question: "I have an allergy. What should I do?",
    answer:
      "Add the allergy to the order notes and speak to the store before ordering. Our kitchen handles wheat, dairy, and shared equipment, so we confirm ingredients case by case.",
  },
];

const promises = [
  {
    title: "Made after you order",
    detail: "Nothing sits under a lamp. Your pizza starts when the kitchen accepts the ticket.",
    icon: ChefHat,
  },
  {
    title: "Clear, final pricing",
    detail: "Taxes, delivery fees, and coupon discounts are calculated server-side before payment.",
    icon: BadgeCheck,
  },
  {
    title: "Track it live",
    detail: "See the kitchen, packing, and handoff stages without calling the store.",
    icon: Clock,
  },
  {
    title: "Payment choices",
    detail: "Pay cash at the counter or door, or prepay through a secure gateway when enabled.",
    icon: CreditCard,
  },
];

const standards = [
  {
    title: "Dough, handled with care",
    detail:
      "Small batches, consistent portioning, and a rested dough give the crust its structure. Every pizza is stretched to order.",
    icon: Flame,
  },
  {
    title: "Ingredients we can name",
    detail:
      "Cheese, sauce, vegetables, and toppings are stocked from traceable suppliers, with vendor price history kept in the kitchen system.",
    icon: Leaf,
  },
  {
    title: "Food safety first",
    detail:
      "Stock is logged, waste is recorded, and prep is planned from real sales data. Temperature and hygiene checks stay on the daily close checklist.",
    icon: ShieldCheck,
  },
  {
    title: "Packaging that travels",
    detail:
      "Vented boxes and sealed sides keep the crust crisp and the dips contained on the way to your door.",
    icon: Truck,
  },
];

export default async function PublicHomePage() {
  const storefront = await loadStorefront();
  const highlights = highlightItems(storefront.menu);
  const promotions = storefront.active_promotions.slice(0, 3);
  const zones = storefront.delivery_zones.slice(0, 6);
  const acceptingOrders = storefront.checkout_readiness?.accepting_orders !== false;
  const profile = storefront.store_profile;
  const siteContent = storefront.site_content;
  const heroImageUrl = siteContent?.hero_image_url || heroImage;
  const storyImageUrl = siteContent?.story_image_url || storyImage;
  const categoryImageMap = {
    ...categoryImages,
    ...(siteContent?.category_images || {}),
  };
  const categoryImageFor = (category: string) =>
    categoryImageMap[category] || categoryImageMap.Pizza;
  const storeName = profile?.name || storeProfile.name;
  const storeTagline = profile?.tagline || storeProfile.tagline;
  const storePhone = profile?.phone || storeProfile.phone;
  const storeEmail = profile?.email || storeProfile.supportEmail;
  const storeAddress = profile?.address_line || storeProfile.address;
  const storeInstagram = profile?.instagram_url || storeProfile.instagramUrl;
  const storeHoursText = formatOpeningHours(profile?.opening_hours);
  const orderingState = profile?.status?.state || (acceptingOrders ? "open" : "closed");
  const statusLabel =
    orderingState === "open"
      ? "Taking orders"
      : orderingState === "paused"
        ? "Ordering paused"
        : "Closed now";
  const statusMessage =
    profile?.status?.message ||
    (acceptingOrders
      ? "The kitchen is online. Customise any item and choose pickup or delivery at checkout."
      : "The store has paused online ordering for now. Please check back shortly.");
  const hasContact = Boolean(storePhone || storeAddress || storeEmail);
  const prepaidAvailable = storefront.payment_checkout?.prepaid_available === true;
  const cashAvailable = storefront.payment_checkout?.cash_available !== false;
  const pickupEta = pickupEtaLabel(profile?.prep_time_minutes);
  const deliveryEta = deliveryEtaLabel(storefront.delivery_zones);
  const paymentLabel = prepaidAvailable
    ? cashAvailable
      ? "Cash or prepaid"
      : "Prepaid online"
    : cashAvailable
      ? "Cash on pickup or delivery"
      : "Payment shown at checkout";
  const contactHref =
    profile?.map_url ||
    (storeAddress
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          `${storeName} ${storeAddress}`
        )}`
      : storeMapHref());
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: storeName,
    description: `${storeName} is a neighbourhood pizza kitchen serving made-to-order pizza, sides, burgers, desserts, and drinks for pickup and delivery.`,
    servesCuisine: "Pizza",
    priceRange: "₹₹",
    url: siteUrl,
    hasMenu: `${siteUrl}/order`,
    acceptsReservations: false,
    ...(storePhone ? { telephone: storePhone } : {}),
    ...(storeAddress
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: storeAddress,
          },
        }
      : {}),
    ...(openingHoursSpecification(profile?.opening_hours)
      ? { openingHoursSpecification: openingHoursSpecification(profile?.opening_hours) }
      : {}),
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };

  return (
    <main className="min-h-screen bg-[#faf6ef] text-[#17130f]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />

      {/* Hero */}
      <section className="relative isolate overflow-hidden bg-[#17130f] text-white">
        <Image
          src={heroImageUrl}
          alt="Freshly baked pizza with melted cheese and basil"
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-70"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#17130f] via-[#17130f]/85 to-[#17130f]/35" />

        <header className="relative z-10 border-b border-white/10">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 md:px-8">
            <Link href="/" className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-red-600 text-lg font-black">
                PB
              </span>
              <span className="text-lg font-black tracking-tight sm:text-xl">{storeName}</span>
            </Link>
            <nav aria-label="Primary" className="hidden items-center gap-6 text-sm font-bold text-white/80 md:flex">
              <a href="#menu" className="hover:text-white">Menu</a>
              <a href="#offers" className="hover:text-white">Offers</a>
              <a href="#standards" className="hover:text-white">Our kitchen</a>
              <a href="#faq" className="hover:text-white">FAQ</a>
            </nav>
            <div className="flex items-center gap-2">
              <Link
                href="/track"
                className="hidden rounded-lg border border-white/30 px-4 py-2 text-sm font-bold text-white hover:bg-white hover:text-[#17130f] sm:inline-flex"
              >
                Track order
              </Link>
              <LandingCartLink className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-black text-white hover:bg-red-500" />
            </div>
          </div>
        </header>

        <div className="relative z-10 mx-auto grid max-w-7xl gap-12 px-5 pb-16 pt-14 md:px-8 md:pb-24 md:pt-20 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.18em]">
              <Sparkles className="h-4 w-4 text-amber-300" />
              Fresh dough · fired to order
            </p>
            <h1 className="mt-6 max-w-2xl text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
              {siteContent?.hero_title || "Pizza that shows up"}{" "}
              <span className="text-amber-300">
                {siteContent?.hero_highlight || "in a Blitz."}
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-base font-medium leading-7 text-white/80 sm:text-lg">
              {siteContent?.hero_subtitle ||
                "Hand-stretched pizza, loaded sides, thick shakes, and desserts — with server-verified pricing, coupons that actually apply, and live tracking from oven to doorstep."}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/order"
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-6 py-4 text-sm font-black uppercase tracking-wide text-white hover:bg-red-500"
              >
                <ShoppingBag className="h-5 w-5" /> Start your order
              </Link>
              <a
                href="#menu"
                className="inline-flex items-center gap-2 rounded-xl border border-white/30 px-6 py-4 text-sm font-black uppercase tracking-wide text-white hover:bg-white hover:text-[#17130f]"
              >
                View the menu
              </a>
            </div>
            <div className="mt-8 grid max-w-xl grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {[
                { icon: Clock, label: "Pickup", value: pickupEta },
                { icon: Truck, label: "Delivery", value: deliveryEta },
                { icon: MapPin, label: "Tracking", value: "Live" },
                { icon: ShieldCheck, label: "Payments", value: "Secure" },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <Icon className="h-4 w-4 text-amber-300" />
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-white/50">
                      {item.label}
                    </p>
                    <p className="text-sm font-black">{item.value}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="w-full self-end lg:max-w-[380px] lg:justify-self-end">
            <BlazeHeroCard />
            <div className="mt-3 rounded-2xl border border-white/[0.12] bg-[#17130f]/80 p-4 backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-black">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      orderingState === "open"
                        ? "bg-emerald-400"
                        : orderingState === "paused"
                          ? "bg-amber-400"
                          : "bg-rose-400"
                    }`}
                  />
                  {statusLabel}
                </p>
                <p className="text-[11px] font-bold text-white/60">
                  {pickupEta} pickup · {deliveryEta} delivery
                </p>
              </div>
              <p className="mt-2 text-xs font-medium leading-5 text-white/60">{statusMessage}</p>
              <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                Coupons apply in cart · {paymentLabel}
              </p>
            </div>
          </aside>
        </div>
      </section>

      {/* Trust strip */}
      <section aria-label="What you can count on" className="border-b border-[#17130f]/10 bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2 md:px-8 lg:grid-cols-4">
          {[
            { icon: BadgeCheck, label: "Prices verified server-side" },
            { icon: Clock, label: "Live order tracking" },
            { icon: CreditCard, label: paymentLabel },
            { icon: Leaf, label: "Allergen info on request" },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <p
                key={item.label}
                className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-[#5a4f45]"
              >
                <Icon className="h-4 w-4 shrink-0 text-red-700" />
                {item.label}
              </p>
            );
          })}
        </div>
      </section>

      {/* Menu highlights */}
      <section id="menu" className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-red-700">The menu</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              Fan favourites, made to order
            </h2>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-[#5a4f45]">
              Prices below come straight from the live menu. Tap Add for our default recipe, or
              Customise to pick the size, crust, toppings, dips, and combos.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AskBlazeButton
              seed="Recommend something for me"
              className="inline-flex items-center gap-2 rounded-xl bg-[#17130f] px-5 py-3 text-sm font-black text-white hover:bg-[#2c241d]"
            >
              <Sparkles className="h-4 w-4 text-amber-300" aria-hidden="true" />
              Not sure? Ask Blaze
            </AskBlazeButton>
            <Link
              href="/order"
              className="inline-flex items-center gap-2 rounded-xl border border-[#17130f]/15 bg-white px-5 py-3 text-sm font-black text-[#17130f] hover:border-red-600 hover:text-red-700"
            >
              Full menu <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {highlights.map((item) => (
            <article
              key={`${item.id}-${item.name}`}
              className="group overflow-hidden rounded-2xl border border-[#17130f]/10 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="relative h-48 w-full overflow-hidden">
                {item.image_url ? (
                  <img
                    src={item.image_url}
                    alt={item.image_alt || item.name}
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                  />
                ) : (
                  <Image
                    src={categoryImageFor(item.category)}
                    alt={item.name}
                    fill
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover transition duration-500 group-hover:scale-105"
                  />
                )}
                <span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-[#17130f]">
                  {item.category}
                </span>
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-black tracking-tight">{item.name}</h3>
                  <span className="shrink-0 rounded-full bg-red-50 px-3 py-1 text-xs font-black text-red-700">
                    {formatPrice(item.selling_price)}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium leading-6 text-[#5a4f45]">
                  {item.category === "Pizza"
                    ? "Choose your size, crust, and toppings. Baked after you order."
                    : "Add it to your order and customise the details at checkout."}
                </p>
                <div className="mt-4">
                  <QuickAddButton
                    itemId={item.id}
                    itemName={item.name}
                    label={`Add · ${formatPrice(item.selling_price)}`}
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* How it works + offers */}
      <section className="border-y border-[#17130f]/10 bg-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 md:px-8 md:py-20 lg:grid-cols-2">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-red-700">How it works</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              Three steps, no phone calls
            </h2>
            <ol className="mt-8 space-y-5">
              {[
                {
                  title: "Build your order",
                  detail: "Pick items, customise sizes and toppings, and add sides or drinks.",
                  icon: Utensils,
                },
                {
                  title: "Choose pickup or delivery",
                  detail: "Enter your phone and address. Delivery zones, fees, and ETAs are checked instantly.",
                  icon: Truck,
                },
                {
                  title: "Pay and track",
                  detail: "Pay cash or prepay, then follow the live kitchen and handoff status.",
                  icon: Clock,
                },
              ].map((step, index) => {
                const Icon = step.icon;
                return (
                  <li key={step.title} className="flex gap-4">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#17130f] text-white">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8a7a6a]">
                        Step {index + 1}
                      </p>
                      <h3 className="mt-1 text-lg font-black">{step.title}</h3>
                      <p className="mt-1 text-sm font-medium leading-6 text-[#5a4f45]">{step.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          <div id="offers" className="rounded-2xl bg-[#17130f] p-6 text-white sm:p-8">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-amber-300">Live offers</p>
                <h2 className="mt-2 text-2xl font-black">Coupons you can use right now</h2>
              </div>
              <Star className="h-8 w-8 text-amber-300" />
            </div>
            <div className="mt-6 space-y-3">
              {promotions.length ? (
                promotions.map((promotion) => {
                  const cardContent = (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-lg font-black tracking-wide text-amber-300">
                          {promotion.code || promotion.name}
                        </p>
                        {promotion.end_date ? (
                          <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                            Ends {new Date(promotion.end_date).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                            })}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm font-semibold text-white/80">
                        {promotion.description || promotion.name}
                      </p>
                    </>
                  );
                  if (!promotion.code) {
                    return (
                      <div
                        key={promotion.code || promotion.name}
                        className="rounded-xl border border-white/10 bg-white/5 p-4"
                      >
                        {cardContent}
                      </div>
                    );
                  }
                  return (
                    <Link
                      key={promotion.code || promotion.name}
                      href={`/order?coupon=${encodeURIComponent(promotion.code)}`}
                      className="group block rounded-xl border border-white/10 bg-white/5 p-4 transition hover:border-amber-300/60 hover:bg-white/10"
                    >
                      {cardContent}
                      <p className="mt-3 inline-flex items-center gap-1 text-xs font-black uppercase tracking-widest text-amber-300">
                        Apply this offer <ArrowRight className="h-3.5 w-3.5" />
                      </p>
                    </Link>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-white/20 p-5 text-sm font-semibold text-white/70">
                  No public coupon is running this minute. Apply a code at checkout — every offer is
                  validated server-side against the live window.
                </div>
              )}
            </div>
            <Link
              href="/order"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-black text-[#17130f] hover:bg-amber-200"
            >
              Apply a coupon at checkout <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Kitchen standards / food detail */}
      <section id="standards" className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-20">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div className="relative h-72 overflow-hidden rounded-2xl sm:h-96 lg:h-[460px]">
            <Image
              src={storyImageUrl}
              alt="Pizza kitchen at work"
              fill
              sizes="(min-width: 1024px) 45vw, 100vw"
              className="object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#17130f]/90 to-transparent p-6 text-white">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">The kitchen</p>
              <p className="mt-1 text-xl font-black">
                {siteContent?.story_title || "Small batches. Real ingredients. No shortcuts."}
              </p>
            </div>
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-red-700">Food, explained</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              What good pizza service actually requires
            </h2>
            <p className="mt-3 max-w-xl text-sm font-medium leading-7 text-[#5a4f45]">
              {siteContent?.story_body ||
                "A restaurant is a supply chain, a kitchen, and a delivery network running at the same time. These are the standards we hold ourselves to — from dough handling to the box that reaches your door."}
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {standards.map((standard) => {
                const Icon = standard.icon;
                return (
                  <article key={standard.title} className="rounded-xl border border-[#17130f]/10 bg-white p-5">
                    <Icon className="h-5 w-5 text-red-700" />
                    <h3 className="mt-3 text-base font-black">{standard.title}</h3>
                    <p className="mt-1 text-sm font-medium leading-6 text-[#5a4f45]">
                      {standard.detail}
                    </p>
                  </article>
                );
              })}
            </div>
            <p className="mt-5 text-xs font-semibold leading-5 text-[#8a7a6a]">
              Allergens: our kitchen handles wheat, dairy, soy, and nuts on shared equipment. Add a
              note to your order and the team will confirm ingredients before preparation.
            </p>
          </div>
        </div>
      </section>

      {/* Pizza craft + food-safety detail */}
      <section className="border-y border-[#17130f]/10 bg-[#f1e9dc]">
        <div className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-20">
          <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-red-700">
                Pizza, decoded
              </p>
              <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
                A short guide to what makes a pizza kitchen work
              </h2>
              <p className="mt-3 text-sm font-medium leading-7 text-[#5a4f45]">
                Good pizza is a chain of small decisions: how the dough rests, how hot the deck is,
                how the cheese melts, and how the box travels. These are the fundamentals
                professional kitchens obsess over.
              </p>
              <ul className="mt-7 space-y-3">
                {[
                  "Daily temperature logs for cold storage, proofing, and cooked items.",
                  "First-in-first-out rotation and expiry checks on every delivery.",
                  "Allergen cross-contact controls, separate tools, and clear order notes.",
                  "Delivery time limits so food leaves the kitchen inside its safe window.",
                  "Portion scales and waste logs for consistent slices and honest margins.",
                ].map((item) => (
                  <li key={item} className="flex gap-3 text-sm font-semibold leading-6 text-[#3f362e]">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red-700" />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-xs font-semibold leading-5 text-[#8a7a6a]">
                These checks are part of our daily prep, close, and inventory routines — not
                marketing lines. Ask the team if you want the detail behind any of them.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {[
                {
                  title: "Dough needs time",
                  detail:
                    "Fermentation builds flavour and a lighter texture. A slow, temperature-controlled rise is why a good crust tastes of more than flour.",
                  icon: Clock,
                },
                {
                  title: "Heat does the rest",
                  detail:
                    "A hot deck oven gives oven spring and deep browning in minutes. Too cool, and the crust dries out before it colours.",
                  icon: Flame,
                },
                {
                  title: "Cheese is structure",
                  detail:
                    "Low-moisture mozzarella melts without flooding the base; blends balance stretch, richness, and browning.",
                  icon: Utensils,
                },
                {
                  title: "The box matters",
                  detail:
                    "Vented board releases steam so the crust stays crisp, while sealed sides keep dips and toppings where they belong.",
                  icon: Truck,
                },
              ].map((card) => {
                const Icon = card.icon;
                return (
                  <article key={card.title} className="rounded-2xl border border-[#17130f]/10 bg-white p-5">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#17130f] text-amber-300">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-4 text-base font-black">{card.title}</h3>
                    <p className="mt-2 text-sm font-medium leading-6 text-[#5a4f45]">
                      {card.detail}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Promises + delivery areas */}
      <section className="border-y border-[#17130f]/10 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-20">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {promises.map((promise) => {
              const Icon = promise.icon;
              return (
                <article key={promise.title} className="rounded-xl border border-[#17130f]/10 bg-[#faf6ef] p-5">
                  <Icon className="h-5 w-5 text-red-700" />
                  <h3 className="mt-3 text-base font-black">{promise.title}</h3>
                  <p className="mt-1 text-sm font-medium leading-6 text-[#5a4f45]">
                    {promise.detail}
                  </p>
                </article>
              );
            })}
          </div>

          <div className="mt-12 grid gap-8 lg:grid-cols-2">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-red-700">Delivery</p>
              <h2 className="mt-2 text-2xl font-black sm:text-3xl">Where we deliver</h2>
              <p className="mt-2 text-sm font-medium leading-6 text-[#5a4f45]">
                Delivery availability, fees, and ETAs are confirmed against your address at checkout.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {zones.length ? (
                  zones.map((zone) => (
                    <span
                      key={zone.name}
                      className="rounded-full border border-[#17130f]/10 bg-white px-3 py-2 text-xs font-bold text-[#17130f]"
                    >
                      {zone.name}
                      {zone.eta_max_minutes ? ` · ${zone.eta_min_minutes ?? ""}–${zone.eta_max_minutes} min` : ""}
                    </span>
                  ))
                ) : (
                  <span className="text-sm font-semibold text-[#5a4f45]">
                    Enter your address at checkout to see availability.
                  </span>
                )}
              </div>
            </div>

            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-red-700">Visit or contact</p>
              <h2 className="mt-2 text-2xl font-black sm:text-3xl">Store details</h2>
              <ul className="mt-5 space-y-3 text-sm font-semibold text-[#5a4f45]">
                {storeAddress ? (
                  <li className="flex items-start gap-3">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                    <span>{storeAddress}</span>
                  </li>
                ) : null}
                <li className="flex items-start gap-3">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                  <span>{storeHoursText}</span>
                </li>
                {storePhone ? (
                  <li className="flex items-start gap-3">
                    <Phone className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                    <a href={`tel:${storePhone}`} className="hover:text-red-700">
                      {storePhone}
                    </a>
                  </li>
                ) : null}
                {storeEmail ? (
                  <li className="flex items-start gap-3">
                    <Mail className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                    <a href={`mailto:${storeEmail}`} className="hover:text-red-700">
                      {storeEmail}
                    </a>
                  </li>
                ) : null}
              </ul>
              {!hasContact ? (
                <p className="mt-3 text-xs font-semibold leading-5 text-[#8a7a6a]">
                  Address and phone are published from the admin store profile as soon as they are
                  saved.
                </p>
              ) : null}
              {contactHref ? (
                <a
                  href={contactHref}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center gap-2 text-sm font-black text-red-700 hover:text-red-800"
                >
                  Open in maps <ArrowRight className="h-4 w-4" />
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-4xl px-5 py-16 md:py-20">
        <div className="text-center">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-red-700">Questions</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Before you order</h2>
        </div>
        <div className="mt-8 divide-y divide-[#17130f]/10 rounded-2xl border border-[#17130f]/10 bg-white">
          {faqs.map((faq) => (
            <details key={faq.question} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-base font-black">
                {faq.question}
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#faf6ef] text-lg leading-none text-[#17130f] transition group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm font-medium leading-7 text-[#5a4f45]">{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-red-700 text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-5 py-12 md:flex-row md:items-center md:px-8">
          <div>
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Hungry yet?</h2>
            <p className="mt-2 max-w-xl text-sm font-semibold text-white/85">
              Build your order in under two minutes. Pickup, delivery, coupons, and live tracking are
              built in.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/order"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-4 text-sm font-black text-red-700 hover:bg-amber-100"
            >
              Order online <ArrowRight className="h-4 w-4" />
            </Link>
            <AskBlazeButton
              seed="Help me build an order"
              className="inline-flex items-center gap-2 rounded-xl bg-amber-300 px-6 py-4 text-sm font-black text-[#17130f] hover:bg-amber-200"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Build it with Blaze
            </AskBlazeButton>
            <Link
              href="/track"
              className="inline-flex items-center gap-2 rounded-xl border border-white/40 px-6 py-4 text-sm font-black text-white hover:bg-white/10"
            >
              Track an order
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#17130f] text-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 md:grid-cols-4 md:px-8">
          <div className="md:col-span-2">
            <p className="text-xl font-black">{storeName}</p>
            <p className="mt-2 max-w-md text-sm font-medium leading-6 text-white/65">
              {storeTagline} Order pizza, sides, burgers, desserts, and drinks for pickup or delivery.
            </p>
            {storeInstagram ? (
              <a
                href={storeInstagram}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex text-sm font-bold text-amber-300 hover:text-amber-200"
              >
                Follow on Instagram
              </a>
            ) : null}
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-white/50">Order</p>
            <ul className="mt-4 space-y-2 text-sm font-semibold text-white/80">
              <li><Link href="/order" className="hover:text-white">Menu &amp; checkout</Link></li>
              <li><Link href="/track" className="hover:text-white">Track an order</Link></li>
              {/* Guarded pages answer with a redirect, so the router must not
                  prefetch them for a visitor who is not signed in yet. */}
              <li><Link href="/account" prefetch={false} className="hover:text-white">My orders</Link></li>
              <li><Link href="/account/login" className="hover:text-white">Customer sign in</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-white/50">Business</p>
            <ul className="mt-4 space-y-2 text-sm font-semibold text-white/80">
              <li><Link href="/careers" className="hover:text-white">Careers</Link></li>
              <li><Link href="/support" className="hover:text-white">Support</Link></li>
              {storeEmail ? (
                <li>
                  <a href={`mailto:${storeEmail}`} className="hover:text-white">
                    {storeEmail}
                  </a>
                </li>
              ) : null}
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-5 text-xs font-semibold text-white/50 sm:flex-row sm:items-center sm:justify-between md:px-8">
            <p>© {new Date().getFullYear()} {storeName}. All rights reserved.</p>
            <p>Prices include applicable taxes shown at checkout. Allergen information on request.</p>
          </div>
        </div>
      </footer>

      <LandingMobileOrderBar />
      <BlazeDock context="landing" />
    </main>
  );
}
