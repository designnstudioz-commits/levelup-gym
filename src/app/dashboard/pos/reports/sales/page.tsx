"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card, CardHeader } from "@/components/ui/Card";
import { StatsCard } from "@/components/ui/StatsCard";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { formatPKR } from "@/lib/utils";
import { DollarSign, ShoppingCart, TrendingDown, Hash } from "lucide-react";

interface Department { id: string; name: string }
interface SalesTotals { grossSales: number; discounts: number; netSales: number; refunds: number; voids: number; qtySold: number; orderCount: number; avgOrderValue: number }
interface OrderRow { id: string; order_no: string; status: string; net_amount: number; completed_at: string }

export default function SalesReportPage() {
  useRoleGuard(["owner", "manager"]);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [totals, setTotals] = useState<SalesTotals | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    from: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
    department_id: "", financial_owner: "", payment_method: "", status: "",
  });

  useEffect(() => {
    fetch("/api/pos/admin/departments").then((r) => r.json()).then((j) => setDepartments(j.departments ?? []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
      const res = await fetch(`/api/pos/reports/sales?${params.toString()}`);
      const json = await res.json();
      setTotals(json.totals);
      setOrders(json.orders ?? []);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="POS Sales Report"
        subtitle="Immutable order snapshots — historical figures never move with catalogue changes"
        action={<Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</Button>}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className="h-10 px-3 rounded-lg border border-[#E4E4DE] text-sm" />
          <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className="h-10 px-3 rounded-lg border border-[#E4E4DE] text-sm" />
          <Select value={filters.department_id} onChange={(e) => setFilters((f) => ({ ...f, department_id: e.target.value }))}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select value={filters.financial_owner} onChange={(e) => setFilters((f) => ({ ...f, financial_owner: e.target.value }))}>
            <option value="">All owners</option>
            <option value="levelup">Level Up</option>
            <option value="healthbox">HealthBox</option>
          </Select>
          <Select value={filters.payment_method} onChange={(e) => setFilters((f) => ({ ...f, payment_method: e.target.value }))}>
            <option value="">All payment methods</option>
            {["Cash", "Card", "Bank Transfer", "EasyPaisa", "JazzCash"].map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
          <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">Completed + Refunded</option>
            <option value="refund">Refunds only</option>
            <option value="void">Voids only</option>
          </Select>
        </div>

        {totals && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsCard title="Net Sales" value={formatPKR(totals.netSales)} icon={DollarSign} />
            <StatsCard title="Gross Sales" value={formatPKR(totals.grossSales)} icon={TrendingDown} />
            <StatsCard title="Order Count" value={totals.orderCount} icon={ShoppingCart} />
            <StatsCard title="Avg Order Value" value={formatPKR(totals.avgOrderValue)} icon={Hash} />
          </div>
        )}
        {totals && (
          <Card>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div><p className="text-[#7A7A72]">Discounts</p><p className="font-bold">{formatPKR(totals.discounts)}</p></div>
              <div><p className="text-[#7A7A72]">Refunds</p><p className="font-bold">{formatPKR(totals.refunds)}</p></div>
              <div><p className="text-[#7A7A72]">Voids</p><p className="font-bold">{formatPKR(totals.voids)}</p></div>
              <div><p className="text-[#7A7A72]">Qty Sold</p><p className="font-bold">{totals.qtySold}</p></div>
            </div>
          </Card>
        )}

        <Card padding={false}>
          <div className="p-5 border-b border-[#E4E4DE]"><CardHeader title="Orders" /></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E4E4DE] text-left text-xs font-semibold text-[#7A7A72] uppercase tracking-wide">
                  <th className="px-4 py-3">Order #</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Net Amount</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-[#7A7A72]">Loading…</td></tr>
                ) : orders.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-[#7A7A72]">No orders match.</td></tr>
                ) : (
                  orders.slice(0, 200).map((o) => (
                    <tr key={o.id} className="border-b border-[#E4E4DE] last:border-0">
                      <td className="px-4 py-3 font-semibold">{o.order_no ?? "—"}</td>
                      <td className="px-4 py-3 text-[#4A4A44]">{o.status}</td>
                      <td className="px-4 py-3 text-[#4A4A44]">{o.completed_at ? new Date(o.completed_at).toLocaleString("en-PK") : "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{formatPKR(o.net_amount)}</td>
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
