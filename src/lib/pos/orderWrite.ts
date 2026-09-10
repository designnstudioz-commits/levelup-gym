// Phase 3B — shaping a CartState into the payload pos_complete_order()
// expects.
//
// As of the Phase B closeout, actual completion (items, payments, stock,
// order number, financial-owner split) happens atomically inside the
// pos_complete_order() Postgres function (see migration 20260910100100) —
// not here. This file's job is narrower now: build the JSONB payload the
// route sends to that function, and build the header fields the hold
// endpoint writes directly (holding is a single-row write with no
// multi-step atomicity concern, so it stays a plain Supabase call).
//
// Deliberately NOT here any more: cost-price lookup, availability/stock
// validation, and stock-movement calculation. Those all moved into
// pos_complete_order() itself, where they run inside the same transaction
// as the writes they guard — a validation done here and a write done
// there would reopen exactly the race the RPC exists to close.

import type { CartLine, CartState, CartTotals } from "./cart";

/** Fields common to both a held order row and a completed order row —
 *  used by the hold endpoint directly, and mirrored (as JSONB keys) in the
 *  payload sent to pos_complete_order() — so the two never drift apart on
 *  what "the order's totals" means. */
export function buildOrderHeaderFields(cart: CartState, totals: CartTotals) {
  return {
    customer_type: cart.member ? ("member" as const) : ("walk_in" as const),
    member_id: cart.member?.id ?? null,
    discount_type: cart.discountType,
    discount_value: cart.discountValue,
    discount_amount: totals.discountAmount,
    gross_amount: totals.gross,
    net_amount: totals.total,
    levelup_net_amount: totals.levelupNet,
    healthbox_net_amount: totals.healthboxNet,
    item_count: totals.itemCount,
    note: cart.note,
  };
}

/**
 * Builds the `items` array of the pos_complete_order() payload.
 *
 * Every figure here (unit_price, line_net, etc.) comes from `totals` —
 * computeTotals() run server-side in the route — never from anything the
 * client might have sent as a bare number. cost_price is deliberately
 * ABSENT: the function resolves it itself, directly from pos_products, so
 * a client can never influence what gets recorded as cost.
 */
export function buildCompletionItemsPayload(cart: CartState, totals: CartTotals) {
  const totalsByKey = new Map(totals.lines.map((t) => [t.key, t]));

  return cart.lines.map((line: CartLine) => {
    const t = totalsByKey.get(line.key);
    return {
      product_id: line.productId,
      variant_id: line.variantId,
      department_id: line.departmentId,
      department_name: line.departmentName,
      financial_owner: line.financialOwner,
      product_name: line.productName,
      variant_name: line.variantName,
      brand: line.brand,
      sku: line.sku,
      unit_price: t?.effectiveUnitPrice ?? line.basePrice,
      qty: line.qty,
      modifiers: line.modifiers,
      modifiers_total: line.modifiersTotal,
      item_note: line.itemNote,
      line_gross: t?.lineGross ?? 0,
      // Member-price discount only — see the note on this in the previous
      // revision of this file: the order-level discount is not pushed down
      // per line, it stays on the order header (and, for settlement
      // purposes, on the header's levelup/healthbox split).
      line_discount: t?.memberSaving ?? 0,
      line_net: t?.lineNet ?? 0,
      member_price_applied: t?.memberPriceApplied ?? false,
      member_price_type: t?.memberPriceType ?? "none",
      member_price_value: t?.memberPriceValue ?? null,
    };
  });
}

/** Full payload for pos_complete_order(). `holdOrderId` is null for a
 *  fresh sale, or the id of the held order being finalised. */
export function buildCompletionPayload(
  cart: CartState,
  totals: CartTotals,
  callerId: string,
  sessionId: string | null,
  payments: Array<{
    method: string;
    amount: number;
    tendered?: number | null;
    changeGiven?: number | null;
    reference?: string | null;
  }>
) {
  return {
    caller_id: callerId,
    session_id: sessionId,
    hold_order_id: cart.holdOrderId ?? null,
    customer_type: cart.member ? "member" : "walk_in",
    member_id: cart.member?.id ?? null,
    discount_type: cart.discountType,
    discount_value: cart.discountValue,
    note: cart.note,
    items: buildCompletionItemsPayload(cart, totals),
    payments: payments.map((p) => ({
      method: p.method,
      amount: p.amount,
      tendered: p.tendered ?? null,
      change_given: p.changeGiven ?? null,
      reference: p.reference ?? null,
    })),
    totals: {
      gross: totals.gross,
      subtotal: totals.subtotal,
      discount_amount: totals.discountAmount,
      total: totals.total,
      levelup_net: totals.levelupNet,
      healthbox_net: totals.healthboxNet,
      item_count: totals.itemCount,
    },
  };
}
