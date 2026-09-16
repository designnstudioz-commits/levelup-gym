import { RECURRING_FEE_TYPES } from "@/lib/utils";

// The single source of truth for a member's Fee Status (Paid / Partial /
// Pending / Free) — replaces the Members list's old `isFeeCurrent()`
// (`expiry_date >= today`), which was never actually a payment check: it
// let a member show "Paid" purely because their expiry_date had been set,
// with zero relationship to whether any fee_payments row existed. That's
// exactly what happened to Mansoor (LUM-2026-0458/0459) — a real incident
// where member creation succeeded, expiry_date was set from the package
// duration as always happens, but the fee collection that was supposed to
// happen next never landed. "Paid" must be evidence of money collected,
// never an inference from a date field alone.
//
// Revised after a pre-deployment review caught two real problems with the
// first version:
//
// 1. It summed balance_due across EVERY recurring-type payment ever, which
//    conflates "this cycle is unpaid" with "an old, unrelated cycle was
//    left with an unsettled balance". A member who fully paid September
//    but never settled a Rs 2,000 July shortfall would show "Partial, Rs
//    2,000 due" — describing September as unpaid because of July. This
//    version identifies the specific payment that produced the member's
//    CURRENT expiry_date (the one whose coverage_end matches it — that's
//    the actual link the schema records between a payment and the cycle
//    it bought) and scores the current cycle from that row alone.
//    Everything else recurring-type is reported separately as
//    historicalArrears — real money, never silently hidden, but never
//    blended into "is the current period paid".
//
// 2. It treated every member.admission_fee as currently owed if no
//    admission-type fee_payments row existed, with no allowance for
//    members whose admission was collected before this system existed.
//    Checked against real data: of 94 active members with admission_fee
//    configured, 25 have no admission-type row — 11 of those are
//    GymAutomate imports (comment starts with "GymAutomate", the exact
//    marker isNewMember() already uses elsewhere in this codebase) whose
//    admission was necessarily paid under the old system with no
//    migrated record. Their admission is never treated as outstanding
//    here; there is no reliable signal either way, and treating an
//    unverifiable legacy field as a live debt is a worse error than
//    treating it as settled.
//
// FREE/EXEMPT is the one true statically-approved zero-fee case:
// members.family_pricing_decision = 'free' — set only by an owner/manager
// approving a family membership. Deliberately NOT members.access_exempt,
// a different concept (device-blocking exemption for an otherwise-unpaid
// member) that must never hide a real balance from reception.
//
// Amounts due are read from members.admission_fee / members.monthly_fee,
// but outstanding amounts are read from fee_payments.balance_due wherever
// a payment row exists — balance_due is computed at collection time using
// the member's ACTUAL discounted final amount (see fee_payments.
// package_breakdown), so a member who was correctly charged a discounted
// rate and paid it in full already has balance_due = 0 regardless of what
// the undiscounted admission_fee/monthly_fee configured on the member row
// says. The undiscounted member-row fee is only ever used as the amount
// presumed due when NO payment exists at all to reveal what (if any)
// discount would have applied — there is no other data-driven number
// available for that case.

export type FeeStatus = "paid" | "partial" | "pending" | "free";

export interface FeeStatusResult {
  status: FeeStatus;
  /** Admission + current-cycle outstanding only. Always 0 for "paid" and
   *  "free". Never includes historicalArrears — see below. */
  outstandingAmount: number;
  admissionOutstanding: number;
  /** Outstanding on the specific recurring payment that produced the
   *  member's current expiry_date (or the full recurring fee if no such
   *  payment/cycle coverage exists). This is what "is the current period
   *  paid" actually means. */
  currentCycleOutstanding: number;
  /** Unsettled balance_due on recurring-type payments that do NOT belong
   *  to the current cycle — real money still owed, reported separately so
   *  it's never hidden, but never described as making the current period
   *  unpaid. Reception should see both numbers. */
  historicalArrears: number;
}

export interface FeeStatusMemberInput {
  admission_fee: number | string | null;
  monthly_fee: number | string | null;
  /** Negotiated PT price (see members.training_fee in CLAUDE.md — meant to
   *  already be folded into monthly_fee, but verified against live data
   *  to NOT always be: 5 active members have monthly_fee = 0 with a real
   *  training_fee due, which without this field would make their PT fee
   *  invisible to Fee Status regardless of whether it was ever collected. */
  training_fee?: number | string | null;
  expiry_date: string | null;
  family_pricing_decision?: string | null;
  /** members.comment — imported GymAutomate rows start with "GymAutomate"
   *  (the same marker isNewMember() checks elsewhere). Their admission is
   *  never treated as outstanding — see the module comment above. */
  comment?: string | null;
}

