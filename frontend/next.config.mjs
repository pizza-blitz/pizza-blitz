/** @type {import('next').NextConfig} */
const isDevelopment = process.env.NODE_ENV === "development";

// `next start` answers loopback requests with one canonical alias of its own
// choosing, so a visit that began on `localhost` can be redirected to
// `127.0.0.1` or the other way round. A relative redirect is not an option
// because NextResponse.redirect rejects it, so when the site is a loopback
// address the policy lists both aliases and keeps 'self' doing the work in a
// real deployment. A deployed site sets PIZZA_BLITZ_SITE_URL to its public
// host, which leaves this allowance switched off.
const configuredSiteUrl =
  process.env.PIZZA_BLITZ_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "";
const isLoopbackSite =
  !configuredSiteUrl ||
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(configuredSiteUrl);
const loopbackOrigins = isLoopbackSite
  ? " http://127.0.0.1:3011 http://localhost:3011"
  : "";

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  `connect-src 'self' https: ws: wss: http://127.0.0.1:8010 http://localhost:8010${loopbackOrigins}`,
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  `form-action 'self'${loopbackOrigins}`,
  "manifest-src 'self'",
].join("; ");

const nextConfig = {
  skipTrailingSlashRedirect: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), geolocation=(self)",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
  async rewrites() {
    const apiBase =
      process.env.PIZZA_BLITZ_API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://127.0.0.1:8010";
    return [
      {
        source: "/media/:path*",
        destination: `${apiBase}/media/:path*`,
      },
    ];
  },
};

export default nextConfig;
