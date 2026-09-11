// Phase E — shared inventory constants and helpers used by both the admin
// API routes and the admin pages, so the reason list / stock classification
// rules live in exactly one place.

export type StockMovementType =
  | "opening" | "purchase" | "sale" | "customer_return"
  | "damage" | "expiry" | "wastage" | "loss_theft" | "internal_use"
  | "count_correction" | "manual_adjustment";

/** The manual adjustment reasons a human picks from the Stock Adjustments
 *  page. "count_correction" is deliberately excluded — that type is only
 *  ever written by pos_apply_stock_count(), never chosen directly, so a
 *  count's audit trail can't be faked as an ordinary adjustment. */
export interface AdjustmentReason {
  value: "damage" | "expiry" | "wastage" | "loss_theft" | "internal_use" | "manual_adjustment";
  label: string;
  /** "Required notes for manual/exceptional adjustments" (spec) — the two
   *  reasons with the least inherent explanation of their own. */
  requiresNotes: boolean;
  /** Reasons a healthbox_staff caller may use at all — everything else is
   *  owner/manager only (canAdjustStock()). */
  healthboxAllowed: boolean;
}

export const ADJUSTMENT_REASONS: AdjustmentReason[] = [
  { value: "damage", label: "Damage", requiresNotes: false, healthboxAllowed: false },
  { value: "expiry", label: "Expiry", requiresNotes: false, healthboxAllowed: true },
  { value: "wastage", label: "Wastage", requiresNotes: false, healthboxAllowed: true },
  { value: "loss_theft", label: "Loss / Theft", requiresNotes: true, healthboxAllowed: false },
  { value: "internal_use", label: "Internal Use / Sample", requiresNotes: false, healthboxAllowed: false },
  { value: "manual_adjustment", label: "Authorized Manual Adjustment", requiresNotes: true, healthboxAllowed: false },
];

export function adjustmentReasonLabel(type: string): string {
  return ADJUSTMENT_REASONS.find((r) => r.value === type)?.label ?? type;
}

/** HealthBox staff may only ever post these two reasons (spec §9/§17) — the
 *  full reason list, including Damage/Loss-Theft/Internal Use/Manual
 *  Adjustment, stays owner/manager only via canAdjustStock(). */
export const HEALTHBOX_ADJUSTMENT_REASONS: string[] = ADJUSTMENT_REASONS
  .filter((r) => r.healthboxAllowed)
  .map((r) => r.value);

export type StockLevel = "not_tracked" | "out" | "critical" | "low" | "ok";

/**
 * Classifies a stock quantity against its own low-stock threshold.
 *
 * "Critical" isn't a separate stored column — the schema only has one
 * low_stock_threshold per product/variant — so it's derived as the bottom
 * half of the low-stock band (<= 50% of threshold), which is enough to
 * distinguish "getting low" from "about to run out" without inventing a
 * second configurable number nothing in the catalogue admin sets today.
 */
export function classifyStock(qty: number, threshold: number | null, tracked: boolean): StockLevel {
  if (!tracked) return "not_tracked";
  if (qty <= 0) return "out";
  if (threshold != null && threshold > 0) {
    if (qty <= threshold * 0.5) return "critical";
    if (qty <= threshold) return "low";
  }
  return "ok";
}

export function stockLevelLabel(level: StockLevel): string {
  switch (level) {
    case "out": return "Out of Stock";
    case "critical": return "Critical";
    case "low": return "Low";
    case "not_tracked": return "Not tracked";
    default: return "OK";
  }
}

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  opening: "Opening Balance",
  purchase: "Stock Received",
  sale: "Sale",
  customer_return: "Customer Return",
  damage: "Damage",
  expiry: "Expiry",
  wastage: "Wastage",
  loss_theft: "Loss / Theft",
  internal_use: "Internal Use / Sample",
  count_correction: "Stock Count Correction",
  manual_adjustment: "Authorized Manual Adjustment",
};
