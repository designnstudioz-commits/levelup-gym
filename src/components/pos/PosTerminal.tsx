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
import type { PosPaymentMethod } from "@/types/pos";
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
import { SessionOpenGate } from "./SessionOpenGate";
import { SessionCloseModal, type SessionCloseResult } from "./SessionCloseModal";
import { RecentOrdersDrawer, type RecentOrderSummary } from "./RecentOrdersDrawer";
import { VoidRefundSheet } from "./VoidRefundSheet";
import { ManagerPinPad } from "./ManagerPinPad";

const NOTE_PRESETS = ["No salt", "Extra spicy", "No onion", "Less oil", "Takeaway", "Rush"];

interface SessionInfo {
  id: string;
  openedAt: string;
  openingCash: number;
  orderCount: number;
  shiftTotal: number;
}

type Sheet =
  | { kind: "none" }
  | { kind: "search" }
  | { kind: "customize"; product: TerminalProduct }
  | { kind: "note"; product: TerminalProduct }
  | { kind: "member" }
  | { kind: "memberSearch" }
  | { kind: "payment" }
  | { kind: "discount" }
  | { kind: "discountPin"; type: "percent" | "amount"; value: number; limit: number }
  | { kind: "heldOrders" }
  | { kind: "recentOrders" }
  | { kind: "voidRefund"; order: RecentOrderSummary; action: "void" | "refund" }
  | { kind: "closeShift" }
  | { kind: "saleComplete"; orderNo: string; payments: DraftPayment[] };

/**
 * The cashier terminal.
 *
 * Nothing renders except the Open-Shift gate until the cashier has an open
 * register session — enforced here for UX, and independently by the
 * server (the completion route checks for an open session on its own, see
 * /api/pos/orders/complete).
 */
