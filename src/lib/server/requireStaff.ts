import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { SystemRole } from "@/types/database";

/**
 * Caller authorisation for the non-POS staff API routes, mirroring what
 * requirePosUser() does for /api/pos/* (src/lib/pos/auth.ts).
 *
 * Identity keys on EMAIL, not auth.uid() — the app-wide convention. One live
 * account has a system_users.id that does not match its auth.users.id, so
 * anything resolving identity by auth.uid() silently fails for that account.
 *
 * Added 2026-09-19 after an audit found /api/devices/push-user,
 * /api/devices/delete-user and /api/devices/sync-access performing
 * service-role writes — which bypass RLS entirely — with no caller
 * authentication at all. All three were confirmed reachable unauthenticated
 * in production.
 */
export interface StaffCaller {
  id: string;
  email: string;
  role: SystemRole;
}

export type StaffAuthResult =
  | { ok: true; caller: StaffCaller }
  | { ok: false; response: NextResponse };

export async function requireStaff(allowedRoles: SystemRole[]): Promise<StaffAuthResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.email) {
    return { ok: false, response: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }

  const { data: row, error } = await supabase
    .from("system_users")
    .select("id, email, role")
    .eq("email", user.email.toLowerCase())
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    return { ok: false, response: NextResponse.json({ error: "Authorization check failed" }, { status: 500 }) };
  }

  // An authenticated Supabase user with no active system_users row is not a
  // staff member. Deny rather than defaulting to a role.
  if (!row?.role) {
    return { ok: false, response: NextResponse.json({ error: "No active staff account" }, { status: 403 }) };
  }

  const caller: StaffCaller = { id: row.id, email: row.email, role: row.role as SystemRole };

  if (!allowedRoles.includes(caller.role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "You do not have permission to perform this action" }, { status: 403 }),
    };
  }

  return { ok: true, caller };
}

/** Front-desk device operations: enrolment, removal and access sync. Matches
 *  the existing role set on /api/members/unblock-access — receptionist is
 *  included deliberately, since they run enrolment at the counter. */
export const DEVICE_OPERATOR_ROLES: SystemRole[] = ["owner", "manager", "receptionist"];
