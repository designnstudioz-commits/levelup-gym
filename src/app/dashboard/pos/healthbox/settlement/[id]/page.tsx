"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { useCurrentUser } from "@/contexts/CurrentUserContext";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatPKR } from "@/lib/utils";
import { SETTLEMENT_STATUS_LABELS, type SettlementStatus } from "@/lib/pos/reports";

interface Settlement {
  id: string; period_type: string; period_start: string; period_end: string;
  gross_sales: number; total_discounts: number; net_sales: number;
  approved_cogs: number; approved_operating: number; approved_expenses: number;
  net_profit: number; levelup_share: number; healthbox_share: number; is_loss: boolean; loss_amount: number;
  status: SettlementStatus; note: string | null; paid_at: string | null; payment_method: string | null;
}
interface Preview {
  grossSales: number; discounts: number; netSales: number; approvedExpensesTotal: number;
  netProfit: number; levelupShare: number; healthboxShare: number; isLoss: boolean;
  conflictingOrders: number; conflictingExpenses: number;
}

function Row({ label, value, bold, negative }: { label: string; value: string; bold?: boolean; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={bold ? "text-sm font-bold text-[#1A1A16]" : "text-sm text-[#4A4A44]"}>{label}</span>
      <span className={`text-sm tabular-nums ${bold ? "font-bold" : ""} ${negative ? "text-red-600" : "text-[#1A1A16]"}`}>{value}</span>
    </div>
  );
}

export default function SettlementDetailPage() {
  useRoleGuard(["owner", "manager"]);
  const isOwner = useCurrentUser()?.role === "owner";
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentReference, setPaymentReference] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pos/settlements/${params.id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not load this settlement");
      setSettlement(json.settlement);
      setPreview(json.preview);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load this settlement");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { void load(); }, [load]);

  async function handleRecalculate() {
    setBusy(true);
    try {
      const res = await fetch(`/api/pos/settlements/${params.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recalculate: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not recalculate");
      toast.success("Recalculated");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not recalculate");
    } finally {
      setBusy(false);
    }
  }

  async function handleStatus(status: "ready" | "draft") {
    setBusy(true);
    try {
      const res = await fetch(`/api/pos/settlements/${params.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not update status");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update status");
    } finally {
      setBusy(false);
    }
  }

  async function handleFinalize() {
    if (!confirm("Finalize this settlement? This locks in the totals and claims every included order and approved expense — it cannot be undone here.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/pos/settlements/${params.id}/finalize`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not finalize");
      toast.success("Settlement finalised");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not finalize");
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkPaid() {
    if (!confirm("Mark this settlement as paid?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/pos/settlements/${params.id}/paid`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: paymentMethod || undefined, paymentReference: paymentReference || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not mark paid");
      toast.success("Marked as paid");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not mark paid");
    } finally {
      setBusy(false);
    }
  }

  const s = settlement;
  const isDraftOrReady = s && (s.status === "draft" || s.status === "ready");
  const display = isDraftOrReady && preview ? {
    gross: preview.grossSales, discounts: preview.discounts, net: preview.netSales, expenses: preview.approvedExpensesTotal,
    profit: preview.netProfit, levelup: preview.levelupShare, healthbox: preview.healthboxShare, isLoss: preview.isLoss,
  } : s ? {
    gross: s.gross_sales, discounts: s.total_discounts, net: s.net_sales, expenses: s.approved_expenses,
    profit: s.net_profit, levelup: s.levelup_share, healthbox: s.healthbox_share, isLoss: s.is_loss,
  } : null;

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title={s ? `Settlement: ${s.period_start} → ${s.period_end}` : "Settlement"}
        subtitle={s ? `Status: ${SETTLEMENT_STATUS_LABELS[s.status]}${isDraftOrReady ? " — figures below are a live preview until finalised" : " — figures below are the frozen, finalised snapshot"}` : ""}
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => router.push("/dashboard/pos/healthbox/settlement")}>Back</Button>
            <Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</Button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {loading || !s || !display ? (
          <p className="text-sm text-[#7A7A72]">Loading…</p>
        ) : (
          <>
            {isDraftOrReady && preview && (preview.conflictingOrders > 0 || preview.conflictingExpenses > 0) && (
              <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">
                  This period overlaps {preview.conflictingOrders} order(s) and {preview.conflictingExpenses} expense(s) already claimed by another settlement. Finalizing will fail until this is resolved.
                </p>
              </div>
            )}

            <Card>
              <CardHeader title="Calculation" subtitle="Gross Sales − Discounts = Net Sales. Net Sales − Approved Expenses = Net Profit/Loss." />
              <div className="mt-3 divide-y divide-[#E4E4DE]">
                <Row label="Gross Sales" value={formatPKR(display.gross)} />
                <Row label="Discounts" value={`- ${formatPKR(display.discounts)}`} />
                <Row label="Net Sales" value={formatPKR(display.net)} bold />
                <Row label="Approved Expenses" value={`- ${formatPKR(display.expenses)}`} />
                <Row label={display.isLoss ? "Net Loss" : "Net Profit"} value={formatPKR(display.profit)} bold negative={display.isLoss} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 bg-[#F7F6F3] rounded-lg p-4">
                <div>
                  <p className="text-xs text-[#7A7A72]">Level Up Share</p>
                  <p className="text-xl font-bold">{formatPKR(display.levelup)}</p>
                </div>
                <div>
                  <p className="text-xs text-[#7A7A72]">HealthBox Share {display.isLoss && "(loss — HealthBox's responsibility)"}</p>
                  <p className={`text-xl font-bold ${display.isLoss ? "text-red-600" : ""}`}>{formatPKR(display.healthbox)}</p>
                </div>
              </div>
            </Card>

            {isDraftOrReady && (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void handleRecalculate()} disabled={busy}>Recalculate</Button>
                {s.status === "draft" && <Button variant="secondary" onClick={() => void handleStatus("ready")} disabled={busy}>Mark Ready</Button>}
                {s.status === "ready" && <Button variant="secondary" onClick={() => void handleStatus("draft")} disabled={busy}>Back to Draft</Button>}
                {isOwner ? (
                  <Button onClick={() => void handleFinalize()} disabled={busy}>Finalize Settlement</Button>
                ) : (
                  <span className="text-xs text-[#7A7A72] self-center">Only an Owner can finalize a settlement.</span>
                )}
              </div>
            )}

            {s.status === "finalised" && (
              <Card>
                <CardHeader title="Mark as Paid" />
                {isOwner ? (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Input label="Payment Method" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder="e.g. Bank Transfer" />
                      <Input label="Payment Reference" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="Optional" />
                    </div>
                    <Button onClick={() => void handleMarkPaid()} disabled={busy}>Mark Paid</Button>
                  </div>
                ) : (
                  <p className="text-xs text-[#7A7A72] mt-2">Only an Owner can mark a settlement as paid.</p>
                )}
              </Card>
            )}

            {s.status === "paid" && (
              <Card>
                <div className="flex items-center gap-2">
                  <Badge variant="active">Paid</Badge>
                  {s.payment_method && <span className="text-sm text-[#4A4A44]">via {s.payment_method}</span>}
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
