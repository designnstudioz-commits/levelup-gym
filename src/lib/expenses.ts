import type { SystemRole } from "@/types/database";

/** Operating-expense categories. Stored in expenses.expense_head as the
 *  value; the label is what staff see. Enforced here rather than by a DB
 *  CHECK — production holds historical rows whose expense_head predates this
 *  module, and a strict constraint would invalidate them (see the migration). */
export const EXPENSE_CATEGORIES = [
  { value: "Rent",        label: "Rent" },
  { value: "Utilities",   label: "Electricity / Utilities" },
  { value: "Salaries",    label: "Salaries" },
  { value: "Maintenance", label: "Maintenance" },
  { value: "Cleaning",    label: "Cleaning" },
  { value: "Marketing",   label: "Marketing" },
  { value: "Equipment",   label: "Equipment" },
  { value: "Supplies",    label: "Supplies" },
  { value: "Internet",    label: "Internet" },
  { value: "Other",       label: "Other" },
] as const;

export const EXPENSE_CATEGORY_VALUES = EXPENSE_CATEGORIES.map((c) => c.value) as readonly string[];

export function expenseCategoryLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return EXPENSE_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

/** OWNER ONLY — view, create, edit and void.
 *
 *  This page shows Net Profit: fees collected set against running costs.
 *  That is management information, not counter information, so no other role
 *  reaches the menu entry, the page, the API routes, the dashboard expense
 *  totals or the Net Profit figure. These three constants are kept separate
 *  even though they are currently identical, because they are consulted from
 *  different layers and collapsing them into one would make a future
 *  widening of, say, "view" silently widen "void" too.
 *
 *  Matches the RLS policy "owner read expenses" exactly. */
export const EXPENSE_VIEW_ROLES: SystemRole[] = ["owner"];
export const EXPENSE_CREATE_ROLES: SystemRole[] = ["owner"];
export const EXPENSE_VOID_ROLES: SystemRole[] = ["owner"];

/** Kept as a function rather than inlined: edit rights were once
 *  role-dependent (a receptionist could amend their own entry), and the
 *  API route still asks this question per row. With owner-only access the
 *  answer is unconditional, but the call sites do not need to change if that
 *  is ever revisited. */
export function canEditExpense(
  role: SystemRole,
  _callerSystemUserId: string,
  _expenseAddedBy: string | null
): boolean {
  return role === "owner";
}

export interface ExpenseRow {
  id: string;
  expense_date: string;
  title: string;
  expense_head: string | null;
  amount: number;
  payment_method: string | null;
  paid_to: string | null;
  note: string | null;
  receipt_path: string | null;
  added_by: string | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

// ── Bills, payments and derived status ────────────────────────────────────
//
// A bill (an `expenses` row) is a cost that exists. A payment
// (an `expense_payments` row) is money that actually left. They are separate
// because a bill can be back-dated, part-paid, or sit unpaid across months.
//
// The invariant the whole module rests on: **only payments move funds.**
// Never sum `expenses.amount` to answer "how much did we spend" — sum
// `expense_payments.amount` by `paid_on`. Summing both double-counts.

export interface ExpensePaymentRow {
  id: string;
  expense_id: string;
  amount: number;
  /** When the money actually left — drives every "Expenses Paid" figure. */
  paid_on: string;
  payment_method: string | null;
  reference: string | null;
  note: string | null;
  receipt_path: string | null;
  /** Real entry trail, kept separate from paid_on so back-dating stays auditable. */
  added_by: string | null;
  created_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  void_reason: string | null;
}

/** An `expenses` row, with its payments and amount history attached by
 *  the page. */
export interface ExpenseBillRow extends ExpenseRow {
  due_date: string | null;
  is_opening_bill: boolean;
  payments?: ExpensePaymentRow[];
  amount_history?: ExpenseAmountHistoryRow[];
}

export type ExpenseStatus = "unpaid" | "partial" | "paid";

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  unpaid: "Unpaid",
  partial: "Partially Paid",
  paid: "Paid",
};

/** Money paid against a bill, ignoring voided payments.
 *
 *  `asOf` caps it to payments made by that date, which is what makes a
 *  historical month honest: viewing September must not show a September bill
 *  as settled because of an October payment. */
export function paidAgainst(
  payments: ExpensePaymentRow[] | undefined,
  asOf?: string
): number {
  return (payments ?? []).reduce((total, p) => {
    if (p.deleted_at) return total;
    if (asOf && p.paid_on > asOf) return total;
    return total + Number(p.amount ?? 0);
  }, 0);
}

