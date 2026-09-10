import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser, logPosActivity } from "@/lib/pos/auth";
import { POS_TERMINAL_ROLES } from "@/lib/pos/permissions";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Opens a register session for the calling cashier. A single INSERT is
 *  already atomic on its own; the uniqueness guard (one open session per
 *  cashier) is enforced by the partial unique index from Phase A
 *  (uniq_pos_session_one_open_per_cashier), so a double-open attempt fails
 *  at the database regardless of any race in this route. */
export async function POST(req: NextRequest) {
  const auth = await requirePosUser(POS_TERMINAL_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const body = await req.json().catch(() => null);
  const openingCash = Number(body?.openingCash);
  if (!Number.isFinite(openingCash) || openingCash < 0) {
    return NextResponse.json({ error: "Enter a valid opening cash amount" }, { status: 400 });
  }

  const admin = getServiceClient();

  const { data: existing } = await admin
    .from("pos_register_sessions")
    .select("id")
    .eq("cashier_id", caller.id)
    .eq("status", "open")
    .is("deleted_at", null)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "You already have an open shift", sessionId: existing.id },
      { status: 409 }
    );
  }

  const { data: inserted, error } = await admin
    .from("pos_register_sessions")
    .insert({ cashier_id: caller.id, opening_cash: openingCash, status: "open" })
    .select("id, opened_at, opening_cash")
    .single();

  if (error || !inserted) {
    console.error("[POS session open]", error);
    return NextResponse.json({ error: "Could not open the shift" }, { status: 500 });
  }

  await logPosActivity({
    userId: caller.id,
    action: "opened_pos_session",
    entityType: "pos_register_session",
    entityId: inserted.id,
    description: `${caller.fullName} opened a shift with Rs ${openingCash} opening cash`,
  });

  return NextResponse.json({
    sessionId: inserted.id,
    openedAt: inserted.opened_at,
    openingCash: inserted.opening_cash,
  });
}
