import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_ADMIN_ROLES } from "@/lib/pos/permissions";
import { ORDER_STATUSES_FOR_SALES, pktDayBounds } from "@/lib/pos/reports";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Cashier / Shift Report — reviewed and locked sessions stay exactly as
 *  they were at review time (this route only READS pos_register_sessions,
 *  never recomputes a closed session's own stored figures). */
export async function GET(req: NextRequest) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const admin = getServiceClient();
  const params = req.nextUrl.searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const cashierId = params.get("cashier_id");

  let query = admin
    .from("pos_register_sessions")
    .select("id, terminal_name, cashier_id, opened_at, opening_cash, closed_at, counted_cash, expected_cash, variance, order_count, payment_method_totals, reviewed_by, reviewed_at, is_locked, status, note")
    .is("deleted_at", null)
    .order("opened_at", { ascending: false });

  if (from) query = query.gte("opened_at", pktDayBounds(from).start);
  if (to) query = query.lte("opened_at", pktDayBounds(to).end);
  if (cashierId) query = query.eq("cashier_id", cashierId);

  const { data: sessions, error } = await query;
  if (error) {
    console.error("[POS cashier report]", error);
    return NextResponse.json({ error: "Could not load the cashier report" }, { status: 500 });
  }

  const userIds = [...new Set([...(sessions ?? []).map((s) => s.cashier_id), ...(sessions ?? []).map((s) => s.reviewed_by)].filter(Boolean))];
  const { data: users } = userIds.length ? await admin.from("system_users").select("id, full_name").in("id", userIds) : { data: [] };
  const userById = new Map((users ?? []).map((u) => [u.id, u.full_name]));

  const sessionIds = (sessions ?? []).map((s) => s.id);
  const { data: orders } = sessionIds.length
    ? await admin.from("pos_orders").select("id, session_id, status, gross_amount, net_amount, refund_of_order_id").in("session_id", sessionIds)
    : { data: [] };
  const ordersBySession = new Map<string, typeof orders>();
  for (const o of orders ?? []) {
    const list = ordersBySession.get(o.session_id) ?? [];
    list.push(o);
    ordersBySession.set(o.session_id, list);
  }

  const { data: approvals } = sessionIds.length
    ? await admin.from("pos_approvals").select("id, type, session_id, value_amount, value_percent, reason, status, requested_by, requested_at, resolved_by, resolved_at, resolution_note").in("session_id", sessionIds).is("deleted_at", null)
    : { data: [] };
  const approvalsBySession = new Map<string, typeof approvals>();
  for (const a of approvals ?? []) {
    const list = approvalsBySession.get(a.session_id) ?? [];
    list.push(a);
    approvalsBySession.set(a.session_id, list);
  }
  const approverIds = [...new Set((approvals ?? []).map((a) => a.resolved_by).filter(Boolean))];
  const { data: approvers } = approverIds.length ? await admin.from("system_users").select("id, full_name").in("id", approverIds) : { data: [] };
  const approverById = new Map((approvers ?? []).map((u) => [u.id, u.full_name]));

  const rows = (sessions ?? []).map((s) => {
    const sessionOrders = (ordersBySession.get(s.id) ?? []).filter((o) => (ORDER_STATUSES_FOR_SALES as readonly string[]).includes(o.status));
    const originals = sessionOrders.filter((o) => !o.refund_of_order_id);
    const grossSales = originals.reduce((sum, o) => sum + Number(o.gross_amount), 0);
    const cashSales = (typeof s.payment_method_totals === "object" && s.payment_method_totals) ? Number((s.payment_method_totals as Record<string, number>)["Cash"] ?? 0) : 0;
    const refunds = -sessionOrders.filter((o) => o.refund_of_order_id).reduce((sum, o) => sum + Number(o.net_amount), 0);

    return {
      ...s,
      cashierName: userById.get(s.cashier_id) ?? "—",
      reviewedByName: s.reviewed_by ? userById.get(s.reviewed_by) ?? "—" : null,
      grossSales, cashSales, refunds,
      exceptions: (approvalsBySession.get(s.id) ?? []).map((a) => ({ ...a, approvingManagerName: a.resolved_by ? approverById.get(a.resolved_by) ?? "—" : null })),
    };
  });

  return NextResponse.json({ sessions: rows });
}
