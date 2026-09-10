import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Phase 3D: lets next/image optimise images served from this project's
  // own Supabase Storage buckets (member-photos, member-docs, and the new
  // pos-products). Scoped to exactly this project's storage host via
  // pathname, not a wildcard "any supabase.co project" pattern — the
  // narrowest rule that makes next/image work at all. Public buckets only;
  // this grants no read access beyond what the bucket's own public flag
  // already allows.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "vravpfergmzparbqsgkk.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
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
