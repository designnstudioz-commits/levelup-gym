// Phase G — server-only shared settlement calculation, used by both the
// read-only preview route and settlement create/recalculate, so the two
// can never silently drift apart. The SQL in pos_finalize_healthbox_settlement()
// (the migration) is deliberately kept parallel to this — same aggregation,
// same math — so a preview always matches what finalizing actually posts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { ORDER_STATUSES_FOR_SALES, computeProfitShare, pktDayBounds } from "./reports";

export interface SettlementCalc {
  grossSales: number;
  discounts: number;
  refunds: number;
  netSales: number;
  approvedCogs: number;
  approvedOperating: number;
  approvedExpensesTotal: number;
  netProfit: number;
  levelupShare: number;
  healthboxShare: number;
  isLoss: boolean;
  lossAmount: number;
  orderCount: number;
  conflictingOrders: number;
  conflictingExpenses: number;
}

export async function calculateHealthboxSettlement(
  admin: SupabaseClient,
  periodStart: string,
  periodEnd: string,
  excludeSettlementId?: string | null
): Promise<SettlementCalc> {
  const { start } = pktDayBounds(periodStart);
  const { end } = pktDayBounds(periodEnd);

  const { data: orders } = await admin
    .from("pos_orders")
    .select("id, refund_of_order_id, healthbox_net_amount, settlement_id")
    .in("status", ORDER_STATUSES_FOR_SALES as unknown as string[])
    .gte("completed_at", start)
    .lte("completed_at", end);

  const healthboxOrders = (orders ?? []).filter((o) => Number(o.healthbox_net_amount) !== 0);
  const originalOrderIds = healthboxOrders.filter((o) => !o.refund_of_order_id).map((o) => o.id);
  const mirrorOrders = healthboxOrders.filter((o) => o.refund_of_order_id);

  const { data: items } = originalOrderIds.length
    ? await admin.from("pos_order_items").select("order_id, line_gross").eq("financial_owner", "healthbox").in("order_id", originalOrderIds)
    : { data: [] };
  const grossSales = (items ?? []).reduce((s: number, i: { line_gross: number }) => s + Number(i.line_gross), 0);
  const netSales = healthboxOrders.reduce((s, o) => s + Number(o.healthbox_net_amount), 0);

  // Refunds must be isolated BEFORE deriving Discounts — a refund-mirror
  // row's negative healthbox_net_amount also reduces Net Sales, so
  // "Discounts = Gross - Net" alone would silently absorb any refunded
  // amount into the Discounts figure once both occur in the same period.
  // Subtracting the (separately computed) Refunds first keeps the two
  // genuinely distinct, matching spec §2's "discounts, refunds ... net
  // sales" as three separate line items, not two conflated into one.
  const refunds = -mirrorOrders.reduce((s, o) => s + Number(o.healthbox_net_amount), 0);
  const discounts = Math.max(0, grossSales - netSales - refunds);

  const { data: expenses } = await admin
    .from("pos_healthbox_expenses")
    .select("id, category, amount, settlement_id")
    .eq("status", "approved")
    .is("deleted_at", null)
    .gte("expense_date", periodStart)
    .lte("expense_date", periodEnd);

  const approvedCogs = (expenses ?? []).filter((e) => e.category === "cogs").reduce((s, e) => s + Number(e.amount), 0);
  const approvedOperating = (expenses ?? []).filter((e) => e.category === "operating").reduce((s, e) => s + Number(e.amount), 0);
  const approvedExpensesTotal = (expenses ?? []).reduce((s, e) => s + Number(e.amount), 0);

  const share = computeProfitShare(netSales, approvedExpensesTotal);

  const conflictingOrders = healthboxOrders.filter((o) => o.settlement_id && o.settlement_id !== excludeSettlementId).length;
  const conflictingExpenses = (expenses ?? []).filter((e) => e.settlement_id && e.settlement_id !== excludeSettlementId).length;

  return {
    grossSales, discounts, refunds, netSales,
    approvedCogs, approvedOperating, approvedExpensesTotal,
    ...share,
    orderCount: originalOrderIds.length,
    conflictingOrders, conflictingExpenses,
  };
}
