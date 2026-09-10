// Phase 3D — shared validation, scoping and audit-diffing for POS catalogue
// admin routes. One place for rules that every product/category/modifier
// route would otherwise have to repeat.

import type { PosCaller } from "./auth";
import { POS_ADMIN_ROLES } from "./permissions";

// ── Department scoping ───────────────────────────────────────────────

/** A healthbox_staff caller is confined to the department id(s) in their
 *  own pos_department_scope. owner/manager are unrestricted. Returns null
 *  when unrestricted — callers use that to skip adding a filter at all. */
export function callerDepartmentFilter(caller: PosCaller): string[] | null {
  if (POS_ADMIN_ROLES.includes(caller.role)) return null;
  return caller.departmentScope && caller.departmentScope.length > 0
    ? caller.departmentScope
    : []; // a healthbox_staff account with no scope configured sees nothing,
          // not everything — fail closed, not open.
}

/** Whether the caller may act on a specific department id. */
export function callerCanUseDepartment(caller: PosCaller, departmentId: string): boolean {
  const filter = callerDepartmentFilter(caller);
  if (filter === null) return true;
  return filter.includes(departmentId);
}

// ── Money-affecting validation ───────────────────────────────────────

export interface ProductMoneyFields {
  selling_price: number;
  cost_price: number | null;
  member_price_type: "none" | "fixed" | "percent";
  member_price: number | null;
  member_discount_percent: number | null;
}

/** Returns an error string if the pricing fields don't make sense, or null
 *  if they're fine. Enforced here so the catalogue can never even STORE a
 *  configuration that would let a member pay more than list price — the
 *  terminal's own resolvePrice() guards against it defensively too (see
 *  pricing.ts), but catching it at entry time means the catalogue is never
 *  self-contradictory in the first place.
 *
 *  hasVariants: a product with variants is a catalogue container with no
 *  customer-facing selling_price of its own (LOCKED RULE) — it's stored as
 *  0, so the "member price can't exceed selling_price" comparison would
 *  always fail there and must be skipped. resolvePrice()'s per-variant
 *  guard is what actually protects a member from overpaying in that case. */
export function validateProductMoney(f: ProductMoneyFields, hasVariants = false): string | null {
  if (!(f.selling_price >= 0)) return "Selling price must be zero or more";
  if (f.cost_price != null && f.cost_price < 0) return "Cost price cannot be negative";

  if (f.member_price_type === "fixed") {
    if (f.member_price == null) return "Enter a fixed member price, or switch the pricing model";
    if (f.member_price < 0) return "Member price cannot be negative";
    if (!hasVariants && f.member_price > f.selling_price) return "Member price cannot be more than the regular selling price";
  }
  if (f.member_price_type === "percent") {
    if (f.member_discount_percent == null) return "Enter a member discount percentage, or switch the pricing model";
    if (f.member_discount_percent <= 0 || f.member_discount_percent > 100) {
      return "Member discount must be between 1 and 100 percent";
    }
  }
  return null;
}

// ── Variants ──────────────────────────────────────────────────────────

export interface VariantInput {
  name?: unknown;
  price?: unknown;
}

/** A product with variants has no price of its own (LOCKED RULE) — every
 *  variant is its own sellable item and must carry a valid, non-negative
 *  price of its own. Returns an error string, or null if all variants are
 *  priced. Mirrors the client-side check in the admin form so a stale or
 *  scripted request can't bypass it. */
export function validateVariantPrices(variants: VariantInput[]): string | null {
  for (const v of variants) {
    const name = typeof v.name === "string" ? v.name.trim() : "";
    if (!name) return "Every variant needs a name";
    const price = Number(v.price);
    if (v.price == null || v.price === "" || !Number.isFinite(price) || price < 0) {
      return `"${name}" needs a valid selling price`;
    }
  }
  return null;
}

// ── Audit logging — meaningful changes only ──────────────────────────

/** Compares a product row before/after and returns a short, human list of
 *  what actually changed — never logs every field, only the ones spec §12
 *  calls out as worth recording. Returns [] when nothing tracked changed,
 *  so the caller can skip writing an activity_logs row entirely rather
 *  than log a no-op edit. */
export function describeProductChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): string[] {
  const changes: string[] = [];

  if (before.selling_price !== after.selling_price) {
    changes.push(`selling price Rs ${before.selling_price} → Rs ${after.selling_price}`);
  }
  if (before.cost_price !== after.cost_price) {
    changes.push(`cost price changed`); // never print the actual figures in a
    // description string that could be read by a role who shouldn't see cost —
    // activity_logs SELECT is owner-only today, but this keeps the habit safe
    // regardless of who reads it later.
  }
  if (
    before.member_price_type !== after.member_price_type ||
    before.member_price !== after.member_price ||
    before.member_discount_percent !== after.member_discount_percent
  ) {
    changes.push(`member pricing changed to ${after.member_price_type}`);
  }
  if (before.is_active !== after.is_active) {
    changes.push(after.is_active ? "activated" : "deactivated");
  }
  if (before.show_on_pos !== after.show_on_pos) {
    changes.push(after.show_on_pos ? "shown on POS" : "hidden from POS");
  }
  if (before.is_available !== after.is_available) {
    changes.push(after.is_available ? "marked available" : "marked sold out");
  }
  if (before.name !== after.name) {
    changes.push(`renamed to "${after.name}"`);
  }

  return changes;
}
