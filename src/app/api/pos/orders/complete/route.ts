import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_TERMINAL_ROLES } from "@/lib/pos/permissions";
import { computeTotals, type CartState } from "@/lib/pos/cart";
import { roundPkr } from "@/lib/pos/pricing";
import { buildCompletionPayload } from "@/lib/pos/orderWrite";
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
 * Money is never trusted from the client: the cart is recomputed here with
 * the same computeTotals() the terminal itself uses, and payments are
 * validated against THAT total.
 *
 * As of the Phase B closeout, the actual write — order header, items,
 * payments, order_no, stock, financial-owner split, all of it — happens
 * inside a single call to the pos_complete_order() Postgres function
 * (migration 20260910100100), which is one implicit transaction: if
 * anything in it fails, everything it did rolls back. This route's job is
 * now just auth, pricing, and shaping the payload — it does not itself
 * write anything to pos_orders/pos_order_items/pos_payments/
 * pos_stock_movements. See that migration's header for the full reasoning,
 * including why the function is deliberately unreachable except via the
 * service-role key used here.
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

  // A sale requires an open shift (Phase 3C — Register Sessions). Resolved
  // server-side, never trusted from the client: the terminal itself blocks
  // Pay when it has no open session, but that is a UX convenience, not
  // enforcement — this is.
  const { data: session } = await admin
    .from("pos_register_sessions")
    .select("id")
    .eq("cashier_id", caller.id)
    .eq("status", "open")
    .is("deleted_at", null)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: "Open a shift before taking a payment" }, { status: 409 });
  }

  const payload = buildCompletionPayload(cart, totals, caller.id, session.id, payments);

  const { data, error } = await admin.rpc("pos_complete_order", { payload });

  if (error) {
    // The function's RAISE EXCEPTION message (availability, stock, a
    // payment-sum mismatch caught again at the DB layer, etc.) comes
    // through here verbatim — it is already written to be shown to the
    // cashier, not a raw Postgres error.
    console.error("[POS complete] pos_complete_order failed", error);
    return NextResponse.json({ error: error.message || "Could not complete the sale" }, { status: 409 });
  }

  // No separate logPosActivity() call here — pos_complete_order() already
  // writes the activity_logs row itself, atomically with everything else
  // it does. A second write from this route would just be a duplicate
  // entry for the same sale.

  return NextResponse.json({
    orderId: data?.order_id,
    orderNo: data?.order_no,
    holdRef: cart.holdRef,
    total: data?.total ?? totals.total,
  });
}
