import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_ADMIN_ROLES } from "@/lib/pos/permissions";
import { ORDER_STATUSES_FOR_SALES, pktDayBounds, todayInPkt } from "@/lib/pos/reports";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Daily Business Report — membership collections, POS sales (gross/
 * discounts/refunds/voids/net), by-department and by-payment-method
 * breakdowns, and cash reconciliation, for one calendar date.
 *
 * Owner/manager only (spec §18 — full owner financial reporting).
 */
export async function GET(req: NextRequest) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const date = req.nextUrl.searchParams.get("date") || todayInPkt();
  const admin = getServiceClient();

  // ── Membership ────────────────────────────────────────────────────
  const { data: feePayments } = await admin
    .from("fee_payments")
    .select("amount, payment_method")
    .eq("payment_date", date)
    .is("deleted_at", null);
  const membershipTotal = (feePayments ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const membershipByMethod: Record<string, number> = {};
  for (const p of feePayments ?? []) {
    membershipByMethod[p.payment_method ?? "Other"] = (membershipByMethod[p.payment_method ?? "Other"] ?? 0) + Number(p.amount);
  }

  // ── POS orders for the day (PKT calendar day — see pktDayBounds) ──────
  const { start: dayStart, end: dayEnd } = pktDayBounds(date);

  const { data: orders } = await admin
    .from("pos_orders")
    .select("id, status, gross_amount, discount_amount, net_amount, levelup_net_amount, healthbox_net_amount, refund_of_order_id, completed_at, voided_at, void_reason")
    .or(`completed_at.gte.${dayStart},voided_at.gte.${dayStart}`)
    .lte("completed_at", dayEnd);

  // completed_at is null for voided-before-completion orders never
  // finished — filter defensively to rows actually in the window.
  const dayOrders = (orders ?? []).filter((o) => {
    const t = o.completed_at ?? o.voided_at;
    return t && t >= dayStart && t <= dayEnd;
  });

  const salesOrders = dayOrders.filter((o) => (ORDER_STATUSES_FOR_SALES as readonly string[]).includes(o.status));
  const originalSales = salesOrders.filter((o) => !o.refund_of_order_id);
  const refundMirrors = salesOrders.filter((o) => o.refund_of_order_id);
  const voidedOrders = dayOrders.filter((o) => o.status === "voided");

  const grossSales = originalSales.reduce((s, o) => s + Number(o.gross_amount), 0);
  const discounts = originalSales.reduce((s, o) => s + Number(o.discount_amount), 0);
  const refunds = -refundMirrors.reduce((s, o) => s + Number(o.net_amount), 0);
  const voids = voidedOrders.reduce((s, o) => s + Number(o.net_amount), 0);
  const netSales = salesOrders.reduce((s, o) => s + Number(o.net_amount), 0);
  const levelupNet = salesOrders.reduce((s, o) => s + Number(o.levelup_net_amount), 0);
  const healthboxNet = salesOrders.reduce((s, o) => s + Number(o.healthbox_net_amount), 0);

  // ── By department (line-level, so a mixed order reconciles correctly) ─
  const orderIds = salesOrders.map((o) => o.id);
  const { data: items } = orderIds.length
    ? await admin.from("pos_order_items").select("order_id, department_id, department_name, line_gross, line_net").in("order_id", orderIds)
    : { data: [] };
  const byDept = new Map<string, { departmentName: string; gross: number; net: number }>();
  for (const it of items ?? []) {
    const d = byDept.get(it.department_id) ?? { departmentName: it.department_name, gross: 0, net: 0 };
    d.gross += Number(it.line_gross);
    d.net += Number(it.line_net);
    byDept.set(it.department_id, d);
  }
  const departmentBreakdown = [...byDept.entries()].map(([departmentId, v]) => ({ departmentId, ...v }));

  // ── By payment method (split payments contribute their own leg only) ──
  const { data: payments } = orderIds.length
    ? await admin.from("pos_payments").select("order_id, method, amount").in("order_id", orderIds)
    : { data: [] };
  const byMethod: Record<string, number> = {};
  for (const p of payments ?? []) {
    byMethod[p.method] = (byMethod[p.method] ?? 0) + Number(p.amount);
  }

  // ── Cash: sessions opened or closed that day ─────────────────────────
  const { data: sessions } = await admin
    .from("pos_register_sessions")
    .select("opening_cash, counted_cash, expected_cash, variance, closed_at")
    .gte("opened_at", dayStart)
    .lte("opened_at", dayEnd)
    .is("deleted_at", null);
  const openingCash = (sessions ?? []).reduce((s, x) => s + Number(x.opening_cash ?? 0), 0);
  const closedToday = (sessions ?? []).filter((s) => s.closed_at);
  const countedCash = closedToday.reduce((s, x) => s + Number(x.counted_cash ?? 0), 0);
  const expectedCash = closedToday.reduce((s, x) => s + Number(x.expected_cash ?? 0), 0);
  const cashVariance = closedToday.reduce((s, x) => s + Number(x.variance ?? 0), 0);
  const cashSales = byMethod["Cash"] ?? byMethod["cash"] ?? 0;

  return NextResponse.json({
    date,
    membership: { total: membershipTotal, byMethod: membershipByMethod },
    pos: { grossSales, discounts, refunds, voids, netSales, levelupNet, healthboxNet, orderCount: originalSales.length },
    byDepartment: departmentBreakdown,
    byPaymentMethod: Object.entries(byMethod).map(([method, amount]) => ({ method, amount })),
    cash: { openingCash, cashSales, expectedCash, countedCash, variance: cashVariance, sessionsOpen: sessions?.length ?? 0, sessionsClosed: closedToday.length },
    combined: { membershipTotal, levelupPosNet: levelupNet, totalBusinessCollection: membershipTotal + netSales },
  });
}
