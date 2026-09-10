"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Clock, CheckCircle2, AlertTriangle, ShieldAlert, RefreshCw, Loader2, Lock, KeyRound } from "lucide-react";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StatsCard } from "@/components/ui/StatsCard";
import { formatPKR, formatDateTime, cn } from "@/lib/utils";

interface SessionRow {
  id: string;
  terminalName: string | null;
  cashierName: string;
  openedAt: string;
  openingCash: number;
  closedAt: string | null;
  countedCash: number | null;
  expectedCash: number | null;
  variance: number | null;
  orderCount: number;
  paymentMethodTotals: Record<string, number>;
  status: string;
  isLocked: boolean;
}

interface ApprovalRow {
  id: string;
  type: string;
  orderId: string | null;
  orderNo: string | null;
  orderAmount: number | null;
  valuePercent: number | null;
  reason: string;
  status: string;
  requestedByName: string;
  requestedAt: string;
  resolvedByName: string | null;
  resolvedAt: string | null;
}

/**
 * "Cashier & Shift Report" — register accountability, payment mix and
 * manager-reviewed exceptions, matching the approved frame's own three
 * panels: shift list, payment mix, and exceptions/approvals.
 */
export default function PosSessionsPage() {
  useRoleGuard(["owner", "manager"]);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SessionRow | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [pinSaving, setPinSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, aRes] = await Promise.all([
        fetch("/api/pos/sessions"),
        fetch("/api/pos/approvals?status=pending"),
      ]);
      const sJson = await sRes.json();
      const aJson = await aRes.json();
      setSessions(sJson.sessions ?? []);
      setApprovals(aJson.approvals ?? []);
      setSelected((prev) => prev ?? (sJson.sessions ?? []).find((s: SessionRow) => s.status !== "open") ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleReview(sessionId: string) {
    setReviewingId(sessionId);
    try {
      const res = await fetch(`/api/pos/sessions/${sessionId}/review`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not review this shift");
      toast.success("Shift reviewed and locked");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not review this shift");
    } finally {
      setReviewingId(null);
    }
  }

  async function handleResolve(approval: ApprovalRow, decision: "approve" | "reject") {
    setResolvingId(approval.id);
    try {
      const body: Record<string, unknown> = { decision };
      if (approval.type === "refund" && decision === "approve") {
        body.payoutMethod = "Cash";
      }
      const res = await fetch(`/api/pos/approvals/${approval.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not resolve this request");
      toast.success(decision === "approve" ? "Approved" : "Rejected");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not resolve this request");
    } finally {
      setResolvingId(null);
    }
  }

  async function handleSetPin() {
    if (!/^\d{4,6}$/.test(pin)) {
      toast.error("PIN must be 4 to 6 digits");
      return;
    }
    setPinSaving(true);
    try {
      const res = await fetch("/api/pos/set-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not set your PIN");
      toast.success("Your manager override PIN is set");
      setPin("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not set your PIN");
    } finally {
      setPinSaving(false);
    }
  }

  const openCount = sessions.filter((s) => s.status === "open").length;
  const closedToday = sessions.filter((s) => {
    if (!s.closedAt) return false;
    return new Date(s.closedAt).toDateString() === new Date().toDateString();
  }).length;
  const totalVariance = sessions.reduce((sum, s) => sum + (s.variance ?? 0), 0);

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader title="Cashier & Shift Report" subtitle="Register accountability, payment mix and manager-reviewed exceptions" />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Card className="border-[#F06418]/30 bg-[#FEF0E8]/40">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="w-10 h-10 rounded-lg bg-[#FEF0E8] flex items-center justify-center flex-shrink-0">
              <KeyRound className="w-5 h-5 text-[#F06418]" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-bold text-[#1A1A16]">Your manager override PIN</p>
              <p className="text-xs text-[#7A7A72]">
                What you type at the terminal to approve a cashier&apos;s void, refund or over-limit discount. 4–6 digits, set for your own account only.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="New PIN"
                className="w-28"
              />
              <Button size="sm" disabled={pinSaving} onClick={() => void handleSetPin()}>
                {pinSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save PIN"}
              </Button>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard title="Open Shifts" value={openCount} icon={Clock} />
          <StatsCard title="Closed Today" value={closedToday} icon={CheckCircle2} iconColor="text-green-700" iconBg="bg-green-50" />
          <StatsCard
            title="Cash Variance"
            value={formatPKR(totalVariance)}
            icon={AlertTriangle}
            iconColor={totalVariance === 0 ? "text-green-700" : "text-amber-700"}
            iconBg={totalVariance === 0 ? "bg-green-50" : "bg-amber-50"}
          />
          <StatsCard title="Pending Approvals" value={approvals.length} icon={ShieldAlert} iconColor="text-amber-700" iconBg="bg-amber-50" />
        </div>

        <Card padding={false}>
          <div className="p-5 border-b border-[#E4E4DE] flex items-center justify-between">
            <CardHeader title="Shifts" subtitle="Every cashier session, most recent first" />
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              <RefreshCw className="w-4 h-4" /> Refresh
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E4E4DE] text-left text-xs font-semibold text-[#7A7A72] uppercase tracking-wide">
                  <th className="px-4 py-3">Cashier</th>
                  <th className="px-4 py-3">Opened</th>
                  <th className="px-4 py-3">Closed</th>
                  <th className="px-4 py-3 text-right">Orders</th>
                  <th className="px-4 py-3 text-right">Expected</th>
                  <th className="px-4 py-3 text-right">Counted</th>
                  <th className="px-4 py-3 text-right">Variance</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-[#7A7A72]">Loading…</td></tr>
                ) : sessions.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-[#7A7A72]">No shifts yet.</td></tr>
                ) : (
                  sessions.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => setSelected(s)}
                      className={cn(
                        "border-b border-[#E4E4DE] last:border-0 cursor-pointer transition-colors",
                        selected?.id === s.id ? "bg-[#FEF0E8]" : "hover:bg-[#F7F6F3]"
                      )}
                    >
                      <td className="px-4 py-3 font-semibold text-[#1A1A16]">{s.cashierName}</td>
                      <td className="px-4 py-3 text-[#4A4A44] text-xs whitespace-nowrap">{formatDateTime(s.openedAt)}</td>
                      <td className="px-4 py-3 text-[#4A4A44] text-xs whitespace-nowrap">{s.closedAt ? formatDateTime(s.closedAt) : "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{s.orderCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{s.expectedCash != null ? formatPKR(s.expectedCash) : "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{s.countedCash != null ? formatPKR(s.countedCash) : "—"}</td>
                      <td className={cn("px-4 py-3 text-right font-semibold tabular-nums", s.variance === 0 ? "text-green-700" : s.variance ? "text-amber-700" : "text-[#7A7A72]")}>
                        {s.variance != null ? `${s.variance > 0 ? "+" : ""}${formatPKR(s.variance)}` : "Open"}
                      </td>
                      <td className="px-4 py-3">
                        {s.status === "open" && <Badge variant="pending">Open</Badge>}
                        {s.status === "closed" && <Badge variant="partial">Closed</Badge>}
                        {s.status === "reviewed" && <Badge variant="active">Reviewed</Badge>}
                      </td>
                      <td className="px-4 py-3">
                        {s.status === "closed" && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={reviewingId === s.id}
                            onClick={(e) => { e.stopPropagation(); void handleReview(s.id); }}
                          >
                            {reviewingId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                            Review &amp; Lock
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {selected && (
          <Card>
            <CardHeader
              title="Payment Mix"
              subtitle={`${selected.cashierName} · ${formatDateTime(selected.openedAt)}`}
            />
            <div className="divide-y divide-[#E4E4DE]">
              {Object.entries(selected.paymentMethodTotals).length === 0 ? (
                <p className="py-3 text-sm text-[#7A7A72]">No payments recorded yet.</p>
              ) : (
                Object.entries(selected.paymentMethodTotals).map(([method, amount]) => (
                  <div key={method} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-[#4A4A44]">{method}</span>
                    <span className="font-semibold text-[#1A1A16] tabular-nums">{formatPKR(amount)}</span>
                  </div>
                ))
              )}
            </div>
          </Card>
        )}

        <Card padding={false}>
          <div className="p-5 border-b border-[#E4E4DE] flex items-center justify-between">
            <CardHeader title="Exceptions & Approvals" subtitle="Refunds, voids and over-limit discounts awaiting a decision" />
            <Badge variant="pending">Manager controlled</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E4E4DE] text-left text-xs font-semibold text-[#7A7A72] uppercase tracking-wide">
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Requested by</th>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {approvals.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-[#7A7A72]">Nothing pending.</td></tr>
                ) : (
                  approvals.map((a) => (
                    <tr key={a.id} className="border-b border-[#E4E4DE] last:border-0">
                      <td className="px-4 py-3">
                        <Badge variant={a.type === "void" ? "rejected" : a.type === "refund" ? "partial" : "expiring"}>
                          {a.type === "discount_over_limit" ? "Discount" : a.type.charAt(0).toUpperCase() + a.type.slice(1)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-semibold text-[#1A1A16] tabular-nums">
                        {a.orderNo ? `#${a.orderNo}` : "—"}
                        {a.orderAmount != null && <span className="ml-1 text-xs text-[#7A7A72] font-normal">{formatPKR(a.orderAmount)}</span>}
                        {a.valuePercent != null && <span className="ml-1 text-xs text-[#7A7A72] font-normal">{a.valuePercent.toFixed(1)}%</span>}
                      </td>
                      <td className="px-4 py-3 text-[#4A4A44]">{a.reason}</td>
                      <td className="px-4 py-3 text-[#4A4A44]">{a.requestedByName}</td>
                      <td className="px-4 py-3 text-[#7A7A72] text-xs whitespace-nowrap">{formatDateTime(a.requestedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            disabled={resolvingId === a.id || a.type === "discount_over_limit"}
                            onClick={() => void handleResolve(a, "approve")}
                          >
                            {resolvingId === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Approve"}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={resolvingId === a.id}
                            onClick={() => void handleResolve(a, "reject")}
                          >
                            Reject
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="bg-[#1A1A1A] rounded-xl p-5 text-white text-sm">
          <p className="font-semibold text-[#F06418] uppercase text-xs tracking-wide mb-1">Shift reconciliation rule</p>
          <p className="text-white/80">
            Opening cash + cash sales − cash refunds = expected cash. The cashier enters counted cash at
            close; the system records the variance and keeps the shift immutable once a manager reviews it.
          </p>
        </div>
      </div>
    </div>
  );
}
