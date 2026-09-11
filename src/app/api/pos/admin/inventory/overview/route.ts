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

/**
 * Inventory Overview — operational stock health across the whole
 * catalogue. Owner/manager only, matching POS_ROUTE_ROLES for
 * "/dashboard/pos/inventory".
 *
 * Stock is tracked at the lowest sellable SKU (spec's locked rule): a
 * product with variants is classified by its variants, not its own
 * (unused, per Phase D) stock_qty column — same aggregation the catalogue
 * admin list already uses.
 */
export async function GET() {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const admin = getServiceClient();

  const { data: products } = await admin
    .from("pos_products")
    .select("id, name, track_inventory, stock_qty, low_stock_threshold")
    .is("deleted_at", null)
    .eq("is_active", true);

  const productIds = (products ?? []).map((p) => p.id);
  const { data: variants } = productIds.length
    ? await admin.from("pos_product_variants").select("id, product_id, name, stock_qty, low_stock_threshold").in("product_id", productIds).is("deleted_at", null)
    : { data: [] };

  const variantsByProduct = new Map<string, { stock_qty: number; low_stock_threshold: number | null }[]>();
  for (const v of variants ?? []) {
    const list = variantsByProduct.get(v.product_id) ?? [];
    list.push({ stock_qty: v.stock_qty, low_stock_threshold: v.low_stock_threshold });
    variantsByProduct.set(v.product_id, list);
  }

  let totalTracked = 0, low = 0, critical = 0, out = 0;

  for (const p of products ?? []) {
    if (!p.track_inventory) continue;
    const pv = variantsByProduct.get(p.id) ?? [];
    if (pv.length > 0) {
      // Each variant is its own sellable SKU — classify and count them
      // individually rather than collapsing the product to one status.
      for (const v of pv) {
        totalTracked++;
        const level = classifyStock(Number(v.stock_qty), v.low_stock_threshold, true);
        if (level === "out") out++;
        else if (level === "critical") critical++;
        else if (level === "low") low++;
      }
    } else {
      totalTracked++;
      const level = classifyStock(Number(p.stock_qty), p.low_stock_threshold, true);
      if (level === "out") out++;
      else if (level === "critical") critical++;
      else if (level === "low") low++;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const { count: countsDue } = await admin
    .from("pos_stock_counts")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .in("status", ["draft", "submitted"])
    .lte("due_date", today);

  const { data: recentActivity } = await admin
    .from("activity_logs")
    .select("id, action, description, created_at")
    .in("action", ["received_pos_stock", "adjusted_pos_stock", "applied_pos_stock_count"])
    .order("created_at", { ascending: false })
    .limit(10);

  return NextResponse.json({
    totalTracked,
    low,
    critical,
    out,
    countsDue: countsDue ?? 0,
    recentActivity: recentActivity ?? [],
  });
}
