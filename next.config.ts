import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Images are resized by Supabase Storage, not by Vercel's optimiser — see
  // src/lib/supabaseImageLoader.ts for why (Vercel's allowance ran out on
  // 2026-10-05 and every uncached avatar started rendering as "needs
  // re-upload"). With a custom loader Next never proxies an image itself, so
  // there is no Vercel image quota to exhaust.
  //
  // remotePatterns is kept deliberately: it is unused while loader is
  // "custom", but it documents the one storage host this app renders from,
  // and it is what would take over again if the loader were ever removed.
  images: {
    loader: "custom",
    loaderFile: "./src/lib/supabaseImageLoader.ts",
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
