"use client";

import { Minus, Plus, Trash2, UserPlus, X, ArrowRight, ShoppingCart } from "lucide-react";
import { cn, formatPKR } from "@/lib/utils";
import type { CartState, CartTotals } from "@/lib/pos/cart";

/**
 * Right column: customer, order lines, actions, totals and PAY.
 *
 * The three zones and the PAY button never move — staff stop looking at
 * them after a week, which is the point. PAY is 96px tall per the Phase 3
 * sizing spec.
 */
export function CartPanel({
  cart,
  totals,
  orderRef,
  onOpenMemberPicker,
  onRemoveMember,
  onSetQty,
  onRemoveLine,
  onHold,
  onClear,
  onDiscount,
  onPay,
  busy,
}: {
  cart: CartState;
  totals: CartTotals;
  orderRef: string | null;
  onOpenMemberPicker: () => void;
  onRemoveMember: () => void;
  onSetQty: (key: string, qty: number) => void;
  onRemoveLine: (key: string) => void;
  onHold: () => void;
  onClear: () => void;
  onDiscount: () => void;
  onPay: () => void;
  busy: boolean;
}) {
  const empty = cart.lines.length === 0;
  const totalsByKey = new Map(totals.lines.map((t) => [t.key, t]));

  return (
    <aside className="w-[400px] flex-shrink-0 bg-white border-l border-[#E4E4DE] flex flex-col overflow-hidden">
      <header className="px-5 pt-5 pb-4 flex items-center justify-between gap-3 flex-shrink-0">
        <h2 className="text-xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] uppercase tracking-wide">
          Current Order
        </h2>
        {orderRef && (
          <span className="px-2 py-1 rounded-md bg-[#F1EFEA] text-[#4A4A44] text-xs font-semibold tabular-nums">
            #{orderRef}
          </span>
        )}
      </header>

      {/* Customer. Walk-in is the default; a member is optional. */}
      <div className="mx-5 mb-4 p-3 rounded-lg bg-[#F7F6F3] border border-[#E4E4DE] flex items-center gap-3 flex-shrink-0">
        <div
          className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold",
            cart.member ? "bg-[#F06418] text-white" : "bg-[#CFCEC6] text-white"
          )}
        >
          {cart.member ? cart.member.fullName.charAt(0).toUpperCase() : "W"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#1A1A16] truncate">
            {cart.member ? cart.member.fullName : "Walk-in Customer"}
          </p>
          <p className="text-xs text-[#7A7A72] truncate">
            {cart.member
              ? cart.member.membershipNo ?? "Member"
              : "Add member for member pricing"}
          </p>
        </div>
        {cart.member ? (
          <button
            type="button"
            onClick={onRemoveMember}
            aria-label="Remove member"
            className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-[#4A4A44] hover:bg-white hover:text-red-600 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenMemberPicker}
            className="min-h-[44px] px-3 rounded-lg bg-white border border-[#E4E4DE] text-sm font-semibold text-[#1A1A16] hover:border-[#F06418] hover:text-[#F06418] transition-colors flex items-center gap-1.5 cursor-pointer flex-shrink-0"
          >
            <UserPlus className="w-4 h-4" />
            Add
          </button>
        )}
      </div>

      {/* Lines */}
      <div className="flex-1 overflow-y-auto px-5 min-h-0">
        {empty ? (
          <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-center">
            <ShoppingCart className="w-8 h-8 text-[#CFCEC6]" />
            <p className="mt-3 text-sm font-semibold text-[#1A1A16]">No items yet</p>
            <p className="mt-1 text-xs text-[#7A7A72]">Tap a product to start the order.</p>
          </div>
        ) : (
          <>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#7A7A72] pb-2">
              {totals.itemCount} {totals.itemCount === 1 ? "item" : "items"}
            </p>
            <div className="divide-y divide-[#E4E4DE]">
              {cart.lines.map((line) => {
                const t = totalsByKey.get(line.key);
                return (
                  <div key={line.key} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[#1A1A16] leading-snug">
                          {line.productName}
                          {line.variantName && (
                            <span className="text-[#7A7A72] font-normal"> · {line.variantName}</span>
                          )}
                        </p>
                        <p className="text-xs text-[#7A7A72] mt-0.5">{line.departmentName}</p>

                        {line.modifiers.length > 0 && (
                          <p className="text-xs text-[#4A4A44] mt-1 leading-snug">
                            {line.modifiers.map((m) => m.name).join(" · ")}
                          </p>
                        )}
                        {line.itemNote && (
                          <p className="text-xs text-[#C04E10] mt-1 italic leading-snug">
                            “{line.itemNote}”
                          </p>
                        )}
                      </div>

                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-[#1A1A16] tabular-nums">
                          {formatPKR(t?.lineNet ?? 0)}
                        </p>
                        {t?.memberPriceApplied && (
                          <p className="text-[11px] text-[#7A7A72] line-through tabular-nums">
                            {formatPKR(t.lineGross)}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <QtyButton
                        label="Decrease quantity"
                        onClick={() => onSetQty(line.key, line.qty - 1)}
                      >
                        <Minus className="w-4 h-4" />
                      </QtyButton>
                      <span className="min-w-[44px] h-[44px] rounded-lg bg-[#F7F6F3] border border-[#E4E4DE] flex items-center justify-center text-sm font-bold text-[#1A1A16] tabular-nums">
                        {line.qty}
                      </span>
                      <QtyButton
                        label="Increase quantity"
                        onClick={() => onSetQty(line.key, line.qty + 1)}
                      >
                        <Plus className="w-4 h-4" />
                      </QtyButton>

                      <button
                        type="button"
                        onClick={() => onRemoveLine(line.key)}
                        aria-label={`Remove ${line.productName}`}
                        className="ml-auto min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-[#7A7A72] hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Actions + totals + PAY */}
      <div className="flex-shrink-0 border-t border-[#E4E4DE] p-5 pt-4">
        <div className="grid grid-cols-3 gap-2">
          <SecondaryAction onClick={onHold} disabled={empty || busy}>Hold</SecondaryAction>
          <SecondaryAction onClick={onClear} disabled={empty || busy}>Clear</SecondaryAction>
          <SecondaryAction onClick={onDiscount} disabled={empty || busy}>Discount</SecondaryAction>
        </div>

        <dl className="mt-4 space-y-1.5">
          <Row label="Subtotal" value={formatPKR(totals.subtotal)} />
          {totals.memberSaving > 0 && (
            <Row
              label="Member saving"
              value={`− ${formatPKR(totals.memberSaving)}`}
              accent
            />
          )}
          <Row
            label="Discount"
            value={totals.discountAmount > 0 ? `− ${formatPKR(totals.discountAmount)}` : "—"}
          />
        </dl>

        <div className="mt-3 pt-3 border-t border-[#E4E4DE] flex items-baseline justify-between">
          <span className="text-base font-semibold text-[#1A1A16]">Total</span>
          <span className="text-3xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] tabular-nums">
            {formatPKR(totals.total)}
          </span>
        </div>

        <button
          type="button"
          onClick={onPay}
          disabled={empty || busy}
          className={cn(
            "mt-4 w-full h-[96px] rounded-xl px-5 cursor-pointer",
            "flex items-center justify-between",
            "transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F06418] focus-visible:ring-offset-2",
            empty || busy
              ? "bg-[#CFCEC6] cursor-not-allowed"
              : "bg-[#F06418] hover:bg-[#C04E10] active:scale-[0.99]"
          )}
        >
          <span className="text-left">
            <span className="block text-white/80 text-xs font-bold uppercase tracking-[0.14em]">
              Pay
            </span>
            <span className="block text-white text-3xl font-bold font-[family-name:var(--font-barlow-condensed)] tabular-nums leading-tight">
              {formatPKR(totals.total)}
            </span>
          </span>
          <ArrowRight className="w-6 h-6 text-white flex-shrink-0" />
        </button>

        <p className="mt-3 text-[11px] text-[#7A7A72] text-center">
          Cash · Card · Bank Transfer · EasyPaisa · JazzCash · Split
        </p>
      </div>
    </aside>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <dt className="text-[#4A4A44]">{label}</dt>
      <dd className={cn("tabular-nums font-medium", accent ? "text-[#C04E10]" : "text-[#1A1A16]")}>
        {value}
      </dd>
    </div>
  );
}

function QtyButton({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="w-[44px] h-[44px] rounded-lg border border-[#E4E4DE] bg-white flex items-center justify-center text-[#1A1A16] hover:bg-[#FEF0E8] hover:border-[#F06418] hover:text-[#F06418] transition-colors cursor-pointer active:scale-95"
    >
      {children}
    </button>
  );
}

function SecondaryAction({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "min-h-[52px] rounded-lg border text-sm font-semibold cursor-pointer",
        "transition-colors duration-150 active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F06418] focus-visible:ring-offset-1",
        disabled
          ? "border-[#E4E4DE] text-[#CFCEC6] cursor-not-allowed"
          : "border-[#E4E4DE] text-[#1A1A16] bg-white hover:bg-[#FEF0E8] hover:border-[#F06418]"
      )}
    >
      {children}
    </button>
  );
}
