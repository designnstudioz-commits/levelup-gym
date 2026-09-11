"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatPKR } from "@/lib/utils";

interface CombinedReport {
  membershipTotal: number; levelupPosNet: number; healthboxPosNet: number; levelupEarnedHealthboxShare: number;
  cashPhysicallyReceived: number; revenueEconomicallyOwned: number; settlementsInRange: number;
}

export default function CombinedReportPage() {
  useRoleGuard(["owner", "manager"]);

  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<CombinedReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pos/reports/combined?from=${from}&to=${to}`);
      setReport(await res.json());
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Combined Business Report"
        subtitle="Cash physically collected is not the same as revenue Level Up actually owns"
        action={
          <div className="flex items-center gap-2">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 px-3 rounded-lg border border-[#E4E4DE] text-sm" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 px-3 rounded-lg border border-[#E4E4DE] text-sm" />
            <Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</Button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {loading || !report ? (
          <p className="text-sm text-[#7A7A72]">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader title="A. Cash Physically Received" subtitle="Everything that landed in the Level Up till, including HealthBox's own sales — held on their behalf until settlement" />
              <div className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-[#4A4A44]">Membership Collections</span><span className="tabular-nums">{formatPKR(report.membershipTotal)}</span></div>
                <div className="flex justify-between"><span className="text-[#4A4A44]">Level Up POS Net Sales</span><span className="tabular-nums">{formatPKR(report.levelupPosNet)}</span></div>
                <div className="flex justify-between"><span className="text-[#4A4A44]">HealthBox POS Net Sales (held, not owned)</span><span className="tabular-nums">{formatPKR(report.healthboxPosNet)}</span></div>
                <div className="flex justify-between pt-2 border-t border-[#E4E4DE] font-bold"><span>Total Cash Received</span><span className="tabular-nums">{formatPKR(report.cashPhysicallyReceived)}</span></div>
              </div>
            </Card>

            <Card>
              <CardHeader title="B. Revenue Level Up Actually Owns" subtitle="Membership + Level Up's own POS sales + Level Up's earned share from FINALISED HealthBox settlements only" />
              <div className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-[#4A4A44]">Membership Collections</span><span className="tabular-nums">{formatPKR(report.membershipTotal)}</span></div>
                <div className="flex justify-between"><span className="text-[#4A4A44]">Level Up POS Net Sales</span><span className="tabular-nums">{formatPKR(report.levelupPosNet)}</span></div>
                <div className="flex justify-between"><span className="text-[#4A4A44]">Level Up's Earned HealthBox Share ({report.settlementsInRange} settlement{report.settlementsInRange === 1 ? "" : "s"})</span><span className="tabular-nums">{formatPKR(report.levelupEarnedHealthboxShare)}</span></div>
                <div className="flex justify-between pt-2 border-t border-[#E4E4DE] font-bold"><span>Total Owned Revenue</span><span className="tabular-nums">{formatPKR(report.revenueEconomicallyOwned)}</span></div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
