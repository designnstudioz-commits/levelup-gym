// Phase 3C — resolves a manager PIN against the pool of active
// owner/manager accounts. Shared by void, refund and the over-limit
// discount routes so the "who may authorise this" lookup exists once.

import { createClient as createServiceClient } from "@supabase/supabase-js";
import { findMatchingManager } from "./managerPin";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface ResolvedManager {
  id: string;
  fullName: string;
}

/** Checks a PIN against every active owner/manager. Returns the matching
 *  manager, or null if the PIN matches none of them. */
export async function resolveManagerByPin(pin: string): Promise<ResolvedManager | null> {
  const admin = getServiceClient();
  const { data: candidates } = await admin
    .from("system_users")
    .select("id, full_name, manager_pin_hash")
    .in("role", ["owner", "manager"])
    .eq("status", "active")
    .is("deleted_at", null);

  const match = await findMatchingManager(
    pin,
    (candidates ?? []).map((c) => ({
      id: c.id,
      fullName: c.full_name,
      managerPinHash: c.manager_pin_hash,
    }))
  );

  return match ? { id: match.id, fullName: match.fullName } : null;
}
