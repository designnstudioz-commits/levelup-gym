import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_ADMIN_ROLES } from "@/lib/pos/permissions";
import { ORDER_STATUSES_FOR_SALES, computeProfitShare, pktDayBounds } from "@/lib/pos/reports";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * HealthBox financial report — Owner/Manager ONLY (spec §8: "HealthBox
 * staff must NOT have access to this financial report"). This route is
 * never reachable from the HealthBox staff-facing expenses page; it lives
 * at a different route entirely, gated the same as every other owner
 * report (POS_ADMIN_ROLES), so there is no shared endpoint a HealthBox
 * account could reach that also happens to leak profit figures.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const admin = getServiceClient();
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");

  let orderQuery = admin
    .from("pos_orders")
    .select("id, status, refund_of_order_id, healthbox_net_amount, completed_at")
    .in("status", ORDER_STATUSES_FOR_SALES as unknown as string[]);
  if (from) orderQuery = orderQuery.gte("completed_at", pktDayBounds(from).start);
  if (to) orderQuery = orderQuery.lte("completed_at", pktDayBounds(to).end);
  const { data: orders } = await orderQuery;

  const orderIds = (orders ?? []).map((o) => o.id);
  const { data: items } = orderIds.length
    ? await admin.from("pos_order_items").select("order_id, product_name, category_id, qty, line_gross, line_discount, line_net").eq("financial_owner", "healthbox").in("order_id", orderIds)
    : { data: [] };

  // Only original (non-mirror) rows contribute Gross/Discounts — see
  // src/lib/pos/reports.ts header comment for why 'refunded' orders stay
  // in the status filter but their line items here come only from the
  // ORIGINAL order id set (mirror lines are on their own separate order id
  // with negative line_gross, which would double count Gross incorrectly).
  const originalOrderIds = new Set((orders ?? []).filter((o) => !o.refund_of_order_id).map((o) => o.id));
  const originalItems = (items ?? []).filter((i) => originalOrderIds.has(i.order_id));

  const grossSales = originalItems.reduce((s, i) => s + Number(i.line_gross), 0);
  const netSales = (orders ?? []).reduce((s, o) => s + Number(o.healthbox_net_amount), 0);
  // Refunds isolated FIRST: a refund-mirror row's negative
  // healthbox_net_amount also lowers netSales, so deriving Discounts as
  // merely (Gross - Net) would silently fold any refunded amount into the
  // Discounts figure whenever both occur in the same period — confirmed by
  // QA with real refunded data. Subtracting Refunds first keeps Discounts
  // and Refunds genuinely separate line items (spec §2).
  const refunds = -(orders ?? []).filter((o) => o.refund_of_order_id).reduce((s, o) => s + Number(o.healthbox_net_amount), 0);
  const discounts = Math.max(0, grossSales - netSales - refunds);
  const orderCount = originalOrderIds.size;

  const byProduct = new Map<string, { qty: number; net: number }>();
  for (const i of originalItems) {
    const cur = byProduct.get(i.product_name) ?? { qty: 0, net: 0 };
    cur.qty += Number(i.qty);
    cur.net += Number(i.line_net);
    byProduct.set(i.product_name, cur);
  }
  const productPerformance = [...byProduct.entries()].map(([productName, v]) => ({ productName, ...v })).sort((a, b) => b.net - a.net);

  let expenseQuery = admin.from("pos_healthbox_expenses").select("status, amount").is("deleted_at", null);
  if (from) expenseQuery = expenseQuery.gte("expense_date", from);
  if (to) expenseQuery = expenseQuery.lte("expense_date", to);
  const { data: expenses } = await expenseQuery;

  const approvedExpenses = (expenses ?? []).filter((e) => e.status === "approved").reduce((s, e) => s + Number(e.amount), 0);
  const pendingExpenses = (expenses ?? []).filter((e) => e.status === "pending").reduce((s, e) => s + Number(e.amount), 0);
  const rejectedExpenses = (expenses ?? []).filter((e) => e.status === "rejected").reduce((s, e) => s + Number(e.amount), 0);
  const needsCorrectionExpenses = (expenses ?? []).filter((e) => e.status === "needs_correction").reduce((s, e) => s + Number(e.amount), 0);

  const share = computeProfitShare(netSales, approvedExpenses);

  let settlementStatus: string | null = null;
  if (from && to) {
    const { data: overlapping } = await admin
      .from("pos_settlements")
      .select("status")
      .eq("financial_owner", "healthbox")
      .is("deleted_at", null)
      .lte("period_start", to)
      .gte("period_end", from)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    settlementStatus = overlapping?.status ?? null;
  }

  return NextResponse.json({
    grossSales, discounts, refunds, netSales, orderCount, productPerformance,
    expenses: { approved: approvedExpenses, pending: pendingExpenses, rejected: rejectedExpenses, needsCorrection: needsCorrectionExpenses },
    ...share,
    settlementStatus,
  });
}