export function PosTerminal({ catalog }: { catalog: TerminalCatalog }) {
  const currentUser = useCurrentUser();

  const [session, setSession] = useState<SessionInfo | null | "loading">("loading");
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [closeResult, setCloseResult] = useState<SessionCloseResult | null>(null);

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

  const [recentOrders, setRecentOrders] = useState<RecentOrderSummary[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [voidRefundBusy, setVoidRefundBusy] = useState(false);
  const [voidRefundError, setVoidRefundError] = useState<string | null>(null);

  const [discountPinBusy, setDiscountPinBusy] = useState(false);
  const [discountPinError, setDiscountPinError] = useState<string | null>(null);

  const [draftNote, setDraftNote] = useState<string | null>(null);

  const totals = useMemo(() => computeTotals(cart), [cart]);

  const productCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of catalog.products) {
      counts[p.department_id] = (counts[p.department_id] ?? 0) + 1;
    }
    return counts;
  }, [catalog.products]);

  // ── Session ──────────────────────────────────────────────────────────

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch("/api/pos/sessions/current");
      const json = await res.json();
      setSession(json.session ?? null);
    } catch {
      setSession(null);
    }
  }, []);

  useEffect(() => { void refreshSession(); }, [refreshSession]);

  async function handleOpenSession(openingCash: number) {
    setSessionBusy(true);
    setSessionError(null);
    try {
      const res = await fetch("/api/pos/sessions/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openingCash }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not open the shift");
      setSession({ id: json.sessionId, openedAt: json.openedAt, openingCash: json.openingCash, orderCount: 0, shiftTotal: 0 });
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : "Could not open the shift");
    } finally {
      setSessionBusy(false);
    }
  }

  async function handleCloseSession(countedCash: number) {
    if (!session || session === "loading") return;
    setSessionBusy(true);
    setSessionError(null);
    try {
      const res = await fetch("/api/pos/sessions/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, countedCash }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not close the shift");
      setCloseResult({
        expectedCash: json.expected_cash, countedCash: json.counted_cash,
        variance: json.variance, orderCount: json.order_count,
      });
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : "Could not close the shift");
    } finally {
      setSessionBusy(false);
    }
  }

  function handleCloseDone() {
    // The shift is closed — nothing left for this cashier to do here.
    // Sign them out rather than dropping back into an empty terminal with
    // no open session, which would just show the gate again anyway.
    window.location.href = "/login";
  }

  // ── Catalogue interaction ───────────────────────────────────────────

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

  // ── Held orders ──────────────────────────────────────────────────────

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

  useEffect(() => { void refreshHeldOrders(); }, [refreshHeldOrders]);

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

  // ── Payment / completion ─────────────────────────────────────────────

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
      void refreshHeldOrders();
      void refreshSession();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not complete the sale");
    } finally {
      setCompleting(false);
    }
  }

  function handleNewSale() {
    setCart(clearCart());
    setSheet({ kind: "none" });
  }

  // ── Discount, with over-limit manager approval ──────────────────────

  async function requestDiscountApproval(
    type: "percent" | "amount",
    value: number,
    pin?: string
  ) {
    const res = await fetch("/api/pos/discounts/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subtotal: totals.subtotal, discountType: type, discountValue: value, pin }),
    });
    return { ok: res.ok, json: await res.json() };
  }

  async function handleDiscountApply(type: "percent" | "amount", value: number) {
    const { ok, json } = await requestDiscountApproval(type, value);
    if (ok && json.approved) {
      setCart((c) => setDiscount(c, type, value, json.authorisedBy));
      setSheet({ kind: "none" });
      toast.success(json.authorisedByName ? `Discount approved by ${json.authorisedByName}` : "Discount applied");
      return;
    }
    if (json.requiresPin) {
      setDiscountPinError(null);
      setSheet({ kind: "discountPin", type, value, limit: json.limit });
      return;
    }
    toast.error(json.error ?? "Could not apply the discount");
  }

  async function handleDiscountPinSubmit(pin: string) {
    if (sheet.kind !== "discountPin") return;
    setDiscountPinBusy(true);
    setDiscountPinError(null);
    try {
      const { ok, json } = await requestDiscountApproval(sheet.type, sheet.value, pin);
      if (ok && json.approved) {
        setCart((c) => setDiscount(c, sheet.type, sheet.value, json.authorisedBy));
        setSheet({ kind: "none" });
        toast.success(`Discount approved by ${json.authorisedByName}`);
      } else {
        setDiscountPinError(json.error ?? "Incorrect PIN");
      }
    } finally {
      setDiscountPinBusy(false);
    }
  }

  // ── Recent orders, void & refund ─────────────────────────────────────

  const refreshRecentOrders = useCallback(async () => {
    setRecentLoading(true);
    try {
      const res = await fetch("/api/pos/orders/recent");
      const json = await res.json();
      setRecentOrders(json.orders ?? []);
    } catch {
      toast.error("Could not load recent orders");
    } finally {
      setRecentLoading(false);
    }
  }, []);

  async function submitInstantAction(args: { reason: string; pin: string; payoutMethod?: PosPaymentMethod }) {
    if (sheet.kind !== "voidRefund") return;
    const { order, action } = sheet;
    setVoidRefundBusy(true);
    setVoidRefundError(null);
    try {
      const url = action === "void" ? `/api/pos/orders/${order.id}/void` : `/api/pos/orders/${order.id}/refund`;
      const body =
        action === "void"
          ? { reason: args.reason, pin: args.pin }
          : { reason: args.reason, pin: args.pin, payoutMethod: args.payoutMethod, sessionId: session !== "loading" ? session?.id : null };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Could not ${action} this order`);

      toast.success(`${action === "void" ? "Voided" : "Refunded"} by ${json.approvedByName}`);
      setSheet({ kind: "none" });
      void refreshRecentOrders();
    } catch (e) {
      setVoidRefundError(e instanceof Error ? e.message : `Could not ${action} this order`);
    } finally {
      setVoidRefundBusy(false);
    }
  }

  async function submitRequestAction(args: { reason: string }) {
    if (sheet.kind !== "voidRefund") return;
    const { order, action } = sheet;
    setVoidRefundBusy(true);
    setVoidRefundError(null);
    try {
      const url = action === "void" ? `/api/pos/orders/${order.id}/void-request` : `/api/pos/orders/${order.id}/refund-request`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: args.reason }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not submit the request");

      toast.success("Sent for manager approval");
      setSheet({ kind: "none" });
      void refreshRecentOrders();
    } catch (e) {
      setVoidRefundError(e instanceof Error ? e.message : "Could not submit the request");
    } finally {
      setVoidRefundBusy(false);
    }
  }

  const customerLabel = cart.member
    ? `${cart.member.fullName}${cart.member.membershipNo ? ` · ${cart.member.membershipNo}` : ""}`
    : "Walk-in Customer";

  // ── Gate: no shift, no terminal ─────────────────────────────────────

  if (session === "loading") {
    return <PosTopBar title="Cashier Terminal" />;
  }
  if (session === null) {
    return <SessionOpenGate busy={sessionBusy} error={sessionError} onOpen={handleOpenSession} />;
  }

  return (
    <>
      <PosTopBar
        title="Cashier Terminal"
        shiftOpen
        onCloseShift={() => { setCloseResult(null); setSessionError(null); setSheet({ kind: "closeShift" }); }}
      />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <DepartmentRail
          departments={catalog.departments}
          productCounts={productCounts}
          activeDepartmentId={departmentId}
          onSelectDepartment={selectDepartment}
          heldCount={heldOrders.length}
          onOpenHeld={() => { setSheet({ kind: "heldOrders" }); void refreshHeldOrders(); }}
          onOpenRecent={() => { setSheet({ kind: "recentOrders" }); void refreshRecentOrders(); }}
          shiftTotal={session.shiftTotal}
          shiftOrderCount={session.orderCount}
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
          onApply={handleDiscountApply}
          onRemove={() => {
            setCart((c) => setDiscount(c, "none", 0));
            setSheet({ kind: "none" });
            toast.success("Discount removed");
          }}
        />
      )}

      {sheet.kind === "discountPin" && (
        <ManagerPinPad
          title="Authorise Discount"
          subtitle={`Over the ${sheet.limit}% limit — manager approval required`}
          error={discountPinError}
          busy={discountPinBusy}
          onCancel={() => setSheet({ kind: "discount" })}
          onSubmit={handleDiscountPinSubmit}
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

      {sheet.kind === "recentOrders" && (
        <RecentOrdersDrawer
          orders={recentOrders}
          loading={recentLoading}
          onVoid={(order) => { setVoidRefundError(null); setSheet({ kind: "voidRefund", order, action: "void" }); }}
          onRefund={(order) => { setVoidRefundError(null); setSheet({ kind: "voidRefund", order, action: "refund" }); }}
          onBack={() => setSheet({ kind: "none" })}
        />
      )}

      {sheet.kind === "voidRefund" && (
        <VoidRefundSheet
          order={sheet.order}
          kind={sheet.action}
          busy={voidRefundBusy}
          error={voidRefundError}
          onSubmitInstant={submitInstantAction}
          onSubmitRequest={submitRequestAction}
          onCancel={() => setSheet({ kind: "recentOrders" })}
        />
      )}

      {sheet.kind === "closeShift" && (
        <SessionCloseModal
          openingCash={session.openingCash}
          busy={sessionBusy}
          error={sessionError}
          result={closeResult}
          onSubmit={handleCloseSession}
          onDone={handleCloseDone}
          onCancel={() => setSheet({ kind: "none" })}
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
