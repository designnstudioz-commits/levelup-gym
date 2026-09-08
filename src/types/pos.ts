// Phase 3 — POS, Inventory and HealthBox row types.
//
// Kept in their own file rather than appended to database.ts, which is
// already 449 lines of gym domain. The Database client map in database.ts
// imports from here so the typed Supabase client still covers every table —
// deliberately not repeating the existing gap where five gym tables were
// never added to that map.

import type { Json } from "./database";

// ── Shared unions ────────────────────────────────────────────────────

/** Who the revenue on a line belongs to. Two values by business design:
 *  Supplements / Level Up Cafe / Accessories are Level Up's own departments,
 *  HealthBox is the third-party operator. */
export type FinancialOwner = "levelup" | "healthbox";

/** Spec §10. Note "Bank Transfer" — the gym's fee_payments uses "Bank",
 *  which is a stored CHECK value across historical rows and must not be
 *  renamed, so POS carries its own list. Member Account / tab is not a POS
 *  payment method in Phase 3. */
export type PosPaymentMethod =
  | "Cash" | "Card" | "Bank Transfer" | "EasyPaisa" | "JazzCash";

export type PosOrderStatus =
  | "open" | "held" | "completed" | "voided" | "refunded" | "partially_refunded";

export type PosCustomerType = "walk_in" | "member" | "daily_member" | "staff";

/** Spec §11 requires both models to be available per product. */
export type MemberPriceType = "none" | "fixed" | "percent";

/** Spec §15. Six of these are user-selectable on the Stock Adjustment
 *  screen; the rest originate from other flows. */
export type StockMovementType =
  | "opening" | "purchase" | "sale" | "customer_return"
  | "damage" | "expiry" | "wastage" | "loss_theft"
  | "internal_use" | "count_correction" | "manual_adjustment";

export type PosApprovalType = "refund" | "void" | "discount_over_limit";
export type PosApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export type HealthBoxExpenseCategory = "cogs" | "salary" | "operating" | "other";
export type SettlementStatus = "draft" | "finalised" | "paid";
export type SettlementPeriodType = "weekly" | "monthly";

// ── Settings ─────────────────────────────────────────────────────────

