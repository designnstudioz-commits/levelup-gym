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

/**
 * POS Sales Report — filterable, immutable-snapshot based (reads
 * pos_order_items' own stored name/sku/price columns, never joins back to
 * the live catalogue for historical figures — spec §3).
 *
 * Owner/manager only.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const admin = getServiceClient();
  const params = req.nextUrl.searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const statusFilter = params.get("status"); // "completed" | "refund" | "void" | null (all sales statuses)
  const cashier = params.get("cashier");
  const customerType = params.get("customer_type");

  let orderQuery = admin
    .from("pos_orders")
    .select("id, order_no, status, gross_amount, discount_amount, net_amount, item_count, served_by, member_id, customer_type, refund_of_order_id, completed_at");

  if (statusFilter === "void") {
    orderQuery = orderQuery.eq("status", "voided");
  } else if (statusFilter === "refund") {
    orderQuery = orderQuery.not("refund_of_order_id", "is", null);
  } else {
    orderQuery = orderQuery.in("status", ORDER_STATUSES_FOR_SALES as unknown as string[]);
  }
  if (from) orderQuery = orderQuery.gte("completed_at", pktDayBounds(from).start);
  if (to) orderQuery = orderQuery.lte("completed_at", pktDayBounds(to).end);
  if (cashier) orderQuery = orderQuery.eq("served_by", cashier);
  if (customerType) orderQuery = orderQuery.eq("customer_type", customerType);

  const { data: orders, error } = await orderQuery;
  if (error) {
    console.error("[POS sales report]", error);
    return NextResponse.json({ error: "Could not load the sales report" }, { status: 500 });
  }

  const orderIds = (orders ?? []).map((o) => o.id);
  const itemFilters = { department_id: params.get("department_id"), category_id: params.get("category_id"), product_id: params.get("product_id"), financial_owner: params.get("financial_owner") };
  const methodFilter = params.get("payment_method");

  let itemQuery = orderIds.length
    ? admin.from("pos_order_items").select("order_id, department_id, department_name, financial_owner, product_id, product_name, variant_name, sku, qty, line_gross, line_discount, line_net").in("order_id", orderIds)
    : null;
  if (itemQuery && itemFilters.department_id) itemQuery = itemQuery.eq("department_id", itemFilters.department_id);
  if (itemQuery && itemFilters.product_id) itemQuery = itemQuery.eq("product_id", itemFilters.product_id);
  if (itemQuery && itemFilters.financial_owner) itemQuery = itemQuery.eq("financial_owner", itemFilters.financial_owner);
  const { data: items } = itemQuery ? await itemQuery : { data: [] };

  // category_id isn't stored on pos_order_items (only department/product) —
  // resolve it via a product->category lookup rather than fabricating a
  // column that was never captured at sale time.
  let categoryProductIds: Set<string> | null = null;
  if (itemFilters.category_id) {
    const { data: catProducts } = await admin.from("pos_products").select("id").eq("category_id", itemFilters.category_id);
    categoryProductIds = new Set((catProducts ?? []).map((p) => p.id));
  }

  let filteredItems = items ?? [];
  if (categoryProductIds) filteredItems = filteredItems.filter((i) => i.product_id && categoryProductIds!.has(i.product_id));

  // Payment method filter narrows to orders that had at least one leg on
  // that method — a report FILTER ("show orders paid by Cash"), not a
  // recomputation of totals for just that leg.
  let matchingOrderIds = new Set(filteredItems.map((i) => i.order_id));
  if (methodFilter) {
    const { data: pays } = orderIds.length ? await admin.from("pos_payments").select("order_id, method").in("order_id", orderIds).eq("method", methodFilter) : { data: [] };
    const methodOrderIds = new Set((pays ?? []).map((p) => p.order_id));
    matchingOrderIds = new Set([...matchingOrderIds].filter((id) => methodOrderIds.has(id)));
  }
  const anyItemFilterApplied = Object.values(itemFilters).some(Boolean) || methodFilter;
  const finalOrders = anyItemFilterApplied ? (orders ?? []).filter((o) => matchingOrderIds.has(o.id)) : (orders ?? []);
  const finalItems = anyItemFilterApplied ? filteredItems.filter((i) => matchingOrderIds.has(i.order_id)) : filteredItems;

  const originals = finalOrders.filter((o) => !o.refund_of_order_id && o.status !== "voided");
  const mirrors = finalOrders.filter((o) => o.refund_of_order_id);
  const voided = finalOrders.filter((o) => o.status === "voided");

  const grossSales = originals.reduce((s, o) => s + Number(o.gross_amount), 0);
  const discounts = originals.reduce((s, o) => s + Number(o.discount_amount), 0);
  const refunds = -mirrors.reduce((s, o) => s + Number(o.net_amount), 0);
  const netSales = [...originals, ...mirrors].reduce((s, o) => s + Number(o.net_amount), 0);
  const qtySold = finalItems.reduce((s, i) => s + Number(i.qty), 0);
  const orderCount = originals.length;
  const avgOrderValue = orderCount > 0 ? netSales / orderCount : 0;

  return NextResponse.json({
    totals: { grossSales, discounts, netSales, refunds, voids: voided.reduce((s, o) => s + Number(o.net_amount), 0), qtySold, orderCount, avgOrderValue },
    orders: finalOrders.map((o) => ({ ...o })),
    lineItems: finalItems,
  });
}
