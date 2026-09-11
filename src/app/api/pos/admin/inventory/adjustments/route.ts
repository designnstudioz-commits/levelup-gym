import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_HEALTHBOX_ROLES, canAdjustStock } from "@/lib/pos/permissions";
import { callerCanUseDepartment } from "@/lib/pos/catalogAdmin";
import { ADJUSTMENT_REASONS, HEALTHBOX_ADJUSTMENT_REASONS } from "@/lib/pos/inventory";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Records one stock adjustment (damage/expiry/wastage/loss-theft/internal
 * use/manual adjustment) via pos_adjust_stock() (atomic: movement row +
 * live stock_qty update in one transaction).
 *
 * Reached from two different pages with two different trust levels:
 *  - /dashboard/pos/inventory/adjustments — owner/manager only (route-gated
 *    by POS_ROUTE_ROLES), full reason list, any product.
 *  - /dashboard/pos/inventory/receive — HealthBox staff's own "Record
 *    Wastage / Expiry" panel. The PAGE route is HealthBox-accessible, but
 *    this API enforces the real restriction: only wastage/expiry, and only
 *    within their own department scope (spec §9/§17 — "HealthBox staff
 *    must NOT get unrestricted manual quantity adjustment access").
 * canAdjustStock() gates nothing here by itself — the reason+scope check
 * below IS the server-side enforcement of that rule.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const body = await req.json().catch(() => null);
  if (!body?.productId || !body?.type) {
    return NextResponse.json({ error: "Product and reason are required" }, { status: 400 });
  }

  const reasonDef = ADJUSTMENT_REASONS.find((r) => r.value === body.type);
  if (!reasonDef) {
    return NextResponse.json({ error: "Invalid adjustment reason" }, { status: 400 });
  }

  const isFullAdjuster = canAdjustStock(caller.role);
  if (!isFullAdjuster) {
    // A healthbox_staff (or any future restricted role) caller: only the
    // two HealthBox-safe reasons, and only within their own department.
    if (!HEALTHBOX_ADJUSTMENT_REASONS.includes(body.type)) {
      return NextResponse.json({ error: "You are not authorised to use this adjustment reason" }, { status: 403 });
    }
  }

  if (reasonDef.requiresNotes && !String(body.note ?? "").trim()) {
    return NextResponse.json({ error: `A note is required for "${reasonDef.label}"` }, { status: 400 });
  }

  const qtyDelta = Number(body.qtyDelta);
  if (!Number.isFinite(qtyDelta) || qtyDelta === 0) {
    return NextResponse.json({ error: "Enter a non-zero adjustment quantity" }, { status: 400 });
  }

  const admin = getServiceClient();

  const { data: product } = await admin.from("pos_products").select("id, department_id").eq("id", body.productId).maybeSingle();
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  if (!callerCanUseDepartment(caller, product.department_id)) {
    return NextResponse.json({ error: "You cannot adjust stock for that product" }, { status: 403 });
  }

  const { data, error } = await admin.rpc("pos_adjust_stock", {
    payload: {
      caller_id: caller.id,
      product_id: body.productId,
      variant_id: body.variantId || null,
      type: body.type,
      qty_delta: qtyDelta,
      note: body.note || null,
    },
  });

  if (error) {
    console.error("[POS admin inventory adjustments post]", error);
    return NextResponse.json({ error: error.message || "Could not record the adjustment" }, { status: 400 });
  }

  return NextResponse.json(data);
}
