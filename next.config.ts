import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The Leads tab became the Pipeline tab (2026-08-11). Old links live in
      // texts, emails, and browser history, so the route keeps answering.
      // 308 preserves the ?spotlight= query string automatically.
      {
        source: "/dash/:sessionId/leads",
        destination: "/dash/:sessionId/pipeline",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
