import { format, addMonths } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import type { TrainerMemberCommission } from "@/types/database";

/** Computes the 15-day commission cycle and payout date for a qualifying
 *  date. The month is split into two halves; the 2nd half always rolls
 *  forward into the FOLLOWING month's 1st-half cycle rather than having a
 *  cycle of its own — payout is always the 10th of the month after the
 *  cycle month.
 *
 *  Aug 1-15  -> cycle Aug 1-15,  payout Sep 10
 *  Aug 16-31 -> cycle Sep 1-15,  payout Oct 10
 *  Sep 1-15  -> cycle Sep 1-15,  payout Oct 10
 *  Sep 16-30 -> cycle Oct 1-15,  payout Nov 10 */
export function computeCommissionCycle(qualifyingDate: string): {
  cycleStart: string;
  cycleEnd: string;
  payoutDate: string;
} {
  const d = new Date(qualifyingDate + "T12:00:00");
  const day = d.getDate();
  // Only the MONTH of this date is used below (day is discarded), so
  // date-fns' end-of-month day-clamping on addMonths is harmless here.
  const cycleMonth = day <= 15 ? d : addMonths(d, 1);
  const y = cycleMonth.getFullYear();
  const m = cycleMonth.getMonth();
  const payout = addMonths(new Date(y, m, 10), 1);
  return {
    cycleStart: format(new Date(y, m, 1), "yyyy-MM-dd"),
    cycleEnd: format(new Date(y, m, 15), "yyyy-MM-dd"),
    payoutDate: format(new Date(payout.getFullYear(), payout.getMonth(), 10), "yyyy-MM-dd"),
  };
}

/** Full trainer commission for one qualifying PT cycle — always computed
 *  from the PT Fee (PTF), never from a normal membership fee, and never
 *  prorated. */
export function computeCommissionAmount(
  rate: { commission_type: "percent" | "fixed"; commission_percent: number; commission_amount: number | null },
  ptFee: number
): number {
  if (rate.commission_type === "fixed") return Number(rate.commission_amount) || 0;
  return Math.round(ptFee * (Number(rate.commission_percent) / 100));
}

/** Idempotently generates one trainer_commission_ledger row for a
 *  qualifying PT payment. Safe to call multiple times for the same
 *  payment/member/cycle — the unique (member_id, cycle_start) index plus
 *  this pre-check mean a duplicate call, a split-method payment's extra
 *  rows, or a re-run backfill all just no-op past the first successful
 *  insert. Returns "created" | "skipped-exists" | "skipped-not-eligible". */
export async function generateCommissionEntry(params: {
  memberId: string;
  trainerId: string | null;
  ptFee: number | null;
  rate: TrainerMemberCommission | null;
  qualifyingDate: string;
  feePaymentId: string | null;
  createdBy: string | null;
}): Promise<"created" | "skipped-exists" | "skipped-not-eligible"> {
  const { memberId, trainerId, ptFee, rate, qualifyingDate, feePaymentId, createdBy } = params;
  if (!trainerId || !ptFee || ptFee <= 0 || !rate) return "skipped-not-eligible";

  const supabase = createClient();
  const { cycleStart, cycleEnd, payoutDate } = computeCommissionCycle(qualifyingDate);

  const { data: existing } = await supabase
    .from("trainer_commission_ledger")
    .select("id")
    .eq("member_id", memberId)
    .eq("cycle_start", cycleStart)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) return "skipped-exists";

  const commissionAmount = computeCommissionAmount(rate, ptFee);

  const { error } = await supabase.from("trainer_commission_ledger").insert({
    member_id: memberId,
    trainer_id: trainerId,
    fee_payment_id: feePaymentId,
    pt_fee: ptFee,
    commission_type: rate.commission_type,
    commission_percent: rate.commission_type === "percent" ? rate.commission_percent : null,
    commission_amount: commissionAmount,
    qualifying_date: qualifyingDate,
    cycle_start: cycleStart,
    cycle_end: cycleEnd,
    payout_date: payoutDate,
    created_by: createdBy,
  });
  // A concurrent insert racing past the pre-check above is caught by the
  // unique index — treat that as an idempotent no-op, not a failure.
  if (error) return "skipped-exists";
  return "created";
}

