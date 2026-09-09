"use client";

import { Check } from "lucide-react";
import { formatPKR } from "@/lib/utils";
import type { DraftPayment } from "./PaymentSheet";

/**
 * "Payment successful" — matches the approved Sale Complete frame.
 *
 * No printer and no public receipt route in this slice (flagged in the
 * Phase B report as a deliberate scope cut, not an oversight): this screen
 * itself is the digital receipt — the cashier can turn the monitor to show
 * the customer the same summary a printed slip would carry.
 */
export function SaleCompleteScreen({
  orderNo,
  payments,
  onNewSale,
}: {
  orderNo: string;
  payments: DraftPayment[];
  onNewSale: () => void;
}) {
  const total = payments.reduce((s, p) => s + p.amount, 0);
  const cashPayment = payments.find((p) => p.method === "Cash");
  const methodLabel =
    payments.length > 1
      ? payments.map((p) => p.method).join(" + ")
      : payments[0]?.method ?? "—";

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-white rounded-2xl border border-[#E4E4DE] p-8 text-center">
        <div className="w-20 h-20 mx-auto rounded-full bg-green-50 flex items-center justify-center">
          <Check className="w-10 h-10 text-green-700" strokeWidth={3} />
        </div>

        <h2 className="mt-5 text-3xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] uppercase tracking-wide">
          Payment successful
        </h2>
        <p className="mt-1 text-sm text-[#7A7A72]">
          Order #{orderNo} has been completed.
        </p>

        <div className="mt-6 rounded-xl bg-[#F7F6F3] border border-[#E4E4DE] p-5 grid grid-cols-2 gap-4 text-left">
          <div>
            <p className="text-xs text-[#7A7A72]">Total Paid</p>
            <p className="text-2xl font-bold text-[#1A1A16] tabular-nums">{formatPKR(total)}</p>
          </div>
          <div>
            <p className="text-xs text-[#7A7A72]">Payment</p>
            <p className="text-lg font-bold text-[#1A1A16]">{methodLabel}</p>
          </div>
          {cashPayment && (cashPayment.changeGiven ?? 0) > 0 && (
            <div className="col-span-2 pt-2 border-t border-[#E4E4DE]">
              <p className="text-xs text-[#7A7A72]">Change</p>
              <p className="text-xl font-bold text-[#1A1A16] tabular-nums">
                {formatPKR(cashPayment.changeGiven ?? 0)}
              </p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onNewSale}
          className="mt-6 w-full min-h-[72px] rounded-xl bg-[#F06418] hover:bg-[#C04E10] text-white text-lg font-bold uppercase tracking-wide transition-colors cursor-pointer active:scale-[0.99]"
        >
          New Sale
        </button>
      </div>
    </div>
  );
}
