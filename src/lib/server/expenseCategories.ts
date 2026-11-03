import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Is this a category a bill may be filed under?
 *
 * Replaces the hardcoded EXPENSE_CATEGORY_VALUES check in the expense write
 * routes. That list is now seed data, not the authority — the owner maintains
 * the real list in expense_categories, so validating against the constant
 * would reject every category he adds.
 *
 * Accepts live categories only. An archived one stops being a valid choice for
 * NEW bills while continuing to label the bills already filed under it, which
 * is the whole point of archiving rather than deleting.
 *
 * Matched case-insensitively for the same reason the unique index is: "Fuel"
 * and "fuel" are one category, and a stray capital from a client should not
 * read as an unknown value.
 */
export async function isKnownExpenseCategory(
  admin: SupabaseClient,
  value: unknown
): Promise<boolean> {
  if (typeof value !== "string" || !value.trim()) return false;

  const { data, error } = await admin
    .from("expense_categories")
    .select("id")
    .ilike("value", value.trim())
    .is("deleted_at", null)
    .maybeSingle();

  // Fail CLOSED on a lookup error. Letting an unvalidated category through
  // because the check itself broke is how junk gets into a column that drives
  // every expense report.
  if (error) {
    console.error("[isKnownExpenseCategory]", error);
    return false;
  }
  return !!data;
}
