// Phase 3B — price resolution for a single product line.
//
// Kept pure and dependency-free so the rules are readable in one place and
// can be reasoned about without a running cart. Every money figure the
// terminal shows comes through here.
//
// All amounts are PKR. Rounding is to whole rupees at the LINE level only
// (see roundPkr) — never per-unit, or a 3 x Rs 333.33 line drifts off the
// figure the customer is quoted.

import type { MemberPriceType, PosProductForTerminal, PosProductVariant } from "@/types/pos";

/** The gym prices in whole rupees; formatPKR renders no decimals. Rounding
 *  half-up matches what a person does with a calculator. */
export function roundPkr(n: number): number {
  return Math.round(n);
}

export interface PriceInput {
  product: Pick<
    PosProductForTerminal,
    "selling_price" | "member_price_type" | "member_price" | "member_discount_percent"
  >;
  variant?: Pick<PosProductVariant, "price_delta"> | null;
  /** Sum of the selected modifiers' price deltas. */
  modifiersTotal?: number;
  /** Whether a member is attached to the order. */
  memberAttached: boolean;
}

export interface ResolvedPrice {
  /** List unit price: base + variant delta + modifiers. What a walk-in pays. */
  listUnitPrice: number;
  /** What this order actually charges per unit. Equals listUnitPrice when no
   *  member is attached or the product has no member pricing. */
  effectiveUnitPrice: number;
  /** True only when a member price genuinely reduced the line. */
  memberPriceApplied: boolean;
  memberPriceType: MemberPriceType;
  /** The configured value that produced the discount — the fixed price, or
   *  the percentage. Snapshotted onto the order line so a historical
   *  receipt can be explained without consulting today's catalogue. */
  memberPriceValue: number | null;
  /** Per-unit saving. Zero when no member price applied. */
  unitSaving: number;
}

/**
 * Resolves what one unit of a product costs.
 *
 * The rule, stated once because it is the kind of thing that gets
 * reimplemented inconsistently:
 *
 *   base            = selling_price + variant.price_delta
 *   member 'fixed'  = member_price  + variant.price_delta
 *   member 'percent'= base * (1 - member_discount_percent/100)
 *   both            + modifiersTotal, which is NEVER discounted
 *
 * Modifiers stay at full price deliberately. An "Extra Chicken" add-on is a
 * cost line, not part of the product's advertised price, so a member
 * discount on the product should not quietly subsidise it.
 *
 * A member price is only applied when it is actually cheaper. A misconfigured
 * member_price above the list price must never charge a member MORE than a
 * walk-in — that is the one failure mode here that would reach a customer.
 */
export function resolvePrice(input: PriceInput): ResolvedPrice {
  const { product, variant, memberAttached } = input;
  const modifiersTotal = input.modifiersTotal ?? 0;
  const variantDelta = variant?.price_delta ?? 0;

  const base = (product.selling_price ?? 0) + variantDelta;
  const listUnitPrice = base + modifiersTotal;

  const type = (product.member_price_type ?? "none") as MemberPriceType;

  const noMemberPrice: ResolvedPrice = {
    listUnitPrice,
    effectiveUnitPrice: listUnitPrice,
    memberPriceApplied: false,
    memberPriceType: type,
    memberPriceValue: null,
    unitSaving: 0,
  };

  if (!memberAttached || type === "none") return noMemberPrice;

  let memberBase: number | null = null;
  let value: number | null = null;

  if (type === "fixed") {
    const mp = product.member_price;
    if (mp == null) return noMemberPrice;   // configured 'fixed' but no price set
    memberBase = mp + variantDelta;
    value = mp;
  } else {
    const pct = product.member_discount_percent;
    if (pct == null || pct <= 0) return noMemberPrice;
    memberBase = base * (1 - pct / 100);
    value = pct;
  }

  const memberUnitPrice = memberBase + modifiersTotal;

  // Guard: never charge a member more than the list price.
  if (memberUnitPrice >= listUnitPrice) return noMemberPrice;

  return {
    listUnitPrice,
    effectiveUnitPrice: memberUnitPrice,
    memberPriceApplied: true,
    memberPriceType: type,
    memberPriceValue: value,
    unitSaving: listUnitPrice - memberUnitPrice,
  };
}

/**
 * Whether a product would give a member a better price than a walk-in.
 *
 * Drives the `Member` badge on a product tile and the cart-aware pill in the
 * member picker ("Member pricing available" vs "No special price on cart"),
 * which the approved UX computes against the CURRENT basket rather than
 * treating it as a static member attribute.
 */
export function hasMemberPricing(
  product: Pick<
    PosProductForTerminal,
    "selling_price" | "member_price_type" | "member_price" | "member_discount_percent"
  >
): boolean {
  const withMember = resolvePrice({ product, memberAttached: true });
  return withMember.memberPriceApplied;
}

/** Applies an order-level discount. Mirrors calculateDiscount() in
 *  src/lib/utils.ts, which the gym's fee flows already use — same formula,
 *  same clamping, so a POS discount behaves the way staff already expect. */
export function applyOrderDiscount(
  subtotal: number,
  type: "none" | "percent" | "amount" | undefined,
  value: number | string | undefined
): { discountAmount: number; total: number } {
  const v = Number(value) || 0;
  const rawDiscount =
    type === "percent" ? roundPkr((subtotal * v) / 100)
    : type === "amount" ? v
    : 0;
  // Clamp the discount itself, not just the total — a percent above 100
  // (mistyped, or a stray keypad tap) must never let discountAmount exceed
  // subtotal while total floors at 0. Without this, discountAmount + total
  // stops equalling subtotal, which is exactly the reconciliation the
  // order header and the financial-owner split both depend on.
  const discountAmount = Math.max(0, Math.min(rawDiscount, subtotal));
  return { discountAmount, total: subtotal - discountAmount };
}
