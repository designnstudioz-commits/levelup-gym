/** Gym operating profit — the ONE definition, shared by the Expenses page,
 *  the owner dashboard and the Revenue report.
 *
 *  Written as a pure function over rows the caller already fetched, so there
 *  is no second fee-collection query anywhere: callers pass the same
 *  fee_payments / daily_members / expenses rows they already load.
 *
 *  Revenue deliberately matches what dashboard/reports/page.tsx has always
 *  counted — fee_payments PLUS walk-in day passes (daily_members.fee_paid).
 *  A walk-in is real gym income, and if this module counted only
 *  fee_payments, the Expenses page and the Revenue report would disagree
 *  about the same period, which is exactly the confusion this replaces.
 *
 *  SCOPE: gym operations only. HealthBox expenses, HealthBox settlements,
 *  the partner share and POS cost/margin are all deliberately excluded —
 *  they live in pos_healthbox_expenses and pos_settlements and have their
 *  own reporting. Do not fold them in here without a deliberate decision:
 *  netting a vendor's costs against gym fees would misstate both. */

export interface AmountRow { amount?: number | null }
export interface WalkInRow { fee_paid?: number | null }

export interface GymProfit {
  feesCollected: number;
  totalExpenses: number;
  netProfit: number;
}

const sum = (rows: { v: number | null | undefined }[]) =>
  rows.reduce((t, r) => t + (r.v ?? 0), 0);

export function calcGymProfit(input: {
  feePayments?: AmountRow[] | null;
  walkIns?: WalkInRow[] | null;
  expenses?: AmountRow[] | null;
}): GymProfit {
  const feesCollected =
    sum((input.feePayments ?? []).map((r) => ({ v: r.amount }))) +
    sum((input.walkIns ?? []).map((r) => ({ v: r.fee_paid })));

  const totalExpenses = sum((input.expenses ?? []).map((r) => ({ v: r.amount })));

  // Net profit can legitimately be negative in a bad month. Callers format
  // it; nothing here clamps it to zero, which would hide exactly the month
  // management most needs to see.
  return { feesCollected, totalExpenses, netProfit: feesCollected - totalExpenses };
}
