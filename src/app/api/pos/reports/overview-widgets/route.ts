import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_ADMIN_ROLES } from "@/lib/pos/permissions";
import { ORDER_STATUSES_FOR_SALES, pktDayBounds, todayInPkt } from "@/lib/pos/reports";
import { classifyStock } from "@/lib/pos/inventory";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Today's figures for the Owner Dashboard's new POS/business widget row
 *  (spec §1). Additive to the existing dashboard — this route only feeds
 *  new cards, nothing here replaces what the dashboard already shows. */
export async function GET() {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const admin = getServiceClient();
  const today = todayInPkt();
  const { start: dayStart, end: dayEnd } = pktDayBounds(today);

  const { data: fees } = await admin.from("fee_payments").select("amount").eq("payment_date", today).is("deleted_at", null);
  const membershipToday = (fees ?? []).reduce((s, f) => s + Number(f.amount), 0);

  const { data: orders } = await admin
    .from("pos_orders")
    .select("net_amount, levelup_net_amount, healthbox_net_amount, refund_of_order_id, completed_at")
    .in("status", ORDER_STATUSES_FOR_SALES as unknown as string[])
    .gte("completed_at", dayStart)
    .lte("completed_at", dayEnd);
  const posSalesToday = (orders ?? []).reduce((s, o) => s + Number(o.net_amount), 0);

  const orderIds: string[] = [];
  const { data: allOrders } = await admin.from("pos_orders").select("id").in("status", ORDER_STATUSES_FOR_SALES as unknown as string[]).gte("completed_at", dayStart).lte("completed_at", dayEnd);
  for (const o of allOrders ?? []) orderIds.push(o.id);
  const { data: items } = orderIds.length
    ? await admin.from("pos_order_items").select("department_name, line_net").in("order_id", orderIds)
    : { data: [] };
  const byDept: Record<string, number> = {};
  for (const i of items ?? []) byDept[i.department_name] = (byDept[i.department_name] ?? 0) + Number(i.line_net);

  const { data: payments } = orderIds.length ? await admin.from("pos_payments").select("method, amount").in("order_id", orderIds) : { data: [] };
  const byMethod: Record<string, number> = {};
  for (const p of payments ?? []) byMethod[p.method] = (byMethod[p.method] ?? 0) + Number(p.amount);

  const { data: sessions } = await admin
    .from("pos_register_sessions")
    .select("expected_cash, counted_cash, variance, closed_at")
    .gte("opened_at", dayStart)
    .lte("opened_at", dayEnd)
    .is("deleted_at", null);
  const closed = (sessions ?? []).filter((s) => s.closed_at);
  const cashExpected = closed.reduce((s, x) => s + Number(x.expected_cash ?? 0), 0);
  const cashCounted = closed.reduce((s, x) => s + Number(x.counted_cash ?? 0), 0);
  const cashVariance = closed.reduce((s, x) => s + Number(x.variance ?? 0), 0);

  const { data: products } = await admin.from("pos_products").select("id, stock_qty, low_stock_threshold, track_inventory").is("deleted_at", null).eq("is_active", true).eq("track_inventory", true);
  const productIds = (products ?? []).map((p) => p.id);
  const { data: variants } = productIds.length
    ? await admin.from("pos_product_variants").select("product_id, stock_qty, low_stock_threshold").in("product_id", productIds).is("deleted_at", null)
    : { data: [] };
  const variantsByProduct = new Map<string, typeof variants>();
  for (const v of variants ?? []) {
    const list = variantsByProduct.get(v.product_id) ?? [];
    list.push(v);
    variantsByProduct.set(v.product_id, list);
  }
  let lowStockCount = 0;
  for (const p of products ?? []) {
    const pv = variantsByProduct.get(p.id) ?? [];
    if (pv.length > 0) {
      for (const v of pv) {
        const lvl = classifyStock(Number(v.stock_qty), v.low_stock_threshold, true);
        if (lvl === "low" || lvl === "critical" || lvl === "out") lowStockCount++;
      }
    } else {
      const lvl = classifyStock(Number(p.stock_qty), p.low_stock_threshold, true);
      if (lvl === "low" || lvl === "critical" || lvl === "out") lowStockCount++;
    }
  }

  const { count: healthboxPending } = await admin.from("pos_healthbox_expenses").select("id", { count: "exact", head: true }).eq("status", "pending").is("deleted_at", null);

  const { data: latestSettlement } = await admin
    .from("pos_settlements")
    .select("status, period_start, period_end")
    .eq("financial_owner", "healthbox")
    .is("deleted_at", null)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    membershipToday,
    posSalesToday,
    totalBusinessCollectionToday: membershipToday + posSalesToday,
    departmentSalesToday: byDept,
    paymentMethodToday: byMethod,
    cash: { expected: cashExpected, counted: cashCounted, variance: cashVariance },
    lowStockCount,
    healthboxPendingExpenses: healthboxPending ?? 0,
    healthboxSettlement: latestSettlement ?? null,
  });
}
