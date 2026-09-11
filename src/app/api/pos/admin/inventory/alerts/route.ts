import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_ADMIN_ROLES } from "@/lib/pos/permissions";
import { classifyStock } from "@/lib/pos/inventory";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Every product/variant currently Low, Critical or Out of Stock, worst
 *  first. Owner/manager only. */
export async function GET() {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const admin = getServiceClient();

  const { data: products } = await admin
    .from("pos_products")
    .select("id, name, department_id, track_inventory, stock_qty, low_stock_threshold")
    .is("deleted_at", null)
    .eq("is_active", true)
    .eq("track_inventory", true);

  const productIds = (products ?? []).map((p) => p.id);
  const { data: variants } = productIds.length
    ? await admin.from("pos_product_variants").select("id, product_id, name, stock_qty, low_stock_threshold").in("product_id", productIds).is("deleted_at", null)
    : { data: [] };
  const variantsByProduct = new Map<string, typeof variants>();
  for (const v of variants ?? []) {
    const list = variantsByProduct.get(v.product_id) ?? [];
    list.push(v);
    variantsByProduct.set(v.product_id, list);
  }

  const deptIds = [...new Set((products ?? []).map((p) => p.department_id))];
  const { data: depts } = deptIds.length
    ? await admin.from("pos_departments").select("id, name").in("id", deptIds)
    : { data: [] };
  const deptById = new Map((depts ?? []).map((d) => [d.id, d.name]));

  const order = { out: 0, critical: 1, low: 2 };
  const rows: {
    productId: string; productName: string; variantId: string | null; variantName: string | null;
    departmentName: string; stockQty: number; lowStockThreshold: number | null; level: "out" | "critical" | "low";
  }[] = [];

  for (const p of products ?? []) {
    const pv = variantsByProduct.get(p.id) ?? [];
    if (pv.length > 0) {
      for (const v of pv) {
        const level = classifyStock(Number(v.stock_qty), v.low_stock_threshold, true);
        if (level === "out" || level === "critical" || level === "low") {
          rows.push({
            productId: p.id, productName: p.name, variantId: v.id, variantName: v.name,
            departmentName: deptById.get(p.department_id) ?? "—", stockQty: Number(v.stock_qty),
            lowStockThreshold: v.low_stock_threshold, level,
          });
        }
      }
    } else {
      const level = classifyStock(Number(p.stock_qty), p.low_stock_threshold, true);
      if (level === "out" || level === "critical" || level === "low") {
        rows.push({
          productId: p.id, productName: p.name, variantId: null, variantName: null,
          departmentName: deptById.get(p.department_id) ?? "—", stockQty: Number(p.stock_qty),
          lowStockThreshold: p.low_stock_threshold, level,
        });
      }
    }
  }

  rows.sort((a, b) => order[a.level] - order[b.level] || a.productName.localeCompare(b.productName));

  return NextResponse.json({ alerts: rows });
}