/** Bill total less valid payments, never below zero.
 *
 *  Both sides are taken as at `asOf`: the total as it stood then (a later
 *  correction must not restate a closed month) and only the payments made by
 *  then. */
export function outstandingOn(bill: ExpenseBillRow, asOf?: string): number {
  return Math.max(amountAsOf(bill, asOf) - paidAgainst(bill.payments, asOf), 0);
}

/** Status is derived, never stored — a stored copy would drift the moment a
 *  payment is voided or back-dated. Uses a 0.005 tolerance so NUMERIC(10,2)
 *  rounding cannot leave a fully-settled bill reading "Partially Paid". */
export function expenseStatus(bill: ExpenseBillRow, asOf?: string): ExpenseStatus {
  const total = amountAsOf(bill, asOf);
  const paid = paidAgainst(bill.payments, asOf);
  if (paid <= 0.005) return "unpaid";
  if (paid >= total - 0.005) return "paid";
  return "partial";
}

/** Figures for one month, as returned by the expense_month_summary RPC.
 *  Every value is derived from live rows on each call, so a back-dated entry
 *  or a void recalculates all later months with nothing to reconcile. */
export interface ExpenseMonthSummary {
  month: string;
  month_start: string;
  month_end: string;
  /** False until an owner has set the starting balance. */
  configured: boolean;
  start_month: string;
  opening_funds: number;
  /** Previous month's closing balance. Carry-forward enters ONLY here. */
  opening_balance: number;
  /** Gym fees + walk-ins for the month. Excludes carry-forward and POS. */
  income_collected: number;
  expenses_paid: number;
  /** income_collected - expenses_paid. Deliberately NOT the closing balance. */
  monthly_net: number;
  /** opening_balance + monthly_net. */
  closing_balance: number;
  outstanding_at_month_end: number;
  outstanding_now: number;
}

// ── Back-dating and effective-dated amounts ───────────────────────────────

/** Today in Asia/Karachi as YYYY-MM-DD. The gym is in Lahore, so "is this
 *  back-dated" must be judged against the gym's calendar, not the browser's
 *  or the server's. en-CA formats as YYYY-MM-DD. */
export function pktToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
}

/** First day of the current PKT month. */
export function pktMonthStart(): string {
  return pktToday().slice(0, 7) + "-01";
}

/** A date is back-dated when it falls before the current month — that is the
 *  point at which saving it changes a month the owner may already have
 *  reported on. Entering last week's bill mid-month is ordinary catching up
 *  and does not warn. */
export function isBackdated(date: string | null | undefined): boolean {
  if (!date) return false;
  return date < pktMonthStart();
}

/** A change to a bill's total is either a correction or a revision, and they
 *  mean different things for history:
 *   - correction: the figure was always wrong, so it is restated from the
 *     bill's own date and every past month changes.
 *   - revision: the amount genuinely changed from a stated date, so earlier
 *     months keep the old figure.
 *  The caller states which; the system never guesses. */
export type AmountChangeKind = "correction" | "revision";

export interface ExpenseAmountHistoryRow {
  id: string;
  expense_id: string;
  amount: number;
  effective_from: string;
  reason: string | null;
  changed_by: string | null;
  recorded_at: string;
}

/** The bill total as it stood on `asOf`, mirroring the SQL
 *  expense_amount_as_of so the table and the summary cards agree. */
export function amountAsOf(
  bill: { amount: number; amount_history?: ExpenseAmountHistoryRow[] },
  asOf?: string
): number {
  const history = bill.amount_history ?? [];
  if (!asOf || history.length === 0) return Number(bill.amount ?? 0);
  const eligible = history
    .filter((h) => h.effective_from <= asOf)
    .sort((a, b) =>
      a.effective_from === b.effective_from
        ? (a.recorded_at < b.recorded_at ? 1 : -1)
        : (a.effective_from < b.effective_from ? 1 : -1)
    );
  return eligible.length ? Number(eligible[0].amount) : Number(bill.amount ?? 0);
}

/** A bill is visible in a period if it existed by then and had not yet been
 *  voided. A void takes effect from the day it happened, so voiding a bill in
 *  November does not erase it from September, where it really was owed. */
export function billLiveAsOf(
  bill: { expense_date: string; deleted_at: string | null },
  asOf?: string
): boolean {
  if (bill.expense_date > (asOf ?? pktToday())) return false;
  if (!bill.deleted_at) return true;
  if (!asOf) return false;
  return bill.deleted_at.slice(0, 10) > asOf;
}
