import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // ZKTeco ADMS protocol sends to /iclock/cdata — rewrite to our handler
      { source: "/iclock/cdata", destination: "/api/attendance/push" },
      { source: "/iclock/cdata/:path*", destination: "/api/attendance/push" },
      { source: "/iclock/getrequest", destination: "/api/attendance/getrequest" },
      { source: "/iclock/getrequest/:path*", destination: "/api/attendance/getrequest" },
      { source: "/iclock/devicecmd", destination: "/api/attendance/devicecmd" },
      { source: "/iclock/devicecmd/:path*", destination: "/api/attendance/devicecmd" },
      // Face-recognition devices push captured punch photos here — we don't
      // store them, just need to acknowledge so the device doesn't retry.
      { source: "/iclock/fdata", destination: "/api/attendance/fdata" },
      { source: "/iclock/fdata/:path*", destination: "/api/attendance/fdata" },
    ];
  },
};

export default nextConfig;
