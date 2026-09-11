// Phase 3 — the single source of truth for POS access control.
//
// WHY THIS FILE EXISTS
//
// The gym app's existing enforcement is layered and uneven: a few routes
// have real server-side checks, six use the client-side useRoleGuard, and
// most rely only on the sidebar hiding a link — which a direct URL walks
// straight past. POS handles cash, so it does not inherit that pattern.
//
// Every rule lives here once and is consulted from three places:
//   1. middleware.ts        — route-level gate before a page renders
//   2. /api/pos/* handlers  — the authoritative server-side check
//   3. Sidebar / UI         — cosmetic only, never the security boundary
//
// Rule 2 is the one that matters. The UI helpers exist so the interface
// does not offer actions that will be rejected, not to enforce anything.

import type { SystemRole } from "@/types/database";
import type { FinancialOwner } from "@/types/pos";

// ── Route access ─────────────────────────────────────────────────────

/** Roles that may operate the touch terminal. Receptionist is included so
 *  reception can cover the counter (Phase 3 decision §12 / C8). */
export const POS_TERMINAL_ROLES: SystemRole[] = [
  "owner", "manager", "cashier", "receptionist",
];

/** Full POS admin. Deliberately NOT cashier — a cashier never sees cost,
 *  margin, catalogue management or business-wide totals. */
export const POS_ADMIN_ROLES: SystemRole[] = ["owner", "manager"];

/** Owner-only: vendor terms, settlement finalisation, financial ownership. */
export const POS_OWNER_ROLES: SystemRole[] = ["owner"];

/** Screens HealthBox staff reach, always additionally scoped to their own
 *  department by `pos_department_scope`. */
export const POS_HEALTHBOX_ROLES: SystemRole[] = [
  "owner", "manager", "healthbox_staff",
];

/**
 * Explicit allow-list for every POS route.
 *
 * IMPORTANT: this map is consulted with a FAIL-CLOSED lookup (see
 * `canAccessPosRoute`), unlike the sidebar's existing `canAccess`, which
 * returns true for any route it does not know about. A POS route missing
 * from this map is denied, not granted.
 */
export const POS_ROUTE_ROLES: Record<string, SystemRole[]> = {
  // Terminal
  "/pos": POS_TERMINAL_ROLES,

  // Admin — overview and orders
  "/dashboard/pos": POS_ADMIN_ROLES,
  "/dashboard/pos/orders": POS_ADMIN_ROLES,
  "/dashboard/pos/sessions": POS_ADMIN_ROLES,
  "/dashboard/pos/reports": POS_ADMIN_ROLES,

  // Catalogue
  "/dashboard/pos/catalog/departments": POS_ADMIN_ROLES,
  "/dashboard/pos/catalog/categories": POS_ADMIN_ROLES,
  // HealthBox staff may add their own products and change their own prices
  // (spec §17) — the department scope check does the narrowing.
  "/dashboard/pos/catalog/products": POS_HEALTHBOX_ROLES,
  "/dashboard/pos/catalog/modifiers": POS_HEALTHBOX_ROLES,

  // Inventory
  "/dashboard/pos/inventory": POS_ADMIN_ROLES,
  // Receiving is permitted for HealthBox staff (spec §17)…
  "/dashboard/pos/inventory/receive": POS_HEALTHBOX_ROLES,
  // …but unrestricted manual quantity adjustment is explicitly NOT
  // (spec §17). Wastage and expiry are recorded through the receive/wastage
  // flow, which posts typed movements, not through free adjustment.
  "/dashboard/pos/inventory/adjustments": POS_ADMIN_ROLES,
  "/dashboard/pos/inventory/counts": POS_ADMIN_ROLES,
  "/dashboard/pos/inventory/movements": POS_ADMIN_ROLES,
  "/dashboard/pos/inventory/alerts": POS_ADMIN_ROLES,
  "/dashboard/pos/suppliers": POS_ADMIN_ROLES,

  // HealthBox
  "/dashboard/pos/healthbox": POS_HEALTHBOX_ROLES,
  "/dashboard/pos/healthbox/expenses": POS_HEALTHBOX_ROLES,
  // Settlement carries the profit split. HealthBox staff must never see it
  // (spec §17, §22) — the approved frame says so on the artboard.
  "/dashboard/pos/healthbox/settlement": POS_ADMIN_ROLES,
};

/**
 * Fail-closed route check.
 *
 * Matches the longest configured prefix, so `/dashboard/pos/orders/abc123`
 * resolves against `/dashboard/pos/orders`. An unrecognised POS route
 * returns false.
 */
export function canAccessPosRoute(pathname: string, role: SystemRole | null | undefined): boolean {
  if (!role) return false;

  let bestMatch: string | null = null;
  for (const route of Object.keys(POS_ROUTE_ROLES)) {
    if (pathname === route || pathname.startsWith(route + "/")) {
      if (!bestMatch || route.length > bestMatch.length) bestMatch = route;
    }
  }
  if (!bestMatch) return false;
  return POS_ROUTE_ROLES[bestMatch].includes(role);
}

