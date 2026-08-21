import { format, formatDistanceToNow, differenceInDays, addMonths, addDays } from "date-fns";
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

// Native date inputs don't reliably stop a stray extra digit in the year
// segment (e.g. typing "42026" instead of "2026") in every browser. Use
// this to guard a raw <input type="date"> onChange — returns null (drop
// the change) when the year is out of a sane range, otherwise the value
// to pass through unchanged. Pairs with min/max attrs for the visual
// :invalid state; this is what actually stops the bad value reaching state.
export function safeDateValue(value: string): string | null {
  if (!value) return "";
  const year = value.split("-")[0];
  if (year.length > 4 || Number(year) < 1900 || Number(year) > 2099) return null;
  return value;
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

/** One logical payment/receipt — a split Cash+Bank collection produces
 *  multiple fee_payments rows sharing one receipt_no, and callers that
 *  display payments (not just sum them) need those collapsed into a
 *  single row rather than shown as duplicates. */
export interface LogicalPayment {
  receiptKey: string;
  receiptNo: string | null;
  memberId: string;
  paymentType: string | null;
  totalAmount: number;
  methods: { method: string; amount: number }[];
  methodLabel: string;
  paymentDate: string;
  collectedBy: string | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  monthCovered: string | null;
  monthsCovered: number | null;
  balanceDue: number;
  balanceDueDate: string | null;
  note: string | null;
  earliestCreatedAt: string;
  anchorId: string;
}

interface RawPaymentRow {
  id: string;
  receipt_no: string | null;
  member_id: string;
  payment_type: string | null;
  amount: number;
  payment_method: string | null;
  payment_date: string;
  collected_by: string | null;
  coverage_start?: string | null;
  coverage_end?: string | null;
  month_covered?: string | null;
  months_covered?: number | null;
  balance_due?: number | null;
  balance_due_date?: string | null;
  note?: string | null;
  created_at: string;
}

/** Groups raw fee_payments rows by receipt_no (falling back to each row's
 *  own id for older/imported rows with none) into one LogicalPayment per
 *  real transaction — the first-row-only fields (balance_due, coverage,
 *  months_covered) are read from whichever row in the group was created
 *  first, matching the established convention. */
export function groupPaymentsByReceipt(rows: RawPaymentRow[]): LogicalPayment[] {
  const groups = new Map<string, RawPaymentRow[]>();
  for (const r of rows) {
    const key = r.receipt_no ?? r.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return [...groups.entries()].map(([key, group]) => {
    const sorted = [...group].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const anchor = sorted[0];
    const totalAmount = group.reduce((s, r) => s + (r.amount ?? 0), 0);
    const methods = group.map((r) => ({ method: r.payment_method ?? "—", amount: r.amount ?? 0 }));
    const methodLabel = [...new Set(methods.map((m) => m.method))].join(" + ");
    return {
      receiptKey: key,
      receiptNo: anchor.receipt_no,
      memberId: anchor.member_id,
      paymentType: anchor.payment_type,
      totalAmount,
      methods,
      methodLabel,
      paymentDate: anchor.payment_date,
      collectedBy: anchor.collected_by,
      coverageStart: anchor.coverage_start ?? null,
      coverageEnd: anchor.coverage_end ?? null,
      monthCovered: anchor.month_covered ?? null,
      monthsCovered: anchor.months_covered ?? null,
      balanceDue: anchor.balance_due ?? 0,
      balanceDueDate: anchor.balance_due_date ?? null,
      note: anchor.note ?? null,
      earliestCreatedAt: anchor.created_at,
      anchorId: anchor.id,
    };
  });
}

/** Fee types that count as a member's recurring dues (as opposed to
 *  one-off charges like admission fees). Paying any of these is what
 *  keeps a member's status current — staff don't always pick "membership"
 *  in the dropdown (e.g. Personal Training packages are often logged as
 *  "trainer"). */
export const RECURRING_FEE_TYPES = ["membership", "trainer", "nutritionist", "physiotherapy"] as const;

/** fee_payments.payment_type values that qualify a PT payment for trainer
 *  commission generation (see src/lib/commission.ts) — actual collected
 *  recurring dues, not one-off charges like admission fees. */
export const COMMISSION_ELIGIBLE_TYPES = ["membership", "trainer"];

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

/** Coverage Period model for recurring-dues payments. Collection Date
 *  (payment_date, when the money was actually received) and Coverage
 *  Period (coverage_start/coverage_end, what period it pays for) are
 *  completely independent — staff pick the period explicitly, it's never
 *  inferred from when the payment happened. Three choices:
 *
 *  - "Current Period": re-confirms whatever's already on file
 *    (membership_start_date → expiry_date) — used for a late/backdated
 *    settlement of a cycle that's already granted. Never moves expiry.
 *  - "Next Period": starts the day after the member's current expiry (or
 *    their joining date if they have none yet), extends by durationMonths
 *    × the chosen number of cycles. Chains correctly for repeat advance
 *    payments since it always starts from whatever's already paid through.
 *  - "Custom Period": staff enters explicit start/end dates directly.
 *
 *  Whichever is chosen, applyCoverageToExpiry() below is the ONE rule that
 *  turns a coverage_end into a new members.expiry_date — it only ever
 *  moves expiry forward, and only from an explicit coverage choice. */

/** The first day of "Next Period" — the day after the member's current
 *  expiry if they have one, else their joining date, else today. */
export function nextPeriodStart(
  expiryDate: string | null | undefined,
  todayStr: string,
  joiningDateFallback?: string | null
): string {
  if (expiryDate) return format(addDays(new Date(expiryDate), 1), "yyyy-MM-dd");
  return joiningDateFallback ?? todayStr;
}

/** The last day covered by `cycles` package cycles starting at
 *  coverageStart (inclusive) — e.g. start Sep 1, durationMonths 1, cycles 1
 *  → Sep 30. Matches how members.expiry_date is already treated elsewhere
 *  (daysUntilExpiry/getMemberStatusDisplay): the last valid day, not the
 *  first invalid one. */
export function computeCoverageEnd(coverageStart: string, durationMonths: number, cycles: number): string {
  return format(addDays(addMonths(new Date(coverageStart), durationMonths * Math.max(cycles, 1)), -1), "yyyy-MM-dd");
}

/** The single rule for turning a payment's coverage_end into a member's new
 *  expiry_date — moves forward only, never backward, and only in response
 *  to an explicit coverage choice (never from payment_date). A "Current
 *  Period" settlement (coverage_end == existing expiry) is a no-op; a
 *  "Next"/"Custom" period with a later coverage_end extends; a custom
 *  period backfilling an earlier/historical gap correctly leaves expiry
 *  untouched rather than shrinking it. */
export function applyCoverageToExpiry(currentExpiry: string | null | undefined, coverageEnd: string): string {
  if (!currentExpiry || coverageEnd > currentExpiry) return coverageEnd;
  return currentExpiry;
}

/** Preset "number of months" choices offered when collecting a Next
 *  Period advance payment. */
export const MONTHS_PRESET = [1, 2, 3, 6, 12] as const;

/** Formats a fee_payments row's covered period for display — the explicit
 *  coverage_start/coverage_end range (full dates) when present, falling
 *  back to the legacy month_covered/payment_date "MMM yyyy" behavior
 *  (flagged as `inferred`) for older rows written before this column
 *  existed. */
export function describeCoveredPeriod(
  coverageStart: string | null | undefined,
  coverageEnd: string | null | undefined,
  monthCovered: string | null | undefined,
  paymentDate: string | null | undefined,
  monthsCovered: number | null | undefined
): { label: string | null; inferred: boolean } {
  if (coverageStart && coverageEnd) {
    const label = coverageStart === coverageEnd ? formatDate(coverageStart) : `${formatDate(coverageStart)} – ${formatDate(coverageEnd)}`;
    return { label, inferred: false };
  }
  const source = monthCovered ?? paymentDate;
  if (!source) return { label: null, inferred: false };
  const inferred = !monthCovered && !!paymentDate;
  const n = Math.max(monthsCovered ?? 1, 1);
  const start = format(new Date(source + "T12:00:00"), "MMM yyyy");
  if (n <= 1) return { label: start, inferred };
  const end = format(addMonths(new Date(source + "T12:00:00"), n - 1), "MMM yyyy");
  return { label: `${start} – ${end}`, inferred };
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

/** `client` defaults to the browser client (every existing call site keeps
 *  working unchanged) — pass the service-role client explicitly when
 *  calling this from a server-side API route, since the browser client
 *  factory relies on browser cookie APIs that don't exist there. */
export async function generateMembershipNo(
  gender?: string | null,
  type: "member" | "staff" = "member",
  client?: ReturnType<typeof createClient>
): Promise<string> {
  const supabase = client ?? createClient();
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
