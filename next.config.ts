import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    proxyTimeout: 300_000, // 5분 — Workflow 처리 시간 대응
  },
  async rewrites() {
    return [
      {
        source: "/mastra/:path*",
        destination: `${process.env.MASTRA_SERVER_URL || "http://localhost:4111"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
