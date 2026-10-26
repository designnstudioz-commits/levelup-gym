import type { NextConfig } from "next";
import path from "node:path";

// Deliberately bare. This app is a public marketing site: no Supabase, no
// image loader, no ADMS rewrites, and no middleware of its own.
//
// `turbopack.root` pins the DEV server to this directory. This app sits
// inside the management app's repository, and that app has a middleware.ts
// at the repository root importing @supabase/ssr — a dependency this app
// does not and must not have. Without the pin, two lockfiles make Next walk
// up and adopt the repository root as the workspace, dragging that
// middleware in.
//
// Production builds use webpack instead (see package.json). On Vercel,
// turbopack could not be contained: the platform sets outputFileTracingRoot
// to the repository root, Next requires both roots to match, resolves the
// conflict in favour of outputFileTracingRoot, and the root middleware comes
// back into scope — "Can't resolve '@supabase/ssr'". Setting
// outputFileTracingRoot here instead breaks where Vercel looks for the build
// output. Webpack scopes middleware discovery to the project directory, so
// the question does not arise.
const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;
