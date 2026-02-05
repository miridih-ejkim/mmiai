import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
