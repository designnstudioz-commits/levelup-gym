import type { NextConfig } from "next";
import path from "node:path";

// Deliberately bare. This app is a public marketing site: no Supabase, no
// image loader, no ADMS rewrites, no middleware of its own.
//
// Both roots below must point at this directory, and both must be set.
//
// This app lives inside the management app's repository, and that app has a
// middleware.ts at the repository root which imports @supabase/ssr — a
// dependency this app does not and must not have. If Next treats the
// repository root as the workspace, it finds that middleware, tries to
// compile it, and the build dies on "Can't resolve '@supabase/ssr'".
//
// Locally, turbopack.root alone was enough. On Vercel it is not: the build
// sets outputFileTracingRoot to the repository root, Next sees the two roots
// disagree, warns, and resolves the conflict in favour of
// outputFileTracingRoot — putting the root middleware back in scope. Setting
// both to the same value is what the warning asks for and what keeps the two
// apps genuinely independent.
const here = path.resolve(__dirname);

const nextConfig: NextConfig = {
  outputFileTracingRoot: here,
  turbopack: { root: here },
};

export default nextConfig;
