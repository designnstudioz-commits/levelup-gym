import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_TERMINAL_ROLES } from "@/lib/pos/permissions";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** The caller's own open session, or null. Drives the terminal's
 *  Open-Shift gate and its "current shift" figure in the rail. */
export async function GET() {
  const auth = await requirePosUser(POS_TERMINAL_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const admin = getServiceClient();
  const { data, error } = await admin
    .from("pos_register_sessions")
    .select("id, opened_at, opening_cash, order_count, payment_method_totals")
    .eq("cashier_id", caller.id)
    .eq("status", "open")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[POS session current]", error);
    return NextResponse.json({ error: "Could not check session status" }, { status: 500 });
  }

  if (!data) return NextResponse.json({ session: null });

  const totals = (data.payment_method_totals ?? {}) as Record<string, number>;
  const shiftTotal = Object.values(totals).reduce((s, n) => s + (Number(n) || 0), 0);

  return NextResponse.json({
    session: {
      id: data.id,
      openedAt: data.opened_at,
      openingCash: data.opening_cash,
      orderCount: data.order_count,
      shiftTotal,
    },
  });
}
