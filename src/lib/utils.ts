import { format, formatDistanceToNow, differenceInDays } from "date-fns";
import { createClient } from "@/lib/supabase/client";

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
  return `RCP-${year}-${String(next).padStart(4, "0")}`;
}

export async function generateMembershipNo(
  gender?: string | null,
  type: "member" | "staff" = "member"
): Promise<string> {
  const supabase = createClient();
  const year = new Date().getFullYear();
  const prefix = type === "staff" ? "LUS" : gender === "Female" ? "LUF" : "LUM";
  const { count } = await supabase
    .from("members")
    .select("*", { count: "exact", head: true })
    .like("membership_no", `${prefix}-%`);
  const next = (count ?? 0) + 1;
  return `${prefix}-${year}-${String(next).padStart(4, "0")}`;
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ");
}
