// Phase 3 — server-side caller resolution for /api/pos/* routes.
//
// Every POS API handler starts by calling requirePosUser(). This is the
// authoritative permission boundary; the middleware gate and the UI helpers
// in ./permissions are convenience layers in front of it.
//
// Identity keys on EMAIL, not auth.uid(), matching the app's existing
// convention everywhere (dashboard/layout.tsx, useRoleGuard,
// api/admin/create-user, and the RLS helper functions). This is deliberate:
// one live account has a system_users.id that does not match its
// auth.users.id, and correcting it would cascade FK updates across roughly
// ten tables. Anything that switches to auth.uid() here will silently
// fail for that account.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { SystemRole } from "@/types/database";

export interface PosCaller {
  id: string;
  email: string;
  fullName: string;
  role: SystemRole;
  staffId: string | null;
  /** null = unrestricted. Populated for healthbox_staff. */
  departmentScope: string[] | null;
}

export type PosAuthResult =
  | { ok: true; caller: PosCaller }
  | { ok: false; response: NextResponse };

/**
 * Resolves and authorises the calling user.
 *
 * Pass `allowedRoles` to restrict the handler. Omit it only for routes that
 * every POS operator may reach, and note that omitting it still requires a
 * valid, active system_users row.
 *
 * Returns a discriminated union rather than throwing, so handlers stay
 * explicit about the failure path:
 *
 *     const auth = await requirePosUser(["owner", "manager"]);
 *     if (!auth.ok) return auth.response;
 *     // auth.caller is now fully typed
 */
export async function requirePosUser(
  allowedRoles?: SystemRole[]
): Promise<PosAuthResult> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not signed in" }, { status: 401 }),
    };
  }

  const { data: row, error } = await supabase
    .from("system_users")
    .select("id, full_name, email, role, staff_id, pos_department_scope")
    .eq("email", user.email.toLowerCase())
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[POS auth] system_users lookup failed", error);
    return {
      ok: false,
      response: NextResponse.json({ error: "Authorization check failed" }, { status: 500 }),
    };
  }

  if (!row || !row.role) {
    // An authenticated Supabase user with no active system_users row is not
    // a staff member. Deny rather than defaulting to a role.
    return {
      ok: false,
      response: NextResponse.json({ error: "No active staff account" }, { status: 403 }),
    };
  }

  const caller: PosCaller = {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role as SystemRole,
    staffId: row.staff_id ?? null,
    departmentScope: row.pos_department_scope ?? null,
  };

  if (allowedRoles && !allowedRoles.includes(caller.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "You do not have permission to do that" },
        { status: 403 }
      ),
    };
  }

  return { ok: true, caller };
}

/**
 * Writes an activity_logs row for a POS action.
 *
 * Honours the house rule that every meaningful user action is audited
 * (spec §29). Failures are logged and swallowed: an audit write must never
 * be the reason a completed sale fails to save. The console error is the
 * signal that something needs investigating.
 */
export async function logPosActivity(params: {
  userId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  description: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.from("activity_logs").insert({
      user_id: params.userId,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      description: params.description,
      metadata: params.metadata ?? {},
    });
  } catch (err) {
    console.error("[POS audit] failed to write activity_logs", err);
  }
}
