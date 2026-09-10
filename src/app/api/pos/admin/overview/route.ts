import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_ADMIN_ROLES } from "@/lib/pos/permissions";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POS Admin Overview — operational catalogue health, not financial
 * reporting (that stays on the owner dashboard / future POS reports
 * screen, deliberately kept separate here per the Phase D scope note).
 *
 * Owner/manager only, matching the pre-existing POS_ROUTE_ROLES entry for
 * "/dashboard/pos" from Phase A. No department scoping needed — this
 * route sees the whole catalogue by design.
 */
export async function GET() {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const admin = getServiceClient();

  const { data: products, error } = await admin
    .from("pos_products")
    .select("id, department_id, is_active, show_on_pos, is_available, track_inventory, stock_qty, low_stock_threshold")
    .is("deleted_at", null);

  if (error) {
    console.error("[POS admin overview]", error);
    return NextResponse.json({ error: "Could not load the overview" }, { status: 500 });
  }

  // Per the locked inventory rule, a product with variants keeps its own
  // stock_qty at 0 — the real stock lives on the variant rows. Low/out of
  // stock counts here must fold in variant stock or every variant product
  // reads as permanently out of stock.
  const trackedIds = (products ?? []).filter((p) => p.track_inventory).map((p) => p.id);
  const { data: variantRows } = trackedIds.length
    ? await admin.from("pos_product_variants").select("product_id, stock_qty, low_stock_threshold").in("product_id", trackedIds).is("deleted_at", null)
    : { data: [] };
  const variantsByProduct = new Map<string, { stock_qty: number; low_stock_threshold: number | null }[]>();
  for (const v of variantRows ?? []) {
    const list = variantsByProduct.get(v.product_id) ?? [];
    list.push({ stock_qty: v.stock_qty, low_stock_threshold: v.low_stock_threshold });
    variantsByProduct.set(v.product_id, list);
  }

  const activeProducts = (products ?? []).filter((p) => p.is_active);
  const stockOf = (p: (typeof products)[number]) => {
    const variants = variantsByProduct.get(p.id) ?? [];
    if (variants.length === 0) return { qty: p.stock_qty, low: p.low_stock_threshold != null && p.stock_qty > 0 && p.stock_qty <= p.low_stock_threshold };
    const qty = variants.reduce((sum, v) => sum + Number(v.stock_qty), 0);
    const low = variants.some((v) => v.low_stock_threshold != null && v.stock_qty > 0 && v.stock_qty <= v.low_stock_threshold);
    return { qty, low };
  };
  const lowStock = activeProducts.filter((p) => p.track_inventory && stockOf(p).low);
  const outOfStock = activeProducts.filter((p) => p.track_inventory && stockOf(p).qty <= 0);
  const hiddenFromPos = activeProducts.filter((p) => !p.show_on_pos);

  const { data: departments } = await admin
    .from("pos_departments")
    .select("id, name, slug, financial_owner, status, sort_order")
    .is("deleted_at", null)
    .order("sort_order");

  const departmentStatus = (departments ?? []).map((d) => {
    const deptProducts = activeProducts.filter((p) => p.department_id === d.id);
    return {
      id: d.id,
      name: d.name,
      slug: d.slug,
      financialOwner: d.financial_owner,
      status: d.status,
      productCount: deptProducts.length,
      lowStockCount: deptProducts.filter((p) => lowStock.includes(p)).length,
      outOfStockCount: deptProducts.filter((p) => outOfStock.includes(p)).length,
    };
  });

  const { data: recentActivity } = await admin
    .from("activity_logs")
    .select("id, action, description, created_at")
    .in("action", [
      "created_pos_product", "edited_pos_product", "archived_pos_product",
      "created_pos_modifier_group", "edited_pos_modifier_group",
    ])
    .order("created_at", { ascending: false })
    .limit(10);

  return NextResponse.json({
    activeProducts: activeProducts.length,
    lowStock: lowStock.length,
    outOfStock: outOfStock.length,
    hiddenFromPos: hiddenFromPos.length,
    departments: departmentStatus,
    recentActivity: recentActivity ?? [],
  });
}
