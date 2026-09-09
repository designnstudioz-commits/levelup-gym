"use client";

import { Loader2, Clock } from "lucide-react";
import { cn, formatPKR, timeAgo } from "@/lib/utils";

export interface HeldOrderSummary {
  id: string;
  holdRef: string;
  heldAt: string;
  heldLabel: string | null;
  itemCount: number;
  netAmount: number;
}

/**
 * "Held Orders" — full-screen list per the approved frame. Resuming loads
 * the parked basket back into the cart (from pos_orders.cart_snapshot);
 * deleting soft-removes a held order that was never completed, which is
 * safe because it never became a financial record.
 */
export function HeldOrdersDrawer({
  orders,
  loading,
  busyId,
  onResume,
  onDelete,
  onBack,
}: {
  orders: HeldOrderSummary[];
  loading: boolean;
  busyId: string | null;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-6">
      <div className="w-full max-w-3xl max-h-[88vh] bg-white rounded-2xl border border-[#E4E4DE] flex flex-col overflow-hidden">
        <div className="px-6 pt-6 pb-4 flex items-start justify-between gap-4 flex-shrink-0">
          <div>
            <h2 className="text-2xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] uppercase tracking-wide">
              Held Orders
            </h2>
            <p className="text-sm text-[#7A7A72] mt-0.5">Resume a parked basket without losing items.</p>
          </div>
          {orders.length > 0 && (
            <span className="px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold flex-shrink-0">
              {orders.length} held
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 min-h-[160px]">
          {loading ? (
            <div className="py-12 flex items-center justify-center text-[#7A7A72]">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : orders.length === 0 ? (
            <div className="py-14 flex flex-col items-center text-center">
              <Clock className="w-8 h-8 text-[#CFCEC6]" />
              <p className="mt-3 text-sm font-semibold text-[#1A1A16]">No held orders</p>
              <p className="mt-1 text-xs text-[#7A7A72]">
                Tap Hold on the terminal to park a basket for later.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#E4E4DE]">
              {orders.map((o) => {
                const rowBusy = busyId === o.id;
                return (
                  <div key={o.id} className="py-4 flex items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-[#7A7A72] tabular-nums">#{o.holdRef}</p>
                      <p className="text-base font-bold text-[#1A1A16] truncate">
                        {o.heldLabel ?? "Walk-in"}
                      </p>
                      <p className="text-xs text-[#7A7A72]">
                        {o.itemCount} {o.itemCount === 1 ? "item" : "items"} · {timeAgo(o.heldAt)}
                      </p>
                    </div>
                    <p className="text-lg font-bold text-[#1A1A16] tabular-nums flex-shrink-0">
                      {formatPKR(o.netAmount)}
                    </p>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        disabled={rowBusy}
                        onClick={() => onDelete(o.id)}
                        className="min-h-[48px] px-4 rounded-lg border border-[#E4E4DE] bg-white text-sm font-semibold text-[#1A1A16] hover:bg-red-50 hover:border-red-300 hover:text-red-600 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        disabled={rowBusy}
                        onClick={() => onResume(o.id)}
                        className={cn(
                          "min-h-[48px] px-5 rounded-lg text-sm font-bold text-white transition-colors cursor-pointer flex items-center gap-2",
                          rowBusy ? "bg-[#CFCEC6] cursor-not-allowed" : "bg-[#F06418] hover:bg-[#C04E10]"
                        )}
                      >
                        {rowBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                        Resume
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#E4E4DE] flex-shrink-0">
          <p className="text-xs text-[#7A7A72] mb-3">
            Held orders remain editable until payment is completed.
          </p>
          <button
            type="button"
            onClick={onBack}
            className="w-full min-h-[64px] rounded-lg bg-[#1A1A1A] text-white text-base font-bold uppercase tracking-wide hover:bg-black transition-colors cursor-pointer"
          >
            Back to POS
          </button>
        </div>
      </div>
    </div>
  );
}
