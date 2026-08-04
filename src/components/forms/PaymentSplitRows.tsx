"use client";

import { useEffect } from "react";
import { Plus, X, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatPKR, cn } from "@/lib/utils";

export interface PaymentLine {
  method: string;
  amount: string;
}

export interface PartialPaymentState {
  isPartial: boolean;
  amountReceivedNow: string;
  balanceDueDate: string;
}

export const PAYMENT_METHODS = ["Cash", "Bank", "Card", "EasyPaisa", "JazzCash"];

export const emptyPartialState: PartialPaymentState = { isPartial: false, amountReceivedNow: "", balanceDueDate: "" };

/** How much of `fullAmount` the split rows below need to add up to —
 *  the full amount, unless a partial payment is being recorded, in which
 *  case only the portion actually being collected now. */
export function splitTarget(fullAmount: number, partial: PartialPaymentState): number {
  return partial.isPartial ? Number(partial.amountReceivedNow) || 0 : fullAmount;
}

/** Returns an error message if the current split/partial state isn't ready
 *  to submit, or null if it's valid. */
export function validatePaymentSplit(fullAmount: number, lines: PaymentLine[], partial: PartialPaymentState): string | null {
  if (lines.length === 0 || lines.some((l) => !l.amount || Number(l.amount) <= 0)) {
    return "Enter a valid amount for every payment method";
  }
  const target = splitTarget(fullAmount, partial);
  const splitTotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  if (Math.abs(splitTotal - target) > 0.5) {
    return "Split amounts must add up to the total being collected";
  }
  if (partial.isPartial) {
    if (!partial.amountReceivedNow || Number(partial.amountReceivedNow) <= 0) return "Enter the amount received now";
    if (Number(partial.amountReceivedNow) >= fullAmount) return "Partial amount must be less than the full amount due";
    if (!partial.balanceDueDate) return "Pick a balance due date";
  }
  return null;
}

/** Split payment methods (Cash + Bank in one transaction) and partial
 *  payment (pay part now, owe the rest by a date) — shared across every
 *  fee-collection surface (member profile, Fees page, registration) plus
 *  the Pay Balance modal, so the dynamic-row UI only exists once. */
export function PaymentSplitRows({
  fullAmount,
  lines,
  onLinesChange,
  partial,
  onPartialChange,
  allowPartial = true,
}: {
  fullAmount: number;
  lines: PaymentLine[];
  onLinesChange: (lines: PaymentLine[]) => void;
  partial: PartialPaymentState;
  onPartialChange: (partial: PartialPaymentState) => void;
  /** Hide the "Mark as partial payment" toggle — used by the Pay Balance
   *  modal, where a further partial-of-partial is handled by its own UI. */
  allowPartial?: boolean;
}) {
  const target = splitTarget(fullAmount, partial);
  const splitTotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const mismatch = lines.length > 1 && Math.abs(splitTotal - target) > 0.5;

  // The last row always mirrors the remaining balance instead of requiring
  // staff to calculate and type it themselves — with one line that's the
  // whole amount; with several, it's whatever's left after the earlier
  // ones. Recalculates live off othersSum (a single stable number, not the
  // lines array itself) so editing an earlier row immediately updates the
  // last one, adding a row re-splits the remainder into it, and removing a
  // row folds its amount back into whatever's now last. Earlier rows are
  // never touched — only the last one auto-adjusts.
  const lastIndex = lines.length - 1;
  const othersSum = lines.slice(0, lastIndex).reduce((s, l) => s + (Number(l.amount) || 0), 0);
  useEffect(() => {
    if (lines.length === 0) return;
    const remainder = Math.max(target - othersSum, 0);
    const currentLast = Number(lines[lastIndex]?.amount) || 0;
    if (currentLast !== remainder) {
      onLinesChange(lines.map((l, i) => (i === lastIndex ? { ...l, amount: String(remainder) } : l)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, lines.length, othersSum]);

  function updateLine(i: number, patch: Partial<PaymentLine>) {
    onLinesChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function addLine() {
    const remaining = Math.max(target - splitTotal, 0);
    onLinesChange([...lines, { method: "Cash", amount: remaining > 0 ? String(remaining) : "" }]);
  }

  function removeLine(i: number) {
    onLinesChange(lines.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      {allowPartial && (
        <>
          <label className="flex items-center gap-2 text-xs font-medium text-[#4A4A44] cursor-pointer">
            <input
              type="checkbox"
              className="accent-[#F06418]"
              checked={partial.isPartial}
              onChange={(e) => {
                const isPartial = e.target.checked;
                onPartialChange({ isPartial, amountReceivedNow: isPartial ? partial.amountReceivedNow : "", balanceDueDate: isPartial ? partial.balanceDueDate : "" });
              }}
            />
            Mark as partial payment
          </label>

          {partial.isPartial && (
            <div className="grid grid-cols-2 gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <Input
                label="Amount Received Now (Rs)"
                type="number"
                value={partial.amountReceivedNow}
                onChange={(e) => onPartialChange({ ...partial, amountReceivedNow: e.target.value })}
                error={
                  partial.amountReceivedNow && Number(partial.amountReceivedNow) >= fullAmount
                    ? "Must be less than full amount"
                    : undefined
                }
              />
              <Input
                label="Balance Due Date"
                type="date"
                required
                value={partial.balanceDueDate}
                onChange={(e) => onPartialChange({ ...partial, balanceDueDate: e.target.value })}
              />
              {Number(partial.amountReceivedNow) > 0 && Number(partial.amountReceivedNow) < fullAmount && (
                <p className="col-span-2 text-xs text-amber-700">
                  Balance remaining: <span className="font-semibold">{formatPKR(fullAmount - Number(partial.amountReceivedNow))}</span>
                </p>
              )}
            </div>
          )}
        </>
      )}

      <div className="space-y-2">
        {lines.map((line, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="flex-1">
              <Select
                label={i === 0 ? "Payment Method" : undefined}
                required={i === 0}
                value={line.method}
                onChange={(e) => updateLine(i, { method: e.target.value })}
              >
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </div>
            <div className="flex-1">
              <Input
                label={i === 0 ? "Amount (Rs)" : undefined}
                type="number"
                value={line.amount}
                onChange={(e) => updateLine(i, { amount: e.target.value })}
              />
            </div>
            {lines.length > 1 && (
              <button
                type="button"
                onClick={() => removeLine(i)}
                className="p-2.5 rounded-lg text-red-600 hover:bg-red-50 flex-shrink-0"
                title="Remove this payment method"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={addLine}
          className="flex items-center gap-1.5 text-xs font-semibold text-[#F06418] hover:underline"
        >
          <Plus className="w-3.5 h-3.5" /> Add Payment Method
        </button>

        {lines.length > 1 && (
          <div className={cn(
            "flex items-center justify-between text-xs font-semibold px-3 py-2 rounded-lg",
            mismatch ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"
          )}>
            <span className="flex items-center gap-1">{mismatch && <AlertTriangle className="w-3.5 h-3.5" />} Split total</span>
            <span>{formatPKR(splitTotal)} / {formatPKR(target)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
