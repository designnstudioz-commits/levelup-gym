"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Receipt, RefreshCw, X } from "lucide-react";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { formatPKR, formatDateTime, cn } from "@/lib/utils";

interface OrderRow {
  id: string;
  orderNo: string | null;
  holdRef: string | null;
  status: string;
  customerLabel: string;
  netAmount: number;
  levelupNet: number;
  healthboxNet: number;
  itemCount: number;
  servedByName: string;
  completedAt: string | null;
  isRefund: boolean;
  createdAt: string;
}

/**
 * POS & Inventory → Orders. Owner/manager only, business-wide — not scoped
 * to one shift the way the terminal's own Recent Orders is.
 */
export default function PosOrdersPage() {
  useRoleGuard(["owner", "manager"]);

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/pos/orders?${params.toString()}`);
      const json = await res.json();
      setOrders(json.orders ?? []);
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader title="POS Orders" subtitle="Every sale, void and refund across the cafe" />

      <div className="flex-1 overflow-y-auto p-6">
        <Card padding={false}>
          <div className="p-4 border-b border-[#E4E4DE] flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#7A7A72]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search order number..."
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#E4E4DE] focus:outline-none focus:ring-2 focus:ring-[#F06418]"
                />
              </div>
            </div>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
              <option value="all">All statuses</option>
              <option value="completed">Completed</option>
              <option value="voided">Voided</option>
              <option value="refunded">Refunded</option>
              <option value="held">Held</option>
            </Select>
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              <RefreshCw className="w-4 h-4" /> Refresh
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E4E4DE] text-left text-xs font-semibold text-[#7A7A72] uppercase tracking-wide">
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Cashier</th>
                  <th className="px-4 py-3">Items</th>
                  <th className="px-4 py-3 text-right">Level Up</th>
                  <th className="px-4 py-3 text-right">HealthBox</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">When</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-[#7A7A72]">Loading…</td></tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-14 text-center text-[#7A7A72]">
                      <Receipt className="w-8 h-8 mx-auto text-[#CFCEC6] mb-2" />
                      No orders match this filter.
                    </td>
                  </tr>
                ) : (
                  orders.map((o) => (
                    <tr key={o.id} className="border-b border-[#E4E4DE] last:border-0 hover:bg-[#F7F6F3]">
                      <td className="px-4 py-3 font-semibold text-[#1A1A16] tabular-nums">
                        {o.orderNo ? `#${o.orderNo}` : o.holdRef ? `#${o.holdRef}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-[#4A4A44]">{o.customerLabel}</td>
                      <td className="px-4 py-3 text-[#4A4A44]">{o.servedByName}</td>
                      <td className="px-4 py-3 text-[#4A4A44] tabular-nums">{o.itemCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#4A4A44]">{formatPKR(o.levelupNet)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#4A4A44]">{formatPKR(o.healthboxNet)}</td>
                      <td className={cn("px-4 py-3 text-right font-bold tabular-nums", o.isRefund && "text-red-600")}>
                        {formatPKR(o.netAmount)}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                      <td className="px-4 py-3 text-[#7A7A72] text-xs whitespace-nowrap">
                        {formatDateTime(o.completedAt ?? o.createdAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "completed": return <Badge variant="active">Completed</Badge>;
    case "voided": return <Badge variant="rejected">Voided</Badge>;
    case "refunded": return <Badge variant="rejected">Refunded</Badge>;
    case "held": return <Badge variant="pending">Held</Badge>;
    default: return <Badge variant="default">{status}</Badge>;
  }
}
