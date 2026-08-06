import { format, formatDistanceToNow, differenceInDays, addMonths } from "date-fns";
import { createClient } from "@/lib/supabase/client";

/** Fetches every row matching a query, paging around Supabase/PostgREST's
 *  server-side row cap (commonly 1000) that silently truncates a single
 *  request no matter what `.limit()`/`.range()` the client asks for. Pass a
 *  function that applies `.range(from, to)` to a fresh query each call —
 *  Supabase query builders can't be reused across pages. */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000
): Promise<T[]> {
  let all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    all = all.concat(data ?? []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export function formatPhone(raw: string): string {
  // International numbers (leading +) are left as typed, digits-only after
  // the +, since the Pakistani 4-digit-prefix grouping below doesn't apply.
  if (raw.trim().startsWith("+")) {
    return `+${raw.replace(/\D/g, "").slice(0, 15)}`;
  }
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

export function formatCnic(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 13);
  if (digits.length <= 5) return digits;
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

export function formatPKR(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return `Rs ${amount.toLocaleString("en-PK")}`;
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  try {
    return format(new Date(date), "dd MMM yyyy");
  } catch {
    return "—";
  }
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleString("en-PK", {
      timeZone: "Asia/Karachi",
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  } catch {
    return "—";
  }
}

export function timeAgo(date: string | Date | null | undefined): string {
  if (!date) return "—";
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true });
  } catch {
    return "—";
  }
}

/** Adds `months` to a "YYYY-MM-DD" date string, e.g. for computing a
 *  membership's expiry date from its joining date + package duration. */
export function addMonthsToDateStr(dateStr: string, months: number): string {
  return format(addMonths(new Date(dateStr), months), "yyyy-MM-dd");
}

/** PT (Personal Training) packages are exclusive — a member can only have
 *  one — and require a trainer to be assigned. There's no dedicated schema
 *  column for this; every PT package is named "Personal Training — <Tier>",
 *  so name-prefix matching is the identification method (confirmed
 *  decision — adding a schema column was the alternative, not chosen). */
export function isPTPackage(pkg: { name: string }): boolean {
  return pkg.name.startsWith("Personal Training");
}

/** Fee types that count as a member's recurring dues (as opposed to
 *  one-off charges like admission fees). Paying any of these is what
 *  keeps a member's status current — staff don't always pick "membership"
 *  in the dropdown (e.g. Personal Training packages are often logged as
 *  "trainer"). */
export const RECURRING_FEE_TYPES = ["membership", "trainer", "nutritionist", "physiotherapy"] as const;

/** Counts distinct logical payment *transactions*, not raw fee_payments
 *  rows — a single collection split across multiple payment methods now
 *  produces multiple rows sharing one receipt_no. Used for isFirstPayment
 *  detection: counting raw rows would make a split first payment look like
 *  2+ payments and silently double-extend expiry. Falls back to the row's
 *  own id for older/imported rows with no receipt_no, so those still count
 *  as their own separate transaction rather than collapsing together under
 *  a shared `null`. */
export function countLogicalPayments(rows: { id: string; receipt_no: string | null }[]): number {
  return new Set(rows.map((r) => r.receipt_no ?? r.id)).size;
}

/** Flat cut the gym takes off every Personal Training payment before the
 *  trainer's commission applies — a fixed business constant (every row of
 *  the old package-tier rate chart used this same Rs 10,000 regardless of
 *  tier), not tied to any specific package. Shared by the staff profile's
 *  commission section and the salary slip so both compute identically. */
export const PT_GYM_FEE_PORTION = 10000;

/** fee_payments.payment_type values that count toward a trainer's
 *  commission basis — actual collected recurring dues plus any ad hoc
 *  trainer session fees. Admission fees don't count (one-off joining fee,
 *  not a trainer service). */
export const COMMISSION_ELIGIBLE_TYPES = ["membership", "trainer"];

/** A trainer's manually-set commission for one assigned member, for a given
 *  period — either a percentage of (payment − flat gym cut), or a flat Rs
 *  amount per qualifying payment. `periodEnd` is optional (omit for an
 *  open-ended "from periodStart to now" range, e.g. "this month" viewed
 *  live); pass it when computing a past, closed period (e.g. a salary slip
 *  for a prior month) so later payments aren't pulled in. */
export function calculateTrainerCommission(
  rate: { commission_type: "percent" | "fixed"; commission_percent: number; commission_amount: number | null } | undefined,
  payments: { id: string; amount: number; payment_date: string; receipt_no: string | null }[],
  periodStart: string | null,
  periodEnd: string | null = null
): number {
  if (!rate) return 0;
  const rows = payments.filter(
    (p) => (!periodStart || p.payment_date >= periodStart) && (!periodEnd || p.payment_date <= periodEnd)
  );

  if (rate.commission_type === "fixed") {
    const amount = Number(rate.commission_amount);
    if (!(amount > 0)) return 0;
    return countLogicalPayments(rows) * amount;
  }

  const percent = Number(rate.commission_percent);
  if (!(percent > 0)) return 0;
  return rows.reduce((sum, p) => sum + Math.max((p.amount ?? 0) - PT_GYM_FEE_PORTION, 0) * (percent / 100), 0);
}

export type CommissionPayload = {
  commission_type: "percent" | "fixed";
  commission_percent: number;
  commission_amount: number | null;
};

/** Validates and shapes a trainer_member_commissions row from raw form
 *  input — shared by every place a commission gets set (trainer profile,
 *  registration, member profile) so the rules can't drift between them. */
export function buildCommissionPayload(
  type: "percent" | "fixed",
  percentRaw: string,
  amountRaw: string
): { payload: CommissionPayload; error?: undefined } | { payload?: undefined; error: string } {
  if (type === "percent") {
    const percent = Number(percentRaw);
    if (percentRaw.trim() === "" || isNaN(percent) || percent < 0 || percent > 100) {
      return { error: "Enter a valid percentage (0–100)" };
    }
    return { payload: { commission_type: "percent", commission_percent: percent, commission_amount: null } };
  }
  const amount = Number(amountRaw);
  if (amountRaw.trim() === "" || isNaN(amount) || amount < 0) {
    return { error: "Enter a valid fixed amount" };
  }
  return { payload: { commission_type: "fixed", commission_percent: 0, commission_amount: amount } };
}

/** Computes a member's new expiry date after a recurring-dues payment.
 *  If their current expiry hasn't lapsed yet, the new cycle extends from
 *  it so paying early doesn't cost them the remaining days. Otherwise the
 *  cycle restarts from the payment date.
 *
 *  isFirstPayment must be true for a member's very first recurring payment —
 *  that payment just settles the cycle already granted at registration, so
 *  it must not push expiry into a second, not-yet-earned cycle. It still
 *  extends normally if paid after the granted cycle has already lapsed
 *  (a genuinely late first payment starting a fresh cycle).
 *
 *  joiningDateFallback covers the case where currentExpiry was never set
 *  (registration should always set it now, but this is a safety net): on a
 *  first payment, base off the member's actual joining date rather than the
 *  payment date, so a late-collected first payment doesn't silently make
 *  expiry track the payment date instead of when the member actually joined. */
export function extendExpiryDate(
  currentExpiry: string | null | undefined,
  paymentDate: string,
  durationMonths: number,
  isFirstPayment: boolean = false,
  joiningDateFallback?: string | null
): string {
  if (isFirstPayment && currentExpiry && currentExpiry >= paymentDate) {
    return currentExpiry;
  }
  if (isFirstPayment && !currentExpiry && joiningDateFallback) {
    return addMonthsToDateStr(joiningDateFallback, durationMonths);
  }
  const base = currentExpiry && currentExpiry >= paymentDate ? currentExpiry : paymentDate;
  return addMonthsToDateStr(base, durationMonths);
}

/** A device counts as online if it's checked in (via the ADMS heartbeat)
 *  within the last 2 minutes — matches the device's own ~30s poll cycle
 *  with headroom for a missed beat or two. */
export function isDeviceOnline(lastSeen: string | null | undefined): boolean {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < 2 * 60 * 1000;
}

export function daysUntilExpiry(expiryDate: string | null | undefined): number | null {
  if (!expiryDate) return null;
  try {
    return differenceInDays(new Date(expiryDate), new Date());
  } catch {
    return null;
  }
}

export function getMemberStatusDisplay(status: string, expiryDate?: string | null): {
  label: string;
  variant: "active" | "inactive" | "expiring" | "frozen" | "archived" | "pending";
} {
  if (status === "pending_family_approval") return { label: "Pending Family Approval", variant: "pending" };
  if (status === "frozen") return { label: "Frozen", variant: "frozen" };
  if (status === "archived") return { label: "Archived", variant: "archived" };
  if (status === "inactive") return { label: "Inactive", variant: "inactive" };
  if (status === "active") {
    const days = daysUntilExpiry(expiryDate);
    if (days !== null && days <= 30 && days >= 0) {
      return { label: `Expiring in ${days}d`, variant: "expiring" };
    }
    if (days !== null && days < 0) {
      return { label: "Expired", variant: "inactive" };
    }
    return { label: "Active", variant: "active" };
  }
  return { label: status, variant: "inactive" };
}

export async function generateReceiptNo(): Promise<string> {
  const supabase = createClient();
  const year = new Date().getFullYear();
  const { count } = await supabase
    .from("fee_payments")
    .select("*", { count: "exact", head: true });
  const next = (count ?? 0) + 1;
  return `PMT-${year}-${String(next).padStart(4, "0")}`;
}

export async function generateMembershipNo(
  gender?: string | null,
  type: "member" | "staff" = "member"
): Promise<string> {
  const supabase = createClient();
  const year = new Date().getFullYear();

  if (type === "staff") {
    // Staff numbering is unchanged — its own independent per-prefix counter.
    const prefix = "LUS";
    const { data } = await supabase
      .from("members")
      .select("membership_no")
      .like("membership_no", `${prefix}-${year}-%`)
      .order("membership_no", { ascending: false })
      .limit(1);
    let next = 1;
    if (data && data.length > 0) {
      const seq = parseInt((data[0].membership_no as string).split("-")[2] ?? "0", 10);
      if (!isNaN(seq)) next = seq + 1;
    }
    return `${prefix}-${year}-${String(next).padStart(4, "0")}`;
  }

  // Male and Female share ONE sequence per year — LUM/LUF only label gender,
  // the number itself increments regardless of who's being registered. So
  // the search has to span both prefixes, and since "LUM" > "LUF"
  // alphabetically the two prefixes don't sort in numeric order together —
  // the max has to be found by parsing every row's sequence in JS, not by
  // ordering the raw membership_no string.
  const prefix = gender === "Female" ? "LUF" : "LUM";
  const { data } = await supabase
    .from("members")
    .select("membership_no")
    .or(`membership_no.like.LUM-${year}-%,membership_no.like.LUF-${year}-%`);

  let next = 1;
  for (const row of data ?? []) {
    const seq = parseInt((row.membership_no as string).split("-")[2] ?? "", 10);
    if (!isNaN(seq) && seq >= next) next = seq + 1;
  }

  return `${prefix}-${year}-${String(next).padStart(4, "0")}`;
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ");
}

/** Applies a discount to an amount — same formula used by the Collect Fee
 *  flows on the Fees page and member profile (kept independent here rather
 *  than refactoring those call sites, to avoid touching working code). */
export function calculateDiscount(
  original: number,
  type: "none" | "percent" | "amount" | undefined,
  value: number | string | undefined
): { discountAmount: number; finalAmount: number } {
  const v = Number(value) || 0;
  const discountAmount =
    type === "percent" ? Math.round((original * v) / 100) :
    type === "amount"  ? Math.min(v, original) : 0;
  return { discountAmount, finalAmount: Math.max(original - discountAmount, 0) };
}
