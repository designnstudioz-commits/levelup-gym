"use client";

import { Loader2, Receipt } from "lucide-react";
import { cn, formatPKR, formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";

export interface RecentOrderSummary {
  id: string;
  orderNo: string | null;
  status: string;
  customerLabel: string;
  netAmount: number;
  completedAt: string | null;
  methods: string[];
  isRefund: boolean;
  hasPendingVoid: boolean;
  hasPendingRefund: boolean;
}

/**
 * "Recent Orders" — matches the approved frame: completed sales from the
 * CURRENT shift, with Refund/Void actions right there in the cashier's own
 * UI. The footer banner is the same line the approved frame carries:
 * refunds and voids need a manager, whichever route gets there.
 */
export function RecentOrdersDrawer({
  orders,
  loading,
  onVoid,
  onRefund,
  onBack,
}: {
  orders: RecentOrderSummary[];
  loading: boolean;
  onVoid: (order: RecentOrderSummary) => void;
  onRefund: (order: RecentOrderSummary) => void;
  onBack: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-6">
      <div className="w-full max-w-3xl max-h-[88vh] bg-white rounded-2xl border border-[#E4E4DE] flex flex-col overflow-hidden">
        <div className="px-6 pt-6 pb-4 flex-shrink-0">
          <h2 className="text-2xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] uppercase tracking-wide">
            Recent Orders
          </h2>
          <p className="text-sm text-[#7A7A72] mt-0.5">Completed sales from the current shift.</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 min-h-[160px]">
          {loading ? (
            <div className="py-12 flex items-center justify-center text-[#7A7A72]">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : orders.length === 0 ? (
            <div className="py-14 flex flex-col items-center text-center">
              <Receipt className="w-8 h-8 text-[#CFCEC6]" />
              <p className="mt-3 text-sm font-semibold text-[#1A1A16]">No sales yet this shift</p>
            </div>
          ) : (
            <div className="divide-y divide-[#E4E4DE]">
              {orders.map((o) => (
                <div key={o.id} className="py-4 flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-[#1A1A16] tabular-nums">#{o.orderNo}</p>
                      <StatusBadge status={o.status} isRefund={o.isRefund} />
                      {o.hasPendingVoid && <Badge variant="pending">Void pending</Badge>}
                      {o.hasPendingRefund && <Badge variant="pending">Refund pending</Badge>}
                    </div>
                    <p className="text-xs text-[#7A7A72] mt-0.5">
                      {o.customerLabel} · {formatDateTime(o.completedAt)} · {o.methods.join(" + ") || "—"}
                    </p>
                  </div>
                  <p className={cn("text-base font-bold tabular-nums flex-shrink-0", o.isRefund && "text-red-600")}>
                    {formatPKR(o.netAmount)}
                  </p>
                  {o.status === "completed" && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => onRefund(o)}
                        disabled={o.hasPendingRefund}
                        className="min-h-[44px] px-4 rounded-lg border border-[#E4E4DE] bg-white text-sm font-semibold text-[#1A1A16] hover:bg-[#F7F6F3] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Refund
                      </button>
                      <button
                        type="button"
                        onClick={() => onVoid(o)}
                        disabled={o.hasPendingVoid}
                        className="min-h-[44px] px-4 rounded-lg border border-red-200 bg-white text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Void
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#E4E4DE] flex-shrink-0">
          <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            Refunds and voids require manager approval.
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

function StatusBadge({ status, isRefund }: { status: string; isRefund: boolean }) {
  if (isRefund) return <Badge variant="rejected">Refund</Badge>;
  if (status === "voided") return <Badge variant="rejected">Voided</Badge>;
  if (status === "refunded") return <Badge variant="rejected">Refunded</Badge>;
  return <Badge variant="active">Completed</Badge>;
}
