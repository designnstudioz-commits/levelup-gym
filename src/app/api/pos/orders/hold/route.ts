import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser, logPosActivity } from "@/lib/pos/auth";
import { POS_TERMINAL_ROLES } from "@/lib/pos/permissions";
import { computeTotals, type CartState } from "@/lib/pos/cart";
import { buildOrderHeaderFields } from "@/lib/pos/orderWrite";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Parks a basket, or updates one already parked.
 *
 * Held baskets live in pos_orders.cart_snapshot, not pos_order_items —
 * see 20260910100000's migration header for why: order_items is an
 * immutable ledger, written exactly once at completion, and a held basket
 * is draft state that gets edited repeatedly before that point.
 *
 * Uses the service-role client for the same reason api/admin/create-user
 * does: this write should not depend on the caller's own RLS-scoped grants,
 * which do not exist yet and will be narrower than "can write pos_orders
 * freely" once they do.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePosUser(POS_TERMINAL_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const body = await req.json().catch(() => null);
  const cart = body?.cart as CartState | undefined;
  if (!cart || !Array.isArray(cart.lines) || cart.lines.length === 0) {
    return NextResponse.json({ error: "Cannot hold an empty order" }, { status: 400 });
  }

  const totals = computeTotals(cart);
  const admin = getServiceClient();

  const row = {
    ...buildOrderHeaderFields(cart, totals),
    held_label: cart.member?.fullName ?? null,
    cart_snapshot: cart,
    served_by: caller.id,
  };

  if (cart.holdOrderId) {
    // Editing an already-held basket. Must still be 'held' — a race where
    // someone else completed it between load and re-save must not silently
    // resurrect a finished sale.
    const { data: existing, error: findErr } = await admin
      .from("pos_orders")
      .select("id, status, hold_ref")
      .eq("id", cart.holdOrderId)
      .is("deleted_at", null)
      .maybeSingle();

    if (findErr || !existing) {
      return NextResponse.json({ error: "Held order not found" }, { status: 404 });
    }
    if (existing.status !== "held") {
      return NextResponse.json({ error: "This order is no longer held" }, { status: 409 });
    }

    const { error: updateErr } = await admin
      .from("pos_orders")
      .update(row)
      .eq("id", cart.holdOrderId);

    if (updateErr) {
      console.error("[POS hold] update failed", updateErr);
      return NextResponse.json({ error: "Could not update the held order" }, { status: 500 });
    }

    return NextResponse.json({ orderId: existing.id, holdRef: existing.hold_ref });
  }

  const { data: seq, error: seqErr } = await admin.rpc("pos_next_hold_ref");
  if (seqErr || !seq) {
    console.error("[POS hold] hold ref generation failed", seqErr);
    return NextResponse.json({ error: "Could not generate a hold reference" }, { status: 500 });
  }
  const holdRef = seq as string;

  const { data: inserted, error: insertErr } = await admin
    .from("pos_orders")
    .insert({ ...row, status: "held", hold_ref: holdRef, held_at: new Date().toISOString() })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    console.error("[POS hold] insert failed", insertErr);
    return NextResponse.json({ error: "Could not hold the order" }, { status: 500 });
  }

  await logPosActivity({
    userId: caller.id,
    action: "held_pos_order",
    entityType: "pos_order",
    entityId: inserted.id,
    description: `${caller.fullName} held an order (#${holdRef}, ${totals.itemCount} items, Rs ${totals.total})`,
  });

  return NextResponse.json({ orderId: inserted.id, holdRef });
}
