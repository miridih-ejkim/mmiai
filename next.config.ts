import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    proxyTimeout: 300_000, // 5분 — Workflow 처리 시간 대응
  },
  async rewrites() {
    const mastraUrl =
      process.env.MASTRA_SERVER_URL || "http://localhost:4111";
    return [
      {
        source: "/mastra/:path*",
        destination: `${mastraUrl}/:path*`,
      },
      // A2A 프록시: /mastra/:path* 가 이미 ${mastraUrl}/:path* 로 전달하므로
      // A2A 엔드포인트는 /mastra/api/a2a/{agentId} 와 /mastra/api/.well-known/{agentId}/agent-card.json 으로 접근
    ];
  },
};

export default nextConfig;