export interface FeeStatusPaymentInput {
  payment_type: string | null;
  balance_due: number | string | null;
  coverage_end?: string | null;
  deleted_at?: string | null;
  /** Used only to pick the "latest" row for legacy payments with no
   *  coverage_end (see currentRows below) — payment_date if available,
   *  else created_at. Without this, legacy-only members can't be resolved
   *  to a current cycle at all and fall back to the full recurring fee. */
  payment_date?: string | null;
}

const RECURRING_TYPES: readonly string[] = RECURRING_FEE_TYPES;

export function computeFeeStatus(
  member: FeeStatusMemberInput,
  payments: FeeStatusPaymentInput[],
  todayStr: string
): FeeStatusResult {
  if (member.family_pricing_decision === "free") {
    return { status: "free", outstandingAmount: 0, admissionOutstanding: 0, currentCycleOutstanding: 0, historicalArrears: 0 };
  }

  const validPayments = payments.filter((p) => !p.deleted_at);
  const admissionRows = validPayments.filter((p) => p.payment_type === "admission");
  const recurringRows = validPayments.filter((p) => p.payment_type && RECURRING_TYPES.includes(p.payment_type));

  const isLegacyImport = !!member.comment?.startsWith("GymAutomate");
  const admissionDue = Number(member.admission_fee) || 0;
  const admissionOutstanding = admissionDue <= 0 || isLegacyImport
    ? 0
    : admissionRows.length === 0
      ? admissionDue
      : Math.max(0, admissionRows.reduce((sum, p) => sum + (Number(p.balance_due) || 0), 0));

  // max(), not +: live data shows monthly_fee already includes training_fee
  // for most combo (package + PT) members (e.g. package=10000, training=20000,
  // monthly_fee=30000) — summing would double-count those. A minority (3 of
  // 48 active members with both fields set) have monthly_fee < training_fee,
  // where max() slightly understates true due rather than double-counting;
  // that's the safer direction of error — it never manufactures a false
  // "Paid" the way ignoring training_fee entirely did for the 5 members
  // (including LUF-2026-0351) whose monthly_fee is 0.
  const recurringDue = Math.max(Number(member.monthly_fee) || 0, Number(member.training_fee) || 0);
  const cycleCovered = !!member.expiry_date && member.expiry_date >= todayStr;

  // The payment(s) whose coverage_end matches the member's current
  // expiry_date are the ones that actually produced it — applyCoverageToExpiry()
  // only ever moves expiry_date forward to a payment's own coverage_end, so
  // this is a real, existing link, not a new assumption. A split payment's
  // sibling rows never carry coverage_end (only the first row of the group
  // does, per the established convention), so this never double-counts.
  const currentCycleRows = member.expiry_date
    ? recurringRows.filter((p) => p.coverage_end && p.coverage_end === member.expiry_date)
    : [];
  // Legacy rows predate the coverage_start/coverage_end columns entirely
  // (added 2026-08-20) — for a member whose only history is such rows,
  // there's no coverage link to check, so the latest recurring payment is
  // the best available "current cycle" signal, matching the existing
  // paidSinceCycleStart()/latestPaymentByMember convention used elsewhere
  // in this codebase for exactly this situation.
  const hasAnyCoverageData = recurringRows.some((p) => !!p.coverage_end);
  const legacyLatestRow = !hasAnyCoverageData && recurringRows.length > 0
    ? recurringRows.reduce((latest, p) =>
        !latest || (p.payment_date ?? "") > (latest.payment_date ?? "") ? p : latest
      )
    : null;
  const currentRows = currentCycleRows.length > 0 ? currentCycleRows : (legacyLatestRow ? [legacyLatestRow] : []);

  const currentCycleOutstanding = recurringDue <= 0
    ? 0
    : (!cycleCovered || currentRows.length === 0)
      ? recurringDue
      : Math.max(0, currentRows.reduce((sum, p) => sum + (Number(p.balance_due) || 0), 0));

  const arrearsRows = recurringRows.filter((p) => !currentRows.includes(p));
  const historicalArrears = Math.max(0, arrearsRows.reduce((sum, p) => sum + (Number(p.balance_due) || 0), 0));

  const totalDue = admissionDue + recurringDue;
  const totalOutstanding = admissionOutstanding + currentCycleOutstanding;

  if (totalDue <= 0 || totalOutstanding <= 0) {
    return { status: "paid", outstandingAmount: 0, admissionOutstanding: 0, currentCycleOutstanding: 0, historicalArrears };
  }
  if (totalOutstanding >= totalDue) {
    return { status: "pending", outstandingAmount: totalOutstanding, admissionOutstanding, currentCycleOutstanding, historicalArrears };
  }
  return { status: "partial", outstandingAmount: totalOutstanding, admissionOutstanding, currentCycleOutstanding, historicalArrears };
}

export const FEE_STATUS_LABELS: Record<FeeStatus, string> = {
  paid: "Paid",
  partial: "Partial",
  pending: "Pending",
  free: "Free",
};
