// Phase F — HealthBox Expenses shared constants and helpers.
//
// pos_healthbox_expenses.category is a locked 4-value CHECK constraint
// (cogs/salary/operating/other) — the schema does not support a freely
// configurable category table, so per the Phase F spec ("allow a
// configurable structure IF the schema supports it") this stays a fixed
// set. What IS avoidable is scattering the label strings across every
// component that renders a category — they live here once instead.

export type ExpenseCategory = "cogs" | "salary" | "operating" | "other";
export type ExpenseStatus = "pending" | "approved" | "rejected" | "needs_correction";

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: "cogs", label: "Cost of Goods Sold" },
  { value: "salary", label: "Staff Salaries / Benefits" },
  { value: "operating", label: "Direct Stall Operating Expenses" },
  { value: "other", label: "Other Mutually Agreed Business Expenses" },
];

export function expenseCategoryLabel(category: string): string {
  return EXPENSE_CATEGORIES.find((c) => c.value === category)?.label ?? category;
}

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  needs_correction: "Needs Correction",
};

/** Only these statuses may still be edited by the person who submitted
 *  them, or receive a NEW management decision — approved/rejected are
 *  final (spec §9: once approved, no destructive editing; a rejected
 *  expense isn't reopened here either, matching "no silent status changes"
 *  — a genuinely mis-rejected expense gets resubmitted as a new entry). */
export const EDITABLE_STATUSES: ExpenseStatus[] = ["pending", "needs_correction"];
export const DECIDABLE_STATUSES: ExpenseStatus[] = ["pending", "needs_correction"];

export interface ExpenseMoneyFields {
  amount: number;
}

export function validateExpenseMoney(f: ExpenseMoneyFields): string | null {
  if (!(f.amount > 0)) return "Amount must be greater than zero";
  return null;
}
