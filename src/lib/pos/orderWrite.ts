// Phase 3B — turning a CartState into the rows pos_order_items and
// pos_stock_movements actually need.
//
// Pure mapping logic, kept separate from the API routes so the shape of a
// written order line is reviewable in one place rather than buried inside
// request-handling code.

import type { CartLine, CartState, CartTotals } from "./cart";

/** Fields common to both a held order row and a completed order row —
 *  used by the hold endpoint and the complete endpoint so the two never
 *  drift apart on what "the order's totals" means. */
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

export interface ProductCostInfo {
  costPrice: number | null;
  isAvailable: boolean;
  trackInventory: boolean;
  stockQty: number;
  lowStockThreshold: number | null;
}

/**
 * Builds the pos_order_items rows for a cart. Caller adds `order_id` before
 * inserting — it isn't known until the order header exists.
 *
 * `line_discount` here is specifically the MEMBER-PRICE discount for that
 * line (lineGross − lineNet from computeTotals). It does NOT include a
 * share of the order-level discount — that discount is applied once at the
 * order header (pos_orders.discount_amount) and split by financial owner
 * there (levelup_net_amount / healthbox_net_amount), not pushed down onto
 * individual lines. This mirrors how the rest of the app keeps a
 * transaction's adjustments at the header level rather than fabricating a
 * proportional per-line split nobody asked for.
 */
export function buildOrderItemRows(
  cart: CartState,
  totals: CartTotals,
  costByProduct: Map<string, ProductCostInfo>
) {
  const totalsByKey = new Map(totals.lines.map((t) => [t.key, t]));

  return cart.lines.map((line: CartLine) => {
    const t = totalsByKey.get(line.key);
    const cost = line.productId ? costByProduct.get(line.productId) : undefined;

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
      cost_price: cost?.costPrice ?? null,
      qty: line.qty,
      modifiers: line.modifiers,
      modifiers_total: line.modifiersTotal,
      item_note: line.itemNote,
      line_gross: t?.lineGross ?? 0,
      line_discount: t?.memberSaving ?? 0,
      line_net: t?.lineNet ?? 0,
      member_price_applied: t?.memberPriceApplied ?? false,
      member_price_type: t?.memberPriceType ?? "none",
      member_price_value: t?.memberPriceValue ?? null,
    };
  });
}

export interface StockMovementPlanItem {
  productId: string;
  qtyDelta: number;
  qtyBefore: number;
  qtyAfter: number;
  unitCost: number | null;
}

/**
 * Aggregates quantity PER PRODUCT across every line before computing a
 * movement, rather than writing one movement per line independently. Two
 * lines of the same product (e.g. two different variants) would otherwise
 * each read the same stale stock_qty and decrement from it separately,
 * silently under-counting the real depletion.
 *
 * Stock is tracked at the PRODUCT level in this phase — pos_product_variants
 * carries its own stock_qty column in the schema, but nothing in Phase B's
 * scope exercises per-variant stock, so variant-level tracking is left
 * unimplemented here rather than half-built. Flagged in the Phase B report.
 */
export function buildStockMovementPlan(
  cart: CartState,
  costByProduct: Map<string, ProductCostInfo>
): StockMovementPlanItem[] {
  const qtyByProduct = new Map<string, number>();
  for (const line of cart.lines) {
    if (!line.productId) continue;
    const info = costByProduct.get(line.productId);
    if (!info?.trackInventory) continue;
    qtyByProduct.set(line.productId, (qtyByProduct.get(line.productId) ?? 0) + line.qty);
  }

  const plan: StockMovementPlanItem[] = [];
  for (const [productId, qty] of qtyByProduct) {
    const info = costByProduct.get(productId)!;
    const qtyBefore = info.stockQty;
    const qtyAfter = qtyBefore - qty;
    plan.push({ productId, qtyDelta: -qty, qtyBefore, qtyAfter, unitCost: info.costPrice });
  }
  return plan;
}

/**
 * Server-side availability re-check, run at completion time against the
 * catalogue as it is RIGHT NOW — not as it was when the terminal loaded.
 * Two cashiers can be mid-sale on the same item; the one who completes
 * second must be told, not silently allowed to oversell.
 */
export function validateAvailability(
  cart: CartState,
  costByProduct: Map<string, ProductCostInfo>
): string | null {
  const qtyByProduct = new Map<string, number>();
  for (const line of cart.lines) {
    if (!line.productId) continue;
    qtyByProduct.set(line.productId, (qtyByProduct.get(line.productId) ?? 0) + line.qty);
  }

  for (const line of cart.lines) {
    if (!line.productId) continue;
    const info = costByProduct.get(line.productId);
    if (!info) return `${line.productName} is no longer in the catalogue`;
    if (!info.isAvailable) return `${line.productName} is no longer available`;
    if (info.trackInventory) {
      const needed = qtyByProduct.get(line.productId) ?? line.qty;
      if (info.stockQty < needed) {
        return `Not enough stock for ${line.productName} (${info.stockQty} left)`;
      }
    }
  }
  return null;
}
