import { format, formatDistanceToNow, differenceInDays } from "date-fns";
import { createClient } from "@/lib/supabase/client";

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
    const d = new Date(date);
    // Add 5 hours for PKT (UTC+5)
    d.setHours(d.getHours() + 5);
    return format(d, "dd MMM yyyy, hh:mm a");
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

export async function generateMembershipNo(): Promise<string> {
  const supabase = createClient();
  const year = new Date().getFullYear();
  const { count } = await supabase
    .from("members")
    .select("*", { count: "exact", head: true });
  const next = (count ?? 0) + 1;
  return `LUF-${year}-${String(next).padStart(4, "0")}`;
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ");
}
