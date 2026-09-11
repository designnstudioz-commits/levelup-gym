"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, RefreshCw, Wallet } from "lucide-react";
import { useCurrentUser } from "@/contexts/CurrentUserContext";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { formatPKR } from "@/lib/utils";
import { SETTLEMENT_STATUS_LABELS, type SettlementStatus } from "@/lib/pos/reports";

interface SettlementRow {
  id: string; period_type: string; period_start: string; period_end: string;
  net_sales: number; approved_expenses: number; net_profit: number; levelup_share: number; healthbox_share: number;
  is_loss: boolean; status: SettlementStatus; created_at: string;
}

const STATUS_BADGE: Record<SettlementStatus, "inactive" | "pending" | "active" | "approved"> = {
  draft: "inactive", ready: "pending", finalised: "active", paid: "approved",
};

export default function SettlementListPage() {
  useRoleGuard(["owner", "manager"]);
  const isOwner = useCurrentUser()?.role === "owner";

  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [periodType, setPeriodType] = useState<"weekly" | "monthly">("monthly");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pos/settlements");
      const json = await res.json();
      setSettlements(json.settlements ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate() {
    if (!periodStart || !periodEnd) { toast.error("Choose a period start and end"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/pos/settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodType, periodStart, periodEnd }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not create the settlement");
      toast.success("Draft settlement created");
      setModalOpen(false);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the settlement");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="HealthBox Settlement"
        subtitle={isOwner ? "Review, finalize and mark settlements paid" : "Review and prepare settlements — finalizing is owner-only"}
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</Button>
            <Button size="sm" onClick={() => setModalOpen(true)}><Plus className="w-4 h-4" /> New Settlement</Button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E4E4DE] text-left text-xs font-semibold text-[#7A7A72] uppercase tracking-wide">
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3 text-right">Net Sales</th>
                  <th className="px-4 py-3 text-right">Approved Expenses</th>
                  <th className="px-4 py-3 text-right">Net Result</th>
                  <th className="px-4 py-3 text-right">HealthBox Share</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-[#7A7A72]">Loading…</td></tr>
                ) : settlements.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-14 text-center text-[#7A7A72]"><Wallet className="w-8 h-8 mx-auto text-[#CFCEC6] mb-2" />No settlements yet.</td></tr>
                ) : (
                  settlements.map((s) => (
                    <tr key={s.id} className="border-b border-[#E4E4DE] last:border-0 hover:bg-[#F7F6F3]">
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/pos/healthbox/settlement/${s.id}`} className="font-semibold text-[#1A1A16] hover:text-[#F06418]">
                          {s.period_start} → {s.period_end}
                        </Link>
                        <p className="text-xs text-[#7A7A72]">{s.period_type}</p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatPKR(s.net_sales)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatPKR(s.approved_expenses)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums font-semibold ${s.is_loss ? "text-red-600" : ""}`}>{formatPKR(s.net_profit)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatPKR(s.healthbox_share)}</td>
                      <td className="px-4 py-3"><Badge variant={STATUS_BADGE[s.status]}>{SETTLEMENT_STATUS_LABELS[s.status]}</Badge></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Settlement" size="sm">
        <div className="space-y-4">
          <Select label="Frequency" value={periodType} onChange={(e) => setPeriodType(e.target.value as "weekly" | "monthly")}>
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#4A4A44] mb-1">Period Start</label>
              <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-[#E4E4DE] text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#4A4A44] mb-1">Period End</label>
              <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-[#E4E4DE] text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleCreate()} disabled={saving}>{saving ? "Creating…" : "Create Draft"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
