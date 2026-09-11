"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, UserCog, Lock } from "lucide-react";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatPKR } from "@/lib/utils";

interface Exception {
  id: string; type: string; value_amount: number | null; value_percent: number | null; reason: string;
  status: string; resolved_at: string | null; approvingManagerName: string | null;
}
interface SessionRow {
  id: string; terminal_name: string; cashierName: string; opened_at: string; opening_cash: number;
  closed_at: string | null; grossSales: number; cashSales: number; refunds: number;
  expected_cash: number; counted_cash: number; variance: number; reviewedByName: string | null;
  reviewed_at: string | null; is_locked: boolean; status: string; exceptions: Exception[];
}

export default function CashierReportPage() {
  useRoleGuard(["owner", "manager"]);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pos/reports/cashiers?from=${from}&to=${to}`);
      const json = await res.json();
      setSessions(json.sessions ?? []);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Cashier / Shift Report"
        subtitle="Reviewed and locked sessions stay exactly as they were at review time"
        action={
          <div className="flex items-center gap-2">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 px-3 rounded-lg border border-[#E4E4DE] text-sm" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 px-3 rounded-lg border border-[#E4E4DE] text-sm" />
            <Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</Button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {loading ? (
          <p className="text-sm text-[#7A7A72]">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-[#7A7A72] flex items-center gap-2 py-10 justify-center"><UserCog className="w-8 h-8 text-[#CFCEC6]" /> No sessions in this range.</p>
        ) : (
          sessions.map((s) => (
            <Card key={s.id} padding={false}>
              <button type="button" onClick={() => setExpanded(expanded === s.id ? null : s.id)} className="w-full text-left p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-[#1A1A16] flex items-center gap-2">
                    {s.cashierName} · {s.terminal_name}
                    {s.is_locked && <Lock className="w-3.5 h-3.5 text-[#7A7A72]" />}
                    <Badge variant={s.status === "closed" ? "active" : "pending"}>{s.status}</Badge>
                  </p>
                  <p className="text-xs text-[#7A7A72] mt-0.5">
                    {new Date(s.opened_at).toLocaleString("en-PK")} {s.closed_at ? `→ ${new Date(s.closed_at).toLocaleString("en-PK")}` : "(open)"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold tabular-nums">{formatPKR(s.grossSales)}</p>
                  <p className={`text-xs tabular-nums ${s.variance !== 0 ? "text-red-600" : "text-[#7A7A72]"}`}>Variance: {formatPKR(s.variance)}</p>
                </div>
              </button>
              {expanded === s.id && (
                <div className="px-4 pb-4 border-t border-[#E4E4DE] pt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><p className="text-[#7A7A72]">Opening Cash</p><p className="font-semibold">{formatPKR(s.opening_cash)}</p></div>
                  <div><p className="text-[#7A7A72]">Cash Sales</p><p className="font-semibold">{formatPKR(s.cashSales)}</p></div>
                  <div><p className="text-[#7A7A72]">Refunds</p><p className="font-semibold">{formatPKR(s.refunds)}</p></div>
                  <div><p className="text-[#7A7A72]">Expected Cash</p><p className="font-semibold">{formatPKR(s.expected_cash)}</p></div>
                  <div><p className="text-[#7A7A72]">Counted Cash</p><p className="font-semibold">{formatPKR(s.counted_cash)}</p></div>
                  <div><p className="text-[#7A7A72]">Reviewed By</p><p className="font-semibold">{s.reviewedByName ?? "—"}</p></div>
                  <div><p className="text-[#7A7A72]">Review Time</p><p className="font-semibold">{s.reviewed_at ? new Date(s.reviewed_at).toLocaleString("en-PK") : "—"}</p></div>
                  <div><p className="text-[#7A7A72]">Locked</p><p className="font-semibold">{s.is_locked ? "Yes" : "No"}</p></div>

                  {s.exceptions.length > 0 && (
                    <div className="col-span-2 sm:col-span-4 mt-2">
                      <p className="text-xs font-bold uppercase tracking-wide text-[#7A7A72] mb-2">Exceptions / Approvals</p>
                      <div className="space-y-2">
                        {s.exceptions.map((e) => (
                          <div key={e.id} className="flex items-center justify-between bg-[#F7F6F3] rounded-lg px-3 py-2">
                            <div>
                              <p className="text-xs font-semibold">{e.type} — {e.reason}</p>
                              <p className="text-xs text-[#7A7A72]">{e.approvingManagerName ? `${e.status} by ${e.approvingManagerName}` : e.status}</p>
                            </div>
                            <Badge variant={e.status === "approved" ? "active" : e.status === "rejected" ? "rejected" : "pending"}>{e.status}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
