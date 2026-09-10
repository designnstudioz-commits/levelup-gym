import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser, logPosActivity } from "@/lib/pos/auth";
import { POS_TERMINAL_ROLES, POS_ADMIN_ROLES } from "@/lib/pos/permissions";
import { resolveManagerByPin } from "@/lib/pos/managerAuth";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Checks whether an order-level discount needs manager sign-off, and if
 * so, verifies it.
 *
 * THE LIMIT IS RE-CHECKED HERE, NEVER TRUSTED FROM THE CLIENT. The
 * terminal already has pos_settings loaded and can skip calling this route
 * entirely when it knows no approval is needed — but "the client didn't
 * think it needed approval" is not authorisation, so this route always
 * re-fetches the configured limit itself and decides fresh.
 *
 * If cashier_discount_limit_percent is not configured (null), NOTHING is
 * gated — this mirrors the gym's own existing fee-discount flow, which has
 * no cap of any kind. No threshold is invented here if the owner hasn't
 * set one.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePosUser(POS_TERMINAL_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const body = await req.json().catch(() => null);
  const subtotal = Number(body?.subtotal);
  const discountType = body?.discountType as "percent" | "amount" | undefined;
  const discountValue = Number(body?.discountValue);
  const pin = typeof body?.pin === "string" ? body.pin : null;

  if (!(subtotal > 0) || !discountType || !Number.isFinite(discountValue)) {
    return NextResponse.json({ error: "subtotal, discountType and discountValue are required" }, { status: 400 });
  }

  // Owner/manager ARE the approval authority — they never need their own
  // sign-off, at any percentage.
  if (POS_ADMIN_ROLES.includes(caller.role)) {
    return NextResponse.json({ approved: true, authorisedBy: caller.id, authorisedByName: caller.fullName });
  }

  const admin = getServiceClient();
  const { data: setting } = await admin
    .from("pos_settings")
    .select("value")
    .eq("key", "cashier_discount_limit_percent")
    .maybeSingle();

  const limit = setting?.value == null ? null : Number(setting.value);

  const equivalentPercent =
    discountType === "percent" ? discountValue : (discountValue / subtotal) * 100;

  // Not configured, or under the limit: preserve current behaviour —
  // apply freely, no approval step at all.
  if (limit == null || equivalentPercent <= limit) {
    return NextResponse.json({ approved: true, authorisedBy: null, authorisedByName: null });
  }

  if (!pin) {
    return NextResponse.json(
      { approved: false, requiresPin: true, limit, equivalentPercent: Math.round(equivalentPercent * 10) / 10 },
      { status: 200 }
    );
  }

  const manager = await resolveManagerByPin(pin);
  if (!manager) {
    return NextResponse.json({ approved: false, error: "Incorrect PIN" }, { status: 401 });
  }

  const { data: approval, error } = await admin
    .from("pos_approvals")
    .insert({
      type: "discount_over_limit",
      value_percent: equivalentPercent,
      reason: `Discount ${discountType === "percent" ? `${discountValue}%` : `Rs ${discountValue}`} exceeds the ${limit}% cashier limit`,
      status: "approved",
      requested_by: caller.id,
      resolved_by: manager.id,
      resolved_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !approval) {
    console.error("[POS discount authorize]", error);
    return NextResponse.json({ error: "Could not record the approval" }, { status: 500 });
  }

  await logPosActivity({
    userId: manager.id,
    action: "approved_pos_discount",
    entityType: "pos_approval",
    entityId: approval.id,
    description: `${manager.fullName} approved a ${equivalentPercent.toFixed(1)}% discount for ${caller.fullName} (limit ${limit}%)`,
  });

  return NextResponse.json({ approved: true, authorisedBy: manager.id, authorisedByName: manager.fullName });
}
