/** @type {import('next').NextConfig} */
const nextConfig = {
  skipTrailingSlashRedirect: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
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
