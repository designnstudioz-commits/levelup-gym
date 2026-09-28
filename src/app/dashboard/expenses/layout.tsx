import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Server-side guard for the Expenses module.
 *
 * The page itself also calls useRoleGuard, but that is a CLIENT hook: it
 * redirects after mount, which means the server has already rendered and
 * shipped the page markup to whoever asked. Found by a live authenticated
 * test on 2026-09-29 — a manager, receptionist and trainer each got HTTP 200
 * with the full Expenses page body before the client bounced them.
 *
 * No expense figures leaked, because the page loads its data client-side and
 * the "owner read expenses" RLS policy returns nothing to a non-owner. But
 * shipping the shell of an owner-only financial screen is the wrong default,
 * and nav visibility plus a client redirect is exactly the layered-but-weak
 * pattern the POS work moved away from.
 *
 * This runs before any render, so a non-owner never receives the page at
 * all. Mirrors how /dashboard/settings already gates owner-only access.
 */
export default async function ExpensesLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");

  const { data: me } = await supabase
    .from("system_users")
    .select("role")
    .eq("email", user.email.toLowerCase())
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  // Deny rather than defaulting to a role: an authenticated user with no
  // active staff row is not staff.
  if (me?.role !== "owner") redirect("/dashboard");

  return <>{children}</>;
}
