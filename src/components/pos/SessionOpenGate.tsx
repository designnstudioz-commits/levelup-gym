"use client";

import { useState } from "react";
import { Wallet, Loader2 } from "lucide-react";
import { cn, formatPKR } from "@/lib/utils";
import { NumericKeypad } from "./NumericKeypad";
import { PosTopBar } from "./PosTopBar";

/**
 * Blocks the terminal entirely until the cashier opens a shift. Matches
 * how every real register works: you count and declare your float before
 * you can ring anything up. Enforced server-side too (the completion
 * route checks for an open session independently) — this gate is the
 * cashier-facing half, not the only one.
 */
export function SessionOpenGate({
  busy,
  error,
  onOpen,
}: {
  busy: boolean;
  error: string | null;
  onOpen: (openingCash: number) => void;
}) {
  const [amountStr, setAmountStr] = useState("");
  const amount = Number(amountStr) || 0;

  return (
    <>
      <PosTopBar title="Cashier Terminal" />
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-2xl border border-[#E4E4DE] p-8">
          <div className="w-14 h-14 rounded-xl bg-[#FEF0E8] flex items-center justify-center">
            <Wallet className="w-7 h-7 text-[#F06418]" />
          </div>
          <h2 className="mt-4 text-2xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] uppercase tracking-wide">
            Open Your Shift
          </h2>
          <p className="mt-1 text-sm text-[#7A7A72]">
            Count the drawer and enter the opening cash before selling.
          </p>

          <div className="mt-6 min-h-[64px] px-4 rounded-lg bg-[#F7F6F3] border border-[#E4E4DE] flex items-center text-2xl font-bold text-[#1A1A16] tabular-nums">
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
            onClick={() => onOpen(amount)}
            className={cn(
              "mt-5 w-full min-h-[72px] rounded-xl text-white text-lg font-bold uppercase tracking-wide",
              "transition-colors cursor-pointer flex items-center justify-center gap-2 active:scale-[0.99]",
              busy ? "bg-[#CFCEC6] cursor-not-allowed" : "bg-[#F06418] hover:bg-[#C04E10]"
            )}
          >
            {busy && <Loader2 className="w-5 h-5 animate-spin" />}
            Start Shift
          </button>
        </div>
      </main>
    </>
  );
}
