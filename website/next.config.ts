import type { NextConfig } from "next";
import path from "node:path";

// Deliberately bare. This app is a public marketing site: no Supabase, no
// image loader, no ADMS rewrites, no middleware.
//
// `turbopack.root` is pinned because this app sits inside the management
// app's repository and both have their own lockfile. Without it Next walks
// up, finds the parent lockfile first and treats D:/Gym/levelup-gym as the
// workspace root — which is how the parent's middleware and config would
// start leaking into a build that must stay completely independent.
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
