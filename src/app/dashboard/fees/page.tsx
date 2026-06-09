"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { format, subDays, startOfMonth, endOfMonth, startOfWeek, subMonths } from "date-fns";
import { toast } from "sonner";
import {
  CreditCard, TrendingUp, AlertTriangle, CheckCircle,
  Search, RefreshCw, X, Plus, Receipt, Tag,
  Minus, ChevronDown, Calendar, Users, Banknote,
  ArrowRight, Clock, Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { StatsCard } from "@/components/ui/StatsCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card } from "@/components/ui/Card";
import { formatDate, formatPKR, daysUntilExpiry, generateReceiptNo, getMemberStatusDisplay } from "@/lib/utils";
import Link from "next/link";
import type { FeePayment, Member, Package } from "@/types/database";

// ── Types ────────────────────────────────────────────────────────────
type Tab = "overview" | "transactions" | "outstanding" | "analytics";
type DateRange = "thisMonth" | "lastMonth" | "3months" | "alltime" | "custom";

interface PaymentRow extends FeePayment {
  member?: { id: string; full_name: string; membership_no: string; photo_url: string | null } | null;
  packages?: { name: string; color: string | null } | null;
}

interface MemberWithPackage extends Member {
  packages?: { name: string; monthly_fee: number; color: string | null } | null;
}

const PAYMENT_METHODS = ["Cash", "Bank", "Card", "EasyPaisa", "JazzCash"];
const TYPE_LABELS: Record<string, string> = {
  membership:    "Monthly Membership",
  trainer:       "Trainer Fee",
  admission:     "Admission Fee",
  nutritionist:  "Nutritionist Fee",
  physiotherapy: "Physiotherapy Fee",
  other:         "Other",
};
const TYPE_COLORS: Record<string, string> = {
  membership:    "bg-[#FEF0E8] text-[#C04E10] border-[#FDDCC8]",
  trainer:       "bg-blue-50 text-blue-700 border-blue-200",
  admission:     "bg-purple-50 text-purple-700 border-purple-200",
  nutritionist:  "bg-green-50 text-green-700 border-green-200",
  physiotherapy: "bg-teal-50 text-teal-700 border-teal-200",
  other:         "bg-gray-100 text-gray-600 border-gray-200",
};

// ── Main Page ────────────────────────────────────────────────────────
export default function FeesPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");

  // Shared data
  const [payments, setPayments]           = useState<PaymentRow[]>([]);
  const [members, setMembers]             = useState<MemberWithPackage[]>([]);
  const [recentPayments30, setRecentP30]  = useState<{ member_id: string }[]>([]);
  const [loading, setLoading]             = useState(true);

  // Transactions filters
  const [txDateRange, setTxDateRange]         = useState<DateRange>("thisMonth");
  const [txCustomFrom, setTxCustomFrom]       = useState("");
  const [txCustomTo, setTxCustomTo]           = useState("");
  const [txSearch, setTxSearch]               = useState("");
  const [txTypeFilter, setTxTypeFilter]       = useState("all");
  const [txMethodFilter, setTxMethodFilter]   = useState("all");

  // Quick Collect
  const [collectModal, setCollectModal]       = useState(false);
  const [memberSearch, setMemberSearch]       = useState("");
  const [memberResults, setMemberResults]     = useState<MemberWithPackage[]>([]);
  const [selectedMember, setSelectedMember]   = useState<MemberWithPackage | null>(null);
  const [feeAmount, setFeeAmount]             = useState("");
  const [feeType, setFeeType]                 = useState("membership");
  const [feeMethod, setFeeMethod]             = useState("Cash");
  const [feeNote, setFeeNote]                 = useState("");
  const [discountType, setDiscountType]       = useState<"none" | "percent" | "amount">("none");
  const [discountValue, setDiscountValue]     = useState("");
  const [collectSaving, setCollectSaving]     = useState(false);
  const [alreadyPaidWarning, setAlreadyPaidWarning] = useState(false);

  // ── Discount computed ───────────────────────────────────────────
  const originalAmount = Number(feeAmount) || 0;
  const discountAmount =
    discountType === "percent" ? Math.round((originalAmount * (Number(discountValue) || 0)) / 100) :
    discountType === "amount"  ? Math.min(Number(discountValue) || 0, originalAmount) : 0;
  const finalAmount    = Math.max(originalAmount - discountAmount, 0);
  const discountPct    = discountType === "percent" ? Number(discountValue) || 0 :
    originalAmount > 0 ? Math.round((discountAmount / originalAmount) * 100) : 0;

  // ── Date bounds ─────────────────────────────────────────────────
  function getTxBounds() {
    const today = new Date();
    if (txDateRange === "thisMonth")  return { from: format(startOfMonth(today), "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
    if (txDateRange === "lastMonth") {
      const last = subMonths(today, 1);
      return { from: format(startOfMonth(last), "yyyy-MM-dd"), to: format(endOfMonth(last), "yyyy-MM-dd") };
    }
    if (txDateRange === "3months") return { from: format(startOfMonth(subMonths(today, 2)), "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
    if (txDateRange === "alltime")  return { from: "2020-01-01", to: format(today, "yyyy-MM-dd") };
    if (txDateRange === "custom" && txCustomFrom && txCustomTo) return { from: txCustomFrom, to: txCustomTo };
    return { from: format(startOfMonth(today), "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
  }

  // ── Fetch ────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { from, to } = getTxBounds();
    const supabase = createClient();
    const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");

    const [{ data: pays }, { data: mems }, { data: rp }] = await Promise.all([
      supabase.from("fee_payments")
        .select("*, member:members!fee_payments_member_id_fkey(id, full_name, membership_no, photo_url, packages(name, color))")
        .is("deleted_at", null)
        .gte("payment_date", from)
        .lte("payment_date", to)
        .order("payment_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase.from("members")
        .select("*, packages(name, monthly_fee, color)")
        .eq("status", "active")
        .is("deleted_at", null)
        .order("full_name"),
      supabase.from("fee_payments")
        .select("member_id")
        .gte("payment_date", thirtyDaysAgo)
        .is("deleted_at", null),
    ]);

    setPayments((pays ?? []) as unknown as PaymentRow[]);
    setMembers((mems ?? []) as unknown as MemberWithPackage[]);
    setRecentP30(rp ?? []);
    setLoading(false);
  }, [txDateRange, txCustomFrom, txCustomTo]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Member search for quick collect
  useEffect(() => {
    if (!memberSearch.trim()) { setMemberResults([]); return; }
    const q = memberSearch.toLowerCase();
    setMemberResults(
      members.filter((m) =>
        m.full_name.toLowerCase().includes(q) ||
        m.phone.includes(q) ||
        m.membership_no.toLowerCase().includes(q)
      ).slice(0, 5)
    );
  }, [memberSearch, members]);

  async function selectMember(m: MemberWithPackage) {
    setSelectedMember(m);
    setMemberSearch("");
    setMemberResults([]);
    setFeeAmount(String((m as any).packages?.monthly_fee ?? m.monthly_fee ?? ""));
    setFeeType("membership");
    setDiscountType("none");
    setDiscountValue("");
    // Check if already paid membership this month
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const supabase = createClient();
    const { count } = await supabase
      .from("fee_payments")
      .select("*", { count: "exact", head: true })
      .eq("member_id", m.id)
      .eq("payment_type", "membership")
      .gte("payment_date", monthStart)
      .is("deleted_at", null);
    setAlreadyPaidWarning((count ?? 0) > 0);
  }

  // ── Quick Collect submit ─────────────────────────────────────────
  async function handleCollect() {
    if (!selectedMember) { toast.error("Select a member first"); return; }
    if (!feeAmount || originalAmount <= 0) { toast.error("Enter a valid amount"); return; }
    setCollectSaving(true);
    try {
      const supabase = createClient();
      const receiptNo = await generateReceiptNo();
      const discountNote = discountAmount > 0
        ? `Discount: ${formatPKR(discountAmount)} (${discountPct}% off original ${formatPKR(originalAmount)})`
        : null;
      const fullNote = [discountNote, feeNote].filter(Boolean).join(" · ") || null;
      const today = format(new Date(), "yyyy-MM-dd");

      const { data: newPayment, error } = await supabase.from("fee_payments").insert({
        member_id: selectedMember.id,
        amount: finalAmount,
        payment_type: feeType as any,
        payment_method: feeMethod as any,
        payment_date: today,
        month_covered: feeType === "membership" ? today : null,
        receipt_no: receiptNo,
        note: fullNote,
      }).select("id").single();

      if (error) throw error;

      await supabase.from("activity_logs").insert({
        action: "paid_fee", entity_type: "member", entity_id: selectedMember.id,
        description: `${selectedMember.full_name} paid ${formatPKR(finalAmount)} (${feeType}) — ${receiptNo}`,
        metadata: { original: originalAmount, discount: discountAmount, final: finalAmount, receipt_no: receiptNo },
      });

      toast.success(`Payment recorded — ${receiptNo}`);
      setCollectModal(false);
      setSelectedMember(null); setMemberSearch(""); setFeeAmount(""); setFeeNote("");
      setDiscountType("none"); setDiscountValue("");
      setCollectSaving(false);
      fetchAll();
      router.push(`/dashboard/fees/receipt/${newPayment.id}`);
    } catch (err) {
      console.error(err); toast.error("Failed to record payment"); setCollectSaving(false);
    }
  }

  // ── Derived data ─────────────────────────────────────────────────
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const paidMemberIds = new Set(recentPayments30.map((p) => p.member_id));
  const expired       = members.filter((m) => m.expiry_date && m.expiry_date < todayStr);
  const unpaidActive  = members.filter((m) => (!m.expiry_date || m.expiry_date >= todayStr) && !paidMemberIds.has(m.id));
  const todayPayments = payments.filter((p) => p.payment_date === todayStr);
  const totalRevenue  = payments.reduce((s, p) => s + (p.amount ?? 0), 0);
  const todayRevenue  = todayPayments.reduce((s, p) => s + (p.amount ?? 0), 0);

  const txFiltered = payments.filter((p) => {
    if (txTypeFilter !== "all" && p.payment_type !== txTypeFilter) return false;
    if (txMethodFilter !== "all" && p.payment_method !== txMethodFilter) return false;
    if (txSearch) {
      const q = txSearch.toLowerCase();
      const m = (p as any).member;
      if (!m?.full_name?.toLowerCase().includes(q) && !m?.membership_no?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: "overview",     label: "Overview" },
    { key: "transactions", label: "Transactions", badge: payments.length },
    { key: "outstanding",  label: "Outstanding Dues", badge: expired.length + unpaidActive.length },
    { key: "analytics",   label: "Analytics" },
  ];

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Fees & Payments"
        subtitle="Collect fees, track payments, manage outstanding dues"
        action={
          <Button size="sm" onClick={() => { setCollectModal(true); setSelectedMember(null); setMemberSearch(""); }}>
            <Plus className="w-4 h-4" /> Collect Fee
          </Button>
        }
      />

      <div className="flex-1 p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard title="Revenue (This Period)" value={formatPKR(totalRevenue)} icon={Banknote} iconColor="text-[#F06418]" iconBg="bg-[#FEF0E8]" />
          <StatsCard title="Collected Today" value={formatPKR(todayRevenue)} icon={CheckCircle} iconColor="text-green-600" iconBg="bg-green-50" />
          <StatsCard title="Expired Members" value={expired.length} icon={AlertTriangle} iconColor="text-red-600" iconBg="bg-red-50" />
          <StatsCard title="Unpaid This Month" value={unpaidActive.length} icon={Clock} iconColor="text-amber-600" iconBg="bg-amber-50" />
        </div>

        {/* Tabs */}
        <div className="flex bg-white border border-[#E4E4DE] rounded-xl p-1 gap-0.5 w-fit">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.key ? "bg-[#F06418] text-white" : "text-[#4A4A44] hover:bg-[#F8F8F6]"}`}
            >
              {t.label}
              {t.badge != null && t.badge > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center ${tab === t.key ? "bg-white/30 text-white" : "bg-[#F06418] text-white"}`}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab content ───────────────────────────────────────── */}
        {tab === "overview"     && <OverviewTab payments={payments} todayPayments={todayPayments} expired={expired} unpaidActive={unpaidActive} loading={loading} onCollect={() => setCollectModal(true)} onSelectMember={selectMember} onRefresh={fetchAll} />}
        {tab === "transactions" && <TransactionsTab payments={txFiltered} totalRevenue={totalRevenue} loading={loading} dateRange={txDateRange} setDateRange={setTxDateRange} customFrom={txCustomFrom} setCustomFrom={setTxCustomFrom} customTo={txCustomTo} setCustomTo={setTxCustomTo} search={txSearch} setSearch={setTxSearch} typeFilter={txTypeFilter} setTypeFilter={setTxTypeFilter} methodFilter={txMethodFilter} setMethodFilter={setTxMethodFilter} onRefresh={fetchAll} />}
        {tab === "outstanding"  && <OutstandingTab expired={expired} unpaidActive={unpaidActive} loading={loading} onCollect={(m) => { setSelectedMember(m); setFeeAmount(String((m as any).packages?.monthly_fee ?? m.monthly_fee ?? "")); setDiscountType("none"); setDiscountValue(""); setCollectModal(true); }} />}
        {tab === "analytics"   && <AnalyticsTab payments={payments} />}
      </div>

      {/* ── Quick Collect Modal ──────────────────────────────────── */}
      <Modal open={collectModal} onClose={() => { setCollectModal(false); setSelectedMember(null); setMemberSearch(""); setAlreadyPaidWarning(false); }} title="Collect Fee Payment" size="md">
        <div className="p-5 space-y-4">

          {/* Member search */}
          {!selectedMember ? (
            <div>
              <label className="text-sm font-medium text-[#1A1A16] block mb-2">Search Member <span className="text-[#F06418]">*</span></label>
              <div className="relative">
                <Search className="w-4 h-4 text-[#7A7A72] absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="text" placeholder="Name, phone, or membership no..." value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)} autoFocus
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
                />
              </div>
              {memberResults.length > 0 && (
                <div className="mt-1.5 bg-white border border-[#E4E4DE] rounded-xl overflow-hidden shadow-lg">
                  {memberResults.map((m) => (
                    <button key={m.id} onClick={() => selectMember(m)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#FEF0E8] transition-colors text-left border-b border-[#E4E4DE] last:border-0"
                    >
                      <div className="w-8 h-8 rounded-full bg-[#FEF0E8] flex items-center justify-center flex-shrink-0">
                        <span className="text-[#F06418] text-xs font-bold">{m.full_name.charAt(0)}</span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[#1A1A16]">{m.full_name}</p>
                        <p className="text-xs text-[#7A7A72]">{m.membership_no} · {(m as any).packages?.name ?? "No package"}</p>
                      </div>
                      <span className="ml-auto text-sm font-bold text-[#F06418]">
                        {formatPKR((m as any).packages?.monthly_fee ?? m.monthly_fee)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {memberSearch.trim() && memberResults.length === 0 && (
                <p className="text-xs text-[#7A7A72] mt-1.5 px-1">No members found</p>
              )}
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-[#FEF0E8] flex items-center justify-center flex-shrink-0">
                    <span className="text-[#F06418] font-bold">{selectedMember.full_name.charAt(0)}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#1A1A16] truncate">{selectedMember.full_name}</p>
                    <p className="text-xs text-[#7A7A72]">{selectedMember.membership_no} · {(selectedMember as any).packages?.name ?? "No package"}</p>
                  </div>
                </div>
                <button onClick={() => { setSelectedMember(null); setMemberSearch(""); }}
                  className="text-[#7A7A72] hover:text-[#1A1A16] p-1 rounded flex-shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Already paid this month warning */}
              {alreadyPaidWarning && feeType === "membership" && (
                <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2.5 mb-1">
                  <span className="text-amber-500 text-base leading-none mt-0.5">⚠</span>
                  <div>
                    <p className="text-xs font-semibold text-amber-800">Already paid this month</p>
                    <p className="text-xs text-amber-700 mt-0.5">This member has a membership payment recorded for the current month. You can still proceed if this is a correction or advance payment.</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 mb-4">
                <Input label="Amount (Rs)" type="number" required
                  value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} />
                <Select label="Payment Type" value={feeType} onChange={(e) => { setFeeType(e.target.value); if (e.target.value !== "membership") setAlreadyPaidWarning(false); }}>
                  <option value="membership">Monthly Membership</option>
                  <option value="admission">Admission Fee</option>
                  <option value="trainer">Trainer Fee</option>
                  <option value="other">Other</option>
                </Select>
              </div>

              {/* Discount section */}
              <div className="rounded-xl border-2 border-dashed border-[#F06418] bg-[#FEF0E8]/40 p-4 space-y-3 mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 bg-[#F06418] rounded-full flex items-center justify-center"><Tag className="w-3 h-3 text-white" /></div>
                  <p className="text-xs font-bold text-[#C04E10] uppercase tracking-wide">Special Discount</p>
                </div>
                <div className="flex gap-2">
                  {(["none", "percent", "amount"] as const).map((opt) => (
                    <button key={opt} type="button" onClick={() => { setDiscountType(opt); setDiscountValue(""); }}
                      className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold border transition-all ${discountType === opt ? "bg-[#F06418] text-white border-[#F06418]" : "bg-white text-[#4A4A44] border-[#E4E4DE] hover:border-[#F06418]"}`}
                    >
                      {opt === "none" ? "No Discount" : opt === "percent" ? "% Percentage" : "Rs Amount"}
                    </button>
                  ))}
                </div>
                {discountType !== "none" && (
                  <Input label={discountType === "percent" ? "Discount %" : "Discount Amount (Rs)"}
                    type="number" placeholder={discountType === "percent" ? "e.g. 10" : "e.g. 500"}
                    value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
                )}
                {discountType !== "none" && discountAmount > 0 && (
                  <div className="bg-white rounded-lg border border-[#FDDCC8] p-3 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-[#4A4A44]">Original</span>
                      <span className="font-medium">{formatPKR(originalAmount)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-[#F06418]">
                      <span className="flex items-center gap-1"><Minus className="w-3 h-3" /> Discount ({discountPct}%)</span>
                      <span className="font-medium">− {formatPKR(discountAmount)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold pt-1 border-t border-[#FDDCC8]">
                      <span>Collect</span><span className="text-green-700">{formatPKR(finalAmount)}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Select label="Payment Method" value={feeMethod} onChange={(e) => setFeeMethod(e.target.value)}>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </Select>
                <Input label="Note (optional)" placeholder="e.g. June 2026" value={feeNote} onChange={(e) => setFeeNote(e.target.value)} />
              </div>

              <div className="mt-3 bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-[#4A4A44]">Collecting:</span>
                <span className="text-xl font-bold text-[#1A1A16]">{formatPKR(finalAmount || originalAmount)}</span>
              </div>
            </div>
          )}

          {selectedMember && (
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setCollectModal(false)} className="flex-1">Cancel</Button>
              <Button onClick={handleCollect} loading={collectSaving} className="flex-1">
                <Receipt className="w-4 h-4" /> Collect & Receipt
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

// ── Tab 1: Overview ──────────────────────────────────────────────────
function OverviewTab({ payments, todayPayments, expired, unpaidActive, loading, onCollect, onSelectMember, onRefresh }: {
  payments: PaymentRow[]; todayPayments: PaymentRow[];
  expired: MemberWithPackage[]; unpaidActive: MemberWithPackage[];
  loading: boolean; onCollect: () => void;
  onSelectMember: (m: MemberWithPackage) => void;
  onRefresh: () => void;
}) {
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!deleteId) return;
    setDeleting(true);
    const supabase = createClient();
    await supabase.from("fee_payments").update({ deleted_at: new Date().toISOString() }).eq("id", deleteId);
    setDeleting(false);
    setDeleteId(null);
    onRefresh();
    toast.success("Payment reversed successfully.");
  }

  return (
    <div className="space-y-5">
      {/* Quick collect CTA */}
      <div className="bg-[#111111] rounded-xl p-5 flex items-center justify-between">
        <div>
          <p className="text-white font-bold text-base">Quick Fee Collection</p>
          <p className="text-white/60 text-sm mt-0.5">Search any member and collect instantly</p>
        </div>
        <Button onClick={onCollect} className="flex-shrink-0">
          <Plus className="w-4 h-4" /> Collect Fee
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Today's collections */}
        <Card padding={false}>
          <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#1A1A16]">Today's Collections</h3>
            <span className="text-base font-bold text-[#F06418]">
              {formatPKR(todayPayments.reduce((s, p) => s + (p.amount ?? 0), 0))}
            </span>
          </div>
          {loading ? (
            <div className="py-8 text-center text-sm text-[#7A7A72]">Loading...</div>
          ) : todayPayments.length === 0 ? (
            <div className="py-8 text-center text-sm text-[#7A7A72]">No collections today yet</div>
          ) : (
            <div className="divide-y divide-[#E4E4DE]">
              {todayPayments.slice(0, 8).map((p) => {
                const m = (p as any).member;
                return (
                  <div key={p.id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-[#FEF0E8] flex items-center justify-center text-[#F06418] text-xs font-bold flex-shrink-0">
                        {m?.full_name?.charAt(0) ?? "?"}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[#1A1A16]">{m?.full_name ?? "—"}</p>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${TYPE_COLORS[p.payment_type ?? "other"]}`}>
                          {TYPE_LABELS[p.payment_type ?? "other"]}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-bold text-green-700">{formatPKR(p.amount)}</span>
                      <Link href={`/dashboard/fees/receipt/${p.id}`}>
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#E4E4DE] text-xs font-semibold text-[#4A4A44] hover:border-[#F06418] hover:text-[#F06418] hover:bg-[#FEF0E8] transition-colors whitespace-nowrap">
                          <Receipt className="w-3 h-3" /> Receipt
                        </span>
                      </Link>
                      <button onClick={() => setDeleteId(p.id)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-red-200 text-xs font-semibold text-red-500 hover:bg-red-50 hover:border-red-400 transition-colors whitespace-nowrap">
                        <Trash2 className="w-3 h-3" /> Reverse
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Due soon warning */}
        <Card padding={false}>
          <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-[#1A1A16]">
              Needs Attention <span className="text-[#7A7A72] font-normal">({expired.length + unpaidActive.length})</span>
            </h3>
          </div>
          {expired.length + unpaidActive.length === 0 ? (
            <div className="py-8 text-center text-sm text-green-600 font-medium">
              ✓ All fees up to date
            </div>
          ) : (
            <div className="divide-y divide-[#E4E4DE] max-h-64 overflow-y-auto">
              {[...expired.slice(0, 3), ...unpaidActive.slice(0, 3)].map((m, i) => {
                const isExpired = i < Math.min(expired.length, 3);
                const days = daysUntilExpiry(m.expiry_date);
                return (
                  <div key={m.id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isExpired ? "bg-red-500" : "bg-amber-400"}`} />
                      <div>
                        <p className="text-sm font-semibold text-[#1A1A16]">{m.full_name}</p>
                        <p className="text-xs text-[#7A7A72]">
                          {isExpired ? `Expired ${Math.abs(days ?? 0)}d ago` : "No payment in 30 days"}
                        </p>
                      </div>
                    </div>
                    <button onClick={() => onSelectMember(m)}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#FEF0E8] text-[#F06418] border border-[#FDDCC8] hover:bg-[#F06418] hover:text-white transition-colors flex-shrink-0"
                    >
                      Collect
                    </button>
                  </div>
                );
              })}
              {expired.length + unpaidActive.length > 6 && (
                <div className="px-5 py-2 text-center text-xs text-[#7A7A72]">
                  +{expired.length + unpaidActive.length - 6} more — see Outstanding tab
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* ── Reverse payment confirm dialog ── */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#1A1A16]">Reverse This Payment?</h3>
                <p className="text-sm text-[#7A7A72] mt-0.5">The payment record will be removed. Member's outstanding balance will be restored.</p>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setDeleteId(null)} disabled={deleting}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[#E4E4DE] text-sm font-semibold text-[#4A4A44] hover:bg-[#F8F8F6] transition-colors">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-60">
                {deleting ? "Reversing…" : "Yes, Reverse"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 2: Transactions ──────────────────────────────────────────────
function TransactionsTab({ payments, totalRevenue, loading, dateRange, setDateRange, customFrom, setCustomFrom, customTo, setCustomTo, search, setSearch, typeFilter, setTypeFilter, methodFilter, setMethodFilter, onRefresh }: {
  payments: PaymentRow[]; totalRevenue: number; loading: boolean;
  dateRange: DateRange; setDateRange: (v: DateRange) => void;
  customFrom: string; setCustomFrom: (v: string) => void;
  customTo: string; setCustomTo: (v: string) => void;
  search: string; setSearch: (v: string) => void;
  typeFilter: string; setTypeFilter: (v: string) => void;
  methodFilter: string; setMethodFilter: (v: string) => void;
  onRefresh: () => void;
}) {
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!deleteId) return;
    setDeleting(true);
    const supabase = createClient();
    await supabase.from("fee_payments").update({ deleted_at: new Date().toISOString() }).eq("id", deleteId);
    setDeleting(false);
    setDeleteId(null);
    onRefresh();
    toast.success("Payment entry removed.");
  }
  const DATE_LABELS: Record<DateRange, string> = {
    thisMonth: "This Month", lastMonth: "Last Month",
    "3months": "3 Months", alltime: "All Time", custom: "Custom Range",
  };

  // Totals by method for summary row
  const byMethod = PAYMENT_METHODS.map((m) => ({
    method: m,
    total: payments.filter((p) => p.payment_method === m).reduce((s, p) => s + (p.amount ?? 0), 0),
  })).filter((m) => m.total > 0);

  const grandTotal = payments.reduce((s, p) => s + (p.amount ?? 0), 0);

  // Colours for method badges
  const METHOD_BADGE: Record<string, string> = {
    Cash: "bg-amber-50 text-amber-700 border-amber-200",
    Bank: "bg-blue-50 text-blue-700 border-blue-200",
    Card: "bg-purple-50 text-purple-700 border-purple-200",
    EasyPaisa: "bg-green-50 text-green-700 border-green-200",
    JazzCash: "bg-red-50 text-red-700 border-red-200",
  };

  return (
    <div className="space-y-4">
      {/* ── Filter bar ── */}
      <div className="bg-white border border-[#E4E4DE] rounded-xl p-4 space-y-3">
        {/* Row 1 — date range + search + refresh */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg p-0.5 gap-0.5 flex-wrap">
            {(["thisMonth", "lastMonth", "3months", "alltime", "custom"] as DateRange[]).map((d) => (
              <button key={d} onClick={() => setDateRange(d)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${dateRange === d ? "bg-[#F06418] text-white" : "text-[#4A4A44] hover:bg-white"}`}
              >{DATE_LABELS[d]}</button>
            ))}
          </div>
          <div className="flex-1 min-w-48 max-w-sm relative">
            <Search className="w-4 h-4 text-[#7A7A72] absolute left-3 top-1/2 -translate-y-1/2" />
            <input type="text" placeholder="Search by name or membership no..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
          </div>
          <Button variant="ghost" size="sm" onClick={onRefresh}><RefreshCw className="w-4 h-4" /></Button>
        </div>

        {/* Row 2 — custom range inputs (only when custom selected) */}
        {dateRange === "custom" && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs text-[#7A7A72] font-medium">From</label>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                className="text-xs px-3 py-1.5 rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[#7A7A72] font-medium">To</label>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                className="text-xs px-3 py-1.5 rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
            </div>
          </div>
        )}

        {/* Row 3 — type + method filters + count */}
        <div className="flex flex-wrap items-center gap-2">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-[#E4E4DE] bg-white text-[#4A4A44] focus:outline-none focus:ring-2 focus:ring-[#F06418]">
            <option value="all">All Payment Types</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-[#E4E4DE] bg-white text-[#4A4A44] focus:outline-none focus:ring-2 focus:ring-[#F06418]">
            <option value="all">All Methods</option>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <span className="text-xs text-[#7A7A72]">{payments.length} records</span>
          <span className="ml-auto text-sm font-bold text-[#1A1A16]">Total: {formatPKR(grandTotal)}</span>
        </div>
      </div>

      {/* ── Summary chips ── */}
      {byMethod.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {byMethod.map((m) => (
            <div key={m.method} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold ${METHOD_BADGE[m.method] ?? "bg-gray-50 text-gray-600 border-gray-200"}`}>
              <span>{m.method}:</span>
              <span className="font-bold">{formatPKR(m.total)}</span>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-[#7A7A72]">Loading transactions...</div>
      ) : payments.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm font-medium text-[#4A4A44]">No transactions found</p>
          <p className="text-xs text-[#7A7A72] mt-1">Try adjusting your filters or date range</p>
        </div>
      ) : (
        <div className="bg-white border border-[#E4E4DE] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#F8F8F6] border-b border-[#E4E4DE]">
                <tr>
                  <th className="text-left text-xs font-semibold text-[#7A7A72] px-5 py-3 whitespace-nowrap">Member</th>
                  <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3 whitespace-nowrap">Receipt No</th>
                  <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3 whitespace-nowrap">For Month</th>
                  <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3 whitespace-nowrap">Payment Type</th>
                  <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3 whitespace-nowrap">Amount</th>
                  <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3 whitespace-nowrap">Method</th>
                  <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3 whitespace-nowrap">Paid On</th>
                  <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3 whitespace-nowrap">Note</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E4DE]">
                {payments.map((p) => {
                  const mem = (p as any).member;
                  const hasDiscount = p.note?.includes("Discount:");
                  // Extract user note (after the discount part if present)
                  const cleanNote = hasDiscount
                    ? p.note?.split(" · ").slice(1).join(" · ") || null
                    : p.note;
                  // Format month covered — use explicit month_covered if set,
                  // else fall back to the payment_date month
                  const monthSource = p.month_covered ?? p.payment_date;
                  const monthLabel = monthSource
                    ? format(new Date(monthSource + "T12:00:00"), "MMM yyyy")
                    : null;
                  const monthInferred = !p.month_covered && !!p.payment_date;
                  return (
                    <tr key={p.id} className="hover:bg-[#F8F8F6] transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-[#FEF0E8] flex items-center justify-center text-[#F06418] text-xs font-bold flex-shrink-0">
                            {mem?.full_name?.charAt(0) ?? "?"}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-[#1A1A16] whitespace-nowrap">{mem?.full_name ?? "—"}</p>
                            <p className="text-[10px] text-[#7A7A72] font-mono">{mem?.membership_no ?? "—"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[11px] font-mono font-semibold text-[#F06418]">
                          {p.receipt_no ?? `RCP-${p.id.slice(-8, -4).toUpperCase()}-${p.id.slice(-4).toUpperCase()}`}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {monthLabel ? (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-md whitespace-nowrap border ${
                            monthInferred
                              ? "text-[#7A7A72] bg-[#F8F8F6] border-[#E4E4DE]"
                              : "text-[#1A1A16] bg-[#F8F8F6] border-[#E4E4DE]"
                          }`}>
                            {monthLabel}
                          </span>
                        ) : (
                          <span className="text-[#7A7A72] text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${TYPE_COLORS[p.payment_type ?? "other"]}`}>
                          {TYPE_LABELS[p.payment_type ?? "other"] ?? p.payment_type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-green-700 whitespace-nowrap">{formatPKR(p.amount)}</span>
                          {hasDiscount && (
                            <span className="text-[9px] bg-[#FEF0E8] text-[#C04E10] border border-[#FDDCC8] px-1.5 py-0.5 rounded-full font-bold">DISC</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${METHOD_BADGE[p.payment_method ?? ""] ?? "bg-gray-50 text-gray-600 border-gray-200"}`}>
                          {p.payment_method ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4A4A44] whitespace-nowrap">{formatDate(p.payment_date)}</td>
                      <td className="px-4 py-3 text-xs text-[#7A7A72] max-w-[140px] truncate">{cleanNote ?? "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link href={`/dashboard/fees/receipt/${p.id}`}>
                            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E4E4DE] text-xs font-semibold text-[#4A4A44] hover:border-[#F06418] hover:text-[#F06418] hover:bg-[#FEF0E8] transition-colors whitespace-nowrap">
                              <Receipt className="w-3.5 h-3.5" /> View Receipt
                            </span>
                          </Link>
                          <button onClick={() => setDeleteId(p.id)}
                            className="p-1.5 rounded-lg text-[#7A7A72] hover:text-red-600 hover:bg-red-50 transition-colors flex-shrink-0" title="Remove this entry">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer totals */}
          <div className="px-5 py-3 border-t border-[#E4E4DE] bg-[#F8F8F6] flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-[#7A7A72]">{payments.length} transaction{payments.length !== 1 ? "s" : ""}</span>
            <div className="flex items-center gap-4 flex-wrap">
              {byMethod.map((m) => (
                <span key={m.method} className="text-xs text-[#7A7A72]">
                  {m.method}: <span className="font-semibold text-[#1A1A16]">{formatPKR(m.total)}</span>
                </span>
              ))}
              <span className="text-base font-bold text-[#1A1A16] border-l border-[#E4E4DE] pl-4">Total: {formatPKR(grandTotal)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm dialog ── */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#1A1A16]">Remove Payment Entry?</h3>
                <p className="text-sm text-[#7A7A72]">This will soft-delete the record. It can be recovered from the database if needed.</p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setDeleteId(null)} disabled={deleting}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[#E4E4DE] text-sm font-semibold text-[#4A4A44] hover:bg-[#F8F8F6] transition-colors">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-60">
                {deleting ? "Removing…" : "Yes, Remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 3: Outstanding Dues ──────────────────────────────────────────
function OutstandingTab({ expired, unpaidActive, loading, onCollect }: {
  expired: MemberWithPackage[]; unpaidActive: MemberWithPackage[];
  loading: boolean; onCollect: (m: MemberWithPackage) => void;
}) {
  function DueRow({ m, isExpired }: { m: MemberWithPackage; isExpired: boolean }) {
    const days = daysUntilExpiry(m.expiry_date);
    const pkg = (m as any).packages;
    return (
      <div className="flex items-center gap-3 px-5 py-3 hover:bg-[#F8F8F6] transition-colors">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isExpired ? "bg-red-500" : "bg-amber-400"}`} />
        <div className="w-8 h-8 rounded-full bg-[#FEF0E8] flex items-center justify-center text-[#F06418] text-xs font-bold flex-shrink-0">
          {m.full_name.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1A1A16] truncate">{m.full_name}</p>
          <p className="text-xs text-[#7A7A72]">
            {m.membership_no}
            {pkg?.name && <span> · {pkg.name}</span>}
            {isExpired && days !== null && <span className="text-red-600 font-medium"> · Expired {Math.abs(days)}d ago</span>}
            {!isExpired && <span className="text-amber-600 font-medium"> · No payment in 30+ days</span>}
          </p>
        </div>
        <span className="text-sm font-bold text-[#1A1A16] flex-shrink-0">{formatPKR(pkg?.monthly_fee ?? m.monthly_fee)}</span>
        <button onClick={() => onCollect(m)}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#FEF0E8] text-[#F06418] border border-[#FDDCC8] hover:bg-[#F06418] hover:text-white transition-colors flex-shrink-0"
        >
          Collect
        </button>
        <Link href={`/dashboard/members/${m.id}`}>
          <button className="p-1.5 rounded-lg text-[#7A7A72] hover:text-[#F06418] hover:bg-[#FEF0E8] transition-colors">
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </Link>
      </div>
    );
  }

  if (loading) return <div className="py-12 text-center text-sm text-[#7A7A72]">Loading...</div>;

  if (expired.length + unpaidActive.length === 0) {
    return (
      <div className="py-16 text-center">
        <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-7 h-7 text-green-600" />
        </div>
        <p className="text-base font-semibold text-[#1A1A16]">All fees up to date!</p>
        <p className="text-sm text-[#7A7A72] mt-1">No expired or unpaid memberships.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Expired section */}
      {expired.length > 0 && (
        <Card padding={false}>
          <div className="px-5 py-3 border-b border-[#E4E4DE] bg-red-50 flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <h3 className="text-sm font-semibold text-red-800">Expired Memberships ({expired.length})</h3>
            <span className="text-xs text-red-600 ml-1">— expiry date has passed</span>
          </div>
          <div className="divide-y divide-[#E4E4DE]">
            {expired.map((m) => <DueRow key={m.id} m={m} isExpired={true} />)}
          </div>
        </Card>
      )}

      {/* Unpaid this month */}
      {unpaidActive.length > 0 && (
        <Card padding={false}>
          <div className="px-5 py-3 border-b border-[#E4E4DE] bg-amber-50 flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <h3 className="text-sm font-semibold text-amber-800">Active — No Payment (30 days) ({unpaidActive.length})</h3>
          </div>
          <div className="divide-y divide-[#E4E4DE]">
            {unpaidActive.map((m) => <DueRow key={m.id} m={m} isExpired={false} />)}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Tab 4: Analytics ─────────────────────────────────────────────────
function AnalyticsTab({ payments }: { payments: PaymentRow[] }) {
  const supabase = createClient();
  const [monthlyData, setMonthlyData] = useState<{ month: string; total: number }[]>([]);

  useEffect(() => {
    async function fetchMonthly() {
      const months: { month: string; total: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = subMonths(new Date(), i);
        const from = format(startOfMonth(d), "yyyy-MM-dd");
        const to = format(new Date(d.getFullYear(), d.getMonth() + 1, 0), "yyyy-MM-dd");
        const { data } = await supabase.from("fee_payments").select("amount").gte("payment_date", from).lte("payment_date", to).is("deleted_at", null);
        months.push({ month: format(d, "MMM yy"), total: data?.reduce((s, r: any) => s + (r.amount ?? 0), 0) ?? 0 });
      }
      setMonthlyData(months);
    }
    fetchMonthly();
  }, []);

  const maxMonthly = Math.max(...monthlyData.map((m) => m.total), 1);

  // Type breakdown
  const byType = Object.entries(TYPE_LABELS).map(([key, label]) => ({
    key, label, total: payments.filter((p) => p.payment_type === key).reduce((s, p) => s + (p.amount ?? 0), 0),
  })).filter((t) => t.total > 0).sort((a, b) => b.total - a.total);
  const totalByType = byType.reduce((s, t) => s + t.total, 0) || 1;

  // Method breakdown
  const byMethod = PAYMENT_METHODS.map((m) => ({
    method: m, total: payments.filter((p) => p.payment_method === m).reduce((s, p) => s + (p.amount ?? 0), 0),
  })).filter((m) => m.total > 0).sort((a, b) => b.total - a.total);
  const totalByMethod = byMethod.reduce((s, m) => s + m.total, 0) || 1;

  const METHOD_COLORS: Record<string, string> = {
    Cash: "#F06418", Bank: "#2563EB", Card: "#7C3AED",
    EasyPaisa: "#059669", JazzCash: "#DC2626",
  };

  return (
    <div className="space-y-5">
      {/* Monthly revenue bars */}
      <Card>
        <h3 className="text-sm font-semibold text-[#1A1A16] mb-5">Monthly Revenue — Last 6 Months</h3>
        {monthlyData.length === 0 ? (
          <div className="py-8 text-center text-sm text-[#7A7A72]">Loading...</div>
        ) : (
          <div className="flex items-end gap-3 h-40">
            {monthlyData.map((m) => (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1.5">
                <span className="text-[10px] text-[#7A7A72] font-medium">{m.total > 0 ? formatPKR(m.total).replace("Rs ", "") : ""}</span>
                <div className="w-full bg-[#F8F8F6] rounded-t-lg relative" style={{ height: "80px" }}>
                  <div
                    className="absolute bottom-0 left-0 right-0 bg-[#F06418] rounded-t-lg transition-all duration-500"
                    style={{ height: `${Math.max((m.total / maxMonthly) * 100, m.total > 0 ? 4 : 0)}%` }}
                  />
                </div>
                <span className="text-[10px] text-[#4A4A44] font-medium">{m.month}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* By type */}
        <Card>
          <h3 className="text-sm font-semibold text-[#1A1A16] mb-4">Revenue by Type</h3>
          {byType.length === 0 ? <p className="text-sm text-[#7A7A72]">No data</p> : (
            <div className="space-y-3">
              {byType.map((t) => (
                <div key={t.key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-[#4A4A44] font-medium">{t.label}</span>
                    <span className="text-[#1A1A16] font-bold">{formatPKR(t.total)}</span>
                  </div>
                  <div className="h-2 bg-[#F8F8F6] rounded-full overflow-hidden">
                    <div className="h-full bg-[#F06418] rounded-full transition-all duration-500" style={{ width: `${(t.total / totalByType) * 100}%` }} />
                  </div>
                  <p className="text-[10px] text-[#7A7A72] mt-0.5">{Math.round((t.total / totalByType) * 100)}%</p>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* By method */}
        <Card>
          <h3 className="text-sm font-semibold text-[#1A1A16] mb-4">Revenue by Method</h3>
          {byMethod.length === 0 ? <p className="text-sm text-[#7A7A72]">No data</p> : (
            <div className="space-y-3">
              {byMethod.map((m) => (
                <div key={m.method}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-[#4A4A44] font-medium flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: METHOD_COLORS[m.method] ?? "#F06418" }} />
                      {m.method}
                    </span>
                    <span className="text-[#1A1A16] font-bold">{formatPKR(m.total)}</span>
                  </div>
                  <div className="h-2 bg-[#F8F8F6] rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(m.total / totalByMethod) * 100}%`, backgroundColor: METHOD_COLORS[m.method] ?? "#F06418" }} />
                  </div>
                  <p className="text-[10px] text-[#7A7A72] mt-0.5">{Math.round((m.total / totalByMethod) * 100)}%</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
