import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser, logPosActivity } from "@/lib/pos/auth";
import { POS_TERMINAL_ROLES, POS_ADMIN_ROLES } from "@/lib/pos/permissions";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Closes a shift. The actual reconciliation math (expected_cash, variance)
 * happens inside pos_close_session() — a fresh aggregate over pos_payments
 * for this session, not anything cached or client-supplied. See that
 * function's header in migration 20260911100200 for why.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePosUser(POS_TERMINAL_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const body = await req.json().catch(() => null);
  const sessionId = body?.sessionId as string | undefined;
  const countedCash = Number(body?.countedCash);

  if (!sessionId || !Number.isFinite(countedCash) || countedCash < 0) {
    return NextResponse.json({ error: "sessionId and a valid countedCash are required" }, { status: 400 });
  }

  const admin = getServiceClient();

  // A cashier closes their own shift; a manager/owner may close on a
  // cashier's behalf (forgotten shift, end of day, etc).
  const { data: session } = await admin
    .from("pos_register_sessions")
    .select("id, cashier_id")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const isOwnSession = session.cashier_id === caller.id;
  const isAdmin = POS_ADMIN_ROLES.includes(caller.role);
  if (!isOwnSession && !isAdmin) {
    return NextResponse.json({ error: "You can only close your own shift" }, { status: 403 });
  }

  const { data, error } = await admin.rpc("pos_close_session", {
    payload: { session_id: sessionId, counted_cash: countedCash },
  });

  if (error) {
    console.error("[POS session close]", error);
    return NextResponse.json({ error: error.message || "Could not close the shift" }, { status: 409 });
  }

  await logPosActivity({
    userId: caller.id,
    action: "closed_pos_session",
    entityType: "pos_register_session",
    entityId: sessionId,
    description: `${caller.fullName} closed a shift — counted Rs ${countedCash}, variance Rs ${data?.variance}`,
  });

  return NextResponse.json(data);
}
