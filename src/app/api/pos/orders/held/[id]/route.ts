import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser, logPosActivity } from "@/lib/pos/auth";
import { POS_TERMINAL_ROLES } from "@/lib/pos/permissions";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Full detail for resuming a held order — returns the cart_snapshot as-is
 *  so the terminal can rebuild CartState with a plain JSON parse, no
 *  catalogue re-fetch needed (every line already carries its own snapshot). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_TERMINAL_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const admin = getServiceClient();

  const { data, error } = await admin
    .from("pos_orders")
    .select("id, hold_ref, status, cart_snapshot")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Held order not found" }, { status: 404 });
  }
  if (data.status !== "held") {
    return NextResponse.json({ error: "This order is no longer held" }, { status: 409 });
  }
  if (!data.cart_snapshot) {
    // Should not happen — held rows always carry a snapshot — but a
    // missing one must fail loudly rather than resume an empty basket.
    return NextResponse.json({ error: "This held order has no saved basket" }, { status: 500 });
  }

  return NextResponse.json({
    orderId: data.id,
    holdRef: data.hold_ref,
    cart: data.cart_snapshot,
  });
}

/** Soft-deletes a held order that was never completed. Safe: a held order
 *  that never became 'completed' is not a financial record, so removing it
 *  does not touch anything the never-hard-delete rule is protecting —
 *  though the row itself is still soft-deleted, not dropped, for
 *  consistency with the rest of the schema. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_TERMINAL_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const { id } = await params;
  const admin = getServiceClient();

  const { data: existing, error: findErr } = await admin
    .from("pos_orders")
    .select("id, status, hold_ref")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (findErr || !existing) {
    return NextResponse.json({ error: "Held order not found" }, { status: 404 });
  }
  if (existing.status !== "held") {
    return NextResponse.json({ error: "Only a held order can be deleted this way" }, { status: 409 });
  }

  const { error: deleteErr } = await admin
    .from("pos_orders")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (deleteErr) {
    console.error("[POS held delete]", deleteErr);
    return NextResponse.json({ error: "Could not delete the held order" }, { status: 500 });
  }

  await logPosActivity({
    userId: caller.id,
    action: "deleted_held_pos_order",
    entityType: "pos_order",
    entityId: id,
    description: `${caller.fullName} deleted held order #${existing.hold_ref}`,
  });

  return NextResponse.json({ ok: true });
}
