"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatPKR } from "@/lib/utils";

interface HealthboxReport {
  grossSales: number; discounts: number; netSales: number; orderCount: number;
  productPerformance: { productName: string; qty: number; net: number }[];
  expenses: { approved: number; pending: number; rejected: number; needsCorrection: number };
  netProfit: number; levelupShare: number; healthboxShare: number; isLoss: boolean; lossAmount: number;
  settlementStatus: string | null;
}

/** Owner/Manager only — HealthBox staff never reach this route
 *  (POS_ROUTE_ROLES gates /dashboard/pos/healthbox/report to
 *  POS_ADMIN_ROLES), unlike /dashboard/pos/healthbox/expenses which they
 *  do use for their own operational work. Profit, shares and settlement
 *  status live ONLY here. */
export default function HealthBoxReportPage() {
  useRoleGuard(["owner", "manager"]);

  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<HealthboxReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pos/reports/healthbox?from=${from}&to=${to}`);
      setReport(await res.json());
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="HealthBox Report"
        subtitle="Sales, expenses and profit/loss — never visible to HealthBox staff"
        action={
          <div className="flex items-center gap-2">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 px-3 rounded-lg border border-[#E4E4DE] text-sm" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 px-3 rounded-lg border border-[#E4E4DE] text-sm" />
            <Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</Button>
            <Link href="/dashboard/pos/healthbox/settlement"><Button size="sm">Settlements</Button></Link>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {loading || !report ? (
          <p className="text-sm text-[#7A7A72]">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader title="Sales" />
                <div className="mt-2 space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-[#4A4A44]">Gross Sales</span><span className="tabular-nums">{formatPKR(report.grossSales)}</span></div>
                  <div className="flex justify-between"><span className="text-[#4A4A44]">Discounts</span><span className="tabular-nums">- {formatPKR(report.discounts)}</span></div>
                  <div className="flex justify-between font-bold pt-1.5 border-t border-[#E4E4DE]"><span>Net Sales</span><span className="tabular-nums">{formatPKR(report.netSales)}</span></div>
                  <div className="flex justify-between text-[#7A7A72]"><span>Orders</span><span className="tabular-nums">{report.orderCount}</span></div>
                </div>
              </Card>

              <Card>
                <CardHeader title="Expenses (this period)" />
                <div className="mt-2 space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-[#4A4A44]">Approved</span><span className="tabular-nums font-bold">{formatPKR(report.expenses.approved)}</span></div>
                  <div className="flex justify-between"><span className="text-[#4A4A44]">Pending (not counted)</span><span className="tabular-nums">{formatPKR(report.expenses.pending)}</span></div>
                  <div className="flex justify-between"><span className="text-[#4A4A44]">Rejected (not counted)</span><span className="tabular-nums">{formatPKR(report.expenses.rejected)}</span></div>
                  <div className="flex justify-between"><span className="text-[#4A4A44]">Needs Correction (not counted)</span><span className="tabular-nums">{formatPKR(report.expenses.needsCorrection)}</span></div>
                </div>
              </Card>
            </div>

            <Card>
              <CardHeader title="Net Profit / Loss" subtitle="Locked rule: positive splits 50/50; a loss belongs entirely to HealthBox" />
              <div className="mt-3 flex flex-wrap items-center gap-6">
                <div>
                  <p className="text-xs text-[#7A7A72]">Net Result</p>
                  <p className={`text-2xl font-bold font-[family-name:var(--font-barlow-condensed)] ${report.isLoss ? "text-red-600" : "text-[#1A1A16]"}`}>{formatPKR(report.netProfit)}</p>
                </div>
                <div>
                  <p className="text-xs text-[#7A7A72]">Level Up Share</p>
                  <p className="text-xl font-bold">{formatPKR(report.levelupShare)}</p>
                </div>
                <div>
                  <p className="text-xs text-[#7A7A72]">HealthBox Share</p>
                  <p className={`text-xl font-bold ${report.isLoss ? "text-red-600" : ""}`}>{formatPKR(report.healthboxShare)}</p>
                </div>
                {report.settlementStatus && (
                  <Badge variant={report.settlementStatus === "paid" ? "active" : report.settlementStatus === "finalised" ? "active" : "pending"}>
                    Settlement: {report.settlementStatus}
                  </Badge>
                )}
              </div>
            </Card>

            <Card padding={false}>
              <div className="p-5 border-b border-[#E4E4DE]"><CardHeader title="Product Performance" /></div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#E4E4DE] text-left text-xs font-semibold text-[#7A7A72] uppercase tracking-wide">
                      <th className="px-4 py-3">Product</th>
                      <th className="px-4 py-3 text-right">Qty</th>
                      <th className="px-4 py-3 text-right">Net Sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.productPerformance.length === 0 ? (
                      <tr><td colSpan={3} className="px-4 py-10 text-center text-[#7A7A72]">No sales in this range.</td></tr>
                    ) : report.productPerformance.slice(0, 20).map((p) => (
                      <tr key={p.productName} className="border-b border-[#E4E4DE] last:border-0">
                        <td className="px-4 py-3 font-semibold">{p.productName}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{p.qty}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatPKR(p.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
