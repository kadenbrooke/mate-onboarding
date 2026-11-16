import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // heic-decode loads libheif as WebAssembly at run time (Lead Snapshot HEIC
  // conversion, src/lib/leads/heicToJpeg.ts). Kept out of the server bundle and
  // loaded from node_modules, which the KVM2 image ships (Dockerfile run stage).
  serverExternalPackages: ["heic-decode", "libheif-js"],
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
