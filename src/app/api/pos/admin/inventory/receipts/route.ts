import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_HEALTHBOX_ROLES } from "@/lib/pos/permissions";
import { callerCanUseDepartment, callerDepartmentFilter } from "@/lib/pos/catalogAdmin";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Recent stock receipts. HealthBox staff see only their own department's
 *  receipts (they only reach this via the Receive Stock page — the
 *  page-level route itself is HealthBox-accessible per POS_ROUTE_ROLES). */
export async function GET(req: NextRequest) {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const admin = getServiceClient();
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 20, 100);

  let query = admin
    .from("pos_stock_receipts")
    .select("id, supplier_id, department_id, received_date, reference, total_qty, total_cost, note, created_by, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  const deptFilter = callerDepartmentFilter(caller);
  if (deptFilter !== null) {
    query = deptFilter.length > 0 ? query.in("department_id", deptFilter) : query.eq("department_id", "00000000-0000-0000-0000-000000000000");
  }

  const { data: receipts, error } = await query;
  if (error) {
    console.error("[POS admin inventory receipts list]", error);
    return NextResponse.json({ error: "Could not load receipts" }, { status: 500 });
  }

  const supplierIds = [...new Set((receipts ?? []).map((r) => r.supplier_id).filter(Boolean))];
  const { data: suppliers } = supplierIds.length
    ? await admin.from("pos_suppliers").select("id, name").in("id", supplierIds)
    : { data: [] };
  const supplierById = new Map((suppliers ?? []).map((s) => [s.id, s.name]));

  const rows = (receipts ?? []).map((r) => ({ ...r, supplierName: r.supplier_id ? supplierById.get(r.supplier_id) ?? "—" : null }));

  return NextResponse.json({ receipts: rows });
}

/** Posts a stock receipt: creates the header, the line items, an
 *  immutable purchase movement per line, and updates live stock_qty — all
 *  atomically in pos_receive_stock() (see the Phase E migration). */
export async function POST(req: NextRequest) {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const body = await req.json().catch(() => null);
  const items = Array.isArray(body?.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "Add at least one line item" }, { status: 400 });
  }

  const admin = getServiceClient();

  // Every line's product must be in the caller's own department scope —
  // checked here, not just left to the RPC, since the RPC runs as
  // SECURITY DEFINER and has no notion of the calling user's own scope.
  const productIds = [...new Set(items.map((i: { productId?: string }) => i.productId).filter(Boolean))];
  if (productIds.length === 0) {
    return NextResponse.json({ error: "Every line needs a product" }, { status: 400 });
  }
  const { data: products } = await admin.from("pos_products").select("id, department_id").in("id", productIds);
  for (const p of products ?? []) {
    if (!callerCanUseDepartment(caller, p.department_id)) {
      return NextResponse.json({ error: "You cannot receive stock into that department" }, { status: 403 });
    }
  }

  const { data, error } = await admin.rpc("pos_receive_stock", {
    payload: {
      caller_id: caller.id,
      supplier_id: body.supplierId || null,
      department_id: body.departmentId || null,
      received_date: body.receivedDate || null,
      reference: body.reference || null,
      note: body.note || null,
      items: items.map((i: { productId: string; variantId?: string | null; qty: number; unitCost?: number | null }) => ({
        product_id: i.productId, variant_id: i.variantId || null, qty: i.qty, unit_cost: i.unitCost ?? null,
      })),
    },
  });

  if (error) {
    console.error("[POS admin inventory receipts post]", error);
    return NextResponse.json({ error: error.message || "Could not post the receipt" }, { status: 400 });
  }

  return NextResponse.json(data);
}
