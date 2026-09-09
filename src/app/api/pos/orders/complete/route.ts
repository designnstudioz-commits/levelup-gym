import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser, logPosActivity } from "@/lib/pos/auth";
import { POS_TERMINAL_ROLES } from "@/lib/pos/permissions";
import { computeTotals, type CartState } from "@/lib/pos/cart";
import { roundPkr } from "@/lib/pos/pricing";
import {
  buildOrderHeaderFields,
  buildOrderItemRows,
  buildStockMovementPlan,
  validateAvailability,
  type ProductCostInfo,
} from "@/lib/pos/orderWrite";
import type { PosPaymentMethod } from "@/types/pos";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const VALID_METHODS: PosPaymentMethod[] = ["Cash", "Card", "Bank Transfer", "EasyPaisa", "JazzCash"];

interface IncomingPayment {
  method: PosPaymentMethod;
  amount: number;
  tendered?: number;
  changeGiven?: number;
  reference?: string;
}

/**
 * Finalises a sale.
 *
 * MONEY IS NEVER TRUSTED FROM THE CLIENT. The client sends the cart (lines,
 * member, discount) and the payments the cashier collected; every total is
 * RECOMPUTED here with the same computeTotals() the terminal itself uses,
 * and that server-computed total — not anything the client claims — is
 * what payments are validated against and what gets written.
 *
 * Ordering is deliberate, to bound the damage from a failure partway
 * through: the order header is written in a non-'completed' state first
 * (status stays 'held' if resuming, or 'open' if fresh), then order_items
 * and payments are written against that id, and ONLY THEN does the header
 * flip to status='completed' with a real order_no. A failure before that
 * last step leaves a recoverable draft row, never a "completed" order that
 * turns out to have no items or no payment behind it.
 *
 * Uses the service-role client, matching the codebase's existing
 * api/admin/create-user pattern, and deliberately so: this needs to read
 * pos_products.cost_price to snapshot it onto order_items (for margin
 * reporting), and cost must never be resolvable through the caller's own
 * RLS-scoped session once RLS ships.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePosUser(POS_TERMINAL_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const body = await req.json().catch(() => null);
  const cart = body?.cart as CartState | undefined;
  const payments = body?.payments as IncomingPayment[] | undefined;

  if (!cart || !Array.isArray(cart.lines) || cart.lines.length === 0) {
    return NextResponse.json({ error: "Cannot complete an empty order" }, { status: 400 });
  }
  if (!Array.isArray(payments) || payments.length === 0) {
    return NextResponse.json({ error: "At least one payment is required" }, { status: 400 });
  }
  for (const p of payments) {
    if (!VALID_METHODS.includes(p.method)) {
      return NextResponse.json({ error: `Unrecognised payment method: ${p.method}` }, { status: 400 });
    }
    if (!(p.amount > 0)) {
      return NextResponse.json({ error: "Every payment must have a positive amount" }, { status: 400 });
    }
  }

  const totals = computeTotals(cart);
  const paymentsSum = roundPkr(payments.reduce((s, p) => s + p.amount, 0));

  if (paymentsSum !== totals.total) {
    return NextResponse.json(
      { error: `Payments total Rs ${paymentsSum} does not match the order total Rs ${totals.total}` },
      { status: 400 }
    );
  }

  const admin = getServiceClient();

  // ── Resolve cost + live availability ────────────────────────────────
  const productIds = [...new Set(cart.lines.map((l) => l.productId).filter(Boolean))];
  const { data: products, error: productsErr } = await admin
    .from("pos_products")
    .select("id, cost_price, is_available, track_inventory, stock_qty, low_stock_threshold")
    .in("id", productIds);

  if (productsErr) {
    console.error("[POS complete] product lookup failed", productsErr);
    return NextResponse.json({ error: "Could not verify the order" }, { status: 500 });
  }

  const costByProduct = new Map<string, ProductCostInfo>(
    (products ?? []).map((p) => [
      p.id,
      {
        costPrice: p.cost_price,
        isAvailable: p.is_available,
        trackInventory: p.track_inventory,
        stockQty: p.stock_qty,
        lowStockThreshold: p.low_stock_threshold,
      },
    ])
  );

  const availabilityError = validateAvailability(cart, costByProduct);
  if (availabilityError) {
    return NextResponse.json({ error: availabilityError }, { status: 409 });
  }

  // ── Order header: created/updated in a non-final state first ───────
  const headerFields = buildOrderHeaderFields(cart, totals);
  let orderId: string;
  let existingHoldRef: string | null = null;

  if (cart.holdOrderId) {
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
      .update(headerFields)
      .eq("id", existing.id);

    if (updateErr) {
      console.error("[POS complete] header update failed", updateErr);
      return NextResponse.json({ error: "Could not finalise the order" }, { status: 500 });
    }
    orderId = existing.id;
    existingHoldRef = existing.hold_ref;
  } else {
    const { data: inserted, error: insertErr } = await admin
      .from("pos_orders")
      .insert({ ...headerFields, status: "open", served_by: caller.id })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      console.error("[POS complete] header insert failed", insertErr);
      return NextResponse.json({ error: "Could not start the order" }, { status: 500 });
    }
    orderId = inserted.id;
  }

  // Defensive cleanup: if a prior attempt on this same draft order inserted
  // items and then failed before reaching 'completed', clear them before
  // writing fresh ones. Only ever touches rows belonging to an order that
  // has NOT reached 'completed' — the immutability guarantee is about
  // completed orders, not abandoned drafts.
  await admin.from("pos_order_items").delete().eq("order_id", orderId);

  const itemRows = buildOrderItemRows(cart, totals, costByProduct).map((r) => ({
    ...r,
    order_id: orderId,
  }));

  const { error: itemsErr } = await admin.from("pos_order_items").insert(itemRows);
  if (itemsErr) {
    console.error("[POS complete] items insert failed", itemsErr);
    return NextResponse.json(
      { error: "Could not save the order items. The order was not completed — try again." },
      { status: 500 }
    );
  }

  const paymentRows = payments.map((p) => ({
    order_id: orderId,
    method: p.method,
    amount: p.amount,
    tendered: p.tendered ?? null,
    change_given: p.changeGiven ?? null,
    reference: p.reference ?? null,
  }));

  const { error: paymentsErr } = await admin.from("pos_payments").insert(paymentRows);
  if (paymentsErr) {
    console.error("[POS complete] payments insert failed", paymentsErr);
    return NextResponse.json(
      { error: "Could not save the payment. The order was not completed — try again." },
      { status: 500 }
    );
  }

  // ── Assign the customer-facing number and flip to completed LAST ────
  const { data: orderNo, error: seqErr } = await admin.rpc("pos_next_order_no");
  if (seqErr || !orderNo) {
    console.error("[POS complete] order number generation failed", seqErr);
    return NextResponse.json(
      { error: "Items and payment were saved, but a receipt number could not be issued. Contact support before retrying." },
      { status: 500 }
    );
  }

  const completedAt = new Date().toISOString();
  const { error: finaliseErr } = await admin
    .from("pos_orders")
    .update({ order_no: orderNo, status: "completed", completed_at: completedAt, cart_snapshot: null })
    .eq("id", orderId);

  if (finaliseErr) {
    console.error("[POS complete] finalisation failed", finaliseErr);
    return NextResponse.json(
      { error: `Order number ${orderNo} was issued but the order could not be closed out. Contact support.` },
      { status: 500 }
    );
  }

  // ── Stock movements, best-effort ────────────────────────────────────
  // A failure here does not roll back the sale — the money has already
  // changed hands and the receipt number is issued. It is logged for
  // investigation rather than left silent.
  const movementPlan = buildStockMovementPlan(cart, costByProduct);
  for (const m of movementPlan) {
    const { error: moveErr } = await admin.from("pos_stock_movements").insert({
      product_id: m.productId,
      type: "sale",
      qty_delta: m.qtyDelta,
      qty_before: m.qtyBefore,
      qty_after: m.qtyAfter,
      order_id: orderId,
      unit_cost: m.unitCost,
      created_by: caller.id,
    });
    if (moveErr) {
      console.error(`[POS complete] stock movement failed for product ${m.productId}`, moveErr);
      continue;
    }
    const { error: stockUpdateErr } = await admin
      .from("pos_products")
      .update({ stock_qty: m.qtyAfter })
      .eq("id", m.productId);
    if (stockUpdateErr) {
      console.error(`[POS complete] stock_qty update failed for product ${m.productId}`, stockUpdateErr);
    }
  }

  await logPosActivity({
    userId: caller.id,
    action: "completed_pos_sale",
    entityType: "pos_order",
    entityId: orderId,
    description: `${caller.fullName} completed sale #${orderNo} — Rs ${totals.total} (${totals.itemCount} items${cart.member ? `, ${cart.member.fullName}` : ""})`,
    metadata: {
      levelupNet: totals.levelupNet,
      healthboxNet: totals.healthboxNet,
      methods: payments.map((p) => p.method),
    },
  });

  return NextResponse.json({
    orderId,
    orderNo,
    holdRef: existingHoldRef,
    total: totals.total,
  });
}
