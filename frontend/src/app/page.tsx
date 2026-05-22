import Link from "next/link";
import {
  ArrowRight,
  Clock,
  MapPin,
  Phone,
  ShieldCheck,
  ShoppingBag,
  Star,
  Utensils,
} from "lucide-react";

const heroImage =
  "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1800&q=85";

const menuHighlights = [
  {
    name: "Margherita Pizza",
    detail: "Classic cheese, tomato sauce, crisp crust",
    price: "from Rs 199",
    image:
      "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=900&q=80",
  },
  {
    name: "Garlic Bread",
    detail: "Oven baked sides for pickup or delivery",
    price: "from Rs 119",
    image:
      "https://images.unsplash.com/photo-1619535860434-cf9b38f60d6a?auto=format&fit=crop&w=900&q=80",
  },
  {
    name: "Cold Coffee",
    detail: "Chilled beverage with quick counter handoff",
    price: "from Rs 99",
    image:
      "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=900&q=80",
  },
];

const serviceModes = [
  { label: "Pickup", value: "20-25 min", icon: ShoppingBag },
  { label: "Delivery", value: "35-45 min", icon: MapPin },
  { label: "Order Tracking", value: "Live status", icon: Clock },
];

export default function PublicHomePage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <section
        className="relative min-h-[88vh] overflow-hidden bg-slate-950 text-white"
        style={{
          backgroundImage: `linear-gradient(90deg, rgba(2,6,23,0.88), rgba(2,6,23,0.42), rgba(2,6,23,0.12)), url(${heroImage})`,
          backgroundPosition: "center",
          backgroundSize: "cover",
        }}
      >
        <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-5 py-5">
          <Link href="/" className="text-xl font-black tracking-wide">
            Pizza Blitz
          </Link>
          <nav className="flex items-center gap-2">
            <Link
              href="/account"
              className="rounded-md border border-white/40 px-4 py-2 text-sm font-bold text-white hover:bg-white hover:text-slate-950"
            >
              My Orders
            </Link>
            <Link
              href="/login"
              className="rounded-md border border-white/20 px-4 py-2 text-sm font-bold text-white/85 hover:bg-white hover:text-slate-950"
            >
              Admin
            </Link>
          </nav>
        </header>

        <div className="relative z-10 mx-auto flex min-h-[calc(88vh-84px)] max-w-7xl items-center px-5 pb-24 pt-10">
          <div className="max-w-2xl">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-bold backdrop-blur">
              <Star className="h-4 w-4 text-yellow-300" />
              Fresh pizza, pickup, delivery
            </p>
            <h1 className="text-5xl font-black leading-tight md:text-7xl">
              Pizza Blitz
            </h1>
            <p className="mt-5 max-w-xl text-lg font-medium leading-8 text-white/85">
              Hot pizzas, sides, drinks, coupons, prepaid checkout, and live order tracking from one place.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/order"
                className="inline-flex items-center gap-2 rounded-md bg-red-700 px-6 py-4 text-sm font-black text-white hover:bg-red-800"
              >
                Order Online <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/track"
                className="inline-flex items-center gap-2 rounded-md border border-white/50 px-6 py-4 text-sm font-black text-white hover:bg-white hover:text-slate-950"
              >
                Track Order
              </Link>
            </div>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-white/15 bg-slate-950/72 backdrop-blur">
          <div className="mx-auto grid max-w-7xl grid-cols-1 gap-3 px-5 py-4 md:grid-cols-3">
            {serviceModes.map((mode) => {
              const Icon = mode.icon;
              return (
                <div key={mode.label} className="flex items-center gap-3 text-white">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white/12">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase text-white/55">{mode.label}</p>
                    <p className="font-black">{mode.value}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-12">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-widest text-red-700">Popular picks</p>
            <h2 className="mt-2 text-3xl font-black">Fast-moving Pizza Blitz favorites</h2>
          </div>
          <Link
            href="/order"
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-800 hover:border-red-700 hover:text-red-700"
          >
            View Full Menu <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {menuHighlights.map((item) => (
            <article key={item.name} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <img src={item.image} alt={item.name} className="h-56 w-full object-cover" />
              <div className="p-5">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <h3 className="text-xl font-black">{item.name}</h3>
                  <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-black text-red-700">
                    {item.price}
                  </span>
                </div>
                <p className="text-sm font-medium leading-6 text-slate-600">{item.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-5 py-10 md:grid-cols-3">
          <Info icon={Utensils} label="Catalog" value="Pizza, sides, beverages, desserts" />
          <Info icon={ShieldCheck} label="Checkout" value="Coupon support and prepaid flow" />
          <Info icon={Phone} label="Customer Care" value="Saved contact details for order history" />
        </div>
      </section>
    </main>
  );
}

function Info({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-md bg-slate-950 text-white">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs font-black uppercase tracking-widest text-slate-500">{label}</p>
        <p className="mt-1 font-bold text-slate-900">{value}</p>
      </div>
    </div>
  );
}
