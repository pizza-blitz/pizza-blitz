const localServerRewrites = process.env.VERCEL
  ? []
  : [
      {
        source: "/server/:path*",
        destination: "http://127.0.0.1:8010/:path*",
      },
    ];

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  async rewrites() {
    return localServerRewrites;
  },
};

export default nextConfig;
