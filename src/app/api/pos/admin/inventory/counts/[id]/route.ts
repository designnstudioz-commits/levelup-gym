import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser, logPosActivity } from "@/lib/pos/auth";
import { POS_ADMIN_ROLES } from "@/lib/pos/permissions";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const admin = getServiceClient();
  const { data: count, error } = await admin.from("pos_stock_counts").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error || !count) return NextResponse.json({ error: "Stock count not found" }, { status: 404 });

  const { data: items } = await admin
    .from("pos_stock_count_items")
    .select("id, product_id, variant_id, system_qty, counted_qty, variance, note")
    .eq("count_id", id)
    .is("deleted_at", null);

  const productIds = [...new Set((items ?? []).map((i) => i.product_id))];
  const { data: products } = productIds.length
    ? await admin.from("pos_products").select("id, name, sku").in("id", productIds)
    : { data: [] };
  const productById = new Map((products ?? []).map((p) => [p.id, p]));

  const variantIds = [...new Set((items ?? []).map((i) => i.variant_id).filter(Boolean))];
  const { data: variants } = variantIds.length
    ? await admin.from("pos_product_variants").select("id, name, sku").in("id", variantIds)
    : { data: [] };
  const variantById = new Map((variants ?? []).map((v) => [v.id, v]));

  const rows = (items ?? []).map((i) => ({
    ...i,
    productName: productById.get(i.product_id)?.name ?? "—",
    variantName: i.variant_id ? variantById.get(i.variant_id)?.name ?? null : null,
    sku: i.variant_id ? variantById.get(i.variant_id)?.sku : productById.get(i.product_id)?.sku,
  }));

  return NextResponse.json({ count, items: rows });
}

/** Fills in counted quantities and/or moves the count to "submitted" —
 *  never touches live stock. That only happens on POST .../apply, which
 *  runs pos_apply_stock_count() atomically. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const admin = getServiceClient();
  const { data: existing } = await admin.from("pos_stock_counts").select("status").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Stock count not found" }, { status: 404 });
  if (existing.status === "applied") {
    return NextResponse.json({ error: "This count has already been applied and can no longer be edited" }, { status: 400 });
  }

  if (Array.isArray(body.items)) {
    for (const item of body.items as { id: string; countedQty: number | null; note?: string | null }[]) {
      await admin
        .from("pos_stock_count_items")
        .update({ counted_qty: item.countedQty, note: item.note ?? null })
        .eq("id", item.id)
        .eq("count_id", id);
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status === "submitted" && existing.status === "draft") {
    patch.status = "submitted";
    patch.submitted_at = new Date().toISOString();
  } else if (body.status === "cancelled") {
    patch.status = "cancelled";
  }

  await admin.from("pos_stock_counts").update(patch).eq("id", id);

  if (patch.status === "submitted") {
    await logPosActivity({
      userId: caller.id, action: "submitted_pos_stock_count", entityType: "pos_stock_count", entityId: id,
      description: `${caller.fullName} submitted a stock count for review`,
    });
  }

  return NextResponse.json({ ok: true });
}
