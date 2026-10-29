import type { MetadataRoute } from "next";

// Local fallback: a frontend started on the loopback address answers visits to
// either spelling with `localhost`, so that is the name the metadata uses. Set
// PIZZA_BLITZ_SITE_URL to the real public address for any deployed environment.
const siteUrl =
  process.env.PIZZA_BLITZ_SITE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "http://localhost:3011";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/dashboard",
        "/login",
        "/api",
        "/kds",
        "/kitchen-ticket",
        "/orders",
        "/operations",
        "/settings",
        "/menu",
        "/departments",
        "/ceo",
        "/counter",
        "/customers",
        "/daily",
        "/expenses",
        "/feedback",
        "/inventory",
        "/invoices",
        "/journeys",
        "/marketing",
        "/messaging",
        "/ops",
        "/promotions",
        "/purchase-orders",
        "/recipes",
        "/reports",
        "/roadmap",
        "/sales",
        "/shifts",
        "/social",
        "/support-inbox",
        "/vendors",
        "/waste",
        "/account",
        "/receipt",
        "/order/confirmation",
        "/customer-display",
        "/rider",
      ],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
