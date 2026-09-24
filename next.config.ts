import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // TypeScript errors should be caught by `npx tsc --noEmit` in CI.
    // Build-time checking is disabled to avoid duplicate passes.
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
  /** Security headers applied to all routes. */
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    },
  ],
};

export default nextConfig;
