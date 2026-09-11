import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_TERMINAL_ROLES } from "@/lib/pos/permissions";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Member lookup for tagging a POS sale.
 *
 * WHY THIS ROUTE EXISTS AT ALL.
 *
 * A cashier needs to find a member to attach to an order. The obvious
 * approach — grant the cashier role SELECT on `members` — is wrong, because
 * Postgres RLS is row-level: a cashier granted SELECT receives EVERY column,
 * including phone, CNIC, address, medical notes, fees and emergency
 * contacts. That is far beyond what tagging a sale requires.
 *
 * So the cashier gets no table access to `members` at all. This route runs
 * server-side, checks the caller's role, and returns exactly four fields.
 *
 * Phase H correction: this originally used the session-scoped client
 * (@/lib/supabase/server), which is fine while `members` has no RLS — but
 * once 20260825100500_rls_members.sql goes live, that client IS subject to
 * its policies, and 'cashier' isn't in them (that migration predates the
 * cashier role entirely). The session client would then silently return
 * zero rows for every cashier, breaking terminal member lookup. Switched to
 * the service-role client instead: the real security boundary was always
 * requirePosUser() + this route's own narrow column list below, never RLS
 * on `members` — this just makes that actually true once RLS is enabled.
 *
 * Consequence to preserve: never widen the select list below without
 * revisiting that reasoning.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePosUser(POS_TERMINAL_ROLES);
  if (!auth.ok) return auth.response;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const supabase = getServiceClient();

  // Only the fields the terminal displays. Nothing else.
  let query = supabase
    .from("members")
    .select("id, full_name, membership_no, status")
    .is("deleted_at", null)
    .neq("status", "archived")
    .limit(25);

  if (q.length > 0) {
    // Name, membership number or phone — matching the approved UX's
    // "Search by name, phone or member ID". Phone is SEARCHED but never
    // RETURNED: matching on it is necessary, exposing it is not.
    const safe = q.replace(/[%,()]/g, " ");
    query = query.or(
      `full_name.ilike.%${safe}%,membership_no.ilike.%${safe}%,phone.ilike.%${safe}%`
    );
  } else {
    // No query yet: show the most recently active members, which is the
    // "Recent members" list on the approved frame.
    query = query.order("updated_at", { ascending: false });
  }

  const { data, error } = await query;

  if (error) {
    console.error("[POS member lookup]", error);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  return NextResponse.json({
    members: (data ?? []).map((m) => ({
      id: m.id,
      fullName: m.full_name,
      membershipNo: m.membership_no,
      status: m.status,
    })),
  });
}
