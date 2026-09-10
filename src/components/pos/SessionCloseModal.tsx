"use client";

import { useState } from "react";
import { X, Loader2, CheckCircle2 } from "lucide-react";
import { cn, formatPKR } from "@/lib/utils";
import { NumericKeypad } from "./NumericKeypad";

export interface SessionCloseResult {
  expectedCash: number;
  countedCash: number;
  variance: number;
  orderCount: number;
}

/**
 * Close Shift — counted cash in, expected/variance shown once submitted.
 * expected_cash is computed server-side by pos_close_session() as a fresh
 * aggregate, never trusted from anything cached client-side; this screen
 * only sends the counted figure and displays what the server returns.
 */
export function SessionCloseModal({
  openingCash,
  busy,
  error,
  result,
  onSubmit,
  onDone,
  onCancel,
}: {
  openingCash: number;
  busy: boolean;
  error: string | null;
  result: SessionCloseResult | null;
  onSubmit: (countedCash: number) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [amountStr, setAmountStr] = useState("");
  const amount = Number(amountStr) || 0;

  if (result) {
    const balanced = result.variance === 0;
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-2xl border border-[#E4E4DE] p-8 text-center">
          <div
            className={cn(
              "w-16 h-16 mx-auto rounded-full flex items-center justify-center",
              balanced ? "bg-green-50" : "bg-amber-50"
            )}
          >
            <CheckCircle2 className={cn("w-8 h-8", balanced ? "text-green-700" : "text-amber-700")} />
          </div>
          <h2 className="mt-4 text-2xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] uppercase tracking-wide">
            Shift Closed
          </h2>
          <p className="mt-1 text-sm text-[#7A7A72]">{result.orderCount} orders this shift</p>

          <div className="mt-5 rounded-xl bg-[#F7F6F3] border border-[#E4E4DE] p-5 grid grid-cols-2 gap-4 text-left">
            <div>
              <p className="text-xs text-[#7A7A72]">Expected Cash</p>
              <p className="text-xl font-bold text-[#1A1A16] tabular-nums">{formatPKR(result.expectedCash)}</p>
            </div>
            <div>
              <p className="text-xs text-[#7A7A72]">Counted Cash</p>
              <p className="text-xl font-bold text-[#1A1A16] tabular-nums">{formatPKR(result.countedCash)}</p>
            </div>
            <div className="col-span-2 pt-3 border-t border-[#E4E4DE]">
              <p className="text-xs text-[#7A7A72]">Variance</p>
              <p className={cn("text-2xl font-bold tabular-nums", balanced ? "text-green-700" : "text-amber-700")}>
                {result.variance > 0 ? "+" : ""}{formatPKR(result.variance)}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onDone}
            className="mt-6 w-full min-h-[64px] rounded-lg bg-[#1A1A1A] hover:bg-black text-white text-base font-bold uppercase tracking-wide transition-colors cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border border-[#E4E4DE] p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] uppercase tracking-wide">
              Close Shift
            </h2>
            <p className="mt-1 text-sm text-[#7A7A72]">
              Opened with {formatPKR(openingCash)}. Count the drawer now.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="min-w-[40px] min-h-[40px] rounded-lg flex items-center justify-center text-[#4A4A44] hover:bg-[#F7F6F3] transition-colors cursor-pointer flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="mt-5 text-xs font-bold uppercase tracking-[0.1em] text-[#7A7A72] mb-1">
          Counted cash
        </p>
        <div className="min-h-[64px] px-4 rounded-lg bg-[#F7F6F3] border border-[#E4E4DE] flex items-center text-2xl font-bold text-[#1A1A16] tabular-nums">
          {formatPKR(amount)}
        </div>
        {error && <p className="mt-2 text-sm font-semibold text-red-600">{error}</p>}

        <div className="mt-4">
          <NumericKeypad
            onDigit={(d) => setAmountStr((v) => (v === "0" ? d : v + d))}
            onDoubleZero={() => setAmountStr((v) => (v === "0" ? "00" : v + "00"))}
            onBackspace={() => setAmountStr((v) => v.slice(0, -1))}
            onClear={() => setAmountStr("")}
          />
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => onSubmit(amount)}
          className={cn(
            "mt-5 w-full min-h-[72px] rounded-xl text-white text-lg font-bold uppercase tracking-wide",
            "transition-colors cursor-pointer flex items-center justify-center gap-2 active:scale-[0.99]",
            busy ? "bg-[#CFCEC6] cursor-not-allowed" : "bg-[#F06418] hover:bg-[#C04E10]"
          )}
        >
          {busy && <Loader2 className="w-5 h-5 animate-spin" />}
          Close Shift
        </button>
      </div>
    </div>
  );
}
