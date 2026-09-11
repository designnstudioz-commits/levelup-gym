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

/** Physical stock counts. Owner/manager only — matches POS_ROUTE_ROLES for
 *  "/dashboard/pos/inventory/counts"; this isn't part of HealthBox's scope
 *  (spec §9 lists receive/wastage/expiry/availability, not counts). */
export async function GET() {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const admin = getServiceClient();
  const { data: counts, error } = await admin
    .from("pos_stock_counts")
    .select("id, department_id, name, due_date, status, counted_by, submitted_at, applied_by, applied_at, note, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[POS admin inventory counts list]", error);
    return NextResponse.json({ error: "Could not load stock counts" }, { status: 500 });
  }

  const deptIds = [...new Set((counts ?? []).map((c) => c.department_id).filter(Boolean))];
  const { data: depts } = deptIds.length
    ? await admin.from("pos_departments").select("id, name").in("id", deptIds)
    : { data: [] };
  const deptById = new Map((depts ?? []).map((d) => [d.id, d.name]));

  const countIds = (counts ?? []).map((c) => c.id);
  const { data: itemCounts } = countIds.length
    ? await admin.from("pos_stock_count_items").select("count_id").in("count_id", countIds).is("deleted_at", null)
    : { data: [] };
  const itemCountByCount = new Map<string, number>();
  for (const i of itemCounts ?? []) {
    itemCountByCount.set(i.count_id, (itemCountByCount.get(i.count_id) ?? 0) + 1);
  }

  const rows = (counts ?? []).map((c) => ({
    ...c,
    departmentName: c.department_id ? deptById.get(c.department_id) ?? "—" : "All departments",
    itemCount: itemCountByCount.get(c.id) ?? 0,
  }));

  return NextResponse.json({ counts: rows });
}

/** Creates a draft count and snapshots one line per trackable SKU (product,
 *  or each variant if it has any) in the chosen department — the expected
 *  quantity is the live stock_qty at creation time. Counting itself (filling
 *  in counted_qty) happens afterward via PATCH; nothing here touches stock. */
export async function POST(req: NextRequest) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const body = await req.json().catch(() => null);
  if (!body?.departmentId) {
    return NextResponse.json({ error: "Department is required" }, { status: 400 });
  }

  const admin = getServiceClient();

  const { data: products } = await admin
    .from("pos_products")
    .select("id, stock_qty")
    .eq("department_id", body.departmentId)
    .eq("track_inventory", true)
    .eq("is_active", true)
    .is("deleted_at", null);

  const productIds = (products ?? []).map((p) => p.id);
  const { data: variants } = productIds.length
    ? await admin.from("pos_product_variants").select("id, product_id, stock_qty").in("product_id", productIds).is("deleted_at", null)
    : { data: [] };
  const variantsByProduct = new Map<string, typeof variants>();
  for (const v of variants ?? []) {
    const list = variantsByProduct.get(v.product_id) ?? [];
    list.push(v);
    variantsByProduct.set(v.product_id, list);
  }

  const lines: { product_id: string; variant_id: string | null; system_qty: number }[] = [];
  for (const p of products ?? []) {
    const pv = variantsByProduct.get(p.id) ?? [];
    if (pv.length > 0) {
      for (const v of pv) lines.push({ product_id: p.id, variant_id: v.id, system_qty: Number(v.stock_qty) });
    } else {
      lines.push({ product_id: p.id, variant_id: null, system_qty: Number(p.stock_qty) });
    }
  }

  if (lines.length === 0) {
    return NextResponse.json({ error: "That department has no trackable products to count" }, { status: 400 });
  }

  const { data: count, error } = await admin
    .from("pos_stock_counts")
    .insert({
      department_id: body.departmentId,
      name: body.name || null,
      due_date: body.dueDate || null,
      status: "draft",
      counted_by: body.assignedTo || caller.id,
      note: body.note || null,
    })
    .select("id")
    .single();

  if (error || !count) {
    console.error("[POS admin inventory counts create]", error);
    return NextResponse.json({ error: "Could not create the stock count" }, { status: 500 });
  }

  const { error: itemsError } = await admin
    .from("pos_stock_count_items")
    .insert(lines.map((l) => ({ count_id: count.id, ...l })));
  if (itemsError) {
    console.error("[POS admin inventory counts create items]", itemsError);
  }

  await logPosActivity({
    userId: caller.id,
    action: "created_pos_stock_count",
    entityType: "pos_stock_count",
    entityId: count.id,
    description: `${caller.fullName} started a stock count (${lines.length} lines)`,
  });

  return NextResponse.json({ id: count.id });
}
