"use client";

import { useState } from "react";
import { X, Percent, Banknote } from "lucide-react";
import { cn, formatPKR } from "@/lib/utils";
import { NumericKeypad } from "./NumericKeypad";
import { applyOrderDiscount } from "@/lib/pos/pricing";

/**
 * Order-level discount — percent or fixed amount, applied against the
 * cart's subtotal (after member pricing, before payment).
 *
 * NOTE ON AUTHORISATION: the existing Level Up fee-discount flow
 * (dashboard/fees) has no numeric cap or manager-approval step of any
 * kind — any role with page access applies whatever discount it likes.
 * There is no existing threshold model to reuse, so none is invented here
 * either. pos_settings.cashier_discount_limit_percent exists in the schema
 * from Phase A but is NOT enforced by this sheet — flagged for an explicit
 * decision rather than guessed at.
 */
export function DiscountSheet({
  subtotal,
  currentType,
  currentValue,
  onCancel,
  onApply,
  onRemove,
}: {
  subtotal: number;
  currentType: "none" | "percent" | "amount";
  currentValue: number;
  onCancel: () => void;
  onApply: (type: "percent" | "amount", value: number) => void;
  onRemove: () => void;
}) {
  const [type, setType] = useState<"percent" | "amount">(
    currentType === "amount" ? "amount" : "percent"
  );
  const [valueStr, setValueStr] = useState(
    currentType !== "none" && currentValue > 0 ? String(currentValue) : ""
  );

  const value = Number(valueStr) || 0;
  // Percent is capped at the input layer too — 100% off is the practical
  // ceiling; the underlying math also clamps defensively (see pricing.ts).
  const clampedValue = type === "percent" ? Math.min(value, 100) : value;
  const preview = applyOrderDiscount(subtotal, type, clampedValue);
  const valid = clampedValue > 0 && preview.discountAmount > 0;

  function appendDigit(d: string) {
    setValueStr((v) => (v === "0" ? d : v + d));
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl bg-white rounded-2xl border border-[#E4E4DE] flex flex-col overflow-hidden">
        <div className="px-6 pt-6 pb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] uppercase tracking-wide">
              Order Discount
            </h2>
            <p className="text-sm text-[#7A7A72] mt-0.5">
              Applies to the subtotal, before payment.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-[#4A4A44] hover:bg-[#F7F6F3] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pb-6">
          <div className="grid grid-cols-2 gap-3 mb-5">
            <button
              type="button"
              onClick={() => { setType("percent"); setValueStr(""); }}
              className={cn(
                "min-h-[64px] rounded-xl border-2 flex items-center justify-center gap-2 cursor-pointer transition-colors",
                type === "percent" ? "bg-[#FEF0E8] border-[#F06418] text-[#C04E10]" : "bg-white border-[#E4E4DE] text-[#1A1A16] hover:border-[#F06418]"
              )}
            >
              <Percent className="w-5 h-5" />
              <span className="text-base font-bold">Percentage</span>
            </button>
            <button
              type="button"
              onClick={() => { setType("amount"); setValueStr(""); }}
              className={cn(
                "min-h-[64px] rounded-xl border-2 flex items-center justify-center gap-2 cursor-pointer transition-colors",
                type === "amount" ? "bg-[#FEF0E8] border-[#F06418] text-[#C04E10]" : "bg-white border-[#E4E4DE] text-[#1A1A16] hover:border-[#F06418]"
              )}
            >
              <Banknote className="w-5 h-5" />
              <span className="text-base font-bold">Fixed Amount</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#7A7A72] mb-1">
                {type === "percent" ? "Discount %" : "Discount (Rs)"}
              </p>
              <div className="min-h-[64px] px-4 rounded-lg bg-[#F7F6F3] border border-[#E4E4DE] flex items-center text-2xl font-bold text-[#1A1A16] tabular-nums">
                {type === "percent" ? `${valueStr || "0"}%` : formatPKR(value)}
              </div>

              <div className="mt-4 rounded-lg bg-[#F7F6F3] border border-[#E4E4DE] p-4 space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#4A4A44]">Subtotal</span>
                  <span className="font-medium text-[#1A1A16] tabular-nums">{formatPKR(subtotal)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#4A4A44]">Discount</span>
                  <span className="font-medium text-[#C04E10] tabular-nums">
                    {preview.discountAmount > 0 ? `− ${formatPKR(preview.discountAmount)}` : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-base font-bold pt-1.5 border-t border-[#E4E4DE]">
                  <span className="text-[#1A1A16]">New total</span>
                  <span className="text-[#1A1A16] tabular-nums">{formatPKR(preview.total)}</span>
                </div>
              </div>
            </div>

            <NumericKeypad
              onDigit={appendDigit}
              onDoubleZero={() => appendDigit("00")}
              onBackspace={() => setValueStr((v) => v.slice(0, -1))}
              onClear={() => setValueStr("")}
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[#E4E4DE] flex items-center gap-3">
          {currentType !== "none" && (
            <button
              type="button"
              onClick={onRemove}
              className="min-h-[64px] px-6 rounded-lg border border-red-200 bg-white text-base font-semibold text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
            >
              Remove Discount
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[64px] px-6 rounded-lg border border-[#E4E4DE] bg-white text-base font-semibold text-[#1A1A16] hover:bg-[#F7F6F3] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid}
            onClick={() => onApply(type, clampedValue)}
            className={cn(
              "min-h-[64px] px-8 rounded-lg text-white text-base font-bold uppercase tracking-wide transition-colors cursor-pointer",
              valid ? "bg-[#F06418] hover:bg-[#C04E10] active:scale-[0.99]" : "bg-[#CFCEC6] cursor-not-allowed"
            )}
          >
            Apply Discount
          </button>
        </div>
      </div>
    </div>
  );
}
