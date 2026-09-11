"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatPKR } from "@/lib/utils";

interface DailyReport {
  date: string;
  membership: { total: number; byMethod: Record<string, number> };
  pos: { grossSales: number; discounts: number; refunds: number; voids: number; netSales: number; levelupNet: number; healthboxNet: number; orderCount: number };
  byDepartment: { departmentId: string; departmentName: string; gross: number; net: number }[];
  byPaymentMethod: { method: string; amount: number }[];
  cash: { openingCash: number; cashSales: number; expectedCash: number; countedCash: number; variance: number; sessionsOpen: number; sessionsClosed: number };
  combined: { membershipTotal: number; levelupPosNet: number; totalBusinessCollection: number };
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={bold ? "text-sm font-bold text-[#1A1A16]" : "text-sm text-[#4A4A44]"}>{label}</span>
      <span className={bold ? "text-sm font-bold text-[#1A1A16] tabular-nums" : "text-sm text-[#1A1A16] tabular-nums"}>{value}</span>
    </div>
  );
}

export default function DailyReportPage() {
  useRoleGuard(["owner", "manager"]);

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pos/reports/daily?date=${date}`);
      const json = await res.json();
      setReport(json);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Daily Business Report"
        subtitle="Membership and POS combined, by department, payment method and cash"
        action={
          <div className="flex items-center gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 px-3 rounded-lg border border-[#E4E4DE] text-sm" />
            <Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</Button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {loading || !report ? (
          <p className="text-sm text-[#7A7A72]">Loading…</p>
        ) : (
          <>
            <Card>
              <CardHeader title="Total Business Collection" subtitle="Membership + net POS sales" />
              <p className="text-3xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] mt-2">{formatPKR(report.combined.totalBusinessCollection)}</p>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader title="Membership" />
                <div className="mt-2 divide-y divide-[#E4E4DE]">
                  <Row label="Total Collected" value={formatPKR(report.membership.total)} bold />
                  {Object.entries(report.membership.byMethod).map(([m, amt]) => <Row key={m} label={m} value={formatPKR(amt)} />)}
                </div>
              </Card>

              <Card>
                <CardHeader title="POS" />
                <div className="mt-2 divide-y divide-[#E4E4DE]">
                  <Row label="Gross Sales" value={formatPKR(report.pos.grossSales)} />
                  <Row label="Discounts" value={`- ${formatPKR(report.pos.discounts)}`} />
                  <Row label="Refunds" value={`- ${formatPKR(report.pos.refunds)}`} />
                  <Row label="Voids (excluded, informational)" value={formatPKR(report.pos.voids)} />
                  <Row label="Net POS Sales" value={formatPKR(report.pos.netSales)} bold />
                  <Row label="Order Count" value={String(report.pos.orderCount)} />
                </div>
              </Card>

              <Card>
                <CardHeader title="By Department" />
                <div className="mt-2 divide-y divide-[#E4E4DE]">
                  {report.byDepartment.length === 0 ? <p className="text-sm text-[#7A7A72] py-2">No sales.</p> : report.byDepartment.map((d) => (
                    <Row key={d.departmentId} label={d.departmentName} value={formatPKR(d.net)} />
                  ))}
                </div>
              </Card>

              <Card>
                <CardHeader title="Payment Methods" />
                <div className="mt-2 divide-y divide-[#E4E4DE]">
                  {report.byPaymentMethod.length === 0 ? <p className="text-sm text-[#7A7A72] py-2">No payments.</p> : report.byPaymentMethod.map((m) => (
                    <Row key={m.method} label={m.method} value={formatPKR(m.amount)} />
                  ))}
                </div>
              </Card>

              <Card>
                <CardHeader title="Cash" subtitle={`${report.cash.sessionsClosed} of ${report.cash.sessionsOpen} sessions closed`} />
                <div className="mt-2 divide-y divide-[#E4E4DE]">
                  <Row label="Opening Cash" value={formatPKR(report.cash.openingCash)} />
                  <Row label="Cash Sales" value={formatPKR(report.cash.cashSales)} />
                  <Row label="Expected Cash" value={formatPKR(report.cash.expectedCash)} />
                  <Row label="Counted Cash" value={formatPKR(report.cash.countedCash)} />
                  <Row label="Variance" value={formatPKR(report.cash.variance)} bold />
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
