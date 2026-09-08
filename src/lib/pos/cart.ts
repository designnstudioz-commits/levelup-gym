// Phase 3B — the cart: shape, operations and totals.
//
// Pure functions over an immutable CartState. No React, no Supabase. The
// terminal holds one CartState in useState and replaces it wholesale, which
// keeps "what is in the basket" trivially inspectable and makes held-order
// save/restore a straight JSON round-trip.
//
// Money rules live in ./pricing. Nothing here computes a price itself.

import type {
  FinancialOwner,
  MemberPriceType,
  PosOrderItemModifier,
  PosProductVariant,
} from "@/types/pos";
import { applyOrderDiscount, resolvePrice, roundPkr } from "./pricing";

/** The minimum a product must expose to be added to the cart.
 *
 *  Structural rather than tied to a row type: the terminal's catalogue view
 *  deliberately omits cost_price and other admin-only columns, so requiring
 *  a full product row here would force those fields into the client just to
 *  satisfy the compiler. */
export interface AddableProduct {
  id: string;
  department_id: string;
  department_name: string;
  financial_owner: FinancialOwner;
  name: string;
  brand: string | null;
  sku: string | null;
  selling_price: number;
  member_price_type: MemberPriceType;
  member_price: number | null;
  member_discount_percent: number | null;
}

// ── Shape ────────────────────────────────────────────────────────────

export interface CartMember {
  id: string;
  fullName: string;
  membershipNo: string | null;
  status: string | null;
}

export interface CartLine {
  /** Stable identity for React keys and for merging a repeat tap of the
   *  same configuration. Two lines merge only when product, variant,
   *  modifier selection AND note all match — otherwise "Bowl, no salsa"
   *  would silently fold into "Bowl". */
  key: string;

  productId: string;
  variantId: string | null;

  // Snapshots taken at add time, carried through to pos_order_items.
  departmentId: string;
  departmentName: string;
  financialOwner: FinancialOwner;
  productName: string;
  variantName: string | null;
  brand: string | null;
  sku: string | null;

  /** Catalogue price at add time: selling_price + variant delta. Modifiers
   *  are tracked separately so the receipt can show them itemised. */
  basePrice: number;
  modifiers: PosOrderItemModifier[];
  modifiersTotal: number;
  itemNote: string | null;

  qty: number;

  /** Kept so member pricing can be recomputed when a member is attached or
   *  removed mid-order, without re-fetching the catalogue. */
  memberPriceType: MemberPriceType;
  memberPrice: number | null;
  memberDiscountPercent: number | null;
}

export interface CartState {
  lines: CartLine[];
  member: CartMember | null;
  discountType: "none" | "percent" | "amount";
  discountValue: number;
  /** Set when a manager authorised an over-limit discount. */
  discountAuthorisedBy: string | null;
  note: string | null;
  /** Present when this basket was resumed from a hold. */
  holdRef: string | null;
  holdOrderId: string | null;
}

export const emptyCart: CartState = {
  lines: [],
  member: null,
  discountType: "none",
  discountValue: 0,
  discountAuthorisedBy: null,
  note: null,
  holdRef: null,
  holdOrderId: null,
};

// ── Line identity ────────────────────────────────────────────────────

function lineKey(
  productId: string,
  variantId: string | null,
  modifiers: PosOrderItemModifier[],
  note: string | null
): string {
  // Modifier order must not affect identity — selecting cheese then
  // jalapeño is the same item as jalapeño then cheese.
  const mods = modifiers
    .map((m) => `${m.group}:${m.name}`)
    .sort()
    .join("|");
  return [productId, variantId ?? "-", mods, note ?? ""].join("::");
}

// ── Operations ───────────────────────────────────────────────────────

export function addLine(
  state: CartState,
  args: {
    product: AddableProduct;
    variant?: PosProductVariant | null;
    modifiers?: PosOrderItemModifier[];
    itemNote?: string | null;
    qty?: number;
  }
): CartState {
  const { product, variant } = args;
  const modifiers = args.modifiers ?? [];
  const itemNote = args.itemNote?.trim() || null;
  const qty = args.qty ?? 1;

  const key = lineKey(product.id, variant?.id ?? null, modifiers, itemNote);
  const existing = state.lines.find((l) => l.key === key);

  if (existing) {
    return {
      ...state,
      lines: state.lines.map((l) =>
        l.key === key ? { ...l, qty: l.qty + qty } : l
      ),
    };
  }

  const modifiersTotal = modifiers.reduce((s, m) => s + (m.price_delta || 0), 0);

  const line: CartLine = {
    key,
    productId: product.id,
    variantId: variant?.id ?? null,
    departmentId: product.department_id,
    departmentName: product.department_name,
    financialOwner: product.financial_owner,
    productName: product.name,
    variantName: variant?.name ?? null,
    brand: product.brand,
    sku: product.sku,
    basePrice: (product.selling_price ?? 0) + (variant?.price_delta ?? 0),
    modifiers,
    modifiersTotal,
    itemNote,
    qty,
    memberPriceType: product.member_price_type,
    memberPrice: product.member_price,
    memberDiscountPercent: product.member_discount_percent,
  };

  return { ...state, lines: [...state.lines, line] };
}

