"use client";

import { useState } from "react";
import { X, ShieldCheck, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { NumericKeypad } from "./NumericKeypad";

/**
 * A manager types their own PIN, right at the counter, to authorise a
 * void, refund or over-limit discount. Matches real retail practice: the
 * cashier asks a manager over, the manager enters their own PIN once,
 * nobody has to know whose PIN it was in advance — the server matches it
 * against every active owner/manager and reports back who it was for the
 * audit trail.
 */
export function ManagerPinPad({
  title,
  subtitle,
  error,
  busy,
  onSubmit,
  onCancel,
}: {
  title: string;
  subtitle?: string;
  error?: string | null;
  busy: boolean;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState("");

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-[#E4E4DE] overflow-hidden">
        <div className="px-6 pt-6 pb-4 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#FEF0E8] flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="w-5 h-5 text-[#F06418]" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] uppercase tracking-wide">
                {title}
              </h2>
              {subtitle && <p className="text-xs text-[#7A7A72] mt-0.5">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="min-w-[40px] min-h-[40px] rounded-lg flex items-center justify-center text-[#4A4A44] hover:bg-[#F7F6F3] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pb-4">
          <div className="min-h-[56px] rounded-lg bg-[#F7F6F3] border border-[#E4E4DE] flex items-center justify-center gap-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "w-3 h-3 rounded-full transition-colors",
                  i < pin.length ? "bg-[#F06418]" : "bg-[#E4E4DE]"
                )}
              />
            ))}
          </div>
          {error && <p className="mt-2 text-sm font-semibold text-red-600 text-center">{error}</p>}
        </div>

        <div className="px-6 pb-6">
          <NumericKeypad
            onDigit={(d) => setPin((p) => (p.length >= 6 ? p : p + d))}
            onDoubleZero={() => setPin((p) => (p.length >= 5 ? p : p + "00"))}
            onBackspace={() => setPin((p) => p.slice(0, -1))}
            onClear={() => setPin("")}
          />
        </div>

        <div className="px-6 pb-6">
          <button
            type="button"
            disabled={pin.length < 4 || busy}
            onClick={() => onSubmit(pin)}
            className={cn(
              "w-full min-h-[64px] rounded-lg text-white text-base font-bold uppercase tracking-wide",
              "transition-colors cursor-pointer flex items-center justify-center gap-2",
              pin.length < 4 || busy ? "bg-[#CFCEC6] cursor-not-allowed" : "bg-[#F06418] hover:bg-[#C04E10] active:scale-[0.99]"
            )}
          >
            {busy && <Loader2 className="w-5 h-5 animate-spin" />}
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