/** Backfills ledger entries for historical qualifying payments made before
 *  this feature existed. Uses each trainer's CURRENT rate (no historical
 *  rate snapshot exists for old payments) — every entry generated from
 *  today onward instead freezes the rate live at the moment of payment.
 *  Idempotent — safe to run repeatedly, including alongside real-time
 *  generation from new payments. */
export async function backfillCommissionLedger(): Promise<{ created: number; skipped: number; scanned: number }> {
  const supabase = createClient();

  const { data: rates } = await supabase
    .from("trainer_member_commissions")
    .select("*")
    .is("deleted_at", null);
  const ratesByMember = new Map((rates ?? []).map((r) => [r.member_id, r as TrainerMemberCommission]));
  if (ratesByMember.size === 0) return { created: 0, skipped: 0, scanned: 0 };

  const memberIds = [...ratesByMember.keys()];
  const { data: members } = await supabase
    .from("members")
    .select("id, trainer_id, training_fee")
    .in("id", memberIds);
  const memberById = new Map((members ?? []).map((m) => [m.id, m]));

  const { data: payments } = await supabase
    .from("fee_payments")
    .select("id, member_id, payment_type, coverage_start, month_covered, payment_date")
    .in("member_id", memberIds)
    .in("payment_type", ["membership", "trainer"])
    .is("deleted_at", null);

  let created = 0, skipped = 0;
  for (const p of payments ?? []) {
    const member = memberById.get(p.member_id);
    const rate = ratesByMember.get(p.member_id);
    if (!member || !rate) continue;
    const qualifyingDate = p.coverage_start ?? p.month_covered ?? p.payment_date;
    if (!qualifyingDate) continue;
    const result = await generateCommissionEntry({
      memberId: p.member_id,
      trainerId: member.trainer_id,
      ptFee: member.training_fee,
      rate,
      qualifyingDate,
      feePaymentId: p.id,
      createdBy: null,
    });
    if (result === "created") created++; else skipped++;
  }
  return { created, skipped, scanned: (payments ?? []).length };
}

/** Formats a cycle for display, e.g. "Aug 1 – 15, 2026". */
export function formatCycleLabel(cycleStart: string, cycleEnd: string): string {
  const s = new Date(cycleStart + "T12:00:00");
  const e = new Date(cycleEnd + "T12:00:00");
  return `${format(s, "MMM d")} – ${format(e, "d, yyyy")}`;
}

/** Every calendar month has exactly ONE commission cycle (the 1st-15th
 *  window — the 16th-end-of-month range has no cycle of its own, it just
 *  rolls into the following month's), so cycleStart is always the 1st of
 *  its cycle month, and stepping to the next/previous cycle is just
 *  stepping one calendar month. */
export function stepCycle(cycleStart: string, direction: 1 | -1): { cycleStart: string; cycleEnd: string; payoutDate: string } {
  const stepped = addMonths(new Date(cycleStart + "T12:00:00"), direction);
  return computeCommissionCycle(format(stepped, "yyyy-MM-dd"));
}

/** The cycle a payment made right now would qualify for, and the one after
 *  it — used to seed the Trainer Commission page's cycle selector. */
export function currentAndNextCycle(): {
  current: { cycleStart: string; cycleEnd: string; payoutDate: string };
  next: { cycleStart: string; cycleEnd: string; payoutDate: string };
} {
  const current = computeCommissionCycle(format(new Date(), "yyyy-MM-dd"));
  const next = stepCycle(current.cycleStart, 1);
  return { current, next };
}
