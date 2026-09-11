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

/** Searchable, filterable, immutable stock movement history. Owner/manager
 *  only. Movements are never edited or deleted here — this route only
 *  reads pos_stock_movements, which nothing but pos_receive_stock(),
 *  pos_adjust_stock(), pos_apply_stock_count() and the checkout/void/refund
 *  functions ever write to. */
export async function GET(req: NextRequest) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const admin = getServiceClient();
  const params = req.nextUrl.searchParams;

  let query = admin
    .from("pos_stock_movements")
    .select("id, product_id, variant_id, type, qty_delta, qty_before, qty_after, order_id, receipt_id, stock_count_id, unit_cost, reason_note, created_by, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const type = params.get("type");
  if (type) query = query.eq("type", type);

  const productId = params.get("product_id");
  if (productId) query = query.eq("product_id", productId);

  const from = params.get("from");
  if (from) query = query.gte("created_at", from);
  const to = params.get("to");
  if (to) query = query.lte("created_at", to);

  const { data: movements, error } = await query;
  if (error) {
    console.error("[POS admin inventory movements list]", error);
    return NextResponse.json({ error: "Could not load stock movements" }, { status: 500 });
  }

  const productIds = [...new Set((movements ?? []).map((m) => m.product_id))];
  const { data: products } = productIds.length
    ? await admin.from("pos_products").select("id, name, sku").in("id", productIds)
    : { data: [] };
  const productById = new Map((products ?? []).map((p) => [p.id, p]));

  const variantIds = [...new Set((movements ?? []).map((m) => m.variant_id).filter(Boolean))];
  const { data: variants } = variantIds.length
    ? await admin.from("pos_product_variants").select("id, name").in("id", variantIds)
    : { data: [] };
  const variantById = new Map((variants ?? []).map((v) => [v.id, v.name]));

  const userIds = [...new Set((movements ?? []).map((m) => m.created_by).filter(Boolean))];
  const { data: users } = userIds.length
    ? await admin.from("system_users").select("id, full_name").in("id", userIds)
    : { data: [] };
  const userById = new Map((users ?? []).map((u) => [u.id, u.full_name]));

  const search = params.get("search")?.trim().toLowerCase();

  let rows = (movements ?? []).map((m) => ({
    ...m,
    productName: productById.get(m.product_id)?.name ?? "—",
    sku: productById.get(m.product_id)?.sku ?? null,
    variantName: m.variant_id ? variantById.get(m.variant_id) ?? null : null,
    userName: m.created_by ? userById.get(m.created_by) ?? "—" : "System",
    reference: m.order_id ? "Sale" : m.receipt_id ? "Receipt" : m.stock_count_id ? "Stock Count" : null,
  }));

  if (search) {
    rows = rows.filter((r) => r.productName.toLowerCase().includes(search) || (r.sku ?? "").toLowerCase().includes(search));
  }

  return NextResponse.json({ movements: rows });
}