/** True for any path this module governs — used by middleware to decide
 *  whether to apply POS rules at all. */
export function isPosPath(pathname: string): boolean {
  return pathname === "/pos"
    || pathname.startsWith("/pos/")
    || pathname.startsWith("/dashboard/pos")
    || pathname.startsWith("/api/pos");
}

// ── Landing ──────────────────────────────────────────────────────────

/**
 * Where a role belongs after sign-in.
 *
 * A cashier must not land on /dashboard: the existing dashboard page
 * branches on trainer / viewer / receptionist and otherwise falls through
 * to the full owner cockpit, which shows revenue. Routing them to /pos is
 * the primary containment, and the explicit cashier branch added to
 * dashboard/page.tsx is the backstop.
 */
export function landingRouteForRole(role: SystemRole | null | undefined): string {
  switch (role) {
    case "cashier":
      return "/pos";
    case "healthbox_staff":
      // No standalone HealthBox dashboard exists yet (/dashboard/pos/healthbox
      // 404s) — Products is the existing, already-authorised, department-
      // scoped landing screen instead. Keep in sync with middleware.ts and
      // dashboard/page.tsx, which both duplicate this mapping.
      return "/dashboard/pos/catalog/products";
    default:
      return "/dashboard";
  }
}

// ── Capability checks ────────────────────────────────────────────────

/** Cost price, margin, profit. Never exposed to cashier, receptionist or
 *  HealthBox staff. Enforced server-side in /api/pos/catalog by stripping
 *  the field — Postgres RLS is row-level and cannot hide one column, and
 *  Supabase gives every logged-in user the same `authenticated` DB role. */
export function canSeeCostAndMargin(role: SystemRole | null | undefined): boolean {
  return role === "owner" || role === "manager";
}

/** Business-wide totals, other cashiers' shifts, settlement figures.
 *  A cashier seeing THEIR OWN open session total is a different question —
 *  see `canSeeOwnShiftTotals`. */
export function canSeeBusinessTotals(role: SystemRole | null | undefined): boolean {
  return role === "owner" || role === "manager";
}

/** A cashier needs their own running shift figures to count the drawer at
 *  close (Phase 3 decision §6). Scoped strictly to their own open session. */
export function canSeeOwnShiftTotals(role: SystemRole | null | undefined): boolean {
  return POS_TERMINAL_ROLES.includes(role as SystemRole);
}

/** Who may START a refund or void. A cashier can — the approved Recent
 *  Orders frame shows the button in their own UI — but cannot authorise it. */
export function canRequestApproval(role: SystemRole | null | undefined): boolean {
  return POS_TERMINAL_ROLES.includes(role as SystemRole);
}

/** Who may APPROVE a refund, void or over-limit discount. Never the
 *  requester's own role unless they are already a manager. */
export function canResolveApproval(role: SystemRole | null | undefined): boolean {
  return role === "owner" || role === "manager";
}

/** Approving a HealthBox expense so it counts toward settlement. HealthBox
 *  staff may submit but never approve (spec §18). */
export function canApproveHealthBoxExpense(role: SystemRole | null | undefined): boolean {
  return role === "owner" || role === "manager";
}

/** Seeing the 50/50 split, net profit and settlement history (spec §17). */
export function canSeeSettlement(role: SystemRole | null | undefined): boolean {
  return role === "owner" || role === "manager";
}

/** Unrestricted manual stock adjustment. Explicitly denied to HealthBox
 *  staff by spec §17. */
export function canAdjustStock(role: SystemRole | null | undefined): boolean {
  return role === "owner" || role === "manager";
}

/** Changing a product's financial owner moves money between Level Up and
 *  HealthBox at settlement, so it is owner-only. */
export function canSetFinancialOwner(role: SystemRole | null | undefined): boolean {
  return role === "owner";
}

// ── Department scoping ───────────────────────────────────────────────

export interface PosScopeContext {
  role: SystemRole | null | undefined;
  /** system_users.pos_department_scope — null means unrestricted. */
  departmentScope: string[] | null | undefined;
}

/** Whether a user may act on a given department. An unscoped user (null or
 *  empty scope) may act on all; a scoped user only on the listed ids. */
export function canAccessDepartment(ctx: PosScopeContext, departmentId: string): boolean {
  if (!ctx.role) return false;
  const scope = ctx.departmentScope;
  if (!scope || scope.length === 0) return true;
  return scope.includes(departmentId);
}

/** Whether a user may see rows belonging to a financial owner. HealthBox
 *  staff must never see Level Up revenue, and vice versa is not a concern
 *  since Level Up management legitimately sees everything. */
export function canAccessFinancialOwner(
  role: SystemRole | null | undefined,
  owner: FinancialOwner
): boolean {
  if (!role) return false;
  if (role === "healthbox_staff") return owner === "healthbox";
  return true;
}

/** Narrows a Supabase filter list. Returns null when no narrowing applies,
 *  so callers can skip adding an `.in()` clause entirely. */
export function departmentScopeFilter(ctx: PosScopeContext): string[] | null {
  const scope = ctx.departmentScope;
  if (!scope || scope.length === 0) return null;
  return scope;
}