export function setLineQty(state: CartState, key: string, qty: number): CartState {
  if (qty <= 0) return removeLine(state, key);
  return {
    ...state,
    lines: state.lines.map((l) => (l.key === key ? { ...l, qty } : l)),
  };
}

export function removeLine(state: CartState, key: string): CartState {
  return { ...state, lines: state.lines.filter((l) => l.key !== key) };
}

export function setMember(state: CartState, member: CartMember | null): CartState {
  // Attaching or removing a member reprices every line. Because each line
  // carries its own member-pricing config, no catalogue re-fetch is needed —
  // totals simply recompute on the next render.
  return {
    ...state,
    member,
  };
}

export function setDiscount(
  state: CartState,
  type: "none" | "percent" | "amount",
  value: number,
  authorisedBy: string | null = null
): CartState {
  return {
    ...state,
    discountType: type,
    discountValue: type === "none" ? 0 : value,
    discountAuthorisedBy: type === "none" ? null : authorisedBy,
  };
}

export function clearCart(): CartState {
  // Deliberately keeps nothing — clearing means clearing, including the
  // attached member and any hold linkage.
  return { ...emptyCart };
}

// ── Totals ───────────────────────────────────────────────────────────

export interface CartLineTotals {
  key: string;
  /** Per unit, before any order-level discount. */
  effectiveUnitPrice: number;
  listUnitPrice: number;
  lineGross: number;   // listUnitPrice  * qty
  lineNet: number;     // effectiveUnit  * qty  (member pricing applied)
  memberSaving: number;
  memberPriceApplied: boolean;
  memberPriceType: MemberPriceType;
  memberPriceValue: number | null;
}

export interface CartTotals {
  lines: CartLineTotals[];
  itemCount: number;
  /** Sum of list prices — what a walk-in would pay. */
  gross: number;
  /** Sum after member pricing, before the order-level discount. */
  subtotal: number;
  memberSaving: number;
  discountAmount: number;
  total: number;
  /** Split by financial owner, for the order's denormalised columns. */
  levelupNet: number;
  healthboxNet: number;
}

export function computeTotals(state: CartState): CartTotals {
  const memberAttached = state.member != null;

  const lines: CartLineTotals[] = state.lines.map((l) => {
    const r = resolvePrice({
      product: {
        selling_price: l.basePrice,
        member_price_type: l.memberPriceType,
        member_price: l.memberPrice,
        member_discount_percent: l.memberDiscountPercent,
      },
      modifiersTotal: l.modifiersTotal,
      memberAttached,
    });

    const lineGross = roundPkr(r.listUnitPrice * l.qty);
    const lineNet = roundPkr(r.effectiveUnitPrice * l.qty);

    return {
      key: l.key,
      effectiveUnitPrice: r.effectiveUnitPrice,
      listUnitPrice: r.listUnitPrice,
      lineGross,
      lineNet,
      memberSaving: lineGross - lineNet,
      memberPriceApplied: r.memberPriceApplied,
      memberPriceType: r.memberPriceType,
      memberPriceValue: r.memberPriceValue,
    };
  });

  const byKey = new Map(lines.map((t) => [t.key, t]));

  const gross = lines.reduce((s, t) => s + t.lineGross, 0);
  const subtotal = lines.reduce((s, t) => s + t.lineNet, 0);
  const memberSaving = gross - subtotal;

  const { discountAmount, total } = applyOrderDiscount(
    subtotal,
    state.discountType,
    state.discountValue
  );

  // Split the order-level discount across owners in proportion to their
  // share of the subtotal. HealthBox settlement uses NET sales after
  // discounts (spec §19), so a Level Up-funded discount must not be charged
  // wholly against HealthBox's side, nor vice versa. Proportional is the
  // only split that is defensible to both parties.
  let levelupNet = 0;
  let healthboxNet = 0;
  for (const l of state.lines) {
    const t = byKey.get(l.key);
    if (!t) continue;
    const share = subtotal > 0 ? t.lineNet / subtotal : 0;
    const net = t.lineNet - discountAmount * share;
    if (l.financialOwner === "healthbox") healthboxNet += net;
    else levelupNet += net;
  }

  // Round at the end and force the two owners to reconcile exactly to the
  // total — a stray rupee from proportional rounding must never make a
  // settlement disagree with the till.
  levelupNet = roundPkr(levelupNet);
  healthboxNet = roundPkr(total - levelupNet);

  return {
    lines,
    itemCount: state.lines.reduce((s, l) => s + l.qty, 0),
    gross,
    subtotal,
    memberSaving,
    discountAmount,
    total,
    levelupNet,
    healthboxNet,
  };
}

/** Whether any line in the basket would be cheaper for a member. Drives the
 *  cart-aware pill in the member picker. */
export function cartHasMemberPricing(state: CartState): boolean {
  return state.lines.some((l) => {
    const r = resolvePrice({
      product: {
        selling_price: l.basePrice,
        member_price_type: l.memberPriceType,
        member_price: l.memberPrice,
        member_discount_percent: l.memberDiscountPercent,
      },
      modifiersTotal: l.modifiersTotal,
      memberAttached: true,
    });
    return r.memberPriceApplied;
  });
}
