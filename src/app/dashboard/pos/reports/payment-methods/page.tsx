"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Wallet } from "lucide-react";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatPKR } from "@/lib/utils";

interface MethodRow { method: string; total: number; count: number }

export default function PaymentMethodReportPage() {
  useRoleGuard(["owner", "manager"]);

  const [from, setFrom] = useState(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [methods, setMethods] = useState<MethodRow[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pos/reports/payment-methods?from=${from}&to=${to}`);
      const json = await res.json();
      setMethods(json.methods ?? []);
      setGrandTotal(json.grandTotal ?? 0);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Payment Method Report"
        subtitle="Split payments and refund/void reversals are netted correctly by construction"
        action={
          <div className="flex items-center gap-2">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 px-3 rounded-lg border border-[#E4E4DE] text-sm" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 px-3 rounded-lg border border-[#E4E4DE] text-sm" />
            <Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</Button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E4E4DE] text-left text-xs font-semibold text-[#7A7A72] uppercase tracking-wide">
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3 text-right">Transactions</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={3} className="px-4 py-10 text-center text-[#7A7A72]">Loading…</td></tr>
                ) : methods.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-14 text-center text-[#7A7A72]"><Wallet className="w-8 h-8 mx-auto text-[#CFCEC6] mb-2" />No payments in this range.</td></tr>
                ) : (
                  methods.map((m) => (
                    <tr key={m.method} className="border-b border-[#E4E4DE] last:border-0">
                      <td className="px-4 py-3 font-semibold">{m.method}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{m.count}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{formatPKR(m.total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {methods.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-[#1A1A16]">
                    <td className="px-4 py-3 font-bold" colSpan={2}>Grand Total</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold">{formatPKR(grandTotal)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
