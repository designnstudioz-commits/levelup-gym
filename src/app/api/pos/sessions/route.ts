import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_ADMIN_ROLES } from "@/lib/pos/permissions";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Session list for the Cashier & Shift Report admin page. Owner/manager
 *  only — a cashier's own shift totals are theirs to see at the terminal,
 *  but every cashier's history is a business-wide view. */
export async function GET(req: NextRequest) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const admin = getServiceClient();
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");

  let query = admin
    .from("pos_register_sessions")
    .select(
      "id, terminal_name, cashier_id, opened_at, opening_cash, closed_at, counted_cash, expected_cash, variance, order_count, payment_method_totals, status, reviewed_by, reviewed_at, is_locked"
    )
    .is("deleted_at", null)
    .order("opened_at", { ascending: false })
    .limit(200);

  if (from) query = query.gte("opened_at", from);
  if (to) query = query.lte("opened_at", to);

  const { data: sessions, error } = await query;
  if (error) {
    console.error("[POS sessions list]", error);
    return NextResponse.json({ error: "Could not load sessions" }, { status: 500 });
  }

  const cashierIds = [...new Set((sessions ?? []).map((s) => s.cashier_id))];
  const { data: cashiers } = await admin
    .from("system_users")
    .select("id, full_name")
    .in("id", cashierIds);
  const nameById = new Map((cashiers ?? []).map((c) => [c.id, c.full_name]));

  return NextResponse.json({
    sessions: (sessions ?? []).map((s) => ({
      id: s.id,
      terminalName: s.terminal_name,
      cashierId: s.cashier_id,
      cashierName: nameById.get(s.cashier_id) ?? "—",
      openedAt: s.opened_at,
      openingCash: s.opening_cash,
      closedAt: s.closed_at,
      countedCash: s.counted_cash,
      expectedCash: s.expected_cash,
      variance: s.variance,
      orderCount: s.order_count,
      paymentMethodTotals: s.payment_method_totals ?? {},
      status: s.status,
      isLocked: s.is_locked,
    })),
  });
}
