"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Percent, Wallet, TrendingUp, Users, UserCheck, Clock,
  ChevronLeft, ChevronRight, CheckCircle, RefreshCw, X, Search,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/contexts/CurrentUserContext";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { StatsCard } from "@/components/ui/StatsCard";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { formatDate, formatPKR, safeDateValue } from "@/lib/utils";
import { computeCommissionCycle, stepCycle, currentAndNextCycle, formatCycleLabel, backfillCommissionLedger } from "@/lib/commission";
import type { TrainerCommissionLedger, StaffMember, TrainerMemberCommission } from "@/types/database";

interface LedgerRow extends TrainerCommissionLedger {
  member?: { id: string; full_name: string; membership_no: string } | null;
  trainer?: { id: string; full_name: string } | null;
}

type Cycle = { cycleStart: string; cycleEnd: string; payoutDate: string };

export default function CommissionsPage() {
  useRoleGuard(["owner", "manager"]);
  const currentUser = useCurrentUser();

  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [trainers, setTrainers] = useState<StaffMember[]>([]);
  const [commissionableCount, setCommissionableCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);

  const [cycle, setCycle] = useState<Cycle>(() => currentAndNextCycle().current);
  const [showAllCycles, setShowAllCycles] = useState(false);
  const [trainerFilter, setTrainerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "paid">("all");
  const [memberSearch, setMemberSearch] = useState("");

  const [detailTrainerId, setDetailTrainerId] = useState<string | null>(null);
  const [markPaidIds, setMarkPaidIds] = useState<string[] | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const [{ data: ledgerRows }, { data: trainerRows }, { data: rateRows }, { data: eligibleMembers }] = await Promise.all([
      supabase
        .from("trainer_commission_ledger")
        .select("*, member:members(id, full_name, membership_no), trainer:staff_members(id, full_name)")
        .is("deleted_at", null)
        .order("cycle_start", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase.from("staff_members").select("*").eq("role", "Trainer").eq("status", "active").is("deleted_at", null).order("full_name"),
      supabase.from("trainer_member_commissions").select("member_id").is("deleted_at", null),
      supabase.from("members").select("id").not("trainer_id", "is", null).not("training_fee", "is", null).is("deleted_at", null),
    ]);
    const ratedMemberIds = new Set((rateRows ?? []).map((r) => r.member_id));
    const eligibleCount = (eligibleMembers ?? []).filter((m) => ratedMemberIds.has(m.id)).length;

    setLedger((ledgerRows ?? []) as unknown as LedgerRow[]);
    setTrainers((trainerRows ?? []) as StaffMember[]);
    setCommissionableCount(eligibleCount);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function runBackfill() {
    setBackfilling(true);
    try {
      const result = await backfillCommissionLedger();
      toast.success(`Generated ${result.created} new record${result.created !== 1 ? "s" : ""} (${result.scanned} payments scanned, ${result.skipped} already existed or weren't eligible)`);
      fetchAll();
    } catch (err) {
      console.error(err);
      toast.error("Backfill failed");
    } finally {
      setBackfilling(false);
    }
  }

  // ── Summary figures ────────────────────────────────────────────────
  const totalPending = ledger.filter((l) => l.status === "pending").reduce((s, l) => s + l.commission_amount, 0);
  const totalPaid = ledger.filter((l) => l.status === "paid").reduce((s, l) => s + (l.paid_amount ?? l.commission_amount), 0);
  const currentCycleTotal = ledger
    .filter((l) => l.cycle_start === currentAndNextCycle().current.cycleStart)
    .reduce((s, l) => s + l.commission_amount, 0);
  const pendingRows = ledger.filter((l) => l.status === "pending");
  const nextPayoutDate = pendingRows.length
    ? pendingRows.map((l) => l.payout_date).sort()[0]
    : null;
  const upcomingPayoutTotal = nextPayoutDate
    ? pendingRows.filter((l) => l.payout_date === nextPayoutDate).reduce((s, l) => s + l.commission_amount, 0)
    : 0;

  // ── Filtering ───────────────────────────────────────────────────────
  const filtered = ledger.filter((l) => {
    if (!showAllCycles && l.cycle_start !== cycle.cycleStart) return false;
    if (trainerFilter !== "all" && l.trainer_id !== trainerFilter) return false;
    if (statusFilter !== "all" && l.status !== statusFilter) return false;
    if (memberSearch) {
      const q = memberSearch.toLowerCase();
      if (!l.member?.full_name?.toLowerCase().includes(q) && !l.member?.membership_no?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Trainer Commissions"
        subtitle="What each trainer has earned, per PT member, per commission cycle"
        action={
          currentUser?.role === "owner" ? (
            <Button size="sm" variant="secondary" onClick={runBackfill} loading={backfilling}>
              <RefreshCw className="w-4 h-4" /> Generate Missing Records
            </Button>
          ) : undefined
        }
      />

      <div className="flex-1 p-6 space-y-5">
        {/* Summary */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatsCard title="Total Pending Commission" value={formatPKR(totalPending)} icon={Clock} iconColor="text-amber-600" iconBg="bg-amber-50" loading={loading} />
          <StatsCard title="Total Paid Commission" value={formatPKR(totalPaid)} icon={CheckCircle} iconColor="text-green-600" iconBg="bg-green-50" loading={loading} />
          <StatsCard title="Current Cycle Commission" value={formatPKR(currentCycleTotal)} icon={TrendingUp} iconColor="text-[#F06418]" iconBg="bg-[#FEF0E8]" loading={loading} />
          <StatsCard title="Upcoming Payout" value={nextPayoutDate ? `${formatPKR(upcomingPayoutTotal)}` : "—"} icon={Wallet} iconColor="text-blue-600" iconBg="bg-blue-50" loading={loading} />
          <StatsCard title="Trainers" value={trainers.length} icon={Users} iconColor="text-purple-600" iconBg="bg-purple-50" loading={loading} />
          <StatsCard title="Commissionable Members" value={commissionableCount} icon={UserCheck} iconColor="text-teal-600" iconBg="bg-teal-50" loading={loading} />
        </div>
        {nextPayoutDate && (
          <p className="text-xs text-[#7A7A72] -mt-3">Next payout due <span className="font-semibold text-[#1A1A16]">{formatDate(nextPayoutDate)}</span></p>
        )}

        {/* Cycle selector */}
        <div className="bg-white border border-[#E4E4DE] rounded-xl p-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <button onClick={() => setCycle(stepCycle(cycle.cycleStart, -1))} disabled={showAllCycles}
              className="p-2 rounded-lg border border-[#E4E4DE] text-[#4A4A44] hover:border-[#F06418] hover:text-[#F06418] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-center min-w-[220px]">
              <p className="text-base font-bold text-[#1A1A16]">{formatCycleLabel(cycle.cycleStart, cycle.cycleEnd)}</p>
              <p className="text-xs text-[#7A7A72]">Eligibility Period</p>
            </div>
            <button onClick={() => setCycle(stepCycle(cycle.cycleStart, 1))} disabled={showAllCycles}
              className="p-2 rounded-lg border border-[#E4E4DE] text-[#4A4A44] hover:border-[#F06418] hover:text-[#F06418] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="w-px h-10 bg-[#E4E4DE]" />
          <div>
            <p className="text-base font-bold text-[#F06418]">{formatDate(cycle.payoutDate)}</p>
            <p className="text-xs text-[#7A7A72]">Payout Date</p>
          </div>
          <label className="ml-auto flex items-center gap-2 text-xs font-medium text-[#4A4A44] cursor-pointer">
            <input type="checkbox" className="accent-[#F06418]" checked={showAllCycles} onChange={(e) => setShowAllCycles(e.target.checked)} />
            Show all cycles
          </label>
        </div>

        {/* Filters */}
        <div className="bg-white border border-[#E4E4DE] rounded-xl p-4 flex flex-wrap items-center gap-2">
          <select value={trainerFilter} onChange={(e) => setTrainerFilter(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-[#E4E4DE] bg-white text-[#4A4A44] focus:outline-none focus:ring-2 focus:ring-[#F06418]">
            <option value="all">All Trainers</option>
            {trainers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
          </select>
          <div className="flex bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg p-0.5 gap-0.5">
            {(["all", "pending", "paid"] as const).map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-colors ${statusFilter === s ? "bg-[#F06418] text-white" : "text-[#4A4A44] hover:bg-white"}`}
              >{s}</button>
            ))}
          </div>
          <div className="relative min-w-48">
            <Search className="w-4 h-4 text-[#7A7A72] absolute left-3 top-1/2 -translate-y-1/2" />
            <input type="text" placeholder="Search member..." value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
          </div>
          <span className="text-xs text-[#7A7A72] ml-auto">{filtered.length} record{filtered.length !== 1 ? "s" : ""}</span>
          <Button variant="ghost" size="sm" onClick={fetchAll}><RefreshCw className="w-4 h-4" /></Button>
        </div>

        {/* Table */}
        {loading ? (
          <div className="py-12 text-center text-sm text-[#7A7A72]">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center bg-white border border-[#E4E4DE] rounded-xl">
            <div className="w-14 h-14 bg-[#FEF0E8] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Percent className="w-7 h-7 text-[#F06418]" />
            </div>
            <p className="text-base font-semibold text-[#1A1A16]">No commission records for this view</p>
            <p className="text-sm text-[#7A7A72] mt-1">Try a different cycle, or generate missing records from historical payments.</p>
          </div>
        ) : (
          <div className="bg-white border border-[#E4E4DE] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#F8F8F6] border-b border-[#E4E4DE]">
                  <tr>
                    <th className="text-left text-xs font-semibold text-[#7A7A72] px-5 py-3 whitespace-nowrap">Member</th>
                    <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3 whitespace-nowrap">Trainer</th>
                    <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3 whitespace-nowrap">PTF</th>
                    <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3 whitespace-nowrap">Commission %</th>
                    <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3 whitespace-nowrap">Commission Earned</th>
                    <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3 whitespace-nowrap">Eligibility Date</th>
                    <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3 whitespace-nowrap">Commission Cycle</th>
                    <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3 whitespace-nowrap">Payout Date</th>
                    <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3 whitespace-nowrap">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E4DE]">
                  {filtered.map((l) => (
                    <tr key={l.id} className="hover:bg-[#F8F8F6] transition-colors">
                      <td className="px-5 py-3">
                        <p className="text-sm font-semibold text-[#1A1A16] whitespace-nowrap">{l.member?.full_name ?? "—"}</p>
                        <p className="text-[10px] text-[#7A7A72] font-mono">{l.member?.membership_no ?? "—"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => setDetailTrainerId(l.trainer_id)} className="text-sm font-medium text-[#F06418] hover:underline whitespace-nowrap">
                          {l.trainer?.full_name ?? "—"}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-sm text-[#1A1A16] whitespace-nowrap">{formatPKR(l.pt_fee)}</td>
                      <td className="px-4 py-3 text-sm text-[#4A4A44] whitespace-nowrap">
                        {l.commission_type === "fixed" ? "Flat" : `${l.commission_percent}%`}
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-green-700 whitespace-nowrap">{formatPKR(l.commission_amount)}</td>
                      <td className="px-4 py-3 text-sm text-[#4A4A44] whitespace-nowrap">{formatDate(l.qualifying_date)}</td>
                      <td className="px-4 py-3 text-xs text-[#4A4A44] whitespace-nowrap">{formatCycleLabel(l.cycle_start, l.cycle_end)}</td>
                      <td className="px-4 py-3 text-sm text-[#4A4A44] whitespace-nowrap">{formatDate(l.payout_date)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${l.status === "paid" ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                          {l.status === "paid" ? "Paid" : "Pending"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {l.status === "pending" && (
                          <button onClick={() => setMarkPaidIds([l.id])}
                            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#FEF0E8] text-[#F06418] border border-[#FDDCC8] hover:bg-[#F06418] hover:text-white transition-colors whitespace-nowrap">
                            Mark Paid
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {detailTrainerId && (
        <TrainerDetailDrawer
          trainerId={detailTrainerId}
          onClose={() => setDetailTrainerId(null)}
          onMarkPaid={(ids) => setMarkPaidIds(ids)}
          onChanged={fetchAll}
        />
      )}

      {markPaidIds && (
        <MarkPaidModal
          ledgerIds={markPaidIds}
          rows={ledger.filter((l) => markPaidIds.includes(l.id))}
          onClose={() => setMarkPaidIds(null)}
          onSaved={() => { setMarkPaidIds(null); fetchAll(); }}
        />
      )}
    </div>
  );
}

// ── Mark as Paid ─────────────────────────────────────────────────────
function MarkPaidModal({ ledgerIds, rows, onClose, onSaved }: {
  ledgerIds: string[];
  rows: LedgerRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const currentUser = useCurrentUser();
  const totalDue = rows.reduce((s, r) => s + r.commission_amount, 0);
  const [paidDate, setPaidDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paidAmount, setPaidAmount] = useState(String(totalDue));
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!paidDate) { toast.error("Enter a paid date"); return; }
    setSaving(true);
    const supabase = createClient();
    // Distribute the total paid amount across rows proportionally to what
    // each row earned — Earned (commission_amount) is never touched; only
    // status/paid_* fields change.
    const amountNum = Number(paidAmount) || 0;
    for (const row of rows) {
      const share = totalDue > 0 ? Math.round((row.commission_amount / totalDue) * amountNum) : 0;
      await supabase.from("trainer_commission_ledger").update({
        status: "paid",
        paid_date: paidDate,
        paid_amount: rows.length === 1 ? amountNum : share,
        payout_reference: reference || null,
        processed_by: currentUser?.id ?? null,
      }).eq("id", row.id);
    }
    await supabase.from("activity_logs").insert({
      user_id: currentUser?.id ?? null,
      action: "paid_commission",
      entity_type: "trainer_commission_ledger",
      entity_id: rows[0]?.id ?? null,
      description: `Marked ${rows.length} commission record${rows.length !== 1 ? "s" : ""} as paid (${formatPKR(amountNum)}) — trainer ${rows[0]?.trainer?.full_name ?? "—"}`,
      metadata: { ledger_ids: ledgerIds, paid_date: paidDate, paid_amount: amountNum, reference },
    });
    toast.success("Commission marked as paid");
    setSaving(false);
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={`Mark ${rows.length > 1 ? `${rows.length} Records` : "Commission"} as Paid`} size="sm">
      <div className="p-5 space-y-4">
        <div className="bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg px-4 py-3 space-y-1">
          {rows.map((r) => (
            <div key={r.id} className="flex justify-between text-xs text-[#4A4A44]">
              <span>{r.member?.full_name ?? "—"} · {formatCycleLabel(r.cycle_start, r.cycle_end)}</span>
              <span className="font-semibold">{formatPKR(r.commission_amount)}</span>
            </div>
          ))}
          <div className="flex justify-between text-sm font-bold pt-1.5 border-t border-[#E4E4DE]">
            <span>Total Earned</span><span>{formatPKR(totalDue)}</span>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-[#1A1A16] block mb-1.5">Paid Date <span className="text-[#F06418]">*</span></label>
          <input type="date" value={paidDate} min="1900-01-01" max="2099-12-31"
            onChange={(e) => { const v = safeDateValue(e.target.value); if (v) setPaidDate(v); }}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
        </div>
        <Input label="Amount Paid (Rs)" type="number" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} />
        <Input label="Payout Reference (optional)" placeholder="e.g. bank transfer ref, cheque no." value={reference} onChange={(e) => setReference(e.target.value)} />
        <p className="text-xs text-[#7A7A72]">Processed by {currentUser?.full_name ?? "—"}. The original earned amount stays on record — this only records that it's been paid.</p>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button onClick={save} loading={saving} className="flex-1">Confirm Paid</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Trainer Detail ────────────────────────────────────────────────────
function TrainerDetailDrawer({ trainerId, onClose, onMarkPaid, onChanged }: {
  trainerId: string;
  onClose: () => void;
  onMarkPaid: (ids: string[]) => void;
  onChanged: () => void;
}) {
  const [trainer, setTrainer] = useState<StaffMember | null>(null);
  const [rates, setRates] = useState<(TrainerMemberCommission & { member?: { full_name: string; membership_no: string } | null })[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fetchTrainer = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const [{ data: t }, { data: rateRows }, { data: ledgerRows }] = await Promise.all([
      supabase.from("staff_members").select("*").eq("id", trainerId).single(),
      supabase.from("trainer_member_commissions").select("*, member:members(full_name, membership_no)").eq("trainer_id", trainerId).is("deleted_at", null),
      supabase.from("trainer_commission_ledger").select("*, member:members(id, full_name, membership_no), trainer:staff_members(id, full_name)").eq("trainer_id", trainerId).is("deleted_at", null).order("cycle_start", { ascending: false }),
    ]);
    setTrainer(t as StaffMember);
    setRates((rateRows ?? []) as any);
    setLedger((ledgerRows ?? []) as unknown as LedgerRow[]);
    setLoading(false);
  }, [trainerId]);

  useEffect(() => { fetchTrainer(); }, [fetchTrainer]);

  const pending = ledger.filter((l) => l.status === "pending");
  const paid = ledger.filter((l) => l.status === "paid");
  const outstandingTotal = pending.reduce((s, l) => s + l.commission_amount, 0);
  const paidTotal = paid.reduce((s, l) => s + (l.paid_amount ?? l.commission_amount), 0);
  const { current } = currentAndNextCycle();
  const currentCycleTotal = ledger.filter((l) => l.cycle_start === current.cycleStart).reduce((s, l) => s + l.commission_amount, 0);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <Modal open onClose={onClose} title={trainer?.full_name ?? "Trainer"} size="lg">
      <div className="p-5 space-y-5">
        {loading ? (
          <div className="py-10 text-center text-sm text-[#7A7A72]">Loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg px-3 py-3 text-center">
                <p className="text-lg font-bold text-[#F06418]">{formatPKR(currentCycleTotal)}</p>
                <p className="text-[11px] text-[#7A7A72]">Current Cycle</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 text-center">
                <p className="text-lg font-bold text-amber-700">{formatPKR(outstandingTotal)}</p>
                <p className="text-[11px] text-[#7A7A72]">Outstanding</p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-3 text-center">
                <p className="text-lg font-bold text-green-700">{formatPKR(paidTotal)}</p>
                <p className="text-[11px] text-[#7A7A72]">Paid</p>
              </div>
            </div>

            {/* Current commission configuration */}
            <div>
              <p className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide mb-2">Current Commission Configuration — Assigned PT Members</p>
              {rates.length === 0 ? (
                <p className="text-sm text-[#7A7A72]">No PT members with a commission rate configured yet.</p>
              ) : (
                <div className="rounded-xl border border-[#E4E4DE] divide-y divide-[#E4E4DE]">
                  {rates.map((r) => (
                    <div key={r.id} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <p className="text-sm font-semibold text-[#1A1A16]">{r.member?.full_name ?? "—"}</p>
                        <p className="text-[10px] text-[#7A7A72] font-mono">{r.member?.membership_no ?? "—"}</p>
                      </div>
                      <span className="text-sm font-bold text-[#F06418]">
                        {r.commission_type === "fixed" ? `${formatPKR(r.commission_amount)} flat` : `${r.commission_percent}%`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Outstanding */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide">Outstanding Commission</p>
                {selected.size > 0 && (
                  <Button size="sm" onClick={() => onMarkPaid([...selected])}>Mark {selected.size} Selected as Paid</Button>
                )}
              </div>
              {pending.length === 0 ? (
                <p className="text-sm text-[#7A7A72]">Nothing outstanding.</p>
              ) : (
                <div className="rounded-xl border border-[#E4E4DE] divide-y divide-[#E4E4DE]">
                  {pending.map((l) => (
                    <label key={l.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-[#F8F8F6]">
                      <input type="checkbox" className="accent-[#F06418]" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#1A1A16] truncate">{l.member?.full_name ?? "—"}</p>
                        <p className="text-[11px] text-[#7A7A72]">{formatCycleLabel(l.cycle_start, l.cycle_end)} · Payout {formatDate(l.payout_date)}</p>
                      </div>
                      <span className="text-sm font-bold text-amber-700 flex-shrink-0">{formatPKR(l.commission_amount)}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Historical / paid */}
            <div>
              <p className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide mb-2">Historical Commission</p>
              {ledger.length === 0 ? (
                <p className="text-sm text-[#7A7A72]">No commission history yet.</p>
              ) : (
                <div className="rounded-xl border border-[#E4E4DE] divide-y divide-[#E4E4DE] max-h-64 overflow-y-auto">
                  {ledger.map((l) => (
                    <div key={l.id} className="flex items-center justify-between px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#1A1A16] truncate">{l.member?.full_name ?? "—"}</p>
                        <p className="text-[11px] text-[#7A7A72]">{formatCycleLabel(l.cycle_start, l.cycle_end)}{l.status === "paid" && l.paid_date ? ` · Paid ${formatDate(l.paid_date)}` : ""}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-sm font-bold text-[#1A1A16]">{formatPKR(l.commission_amount)}</span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${l.status === "paid" ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                          {l.status === "paid" ? "Paid" : "Pending"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
