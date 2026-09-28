import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { loadTerminalCatalog } from "@/lib/pos/catalog";
import { posDepartmentScopeFor } from "@/lib/pos/permissions";
import { PosTerminal } from "@/components/pos/PosTerminal";
import type { SystemRole } from "@/types/database";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * The cashier terminal route.
 *
 * A server component so the catalogue is loaded and cost-stripped before
 * anything reaches the browser — loadTerminalCatalog never selects
 * cost_price, so margin cannot be serialised into the client bundle by
 * accident. Role enforcement already happened in the layout (PosLayout
 * redirects anyone without a POS_TERMINAL_ROLES role before this ever
 * renders), so it's safe for this one read to use the service-role client.
 *
 * Uses service-role rather than the session client because the security
 * audit's RLS lockdown enabled RLS on every pos_* table with zero
 * policies — service-role-only access by design (see
 * 20260913090100_pos_tables_lockdown.sql). Every other POS data path in
 * the app already goes through service-role via an /api/pos/* route; this
 * page was the one place that still queried pos_products/pos_departments
 * directly with the session client, which the lockdown silently broke —
 * RLS denies return an empty result set, not an error, so the terminal
 * just showed "No products here yet" with no visible failure.
 *
 * force-dynamic because availability, stock and prices change during a
 * shift; a cached catalogue would let a cashier sell something marked sold
 * out minutes earlier.
 */
export const dynamic = "force-dynamic";

export default async function PosTerminalPage() {
  // Resolve the caller's department assignment before loading anything. The
  // layout has already confirmed they may be here at all (hasPosAccess);
  // this decides WHAT they may sell. Scoping the query rather than the
  // rendered list matters — filtering client-side would still ship the whole
  // catalogue to the browser.
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  const { data: me } = user?.email
    ? await session
        .from("system_users")
        .select("role, pos_access, pos_department_scope")
        .eq("email", user.email.toLowerCase())
        .eq("status", "active")
        .is("deleted_at", null)
        .maybeSingle()
    : { data: null };

  const departmentIds = posDepartmentScopeFor({
    role: (me?.role ?? null) as SystemRole | null,
    pos_access: me?.pos_access,
    pos_department_scope: me?.pos_department_scope,
  });

  const supabase = getServiceClient();
  const catalog = await loadTerminalCatalog(supabase, departmentIds);

  return <PosTerminal catalog={catalog} />;
}
