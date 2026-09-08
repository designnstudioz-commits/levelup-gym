"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useCurrentUser } from "@/contexts/CurrentUserContext";
import { canSeeOwnShiftTotals } from "@/lib/pos/permissions";
import {
  addLine,
  cartHasMemberPricing,
  clearCart,
  computeTotals,
  emptyCart,
  removeLine,
  setLineQty,
  setMember,
  type CartState,
} from "@/lib/pos/cart";
import type { TerminalCatalog, TerminalProduct } from "@/lib/pos/catalog";
import { PosTopBar } from "./PosTopBar";
import { DepartmentRail } from "./DepartmentRail";
import { ProductBrowser } from "./ProductBrowser";
import { CartPanel } from "./CartPanel";
import { ModifierSheet } from "./ModifierSheet";
import { MemberPicker } from "./MemberPicker";
import { OnScreenKeyboard } from "./OnScreenKeyboard";

/** Cover most kitchen notes in one tap. Free text stays available. */
const NOTE_PRESETS = ["No salt", "Extra spicy", "No onion", "Less oil", "Takeaway", "Rush"];

/**
 * The cashier terminal.
 *
 * Owns one CartState and replaces it wholesale through the pure helpers in
 * lib/pos/cart, which keeps "what is in the basket" trivially inspectable
 * and makes hold/resume a straight JSON round-trip later.
 *
 * Adding to the cart is optimistic and entirely local — no network round
 * trip per tap. Only completing a sale talks to the server.
 */
type Sheet =
  | { kind: "none" }
  | { kind: "search" }
  | { kind: "customize"; product: TerminalProduct }
  | { kind: "note"; product: TerminalProduct }
  | { kind: "member" }
  | { kind: "memberSearch" };

export function PosTerminal({ catalog }: { catalog: TerminalCatalog }) {
  const currentUser = useCurrentUser();

  const [cart, setCart] = useState<CartState>(emptyCart);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [sheet, setSheet] = useState<Sheet>({ kind: "none" });
  const [busy] = useState(false);

  // Held across the customize -> note -> customize round trip, so opening
  // the keyboard does not discard the modifier selections behind it.
  const [draftNote, setDraftNote] = useState<string | null>(null);

  const totals = useMemo(() => computeTotals(cart), [cart]);

  const productCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of catalog.products) {
      counts[p.department_id] = (counts[p.department_id] ?? 0) + 1;
    }
    return counts;
  }, [catalog.products]);

  function selectDepartment(id: string | null) {
    setDepartmentId(id);
    // Categories are department-scoped, so a stale category would filter
    // the new department down to nothing.
    setCategoryId(null);
    setSearch("");
  }

  function handleSelectProduct(product: TerminalProduct) {
    // Anything with options opens the Customize sheet; a plain product goes
    // straight into the cart, keeping the common sale at two taps.
    if (product.modifierGroups.length > 0 || product.variants.length > 0) {
      setDraftNote(null);
      setSheet({ kind: "customize", product });
      return;
    }
    setCart((c) => addLine(c, { product }));
  }

  function handleClear() {
    if (cart.lines.length === 0) return;
    setCart(clearCart());
    toast.success("Order cleared");
  }

  return (
    <>
      <PosTopBar title="Cashier Terminal" />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <DepartmentRail
          departments={catalog.departments}
          productCounts={productCounts}
          activeDepartmentId={departmentId}
          onSelectDepartment={selectDepartment}
          heldCount={0}
          onOpenHeld={() => toast.info("Held orders arrive in the next slice")}
          onOpenRecent={() => toast.info("Recent sales arrive in the next slice")}
          shiftTotal={null}
          shiftOrderCount={null}
          canSeeShiftTotals={canSeeOwnShiftTotals(currentUser?.role)}
        />

        <ProductBrowser
          departments={catalog.departments}
          categories={catalog.categories}
          products={catalog.products}
          activeDepartmentId={departmentId}
          activeCategoryId={categoryId}
          onSelectCategory={setCategoryId}
          search={search}
          onOpenSearch={() => setSheet({ kind: "search" })}
          onClearSearch={() => setSearch("")}
          barcodeEnabled={catalog.settings.barcode_scanning_enabled}
          memberAttached={cart.member !== null}
          onSelectProduct={handleSelectProduct}
        />

        <CartPanel
          cart={cart}
          totals={totals}
          orderRef={cart.holdRef}
          onOpenMemberPicker={() => setSheet({ kind: "member" })}
          onRemoveMember={() => setCart((c) => setMember(c, null))}
          onSetQty={(key, qty) => setCart((c) => setLineQty(c, key, qty))}
          onRemoveLine={(key) => setCart((c) => removeLine(c, key))}
          onHold={() => toast.info("Held orders arrive in the next slice")}
          onClear={handleClear}
          onDiscount={() => toast.info("Discounts arrive in the next slice")}
          onPay={() => toast.info("Payment arrives in the next slice")}
          busy={busy}
        />
      </div>

      {sheet.kind === "customize" && (
        <ModifierSheet
          product={sheet.product}
          memberAttached={cart.member !== null}
          note={draftNote}
          onOpenNoteKeyboard={() => setSheet({ kind: "note", product: sheet.product })}
          onCancel={() => { setDraftNote(null); setSheet({ kind: "none" }); }}
          onAdd={({ variant, modifiers, qty, itemNote }) => {
            setCart((c) =>
              addLine(c, { product: sheet.product, variant, modifiers, qty, itemNote })
            );
            setDraftNote(null);
            setSheet({ kind: "none" });
            toast.success(`${sheet.product.name} added`);
          }}
        />
      )}

      {sheet.kind === "member" && (
        <MemberPicker
          cartHasMemberPricing={cartHasMemberPricing(cart)}
          search={memberSearch}
          onOpenSearch={() => setSheet({ kind: "memberSearch" })}
          onClearSearch={() => setMemberSearch("")}
          onCancel={() => setSheet({ kind: "none" })}
          onContinueWalkIn={() => {
            setCart((c) => setMember(c, null));
            setSheet({ kind: "none" });
          }}
          onSelect={(m) => {
            setCart((c) => setMember(c, m));
            setSheet({ kind: "none" });
            toast.success(`${m.fullName} added to the order`);
          }}
        />
      )}

      {sheet.kind === "search" && (
        <OnScreenKeyboard
          title="Search products"
          placeholder="Name, brand or SKU"
          initialValue={search}
          submitLabel="Search"
          onSubmit={(v) => { setSearch(v); setSheet({ kind: "none" }); }}
          onCancel={() => setSheet({ kind: "none" })}
        />
      )}

      {sheet.kind === "memberSearch" && (
        <OnScreenKeyboard
          title="Find a member"
          placeholder="Name, phone or member number"
          initialValue={memberSearch}
          submitLabel="Search"
          onSubmit={(v) => { setMemberSearch(v); setSheet({ kind: "member" }); }}
          onCancel={() => setSheet({ kind: "member" })}
        />
      )}

      {sheet.kind === "note" && (
        <OnScreenKeyboard
          title="Kitchen note"
          placeholder="e.g. no onion, extra spicy"
          initialValue={draftNote ?? ""}
          submitLabel="Save note"
          presets={NOTE_PRESETS}
          onSubmit={(v) => {
            setDraftNote(v || null);
            setSheet({ kind: "customize", product: sheet.product });
          }}
          onCancel={() => setSheet({ kind: "customize", product: sheet.product })}
        />
      )}
    </>
  );
}
