"use client";

import { useMemo } from "react";
import { Search, X, ScanLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProductTile } from "./ProductTile";
import type { TerminalProduct } from "@/lib/pos/catalog";
import type { PosCategory, PosDepartment } from "@/types/pos";

/**
 * Centre column: heading, search, category strip and the product grid.
 *
 * The search input is READ-ONLY and opens the on-screen keyboard on tap.
 * The terminal is a touch monitor with no keyboard — the approved UX uses a
 * search field, so the field stays and the keyboard comes to it.
 */
export function ProductBrowser({
  departments,
  categories,
  products,
  activeDepartmentId,
  activeCategoryId,
  onSelectCategory,
  search,
  onOpenSearch,
  onClearSearch,
  barcodeEnabled,
  memberAttached,
  onSelectProduct,
}: {
  departments: PosDepartment[];
  categories: PosCategory[];
  products: TerminalProduct[];
  activeDepartmentId: string | null;
  activeCategoryId: string | null;
  onSelectCategory: (id: string | null) => void;
  search: string;
  onOpenSearch: () => void;
  onClearSearch: () => void;
  barcodeEnabled: boolean;
  memberAttached: boolean;
  onSelectProduct: (p: TerminalProduct) => void;
}) {
  const department = activeDepartmentId
    ? departments.find((d) => d.id === activeDepartmentId) ?? null
    : null;

  // Categories are department-scoped: "Protein" under Supplements and
  // "Bowls" under HealthBox are unrelated lists.
  const visibleCategories = useMemo(
    () =>
      activeDepartmentId
        ? categories.filter((c) => c.department_id === activeDepartmentId)
        : [],
    [categories, activeDepartmentId]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (activeDepartmentId && p.department_id !== activeDepartmentId) return false;
      if (activeCategoryId && p.category_id !== activeCategoryId) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.brand?.toLowerCase().includes(q) ?? false) ||
        (p.sku?.toLowerCase().includes(q) ?? false) ||
        (p.barcode?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [products, activeDepartmentId, activeCategoryId, search]);

  const title = search.trim()
    ? `Results for "${search.trim()}"`
    : department?.name ?? "All Items";

  const subtitle = search.trim()
    ? `${visible.length} ${visible.length === 1 ? "product" : "products"}`
    : department?.description ?? "Choose a department, category or search a product.";

  return (
    <section className="flex-1 min-w-0 flex flex-col overflow-hidden">
      <div className="px-6 pt-5 pb-3 flex-shrink-0">
        <h2 className="text-2xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] uppercase tracking-wide leading-none">
          {title}
        </h2>
        <p className="text-sm text-[#7A7A72] mt-1 line-clamp-1">{subtitle}</p>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenSearch}
            className={cn(
              "flex-1 min-h-[56px] px-4 rounded-lg border border-[#E4E4DE] bg-white",
              "flex items-center gap-3 text-left cursor-pointer",
              "hover:border-[#F06418] transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F06418]"
            )}
          >
            <Search className="w-5 h-5 text-[#7A7A72] flex-shrink-0" />
            <span
              className={cn(
                "flex-1 text-[15px] truncate",
                search ? "text-[#1A1A16] font-medium" : "text-[#7A7A72]"
              )}
            >
              {search || "Search products"}
            </span>
          </button>

          {search && (
            <button
              type="button"
              onClick={onClearSearch}
              aria-label="Clear search"
              className="min-h-[56px] min-w-[56px] rounded-lg border border-[#E4E4DE] bg-white flex items-center justify-center text-[#4A4A44] hover:bg-[#FEF0E8] hover:border-[#F06418] hover:text-[#F06418] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}

          {/* Off by default. A USB POS scanner types like a keyboard, so
              enabling this later is a pos_settings flip, not a build. */}
          {barcodeEnabled && (
            <button
              type="button"
              className="min-h-[56px] px-5 rounded-lg border border-[#E4E4DE] bg-white flex items-center gap-2 text-[15px] font-semibold text-[#1A1A16] hover:border-[#F06418] transition-colors cursor-pointer"
            >
              <ScanLine className="w-5 h-5 text-[#4A4A44]" />
              Scan barcode
            </button>
          )}
        </div>

        {visibleCategories.length > 0 && !search.trim() && (
          <>
            <p className="mt-5 mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#7A7A72]">
              Categories
            </p>
            <div className="flex flex-wrap gap-2">
              <CategoryPill
                label="All"
                active={activeCategoryId === null}
                onClick={() => onSelectCategory(null)}
              />
              {visibleCategories.map((c) => (
                <CategoryPill
                  key={c.id}
                  label={c.name}
                  active={activeCategoryId === c.id}
                  onClick={() => onSelectCategory(c.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {visible.length === 0 ? (
          <EmptyState hasSearch={Boolean(search.trim())} />
        ) : (
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {visible.map((p) => (
              <ProductTile
                key={p.id}
                product={p}
                memberAttached={memberAttached}
                onSelect={onSelectProduct}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function CategoryPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-[48px] px-5 rounded-lg border text-[15px] font-semibold cursor-pointer",
        "transition-colors duration-150 active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F06418] focus-visible:ring-offset-1",
        active
          ? "bg-[#F06418] text-white border-[#F06418]"
          : "bg-white text-[#1A1A16] border-[#E4E4DE] hover:bg-[#FEF0E8] hover:border-[#F06418]"
      )}
    >
      {label}
    </button>
  );
}

function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="h-full min-h-[280px] flex flex-col items-center justify-center text-center">
      <Search className="w-8 h-8 text-[#CFCEC6]" />
      <p className="mt-3 text-base font-semibold text-[#1A1A16]">
        {hasSearch ? "No products match that search" : "No products here yet"}
      </p>
      <p className="mt-1 text-sm text-[#7A7A72] max-w-sm">
        {hasSearch
          ? "Try a shorter search, or clear it to browse by department."
          : "Add products in Dashboard → POS & Inventory → Catalog to see them here."}
      </p>
    </div>
  );
}
