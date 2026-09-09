"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  setDiscount,
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
import { PaymentSheet, type DraftPayment } from "./PaymentSheet";
import { DiscountSheet } from "./DiscountSheet";
import { HeldOrdersDrawer, type HeldOrderSummary } from "./HeldOrdersDrawer";
import { SaleCompleteScreen } from "./SaleCompleteScreen";

/** Cover most kitchen notes in one tap. Free text stays available. */
const NOTE_PRESETS = ["No salt", "Extra spicy", "No onion", "Less oil", "Takeaway", "Rush"];

type Sheet =
  | { kind: "none" }
  | { kind: "search" }
  | { kind: "customize"; product: TerminalProduct }
  | { kind: "note"; product: TerminalProduct }
  | { kind: "member" }
  | { kind: "memberSearch" }
  | { kind: "payment" }
  | { kind: "discount" }
  | { kind: "heldOrders" }
  | { kind: "saleComplete"; orderNo: string; payments: DraftPayment[] };

/**
 * The cashier terminal.
 *
 * Owns one CartState and replaces it wholesale through the pure helpers in
 * lib/pos/cart. Adding to the cart, holding it and resuming it are all
 * local/optimistic; only Hold, Pay and Delete-held talk to the server, and
 * even then the server recomputes every total itself rather than trusting
 * whatever the client sends (see /api/pos/orders/complete).
 */
export function PosTerminal({ catalog }: { catalog: TerminalCatalog }) {
  const currentUser = useCurrentUser();

  const [cart, setCart] = useState<CartState>(emptyCart);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [sheet, setSheet] = useState<Sheet>({ kind: "none" });

  const [holding, setHolding] = useState(false);
  const [completing, setCompleting] = useState(false);

  const [heldOrders, setHeldOrders] = useState<HeldOrderSummary[]>([]);
  const [heldLoading, setHeldLoading] = useState(false);
  const [heldBusyId, setHeldBusyId] = useState<string | null>(null);

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

  const refreshHeldOrders = useCallback(async () => {
    setHeldLoading(true);
    try {
      const res = await fetch("/api/pos/orders/held");
      if (!res.ok) throw new Error();
      const json = await res.json();
      setHeldOrders(json.orders ?? []);
    } catch {
      toast.error("Could not load held orders");
    } finally {
      setHeldLoading(false);
    }
  }, []);

  // Kept lightweight: refresh the held count once on mount so the rail
  // badge is accurate without the cashier having to open the drawer first.
  useEffect(() => { void refreshHeldOrders(); }, [refreshHeldOrders]);

  function selectDepartment(id: string | null) {
    setDepartmentId(id);
    setCategoryId(null);
    setSearch("");
  }

  function handleSelectProduct(product: TerminalProduct) {
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

  async function handleHold() {
    if (cart.lines.length === 0 || holding) return;
    setHolding(true);
    try {
      const res = await fetch("/api/pos/orders/hold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cart }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not hold the order");

      toast.success(`Order held — #${json.holdRef}`);
      setCart(clearCart());
      void refreshHeldOrders();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not hold the order");
    } finally {
      setHolding(false);
    }
  }

  async function handleResumeHeld(id: string) {
    setHeldBusyId(id);
    try {
      const res = await fetch(`/api/pos/orders/held/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not resume this order");

      // The stored snapshot is a CartState already, since every line was
      // fully snapshotted when it was added. Only the hold identifiers are
      // overridden, to whatever THIS fetch says is authoritative — not
      // whatever happened to be in the snapshot when it was saved.
      const resumed: CartState = {
        ...(json.cart as CartState),
        holdOrderId: json.orderId,
        holdRef: json.holdRef,
      };
      setCart(resumed);
      setSheet({ kind: "none" });
      toast.success(`Resumed #${json.holdRef}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not resume this order");
    } finally {
      setHeldBusyId(null);
    }
  }

  async function handleDeleteHeld(id: string) {
    setHeldBusyId(id);
    try {
      const res = await fetch(`/api/pos/orders/held/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Could not delete this order");
      }
      setHeldOrders((list) => list.filter((o) => o.id !== id));
      toast.success("Held order deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete this order");
    } finally {
      setHeldBusyId(null);
    }
  }

  async function handleCompletePayment(payments: DraftPayment[]) {
    if (completing) return;
    setCompleting(true);
    try {
      const res = await fetch("/api/pos/orders/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cart, payments }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not complete the sale");

      setSheet({ kind: "saleComplete", orderNo: json.orderNo, payments });
      void refreshHeldOrders(); // in case this was a resumed held order
    } catch (e) {
      // Sheet stays open deliberately — the cashier's typed amounts and
      // selected method are still there, so a network blip or a stock
      // conflict is a one-tap retry, not a lost sale.
      toast.error(e instanceof Error ? e.message : "Could not complete the sale");
    } finally {
      setCompleting(false);
    }
  }

  function handleNewSale() {
    setCart(clearCart());
    setSheet({ kind: "none" });
  }

  const customerLabel = cart.member
    ? `${cart.member.fullName}${cart.member.membershipNo ? ` · ${cart.member.membershipNo}` : ""}`
    : "Walk-in Customer";

  return (
    <>
      <PosTopBar title="Cashier Terminal" />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <DepartmentRail
          departments={catalog.departments}
          productCounts={productCounts}
          activeDepartmentId={departmentId}
          onSelectDepartment={selectDepartment}
          heldCount={heldOrders.length}
          onOpenHeld={() => { setSheet({ kind: "heldOrders" }); void refreshHeldOrders(); }}
          onOpenRecent={() => toast.info("Recent sales arrive in Phase 3C, alongside void/refund")}
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
          onHold={handleHold}
          onClear={handleClear}
          onDiscount={() => setSheet({ kind: "discount" })}
          onPay={() => setSheet({ kind: "payment" })}
          busy={holding}
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

      {sheet.kind === "payment" && (
        <PaymentSheet
          lines={cart.lines}
          totals={totals}
          customerLabel={customerLabel}
          quickCashDenominations={catalog.settings.quick_cash_denominations}
          busy={completing}
          onCancel={() => setSheet({ kind: "none" })}
          onComplete={handleCompletePayment}
        />
      )}

      {sheet.kind === "discount" && (
        <DiscountSheet
          subtotal={totals.subtotal}
          currentType={cart.discountType}
          currentValue={cart.discountValue}
          onCancel={() => setSheet({ kind: "none" })}
          onApply={(type, value) => {
            setCart((c) => setDiscount(c, type, value));
            setSheet({ kind: "none" });
            toast.success("Discount applied");
          }}
          onRemove={() => {
            setCart((c) => setDiscount(c, "none", 0));
            setSheet({ kind: "none" });
            toast.success("Discount removed");
          }}
        />
      )}

      {sheet.kind === "heldOrders" && (
        <HeldOrdersDrawer
          orders={heldOrders}
          loading={heldLoading}
          busyId={heldBusyId}
          onResume={handleResumeHeld}
          onDelete={handleDeleteHeld}
          onBack={() => setSheet({ kind: "none" })}
        />
      )}

      {sheet.kind === "saleComplete" && (
        <SaleCompleteScreen
          orderNo={sheet.orderNo}
          payments={sheet.payments}
          onNewSale={handleNewSale}
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
