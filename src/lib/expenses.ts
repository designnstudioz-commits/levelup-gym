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
