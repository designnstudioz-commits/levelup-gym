// Phase 3B — loading the terminal catalogue.
//
// COST NEVER LEAVES THE SERVER. The queries below select explicit column
// lists that omit cost_price entirely — it is not fetched, so it cannot be
// serialised into the client bundle by accident.
//
// This is the architectural constraint recorded in the Phase 3 audit:
// Postgres RLS is row-level, and Supabase issues every logged-in user the
// same `authenticated` database role, so no policy or column GRANT can hide
// one column per app-role. Not selecting it is the enforcement.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FinancialOwner,
  MemberPriceType,
  PosCategory,
  PosDepartment,
  PosModifier,
  PosModifierGroup,
  PosProductVariant,
  PosSettingsResolved,
} from "@/types/pos";

/** A product as the terminal sees it — no cost, no margin. */
export interface TerminalProduct {
  id: string;
  department_id: string;
  department_name: string;
  financial_owner: FinancialOwner;
  category_id: string | null;
  name: string;
  description: string | null;
  brand: string | null;
  sku: string | null;
  barcode: string | null;
  image_url: string | null;
  unit: string | null;
  selling_price: number;
  member_price_type: MemberPriceType;
  member_price: number | null;
  member_discount_percent: number | null;
  track_inventory: boolean;
  stock_qty: number;
  low_stock_threshold: number | null;
  is_available: boolean;
  sort_order: number;
  variants: PosProductVariant[];
  /** Modifier groups that apply, already ordered, with their options. */
  modifierGroups: (PosModifierGroup & { modifiers: PosModifier[] })[];
}

export interface TerminalCatalog {
  departments: PosDepartment[];
  categories: PosCategory[];
  products: TerminalProduct[];
  settings: PosSettingsResolved;
}

const DEFAULT_SETTINGS: PosSettingsResolved = {
  settlement_period_type: "monthly",
  settlement_month_start_day: 1,
  cashier_discount_limit_percent: 10,
  void_window_minutes: 120,
  barcode_scanning_enabled: false,
  quick_cash_denominations: [500, 1000, 5000],
  low_stock_default_threshold: 5,
};

/**
 * Loads everything the terminal needs in one pass.
 *
 * Six queries rather than nested selects: PostgREST's embedded-resource
 * syntax would work, but the modifier chain (product -> join -> group ->
 * modifiers) nests three deep and becomes hard to read and harder to change.
 * Six flat reads assembled in memory is clearer, and the catalogue is small
 * — low hundreds of rows in total.
 */
export async function loadTerminalCatalog(
  supabase: SupabaseClient
): Promise<TerminalCatalog> {
  const [
    { data: departments },
    { data: categories },
    { data: rawProducts },
    { data: variants },
    { data: links },
    { data: settingRows },
  ] = await Promise.all([
    supabase
      .from("pos_departments")
      .select("id, name, slug, financial_owner, description, sort_order, status, created_at, updated_at, deleted_at")
      .eq("status", "active")
      .is("deleted_at", null)
      .order("sort_order"),

    supabase
      .from("pos_categories")
      .select("id, department_id, name, sort_order, status, created_at, updated_at, deleted_at")
      .eq("status", "active")
      .is("deleted_at", null)
      .order("sort_order"),

    // Explicit column list — cost_price is deliberately absent.
    // Written as ONE string literal, not concatenated: Supabase infers the
    // row type from the literal, and a `+` join degrades it to `string`,
    // which silently collapses the result type to GenericStringError.
    supabase
      .from("pos_products")
      .select("id, department_id, category_id, name, description, brand, sku, barcode, image_url, unit, selling_price, member_price_type, member_price, member_discount_percent, track_inventory, stock_qty, low_stock_threshold, is_available, sort_order")
      .eq("is_active", true)
      .eq("show_on_pos", true)
      .is("deleted_at", null)
      .order("sort_order")
      .order("name"),

    supabase
      .from("pos_product_variants")
      .select("*")
      .is("deleted_at", null)
      .order("sort_order"),

    supabase
      .from("pos_product_modifier_groups")
      .select("product_id, group_id, sort_order")
      .is("deleted_at", null)
      .order("sort_order"),

    supabase.from("pos_settings").select("key, value"),
  ]);

  // Modifier groups and their options, fetched only if any product uses one.
  let groups: PosModifierGroup[] = [];
  let modifiers: PosModifier[] = [];
  if ((links ?? []).length > 0) {
    const groupIds = [...new Set((links ?? []).map((l) => l.group_id))];
    const [{ data: g }, { data: m }] = await Promise.all([
      supabase
        .from("pos_modifier_groups")
        .select("*")
        .in("id", groupIds)
        .eq("status", "active")
        .is("deleted_at", null),
      supabase
        .from("pos_modifiers")
        .select("*")
        .in("group_id", groupIds)
        .is("deleted_at", null)
        .order("sort_order"),
    ]);
    groups = (g ?? []) as PosModifierGroup[];
    modifiers = (m ?? []) as PosModifier[];
  }

  const deptById = new Map((departments ?? []).map((d) => [d.id, d]));
  const variantsByProduct = new Map<string, PosProductVariant[]>();
  for (const v of (variants ?? []) as PosProductVariant[]) {
    const list = variantsByProduct.get(v.product_id) ?? [];
    list.push(v);
    variantsByProduct.set(v.product_id, list);
  }

  const groupById = new Map(groups.map((g) => [g.id, g]));
  const modifiersByGroup = new Map<string, PosModifier[]>();
  for (const m of modifiers) {
    const list = modifiersByGroup.get(m.group_id) ?? [];
    list.push(m);
    modifiersByGroup.set(m.group_id, list);
  }

  const groupsByProduct = new Map<string, (PosModifierGroup & { modifiers: PosModifier[] })[]>();
  for (const link of (links ?? [])) {
    const g = groupById.get(link.group_id);
    if (!g) continue;
    const list = groupsByProduct.get(link.product_id) ?? [];
    list.push({ ...g, modifiers: modifiersByGroup.get(g.id) ?? [] });
    groupsByProduct.set(link.product_id, list);
  }

  const products: TerminalProduct[] = (rawProducts ?? [])
    .map((p) => {
      const dept = deptById.get(p.department_id);
      // A product whose department is inactive or deleted is not sellable.
      if (!dept) return null;
      return {
        ...p,
        department_name: dept.name,
        financial_owner: dept.financial_owner as FinancialOwner,
        variants: variantsByProduct.get(p.id) ?? [],
        modifierGroups: groupsByProduct.get(p.id) ?? [],
      } as TerminalProduct;
    })
    .filter((p): p is TerminalProduct => p !== null);

  // Settings fall back to the documented defaults rather than throwing, so a
  // missing row can never stop the counter from taking money.
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of (settingRows ?? [])) {
    if (row.key in settings) {
      (settings as Record<string, unknown>)[row.key] = row.value;
    }
  }

  return {
    departments: (departments ?? []) as PosDepartment[],
    categories: (categories ?? []) as PosCategory[],
    products,
    settings,
  };
}
