import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_HEALTHBOX_ROLES } from "@/lib/pos/permissions";
import { callerDepartmentFilter } from "@/lib/pos/catalogAdmin";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Flat list of sellable SKUs (a variant if the product has one, otherwise
 * the product itself) for the Receive Stock / Adjustments / Stock Count
 * pickers. Department-scoped for healthbox_staff the same way the
 * catalogue admin list is — a HealthBox account must never even see a
 * Level Up SKU in a dropdown, let alone act on it.
 */
export async function GET() {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const admin = getServiceClient();

  let query = admin
    .from("pos_products")
    .select("id, department_id, name, sku, barcode, track_inventory, stock_qty, low_stock_threshold")
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("name");

  const deptFilter = callerDepartmentFilter(caller);
  if (deptFilter !== null) {
    query = deptFilter.length > 0 ? query.in("department_id", deptFilter) : query.eq("department_id", "00000000-0000-0000-0000-000000000000");
  }

  const { data: products, error } = await query;
  if (error) {
    console.error("[POS admin inventory skus]", error);
    return NextResponse.json({ error: "Could not load products" }, { status: 500 });
  }

  const productIds = (products ?? []).map((p) => p.id);
  const { data: variants } = productIds.length
    ? await admin.from("pos_product_variants").select("id, product_id, name, sku, barcode, stock_qty, low_stock_threshold").in("product_id", productIds).is("deleted_at", null).order("sort_order")
    : { data: [] };

  const deptIds = [...new Set((products ?? []).map((p) => p.department_id))];
  const { data: depts } = deptIds.length
    ? await admin.from("pos_departments").select("id, name, financial_owner").in("id", deptIds)
    : { data: [] };
  const deptById = new Map((depts ?? []).map((d) => [d.id, d]));

  const variantsByProduct = new Map<string, typeof variants>();
  for (const v of variants ?? []) {
    const list = variantsByProduct.get(v.product_id) ?? [];
    list.push(v);
    variantsByProduct.set(v.product_id, list);
  }

  const skus = (products ?? []).flatMap((p) => {
    const dept = deptById.get(p.department_id);
    const base = {
      productId: p.id, productName: p.name,
      departmentId: p.department_id, departmentName: dept?.name ?? "—", financialOwner: dept?.financial_owner ?? "levelup",
      trackInventory: p.track_inventory,
    };
    const pv = variantsByProduct.get(p.id) ?? [];
    if (pv.length > 0) {
      return pv.map((v) => ({
        ...base,
        variantId: v.id, variantName: v.name, sku: v.sku, barcode: v.barcode,
        stockQty: Number(v.stock_qty), lowStockThreshold: v.low_stock_threshold,
      }));
    }
    return [{
      ...base,
      variantId: null, variantName: null, sku: p.sku, barcode: p.barcode,
      stockQty: Number(p.stock_qty), lowStockThreshold: p.low_stock_threshold,
    }];
  });

  return NextResponse.json({ skus });
}
