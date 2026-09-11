// Phase G — shared reporting constants and math.
//
// THE ONE RULE EVERY REPORT QUERY MUST FOLLOW, stated once because getting
// it wrong silently misstates revenue:
//
//   pos_void_order() keeps the voided order's OWN row with its ORIGINAL
//   positive gross_amount/net_amount/levelup_net_amount/healthbox_net_amount
//   — only `status` flips to 'voided'. So a voided order must be excluded
//   by its STATUS, never counted as if it were a negative adjustment.
//
//   pos_refund_order() does the opposite: the ORIGINAL row's status flips
//   to 'refunded' but its amount columns are UNTOUCHED (still positive) —
//   the refund itself is a SEPARATE new order row (status='completed',
//   refund_of_order_id set, every amount column NEGATED, negative payment
//   row(s)). So 'refunded' must stay INCLUDED in every sales sum — that is
//   what lets the negative mirror row cancel the original's positive row
//   out to the correct net figure. Excluding 'refunded' would double-count
//   the wrong direction (you'd lose the original's contribution but the
//   mirror's negative would still land somewhere).
//
// Net effect: every revenue query filters status IN ORDER_STATUSES_FOR_SALES
// (below) — completed, refunded, partially_refunded — and NEVER 'voided',
// 'open' or 'held'. Get this list right once here; nowhere else reimplements it.
export const ORDER_STATUSES_FOR_SALES = ["completed", "refunded", "partially_refunded"] as const;

/**
 * A "date" query param (YYYY-MM-DD) means a PKT calendar day, not a UTC
 * one — this gym is in Lahore. completed_at/opened_at are timestamptz in
 * UTC, so naively comparing against `${date}T00:00:00.000Z` is off by
 * Pakistan's UTC+5 offset: for roughly five hours around each UTC
 * midnight, "today" in PKT and "today" in UTC disagree, and a report run
 * during that window silently misses (or wrongly includes) transactions.
 * Every report route converts its date-range params through this once,
 * rather than each re-deriving its own (and inevitably drifting) bounds.
 */
export function pktDayBounds(dateStr: string): { start: string; end: string } {
  return { start: new Date(`${dateStr}T00:00:00.000+05:00`).toISOString(), end: new Date(`${dateStr}T23:59:59.999+05:00`).toISOString() };
}

/** Today's date as Pakistan sees it, not the server/browser's UTC date. */
export function todayInPkt(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" }); // en-CA gives YYYY-MM-DD
}

export type SettlementStatus = "draft" | "ready" | "finalised" | "paid";
export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  draft: "Draft", ready: "Ready", finalised: "Finalised", paid: "Paid",
};

export type SettlementPeriodType = "weekly" | "monthly";

/**
 * Locked profit-share rule (spec §9, unchanged from Phase F):
 *   profit > 0  -> 50/50
 *   profit = 0  -> 0/0
 *   profit < 0  -> the whole loss is HealthBox's; Level Up's share is 0,
 *                  never negative.
 * Mirrors exactly what pos_finalize_healthbox_settlement() computes in SQL
 * — this copy is for PREVIEWING the same math client-/API-side before
 * anything is persisted (spec §15), so the numbers a manager sees in the
 * preview modal are guaranteed to match what finalizing will actually post.
 */
export function computeProfitShare(netSales: number, approvedExpenses: number): {
  netProfit: number; levelupShare: number; healthboxShare: number; isLoss: boolean; lossAmount: number;
} {
  const netProfit = round2(netSales - approvedExpenses);
  if (netProfit > 0) {
    const levelupShare = round2(netProfit * 0.5);
    const healthboxShare = round2(netProfit - levelupShare);
    return { netProfit, levelupShare, healthboxShare, isLoss: false, lossAmount: 0 };
  }
  if (netProfit === 0) {
    return { netProfit, levelupShare: 0, healthboxShare: 0, isLoss: false, lossAmount: 0 };
  }
  return { netProfit, levelupShare: 0, healthboxShare: netProfit, isLoss: true, lossAmount: round2(-netProfit) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Default settlement period boundaries for a NEW draft, derived from the
 *  existing pos_settings row (settlement_period_type/settlement_month_start_day
 *  — already set up in an earlier phase, default 'monthly'/1) rather than a
 *  hardcoded frequency, so switching the setting needs no code change. */
export function defaultSettlementPeriod(
  periodType: SettlementPeriodType,
  monthStartDay: number,
  asOf: Date = new Date()
): { periodStart: string; periodEnd: string } {
  if (periodType === "weekly") {
    // Monday-start week, most recently completed full week.
    const day = asOf.getDay(); // 0=Sun..6=Sat
    const diffToMonday = (day + 6) % 7;
    const thisMonday = new Date(asOf);
    thisMonday.setDate(asOf.getDate() - diffToMonday);
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSunday = new Date(thisMonday);
    lastSunday.setDate(thisMonday.getDate() - 1);
    return { periodStart: toDateStr(lastMonday), periodEnd: toDateStr(lastSunday) };
  }
  // Monthly, anchored to settlement_month_start_day, most recently completed cycle.
  const clamp = Math.min(Math.max(monthStartDay, 1), 28);
  const cursor = new Date(asOf.getFullYear(), asOf.getMonth(), clamp);
  if (cursor > asOf) cursor.setMonth(cursor.getMonth() - 1);
  const periodStart = new Date(cursor);
  const periodEnd = new Date(cursor);
  periodEnd.setMonth(periodEnd.getMonth() + 1);
  periodEnd.setDate(periodEnd.getDate() - 1);
  return { periodStart: toDateStr(periodStart), periodEnd: toDateStr(periodEnd) };
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
