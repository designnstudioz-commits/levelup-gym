"use client";

import { useState } from "react";
import { X, Loader2, ShieldCheck, Clock } from "lucide-react";
import { cn, formatPKR } from "@/lib/utils";
import { ManagerPinPad } from "./ManagerPinPad";
import type { RecentOrderSummary } from "./RecentOrdersDrawer";
import type { PosPaymentMethod } from "@/types/pos";

const REASON_PRESETS = [
  "Customer changed mind", "Wrong item rung up", "Duplicate charge",
  "Pricing error", "Out of stock after sale", "Other",
];
const PAYOUT_METHODS: PosPaymentMethod[] = ["Cash", "Card", "Bank Transfer", "EasyPaisa", "JazzCash"];

type Step = "reason" | "payout" | "choice" | "pin";

/**
 * Reason -> (refund only) payout method -> manager-here-now or
 * request-for-later. Matches the approved flow exactly: "cashier initiates
 * -> reason required -> approval request created -> manager approves/
 * rejects -> approved action posts an auditable transaction." The PIN path
 * is the same flow with the last two steps happening in one motion instead
 * of two, for when a manager is standing right there.
 */
export function VoidRefundSheet({
  order,
  kind,
  busy,
  error,
  onSubmitInstant,
  onSubmitRequest,
  onCancel,
}: {
  order: RecentOrderSummary;
  kind: "void" | "refund";
  busy: boolean;
  error: string | null;
  onSubmitInstant: (args: { reason: string; pin: string; payoutMethod?: PosPaymentMethod }) => void;
  onSubmitRequest: (args: { reason: string }) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>("reason");
  const [reason, setReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [payoutMethod, setPayoutMethod] = useState<PosPaymentMethod>("Cash");

  const finalReason = reason === "Other" ? customReason.trim() : reason;
  const reasonValid = finalReason.length > 0;

  function goNext() {
    if (kind === "refund") setStep("payout");
    else setStep("choice");
  }

  if (step === "pin") {
    return (
      <ManagerPinPad
        title={`Authorise ${kind === "void" ? "Void" : "Refund"}`}
        subtitle={`#${order.orderNo} · ${formatPKR(order.netAmount)}`}
        error={error}
        busy={busy}
        onCancel={() => setStep("choice")}
        onSubmit={(pin) => onSubmitInstant({ reason: finalReason, pin, payoutMethod: kind === "refund" ? payoutMethod : undefined })}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white rounded-2xl border border-[#E4E4DE] overflow-hidden">
        <div className="px-6 pt-6 pb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] uppercase tracking-wide">
              {kind === "void" ? "Void Order" : "Refund Order"}
            </h2>
            <p className="text-sm text-[#7A7A72] mt-0.5">
              #{order.orderNo} · {formatPKR(order.netAmount)} · {order.customerLabel}
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

        {step === "reason" && (
          <div className="px-6 pb-6">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#7A7A72] mb-2">Reason (required)</p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {REASON_PRESETS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={cn(
                    "min-h-[52px] px-3 rounded-lg border text-sm font-semibold text-left cursor-pointer transition-colors",
                    reason === r ? "bg-[#FEF0E8] border-[#F06418] text-[#C04E10]" : "bg-white border-[#E4E4DE] text-[#1A1A16] hover:border-[#F06418]"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            {reason === "Other" && (
              <input
                autoFocus
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Describe the reason"
                className="w-full min-h-[52px] px-4 rounded-lg border border-[#E4E4DE] text-sm focus:outline-none focus:ring-2 focus:ring-[#F06418]"
              />
            )}
            <button
              type="button"
              disabled={!reasonValid}
              onClick={goNext}
              className={cn(
                "mt-5 w-full min-h-[64px] rounded-lg text-white text-base font-bold uppercase tracking-wide cursor-pointer transition-colors",
                reasonValid ? "bg-[#F06418] hover:bg-[#C04E10]" : "bg-[#CFCEC6] cursor-not-allowed"
              )}
            >
              Continue
            </button>
          </div>
        )}

        {step === "payout" && (
          <div className="px-6 pb-6">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#7A7A72] mb-2">
              How is the refund paid out?
            </p>
            <div className="grid grid-cols-2 gap-2">
              {PAYOUT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPayoutMethod(m)}
                  className={cn(
                    "min-h-[56px] px-4 rounded-lg border text-sm font-semibold cursor-pointer transition-colors",
                    payoutMethod === m ? "bg-[#FEF0E8] border-[#F06418] text-[#C04E10]" : "bg-white border-[#E4E4DE] text-[#1A1A16] hover:border-[#F06418]"
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setStep("choice")}
              className="mt-5 w-full min-h-[64px] rounded-lg bg-[#F06418] hover:bg-[#C04E10] text-white text-base font-bold uppercase tracking-wide cursor-pointer transition-colors"
            >
              Continue
            </button>
          </div>
        )}

        {step === "choice" && (
          <div className="px-6 pb-6 space-y-3">
            {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
            <button
              type="button"
              onClick={() => setStep("pin")}
              className="w-full min-h-[76px] px-5 rounded-xl border-2 border-[#F06418] bg-[#FEF0E8] flex items-center gap-3 text-left cursor-pointer hover:bg-[#FDDCC8] transition-colors"
            >
              <ShieldCheck className="w-6 h-6 text-[#C04E10] flex-shrink-0" />
              <span>
                <span className="block text-base font-bold text-[#C04E10]">Manager is here now</span>
                <span className="block text-xs text-[#7A7A72]">Enter their PIN to approve instantly</span>
              </span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSubmitRequest({ reason: finalReason })}
              className="w-full min-h-[76px] px-5 rounded-xl border border-[#E4E4DE] bg-white flex items-center gap-3 text-left cursor-pointer hover:bg-[#F7F6F3] transition-colors disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-6 h-6 text-[#4A4A44] flex-shrink-0 animate-spin" /> : <Clock className="w-6 h-6 text-[#4A4A44] flex-shrink-0" />}
              <span>
                <span className="block text-base font-bold text-[#1A1A16]">Request approval for later</span>
                <span className="block text-xs text-[#7A7A72]">A manager approves from the dashboard</span>
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