export interface PosSetting {
  key: string;
  value: Json;
  description: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Typed view of pos_settings, resolved once per request. */
export interface PosSettingsResolved {
  settlement_period_type: SettlementPeriodType;
  settlement_month_start_day: number;
  cashier_discount_limit_percent: number;
  void_window_minutes: number;
  barcode_scanning_enabled: boolean;
  quick_cash_denominations: number[];
  low_stock_default_threshold: number;
}

// ── Catalogue ────────────────────────────────────────────────────────

export interface PosDepartment {
  id: string;
  name: string;
  slug: string;
  financial_owner: FinancialOwner;
  description: string | null;
  sort_order: number;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PosCategory {
  id: string;
  department_id: string;
  name: string;
  sort_order: number;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PosSupplier {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PosProduct {
  id: string;
  department_id: string;
  category_id: string | null;
  supplier_id: string | null;

  name: string;
  description: string | null;
  brand: string | null;
  sku: string | null;
  barcode: string | null;
  image_url: string | null;
  unit: string | null;

  /** Owner/manager only. Stripped server-side by /api/pos/catalog for every
   *  other caller — never rely on the UI to hide it. */
  cost_price: number | null;
  selling_price: number;

  member_price_type: MemberPriceType;
  member_price: number | null;
  member_discount_percent: number | null;

  /** Normally null, meaning inherit from the department. */
  financial_owner_override: FinancialOwner | null;

  track_inventory: boolean;
  /** Derived cache of SUM(pos_stock_movements.qty_delta). Never write
   *  directly — post a movement. */
  stock_qty: number;
  low_stock_threshold: number | null;

  /** Three independent states: exists / on the terminal / in stock now. */
  is_active: boolean;
  show_on_pos: boolean;
  is_available: boolean;

  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** What the terminal actually receives: cost and margin removed. */
export type PosProductForTerminal = Omit<PosProduct, "cost_price">;

export interface PosProductVariant {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  price_delta: number;
  cost_delta: number;
  stock_qty: number;
  is_available: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ── Modifiers ────────────────────────────────────────────────────────

export interface PosModifierGroup {
  id: string;
  /** Null = usable by any department. */
  department_id: string | null;
  name: string;
  selection_type: "single" | "multiple";
  is_required: boolean;
  min_select: number;
  /** Null = unlimited. */
  max_select: number | null;
  sort_order: number;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PosModifier {
  id: string;
  group_id: string;
  name: string;
  price_delta: number;
  is_default: boolean;
  is_available: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PosProductModifierGroup {
  id: string;
  product_id: string;
  group_id: string;
  sort_order: number;
  created_at: string;
  deleted_at: string | null;
}

/** The modifier selection snapshot stored on an order line. */
export interface PosOrderItemModifier {
  group: string;
  name: string;
  price_delta: number;
}

// ── Register sessions ────────────────────────────────────────────────

export interface PosRegisterSession {
  id: string;
  terminal_name: string | null;
  cashier_id: string;

  opened_at: string;
  opening_cash: number;

  closed_at: string | null;
  counted_cash: number | null;
  /** opening_cash + cash sales - cash refunds. Payouts are not part of this
   *  formula; no payout feature exists in Phase 3. */
  expected_cash: number | null;
  variance: number | null;
  order_count: number;
  payment_method_totals: Record<string, number>;

  reviewed_by: string | null;
  reviewed_at: string | null;
  /** Set on manager review. A locked session is immutable except through an
   *  explicit audited correction workflow. */
  is_locked: boolean;

  status: "open" | "closed" | "reviewed";
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ── Orders ───────────────────────────────────────────────────────────

export interface PosOrder {
  id: string;
  /** 'LU-1042'. Null until completion, so parked baskets never consume a
   *  customer-facing number. */
  order_no: string | null;
  /** 'H-021' while held. A held order that completes keeps this and also
   *  receives a normal order_no. */
  hold_ref: string | null;

  session_id: string | null;
  status: PosOrderStatus;

  customer_type: PosCustomerType;
  member_id: string | null;
  daily_member_id: string | null;
  staff_id: string | null;
  customer_label: string | null;

  gross_amount: number;
  discount_type: "none" | "percent" | "amount" | null;
  discount_value: number;
  discount_amount: number;
  net_amount: number;
  item_count: number;

  /** Denormalised split of net_amount, written once at completion. */
  levelup_net_amount: number;
  healthbox_net_amount: number;

  served_by: string;
  completed_at: string | null;

  voided_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
  refund_of_order_id: string | null;
  discount_authorised_by: string | null;

  held_at: string | null;
  held_label: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PosOrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  variant_id: string | null;

  /** Snapshots from here down — never joined at read time. */
  department_id: string | null;
  department_name: string;
  financial_owner: FinancialOwner;

  product_name: string;
  variant_name: string | null;
  brand: string | null;
  sku: string | null;

  unit_price: number;
  cost_price: number | null;
  /** Negative on a refund line. */
  qty: number;

  modifiers: PosOrderItemModifier[];
  modifiers_total: number;
  /** The "Special note" kitchen note for this line. */
  item_note: string | null;

  line_gross: number;
  line_discount: number;
  line_net: number;

  member_price_applied: boolean;
  member_price_type: MemberPriceType | null;
  member_price_value: number | null;

  created_at: string;
}

export interface PosPayment {
  id: string;
  order_id: string;
  method: PosPaymentMethod;
  amount: number;
  tendered: number | null;
  change_given: number | null;
  reference: string | null;
  created_at: string;
}

// ── Inventory ────────────────────────────────────────────────────────

export interface PosStockReceipt {
  id: string;
  supplier_id: string | null;
  department_id: string | null;
  received_date: string;
  reference: string | null;
  total_qty: number;
  total_cost: number;
  note: string | null;
  status: "draft" | "posted";
  posted_by: string | null;
  posted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PosStockReceiptItem {
  id: string;
  receipt_id: string;
  product_id: string;
  variant_id: string | null;
  qty: number;
  unit_cost: number | null;
  total_cost: number | null;
  created_at: string;
  deleted_at: string | null;
}

export interface PosStockCount {
  id: string;
  department_id: string | null;
  name: string | null;
  due_date: string | null;
  status: "draft" | "submitted" | "applied" | "cancelled";
  counted_by: string | null;
  submitted_at: string | null;
  applied_by: string | null;
  applied_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PosStockCountItem {
  id: string;
  count_id: string;
  product_id: string;
  variant_id: string | null;
  system_qty: number;
  counted_qty: number | null;
  variance: number | null;
  note: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface PosStockMovement {
  id: string;
  product_id: string;
  variant_id: string | null;
  type: StockMovementType;
  /** Signed. Current stock is SUM(qty_delta) across all rows. */
  qty_delta: number;
  qty_before: number | null;
  qty_after: number | null;
  order_id: string | null;
  receipt_id: string | null;
  stock_count_id: string | null;
  unit_cost: number | null;
  reason_note: string | null;
  created_by: string | null;
  created_at: string;
}

// ── Approvals ────────────────────────────────────────────────────────

export interface PosApproval {
  id: string;
  type: PosApprovalType;
  order_id: string | null;
  session_id: string | null;
  value_amount: number | null;
  value_percent: number | null;
  /** Mandatory on request — a cashier must say why. */
  reason: string;
  status: PosApprovalStatus;
  requested_by: string;
  requested_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  resulting_order_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ── HealthBox ────────────────────────────────────────────────────────

export interface PosHealthBoxExpense {
  id: string;
  expense_date: string;
  category: HealthBoxExpenseCategory;
  title: string;
  description: string | null;
  amount: number;
  attachment_urls: string[] | null;
  status: "pending" | "approved" | "rejected";
  submitted_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  settlement_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PosSettlement {
  id: string;
  financial_owner: "healthbox";
  period_type: SettlementPeriodType;
  period_start: string;
  period_end: string;

  gross_sales: number;
  total_discounts: number;
  net_sales: number;

  approved_cogs: number;
  approved_operating: number;
  approved_expenses: number;

  net_profit: number;

  /** Both are 0 when the period is a loss — a loss belongs wholly to
   *  HealthBox (spec §20) and is carried in loss_amount, not split. */
  levelup_share: number;
  healthbox_share: number;
  is_loss: boolean;
  loss_amount: number;

  status: SettlementStatus;
  finalised_by: string | null;
  finalised_at: string | null;
  paid_at: string | null;
  payment_method: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
