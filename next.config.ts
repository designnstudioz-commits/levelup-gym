import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // ZKTeco ADMS protocol sends to /iclock/cdata — rewrite to our handler
      { source: "/iclock/cdata", destination: "/api/attendance/push" },
      { source: "/iclock/cdata/:path*", destination: "/api/attendance/push" },
    ];
  },
};

export default nextConfig;
