import type { MetadataRoute } from "next";

const siteUrl =
  process.env.PIZZA_BLITZ_SITE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "http://localhost:3011";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes: Array<{
    path: string;
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
    priority: number;
  }> = [
    { path: "/", changeFrequency: "daily", priority: 1 },
    { path: "/order", changeFrequency: "daily", priority: 0.9 },
    { path: "/track", changeFrequency: "monthly", priority: 0.5 },
    { path: "/careers", changeFrequency: "weekly", priority: 0.5 },
    { path: "/support", changeFrequency: "monthly", priority: 0.4 },
  ];

  return routes.map((route) => ({
    url: `${siteUrl}${route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
