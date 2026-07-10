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

/** Fee types that count as a member's recurring dues (as opposed to
 *  one-off charges like admission fees). Paying any of these is what
 *  keeps a member's status current — staff don't always pick "membership"
 *  in the dropdown (e.g. Personal Training packages are often logged as
 *  "trainer"). */
export const RECURRING_FEE_TYPES = ["membership", "trainer", "nutritionist", "physiotherapy"] as const;

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
