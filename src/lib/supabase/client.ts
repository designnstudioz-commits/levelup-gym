import { createBrowserClient } from "@supabase/ssr";

// Using untyped client for now — types will be generated from Supabase CLI in a later step
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
