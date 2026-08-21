"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, subDays, startOfWeek, startOfMonth, endOfMonth } from "date-fns";
import {
  Banknote, Users, TrendingUp, Clock, AlertTriangle,
  CheckCircle, ArrowRight, Search, RefreshCw, CalendarCheck, Wifi,
  UserPlus, RotateCcw, Dumbbell, Zap, Percent, ChevronRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/contexts/CurrentUserContext";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { StatsCard } from "@/components/ui/StatsCard";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PaymentDetailModal } from "@/components/forms/PaymentDetailModal";
import {
  formatDate, formatPKR, daysUntilExpiry, describeCoveredPeriod,
  groupPaymentsByReceipt, type LogicalPayment, isDeviceOnline, safeDateValue,
} from "@/lib/utils";
import { currentAndNextCycle, formatCycleLabel } from "@/lib/commission";
import ReceptionistDashboard from "@/components/dashboard/ReceptionistDashboard";

type RangeKey = "today" | "yesterday" | "week" | "month" | "custom";

const TYPE_LABELS: Record<string, string> = {
  membership: "Membership", trainer: "PT Fee", admission: "Admission Fee",
  nutritionist: "Nutritionist Fee", physiotherapy: "Physiotherapy Fee", other: "Other",
  // Walk-in day passes (daily_members) aren't fee_payments rows — they're
  // folded into the same collection list/totals below with this label so
  // they're not silently missing from "how much did we collect today".
  walkin: "Day Pass",
};
const METHOD_COLORS: Record<string, string> = {
  Cash: "bg-amber-50 text-amber-700 border-amber-200",
  Bank: "bg-blue-50 text-blue-700 border-blue-200",
  Card: "bg-purple-50 text-purple-700 border-purple-200",
  EasyPaisa: "bg-green-50 text-green-700 border-green-200",
  JazzCash: "bg-red-50 text-red-700 border-red-200",
};
const PAYMENT_METHODS = ["Cash", "Bank", "Card", "EasyPaisa", "JazzCash"];

function rangeBounds(key: RangeKey, customFrom: string, customTo: string): { from: string; to: string; label: string } {
  const today = new Date();
  const t = format(today, "yyyy-MM-dd");
  if (key === "today") return { from: t, to: t, label: "Today's" };
  if (key === "yesterday") { const y = format(subDays(today, 1), "yyyy-MM-dd"); return { from: y, to: y, label: "Yesterday's" }; }
  if (key === "week") return { from: format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd"), to: t, label: "This Week's" };
  if (key === "month") return { from: format(startOfMonth(today), "yyyy-MM-dd"), to: t, label: "This Month's" };
  return { from: customFrom || t, to: customTo || t, label: "Selected Range" };
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const currentUser = useCurrentUser();
  const role = currentUser?.role ?? "viewer";

  const header = (
    <DashboardHeader
      title={`${greeting()}, ${currentUser?.full_name ?? "there"}`}
      subtitle={formatDate(new Date().toISOString())}
    />
  );

  if (role === "trainer") return <TrainerDashboard header={header} />;
  if (role === "viewer") return <ViewerDashboard header={header} />;
  if (role === "receptionist") return <ReceptionistDashboard header={header} />;
  return <ManagementCockpit header={header} />;
}

// ── Owner / Manager / Receptionist ─────────────────────────────────────
function ManagementCockpit({ header }: { header: React.ReactNode }) {
  const router = useRouter();
  const [rangeKey, setRangeKey] = useState<RangeKey>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [detailPaymentId, setDetailPaymentId] = useState<string | null>(null);

  const [payments, setPayments] = useState<LogicalPayment[]>([]);
  const [collectorNames, setCollectorNames] = useState<Record<string, string>>({});
  const [memberNames, setMemberNames] = useState<Record<string, { full_name: string; membership_no: string }>>({});
  const [monthlyCollection, setMonthlyCollection] = useState(0);

  const [outstandingRows, setOutstandingRows] = useState<{ id: string; kind: "cycle" | "balance"; memberId: string; memberName: string; amount: number; dueDate: string | null; daysOverdue: number; status: "overdue" | "partial" | "pending" }[]>([]);

  const [newMembersCount, setNewMembersCount] = useState(0);
  const [renewalsCount, setRenewalsCount] = useState(0);
  const [ptAddedCount, setPtAddedCount] = useState(0);
  const [dayPassesCount, setDayPassesCount] = useState(0);
  const [expiringMembers, setExpiringMembers] = useState<{ id: string; full_name: string; expiry_date: string }[]>([]);

  const [commissionCurrentCycle, setCommissionCurrentCycle] = useState(0);
  const [commissionPending, setCommissionPending] = useState(0);
  const [commissionNextPayout, setCommissionNextPayout] = useState<string | null>(null);

  const [attendanceToday, setAttendanceToday] = useState(0);
  const [attendanceTrend, setAttendanceTrend] = useState<{ date: string; count: number }[]>([]);
  const [devicesOnline, setDevicesOnline] = useState(0);
  const [devicesTotal, setDevicesTotal] = useState(0);
  const [pendingSubmissions, setPendingSubmissions] = useState(0);

  const { from, to, label } = rangeBounds(rangeKey, customFrom, customTo);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const today = format(new Date(), "yyyy-MM-dd");
    const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
    const sevenDaysOut = format(subDays(new Date(), -7), "yyyy-MM-dd");
    const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");
    const sevenDaysAgo = format(subDays(new Date(), 6), "yyyy-MM-dd");
    const { current } = currentAndNextCycle();

    const [
      { data: rangePayments },
      { data: monthPayments },
      { data: activeMembers },
      { data: balanceRows },
      { data: ptRows },
      { data: walkInRows },
      { data: monthWalkIns },
      { data: expiringData },
      { data: pendingLedger },
      { data: currentCycleLedger },
      { count: attendanceTodayCount },
      { data: attendanceRows },
      { data: devices },
      { count: pendingSubs },
    ] = await Promise.all([
      supabase.from("fee_payments")
        .select("id, receipt_no, member_id, payment_type, amount, payment_method, payment_date, collected_by, coverage_start, coverage_end, month_covered, months_covered, balance_due, balance_due_date, note, created_at, member:members(full_name, membership_no), collector:system_users!fee_payments_collected_by_fkey(full_name)")
        .is("deleted_at", null).gte("payment_date", from).lte("payment_date", to),
      supabase.from("fee_payments").select("amount").is("deleted_at", null).gte("payment_date", monthStart),
      supabase.from("members").select("id, full_name, expiry_date, monthly_fee, membership_start_date, joining_date, trainer_id, packages(monthly_fee)")
        .eq("status", "active").is("deleted_at", null),
      supabase.from("fee_payments").select("id, member_id, balance_due, balance_due_date, member:members(full_name)")
        .is("deleted_at", null).gt("balance_due", 0),
      supabase.from("trainer_member_commissions").select("id, created_at").is("deleted_at", null).gte("created_at", `${from}T00:00:00`).lte("created_at", `${to}T23:59:59`),
      // Walk-in day passes — real collected revenue (daily_members.fee_paid),
      // not a fee_payments row. Folded into the same collection list/totals
      // below (labeled "Day Pass") rather than left out, which is what was
      // silently happening everywhere except the Reports Daily Summary tab.
      supabase.from("daily_members")
        .select("id, full_name, fee_paid, payment_method, visit_date, added_by, created_at, collector:system_users!daily_members_added_by_fkey(full_name)")
        .is("deleted_at", null).gte("visit_date", from).lte("visit_date", to),
      supabase.from("daily_members").select("fee_paid").is("deleted_at", null).gte("visit_date", monthStart),
      supabase.from("members").select("id, full_name, expiry_date").eq("status", "active").is("deleted_at", null)
        .gte("expiry_date", today).lte("expiry_date", sevenDaysOut).order("expiry_date", { ascending: true }),
      supabase.from("trainer_commission_ledger").select("commission_amount, payout_date").is("deleted_at", null).eq("status", "pending"),
      supabase.from("trainer_commission_ledger").select("commission_amount").is("deleted_at", null).eq("cycle_start", current.cycleStart),
      supabase.from("attendances").select("*", { count: "exact", head: true }).gte("punch_time", `${today}T00:00:00`).lte("punch_time", `${today}T23:59:59`),
      supabase.from("attendances").select("punch_time").gte("punch_time", `${sevenDaysAgo}T00:00:00`).lte("punch_time", `${today}T23:59:59`),
      supabase.from("devices").select("id, last_seen"),
      supabase.from("submissions").select("*", { count: "exact", head: true }).eq("status", "pending").is("deleted_at", null),
    ]);

    // Today's Collection — collapse split-method rows into one logical
    // payment per receipt, per the established convention.
    const grouped = groupPaymentsByReceipt((rangePayments ?? []) as any);
    const names: Record<string, string> = {};
    const members: Record<string, { full_name: string; membership_no: string }> = {};
    for (const p of (rangePayments ?? []) as any[]) {
      if (p.collected_by && p.collector?.full_name) names[p.collected_by] = p.collector.full_name;
      if (p.member_id && p.member) members[p.member_id] = { full_name: p.member.full_name, membership_no: p.member.membership_no };
    }
    // Walk-ins converted into the same LogicalPayment shape so the table,
    // search, method breakdown, and Collected By Staff summary all handle
    // them with zero special-casing — "memberId" is a synthetic id since
    // walk-ins aren't real members, resolved via the same memberNames map.
    const walkInPayments = ((walkInRows ?? []) as any[]).map((w) => {
      const walkinMemberId = `walkin-${w.id}`;
      members[walkinMemberId] = { full_name: w.full_name, membership_no: "Walk-in" };
      if (w.added_by && w.collector?.full_name) names[w.added_by] = w.collector.full_name;
      return {
        receiptKey: `walkin-${w.id}`, receiptNo: null, memberId: walkinMemberId, paymentType: "walkin",
        totalAmount: w.fee_paid ?? 0, methods: [{ method: w.payment_method ?? "—", amount: w.fee_paid ?? 0 }],
        methodLabel: w.payment_method ?? "—", paymentDate: w.visit_date, collectedBy: w.added_by,
        coverageStart: w.visit_date, coverageEnd: w.visit_date, monthCovered: null, monthsCovered: 1,
        balanceDue: 0, balanceDueDate: null, note: null, earliestCreatedAt: w.created_at, anchorId: w.id,
      };
    });
    setPayments([...grouped, ...walkInPayments]);
    setCollectorNames(names);
    setMemberNames(members);
    setMonthlyCollection(
      (monthPayments ?? []).reduce((s, r) => s + (r.amount ?? 0), 0) +
      (monthWalkIns ?? []).reduce((s, w) => s + (w.fee_paid ?? 0), 0)
    );

    // Outstanding — same expired/unpaid-since-cycle-start definition used
    // on the Fees page, unchanged, plus open balance_due partial payments
    // (a genuinely different kind of money owed, not a duplicate of the
    // cycle-based bucket) merged into one prioritized list.
    const boundaries = (activeMembers ?? []).map((m) => m.membership_start_date ?? thirtyDaysAgo);
    const earliestNeeded = boundaries.length ? boundaries.reduce((min, b) => (b < min ? b : min)) : thirtyDaysAgo;
    const { data: recentPayments } = await supabase.from("fee_payments").select("member_id, payment_date").gte("payment_date", earliestNeeded).is("deleted_at", null);
    const latestByMember = new Map<string, string>();
    for (const p of recentPayments ?? []) {
      const cur = latestByMember.get(p.member_id);
      if (!cur || p.payment_date > cur) latestByMember.set(p.member_id, p.payment_date);
    }
    function paidSinceCycleStart(m: { id: string; membership_start_date: string | null }) {
      const boundary = m.membership_start_date ?? thirtyDaysAgo;
      const latest = latestByMember.get(m.id);
      return !!latest && latest >= boundary;
    }
    const cycleRows = (activeMembers ?? [])
      .filter((m) => (m.expiry_date && m.expiry_date < today) || !paidSinceCycleStart(m))
      .map((m) => {
        const isExpired = !!(m.expiry_date && m.expiry_date < today);
        const dueDate = m.expiry_date ?? null;
        const daysOverdue = isExpired && dueDate ? Math.max(daysUntilExpiry(dueDate)! * -1, 0) : 0;
        return {
          id: `cycle-${m.id}`, kind: "cycle" as const, memberId: m.id, memberName: m.full_name,
          amount: m.monthly_fee ?? (m as any).packages?.monthly_fee ?? 0,
          dueDate, daysOverdue, status: isExpired ? ("overdue" as const) : ("pending" as const),
        };
      });
    const balanceOutstanding = ((balanceRows ?? []) as any[]).map((b) => {
      const daysOverdue = b.balance_due_date ? Math.max(daysUntilExpiry(b.balance_due_date)! * -1, 0) : 0;
      return {
        id: `bal-${b.id}`, kind: "balance" as const, memberId: b.member_id, memberName: b.member?.full_name ?? "—",
        amount: b.balance_due, dueDate: b.balance_due_date, daysOverdue, status: "partial" as const,
      };
    });
    setOutstandingRows([...cycleRows, ...balanceOutstanding].sort((a, b) => b.daysOverdue - a.daysOverdue));

    // Membership activity — New Members / Renewals both use joining_date
    // as the dividing line: a recurring payment from a member who already
    // existed before this range is a renewal; one from a member who
    // joined inside this range is (part of) their registration, not a
    // renewal, since registration payments use the same payment_type.
    const memberById = new Map((activeMembers ?? []).map((m) => [m.id, m]));
    const newMembers = (activeMembers ?? []).filter((m) => (m as any).joining_date && (m as any).joining_date >= from && (m as any).joining_date <= to);
    setNewMembersCount(newMembers.length);
    const newMemberIds = new Set(newMembers.map((m) => m.id));
    const renewalMemberIds = new Set(
      grouped
        .filter((p) => (p.paymentType === "membership" || p.paymentType === "trainer") && !newMemberIds.has(p.memberId))
        .map((p) => p.memberId)
    );
    setRenewalsCount(renewalMemberIds.size);
    setPtAddedCount((ptRows ?? []).length);
    setDayPassesCount((walkInRows ?? []).length);
    setExpiringMembers((expiringData ?? []) as any);

    // Trainer commission — read only, from the ledger, never recalculated.
    setCommissionCurrentCycle((currentCycleLedger ?? []).reduce((s, l) => s + (l.commission_amount ?? 0), 0));
    const pending = pendingLedger ?? [];
    setCommissionPending(pending.reduce((s, l) => s + (l.commission_amount ?? 0), 0));
    setCommissionNextPayout(pending.length ? pending.map((l) => l.payout_date).sort()[0] : null);

    // Attendance / devices — secondary, unchanged concepts.
    setAttendanceToday(attendanceTodayCount ?? 0);
    const trendMap: Record<string, number> = {};
    for (const a of attendanceRows ?? []) {
      const d = a.punch_time.slice(0, 10);
      trendMap[d] = (trendMap[d] ?? 0) + 1;
    }
    const trend: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = format(subDays(new Date(), i), "yyyy-MM-dd");
      trend.push({ date: d, count: trendMap[d] ?? 0 });
    }
    setAttendanceTrend(trend);
    setDevicesTotal(devices?.length ?? 0);
    setDevicesOnline((devices ?? []).filter((d) => isDeviceOnline(d.last_seen)).length);
    setPendingSubmissions(pendingSubs ?? 0);

    setLoading(false);
  }, [from, to]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const totalCollected = payments.reduce((s, p) => s + p.totalAmount, 0);
  const paymentCount = payments.length;
  const distinctMembers = new Set(payments.map((p) => p.memberId)).size;
  const avgPayment = paymentCount > 0 ? totalCollected / paymentCount : 0;
  const methodTotals = PAYMENT_METHODS.map((m) => ({
    method: m,
    total: payments.reduce((s, p) => s + p.methods.filter((x) => x.method === m).reduce((s2, x) => s2 + x.amount, 0), 0),
  })).filter((m) => m.total > 0);

  const totalOutstanding = outstandingRows.reduce((s, r) => s + r.amount, 0);

  const staffCollection = Object.entries(
    payments.reduce((acc, p) => {
      const key = p.collectedBy ?? "unknown";
      if (!acc[key]) acc[key] = { count: 0, amount: 0 };
      acc[key].count += 1;
      acc[key].amount += p.totalAmount;
      return acc;
    }, {} as Record<string, { count: number; amount: number }>)
  ).map(([id, v]) => ({ id, name: id === "unknown" ? "Not recorded" : (collectorNames[id] ?? "—"), ...v }))
    .sort((a, b) => b.amount - a.amount);

  const filteredPayments = payments.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const member = memberNames[p.memberId];
    return (
      member?.full_name?.toLowerCase().includes(q) ||
      member?.membership_no?.toLowerCase().includes(q) ||
      p.receiptNo?.toLowerCase().includes(q) ||
      (TYPE_LABELS[p.paymentType ?? "other"] ?? "").toLowerCase().includes(q) ||
      p.methodLabel.toLowerCase().includes(q) ||
      (collectorNames[p.collectedBy ?? ""] ?? "").toLowerCase().includes(q) ||
      String(p.totalAmount).includes(q)
    );
  }).sort((a, b) => b.earliestCreatedAt.localeCompare(a.earliestCreatedAt));

  // Needs Attention — assembled purely from data already computed above.
  const alerts: { id: string; text: string; severity: "red" | "amber"; href: string }[] = [];
  const overdueCount = outstandingRows.filter((r) => r.status === "overdue").length;
  if (overdueCount > 0) alerts.push({ id: "overdue", text: `${overdueCount} member${overdueCount !== 1 ? "s" : ""} overdue on renewal`, severity: "red", href: "/dashboard/fees?tab=outstanding" });
  const largeBalances = outstandingRows.filter((r) => r.amount >= 20000);
  if (largeBalances.length > 0) alerts.push({ id: "large", text: `${largeBalances.length} large outstanding balance${largeBalances.length !== 1 ? "s" : ""} (Rs 20,000+)`, severity: "amber", href: "/dashboard/fees?tab=outstanding" });
  if (expiringMembers.length > 0) alerts.push({ id: "expiring", text: `${expiringMembers.length} membership${expiringMembers.length !== 1 ? "s" : ""} expiring within 7 days`, severity: "amber", href: "/dashboard/fees?tab=renewals" });
  if (commissionNextPayout) {
    const daysToPayout = daysUntilExpiry(commissionNextPayout);
    if (daysToPayout !== null && daysToPayout >= 0 && daysToPayout <= 7) {
      alerts.push({ id: "payout", text: `Trainer commission payout of ${formatPKR(commissionPending)} due ${formatDate(commissionNextPayout)}`, severity: "amber", href: "/dashboard/commissions" });
    }
  }
  if (pendingSubmissions > 0) alerts.push({ id: "subs", text: `${pendingSubmissions} member application${pendingSubmissions !== 1 ? "s" : ""} awaiting approval`, severity: "amber", href: "/dashboard/submissions" });
  if (devicesTotal > 0 && devicesOnline < devicesTotal) alerts.push({ id: "devices", text: `${devicesTotal - devicesOnline} attendance device${devicesTotal - devicesOnline !== 1 ? "s" : ""} offline`, severity: "amber", href: "/dashboard/attendance" });

  const RANGE_LABELS: Record<RangeKey, string> = { today: "Today", yesterday: "Yesterday", week: "This Week", month: "This Month", custom: "Custom" };

  return (
    <div className="flex flex-col flex-1">
      {header}
      <div className="flex-1 p-6 space-y-6">
        {/* Date range selector */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-white border border-[#E4E4DE] rounded-lg p-0.5 gap-0.5">
            {(["today", "yesterday", "week", "month", "custom"] as RangeKey[]).map((k) => (
              <button key={k} onClick={() => setRangeKey(k)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${rangeKey === k ? "bg-[#F06418] text-white" : "text-[#4A4A44] hover:bg-[#F8F8F6]"}`}
              >{RANGE_LABELS[k]}</button>
            ))}
          </div>
          {rangeKey === "custom" && (
            <div className="flex items-center gap-2">
              <input type="date" value={customFrom} min="1900-01-01" max="2099-12-31"
                onChange={(e) => { const v = safeDateValue(e.target.value); if (v !== null) setCustomFrom(v); }}
                className="text-xs px-3 py-1.5 rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
              <span className="text-xs text-[#7A7A72]">to</span>
              <input type="date" value={customTo} min="1900-01-01" max="2099-12-31"
                onChange={(e) => { const v = safeDateValue(e.target.value); if (v !== null) setCustomTo(v); }}
                className="text-xs px-3 py-1.5 rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={fetchAll} className="ml-auto"><RefreshCw className="w-4 h-4" /></Button>
        </div>

        {/* ── HERO: Today's Collection ── */}
        <div className="bg-[#111111] rounded-2xl p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-white/60 text-sm font-medium">{label} Collection</p>
              <p className="text-white text-4xl font-bold font-[family-name:var(--font-barlow-condensed)] mt-1">
                {loading ? "—" : formatPKR(totalCollected)}
              </p>
            </div>
            <div className="flex gap-6">
              <div>
                <p className="text-white text-xl font-bold">{paymentCount}</p>
                <p className="text-white/60 text-xs">Payments</p>
              </div>
              <div>
                <p className="text-white text-xl font-bold">{distinctMembers}</p>
                <p className="text-white/60 text-xs">Members Paid</p>
              </div>
              <div>
                <p className="text-white text-xl font-bold">{formatPKR(Math.round(avgPayment))}</p>
                <p className="text-white/60 text-xs">Average</p>
              </div>
            </div>
          </div>
          {methodTotals.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-5 pt-5 border-t border-white/10">
              {methodTotals.map((m) => (
                <div key={m.method} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 text-xs font-semibold text-white">
                  <span>{m.method}:</span><span>{formatPKR(m.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard title={`${label} Collection`} value={formatPKR(totalCollected)} icon={Banknote} iconColor="text-[#F06418]" iconBg="bg-[#FEF0E8]" loading={loading} />
          <StatsCard title="Total Outstanding" value={formatPKR(totalOutstanding)} icon={AlertTriangle} iconColor="text-red-600" iconBg="bg-red-50" loading={loading} />
          <StatsCard title="Monthly Collection" value={formatPKR(monthlyCollection)} icon={TrendingUp} iconColor="text-blue-600" iconBg="bg-blue-50" loading={loading} />
          <StatsCard title="New Members" value={newMembersCount} icon={UserPlus} iconColor="text-green-600" iconBg="bg-green-50" loading={loading} />
          <StatsCard title="Renewals" value={renewalsCount} icon={RotateCcw} iconColor="text-purple-600" iconBg="bg-purple-50" loading={loading} />
          <StatsCard title="PT Members Added" value={ptAddedCount} icon={Dumbbell} iconColor="text-teal-600" iconBg="bg-teal-50" loading={loading} />
          <StatsCard title="Commission Pending" value={formatPKR(commissionPending)} icon={Percent} iconColor="text-amber-600" iconBg="bg-amber-50" loading={loading} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
          {/* ── Today's Collection table ── */}
          <div className="xl:col-span-2 space-y-6">
            <Card padding={false}>
              <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center justify-between flex-wrap gap-3">
                <h3 className="text-base font-semibold text-[#1A1A16]">{label} Collection — {filteredPayments.length} payment{filteredPayments.length !== 1 ? "s" : ""}</h3>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-[#7A7A72] absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)}
                      className="pl-7 pr-3 py-1.5 text-xs rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418] w-40" />
                  </div>
                  <Link href="/dashboard/fees?tab=transactions">
                    <span className="flex items-center gap-1 text-xs font-semibold text-[#F06418] hover:underline whitespace-nowrap">
                      View All Payments <ArrowRight className="w-3 h-3" />
                    </span>
                  </Link>
                </div>
              </div>
              {loading ? (
                <div className="py-10 text-center text-sm text-[#7A7A72]">Loading...</div>
              ) : filteredPayments.length === 0 ? (
                <div className="py-12 text-center">
                  <CheckCircle className="w-8 h-8 text-[#E4E4DE] mx-auto mb-2" />
                  <p className="text-sm text-[#7A7A72]">No payments {search ? "match your search" : "collected in this range yet"}</p>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
                  <table className="w-full">
                    <thead className="bg-[#F8F8F6] border-b border-[#E4E4DE] sticky top-0">
                      <tr>
                        <th className="text-left text-xs font-semibold text-[#7A7A72] px-5 py-2.5 whitespace-nowrap">Time</th>
                        <th className="text-left text-xs font-semibold text-[#7A7A72] px-3 py-2.5 whitespace-nowrap">Member</th>
                        <th className="text-left text-xs font-semibold text-[#7A7A72] px-3 py-2.5 whitespace-nowrap">Payment For</th>
                        <th className="text-left text-xs font-semibold text-[#7A7A72] px-3 py-2.5 whitespace-nowrap">Coverage</th>
                        <th className="text-left text-xs font-semibold text-[#7A7A72] px-3 py-2.5 whitespace-nowrap">Amount</th>
                        <th className="text-left text-xs font-semibold text-[#7A7A72] px-3 py-2.5 whitespace-nowrap">Method</th>
                        <th className="text-left text-xs font-semibold text-[#7A7A72] px-3 py-2.5 whitespace-nowrap">Collected By</th>
                        <th className="text-left text-xs font-semibold text-[#7A7A72] px-3 py-2.5 whitespace-nowrap">Receipt #</th>
                        <th className="text-left text-xs font-semibold text-[#7A7A72] px-3 py-2.5 whitespace-nowrap">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E4E4DE]">
                      {filteredPayments.map((p) => {
                        const member = memberNames[p.memberId];
                        const coverage = describeCoveredPeriod(p.coverageStart, p.coverageEnd, p.monthCovered, p.paymentDate, p.monthsCovered);
                        const isPartial = p.balanceDue > 0;
                        return (
                          <tr key={p.receiptKey}
                            onClick={() => p.paymentType === "walkin" ? router.push("/dashboard/daily-members") : setDetailPaymentId(p.anchorId)}
                            className="hover:bg-[#F8F8F6] transition-colors cursor-pointer">
                            <td className="px-5 py-2.5 text-xs text-[#4A4A44] whitespace-nowrap">{new Date(p.earliestCreatedAt).toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit", hour12: true })}</td>
                            <td className="px-3 py-2.5">
                              <p className="text-sm font-semibold text-[#1A1A16] whitespace-nowrap">{member?.full_name ?? "—"}</p>
                              <p className="text-[10px] text-[#7A7A72] font-mono">{member?.membership_no ?? "—"}</p>
                            </td>
                            <td className="px-3 py-2.5 text-xs text-[#4A4A44] whitespace-nowrap">{TYPE_LABELS[p.paymentType ?? "other"] ?? p.paymentType}</td>
                            <td className="px-3 py-2.5 text-xs text-[#4A4A44] whitespace-nowrap">{coverage.label ?? "—"}</td>
                            <td className="px-3 py-2.5 text-sm font-bold text-green-700 whitespace-nowrap">{formatPKR(p.totalAmount)}</td>
                            <td className="px-3 py-2.5">
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${METHOD_COLORS[p.methodLabel] ?? "bg-gray-50 text-gray-700 border-gray-200"}`}>{p.methodLabel}</span>
                            </td>
                            <td className="px-3 py-2.5 text-xs text-[#4A4A44] whitespace-nowrap">{collectorNames[p.collectedBy ?? ""] ?? "Not recorded"}</td>
                            <td className="px-3 py-2.5 text-[11px] font-mono font-semibold text-[#F06418] whitespace-nowrap">{p.receiptNo ?? "—"}</td>
                            <td className="px-3 py-2.5">
                              <Badge variant={isPartial ? "partial" : "active"}>{isPartial ? "Partial" : "Paid"}</Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* Outstanding Payments */}
            <Card padding={false}>
                <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-[#1A1A16]">Outstanding Payments</h3>
                    <p className="text-xs text-[#7A7A72] mt-0.5">{formatPKR(totalOutstanding)} across {outstandingRows.length} member{outstandingRows.length !== 1 ? "s" : ""}</p>
                  </div>
                  <Link href="/dashboard/fees?tab=outstanding">
                    <span className="flex items-center gap-1 text-xs font-semibold text-[#F06418] hover:underline whitespace-nowrap">View All Outstanding <ArrowRight className="w-3 h-3" /></span>
                  </Link>
                </div>
                {outstandingRows.length === 0 ? (
                  <div className="py-8 text-center text-sm text-green-600 font-medium">✓ Nothing outstanding</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-[#F8F8F6] border-b border-[#E4E4DE]">
                        <tr>
                          <th className="text-left text-xs font-semibold text-[#7A7A72] px-5 py-2.5">Member</th>
                          <th className="text-left text-xs font-semibold text-[#7A7A72] px-3 py-2.5">Amount Due</th>
                          <th className="text-left text-xs font-semibold text-[#7A7A72] px-3 py-2.5">Due Date</th>
                          <th className="text-left text-xs font-semibold text-[#7A7A72] px-3 py-2.5">Days Overdue</th>
                          <th className="text-left text-xs font-semibold text-[#7A7A72] px-3 py-2.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E4E4DE]">
                        {outstandingRows.slice(0, 8).map((r) => (
                          <tr key={r.id} className="hover:bg-[#F8F8F6]">
                            <td className="px-5 py-2.5">
                              <Link href={`/dashboard/members/${r.memberId}`} className="text-sm font-medium text-[#1A1A16] hover:text-[#F06418]">{r.memberName}</Link>
                            </td>
                            <td className="px-3 py-2.5 text-sm font-bold text-red-600 whitespace-nowrap">{formatPKR(r.amount)}</td>
                            <td className="px-3 py-2.5 text-xs text-[#4A4A44] whitespace-nowrap">{r.dueDate ? formatDate(r.dueDate) : "—"}</td>
                            <td className="px-3 py-2.5 text-xs text-[#4A4A44] whitespace-nowrap">{r.daysOverdue > 0 ? `${r.daysOverdue}d` : "—"}</td>
                            <td className="px-3 py-2.5"><Badge variant={r.status}>{r.status === "overdue" ? "Overdue" : r.status === "partial" ? "Partial" : "Pending"}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
          </div>

          {/* ── Right column ── */}
          <div className="space-y-6">
            {/* Needs Attention */}
            {alerts.length > 0 && (
              <Card padding={false}>
                <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-[#F06418]" />
                  <h3 className="text-sm font-semibold text-[#1A1A16]">Needs Attention</h3>
                </div>
                <div className="divide-y divide-[#E4E4DE]">
                  {alerts.map((a) => (
                    <Link key={a.id} href={a.href} className="flex items-center gap-2.5 px-5 py-3 hover:bg-[#F8F8F6] transition-colors">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.severity === "red" ? "bg-red-500" : "bg-amber-400"}`} />
                      <p className="text-xs text-[#1A1A16] flex-1">{a.text}</p>
                      <ChevronRight className="w-3.5 h-3.5 text-[#7A7A72] flex-shrink-0" />
                    </Link>
                  ))}
                </div>
              </Card>
            )}

            {/* Trainer Commission Summary */}
            <Card padding={false}>
                <div className="px-5 py-4 border-b border-[#E4E4DE]">
                  <h3 className="text-sm font-semibold text-[#1A1A16]">Trainer Commissions</h3>
                </div>
                <div className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#7A7A72]">Current Cycle</span>
                    <span className="text-xs font-semibold text-[#1A1A16]">{formatCycleLabel(currentAndNextCycle().current.cycleStart, currentAndNextCycle().current.cycleEnd)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#7A7A72]">Commission Earned</span>
                    <span className="text-sm font-bold text-[#1A1A16]">{formatPKR(commissionCurrentCycle)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#7A7A72]">Commission Pending</span>
                    <span className="text-sm font-bold text-amber-700">{formatPKR(commissionPending)}</span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-[#E4E4DE]">
                    <span className="text-xs text-[#7A7A72]">Next Payout</span>
                    <span className="text-sm font-bold text-[#F06418]">{commissionNextPayout ? formatDate(commissionNextPayout) : "—"}</span>
                  </div>
                  <Link href="/dashboard/commissions">
                    <span className="flex items-center justify-center gap-1 text-xs font-semibold text-[#F06418] hover:underline pt-1">View Trainer Commissions <ArrowRight className="w-3 h-3" /></span>
                  </Link>
                </div>
              </Card>

            {/* Membership Activity */}
            <Card padding={false}>
              <div className="px-5 py-4 border-b border-[#E4E4DE]">
                <h3 className="text-sm font-semibold text-[#1A1A16]">Membership Activity</h3>
              </div>
              <div className="divide-y divide-[#E4E4DE]">
                <Link href="/dashboard/members" className="flex items-center justify-between px-5 py-2.5 hover:bg-[#F8F8F6]">
                  <span className="text-xs text-[#4A4A44]">New Members</span><span className="text-sm font-bold text-[#1A1A16]">{newMembersCount}</span>
                </Link>
                <Link href="/dashboard/fees?tab=transactions" className="flex items-center justify-between px-5 py-2.5 hover:bg-[#F8F8F6]">
                  <span className="text-xs text-[#4A4A44]">Renewals</span><span className="text-sm font-bold text-[#1A1A16]">{renewalsCount}</span>
                </Link>
                <Link href="/dashboard/commissions" className="flex items-center justify-between px-5 py-2.5 hover:bg-[#F8F8F6]">
                  <span className="text-xs text-[#4A4A44]">PT Members Added</span><span className="text-sm font-bold text-[#1A1A16]">{ptAddedCount}</span>
                </Link>
                <Link href="/dashboard/daily-members" className="flex items-center justify-between px-5 py-2.5 hover:bg-[#F8F8F6]">
                  <span className="text-xs text-[#4A4A44]">Day Passes</span><span className="text-sm font-bold text-[#1A1A16]">{dayPassesCount}</span>
                </Link>
                <Link href="/dashboard/fees?tab=renewals" className="flex items-center justify-between px-5 py-2.5 hover:bg-[#F8F8F6]">
                  <span className="text-xs text-[#4A4A44]">Expiring (7 days)</span><span className="text-sm font-bold text-[#1A1A16]">{expiringMembers.length}</span>
                </Link>
              </div>
            </Card>

            {/* Collected By Staff */}
            {staffCollection.length > 0 && (
              <Card padding={false}>
                <div className="px-5 py-4 border-b border-[#E4E4DE]">
                  <h3 className="text-sm font-semibold text-[#1A1A16]">Collected By Staff</h3>
                </div>
                <div className="divide-y divide-[#E4E4DE]">
                  {staffCollection.map((s) => (
                    <div key={s.id} className="flex items-center justify-between px-5 py-2.5">
                      <div>
                        <p className="text-xs font-semibold text-[#1A1A16]">{s.name}</p>
                        <p className="text-[10px] text-[#7A7A72]">{s.count} transaction{s.count !== 1 ? "s" : ""}</p>
                      </div>
                      <span className="text-sm font-bold text-[#1A1A16]">{formatPKR(s.amount)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Attendance + Devices — secondary */}
            <Card padding={false}>
              <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#1A1A16]">Attendance Today</h3>
                <Link href="/dashboard/attendance" className="flex items-center gap-1 text-[10px] text-[#7A7A72] hover:text-[#F06418]">
                  <Wifi className="w-3 h-3" /> {devicesOnline}/{devicesTotal} devices
                </Link>
              </div>
              <div className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <CalendarCheck className="w-4 h-4 text-green-600" />
                  <span className="text-2xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)]">{attendanceToday}</span>
                  <span className="text-xs text-[#7A7A72]">check-ins</span>
                </div>
                <div className="flex items-end gap-1.5 h-12">
                  {attendanceTrend.map((d) => {
                    const max = Math.max(...attendanceTrend.map((x) => x.count), 1);
                    return (
                      <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                        <div className="w-full bg-[#F8F8F6] rounded-t relative" style={{ height: "32px" }}>
                          <div className="absolute bottom-0 left-0 right-0 bg-[#F06418] rounded-t transition-all" style={{ height: `${Math.max((d.count / max) * 100, d.count > 0 ? 8 : 0)}%` }} />
                        </div>
                        <span className="text-[9px] text-[#7A7A72]">{format(new Date(d.date + "T12:00:00"), "EEE")[0]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>

      {detailPaymentId && (
        <PaymentDetailModal paymentId={detailPaymentId} onClose={() => setDetailPaymentId(null)} onUpdated={fetchAll} />
      )}
    </div>
  );
}

// ── Trainer ─────────────────────────────────────────────────────────
function TrainerDashboard({ header }: { header: React.ReactNode }) {
  const currentUser = useCurrentUser();
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<{ id: string; full_name: string; expiry_date: string | null; packages?: { name: string } | null }[]>([]);
  const [cycleEarned, setCycleEarned] = useState(0);
  const [pending, setPending] = useState(0);
  const [nextPayout, setNextPayout] = useState<string | null>(null);
  const [attendanceToday, setAttendanceToday] = useState(0);

  useEffect(() => {
    if (!currentUser?.staff_id) { setLoading(false); return; }
    (async () => {
      const supabase = createClient();
      const today = format(new Date(), "yyyy-MM-dd");
      const { current } = currentAndNextCycle();
      const [{ data: assigned }, { data: currentCycleLedger }, { data: pendingLedger }, { count: attCount }] = await Promise.all([
        supabase.from("members").select("id, full_name, expiry_date, packages(name)").eq("trainer_id", currentUser.staff_id).eq("status", "active").is("deleted_at", null).order("full_name"),
        supabase.from("trainer_commission_ledger").select("commission_amount").eq("trainer_id", currentUser.staff_id).is("deleted_at", null).eq("cycle_start", current.cycleStart),
        supabase.from("trainer_commission_ledger").select("commission_amount, payout_date").eq("trainer_id", currentUser.staff_id).is("deleted_at", null).eq("status", "pending"),
        supabase.from("attendances").select("*", { count: "exact", head: true }).gte("punch_time", `${today}T00:00:00`).lte("punch_time", `${today}T23:59:59`),
      ]);
      setMembers((assigned ?? []) as any);
      setCycleEarned((currentCycleLedger ?? []).reduce((s, l) => s + l.commission_amount, 0));
      const pend = pendingLedger ?? [];
      setPending(pend.reduce((s, l) => s + l.commission_amount, 0));
      setNextPayout(pend.length ? pend.map((l) => l.payout_date).sort()[0] : null);
      setAttendanceToday(attCount ?? 0);
      setLoading(false);
    })();
  }, [currentUser?.staff_id]);

  return (
    <div className="flex flex-col flex-1">
      {header}
      <div className="flex-1 p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard title="My PT Members" value={members.length} icon={Users} iconColor="text-[#F06418]" iconBg="bg-[#FEF0E8]" loading={loading} />
          <StatsCard title="Commission This Cycle" value={formatPKR(cycleEarned)} icon={Percent} iconColor="text-green-600" iconBg="bg-green-50" loading={loading} />
          <StatsCard title="Commission Pending" value={formatPKR(pending)} icon={Clock} iconColor="text-amber-600" iconBg="bg-amber-50" loading={loading} />
          <StatsCard title="Today's Check-ins" value={attendanceToday} icon={CalendarCheck} iconColor="text-blue-600" iconBg="bg-blue-50" loading={loading} />
        </div>
        {nextPayout && (
          <p className="text-xs text-[#7A7A72]">Next commission payout: <span className="font-semibold text-[#1A1A16]">{formatDate(nextPayout)}</span></p>
        )}
        <Card padding={false}>
          <div className="px-5 py-4 border-b border-[#E4E4DE]">
            <h3 className="text-base font-semibold text-[#1A1A16]">My Assigned Members ({members.length})</h3>
          </div>
          {members.length === 0 ? (
            <div className="py-10 text-center text-sm text-[#7A7A72]">No members assigned yet</div>
          ) : (
            <div className="divide-y divide-[#E4E4DE]">
              {members.map((m) => {
                const days = daysUntilExpiry(m.expiry_date);
                return (
                  <Link key={m.id} href={`/dashboard/members/${m.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-[#F8F8F6]">
                    <div>
                      <p className="text-sm font-semibold text-[#1A1A16]">{m.full_name}</p>
                      <p className="text-xs text-[#7A7A72]">{m.packages?.name ?? "—"}</p>
                    </div>
                    <span className={`text-xs font-medium ${days !== null && days < 0 ? "text-red-600" : days !== null && days <= 7 ? "text-amber-600" : "text-[#7A7A72]"}`}>
                      {m.expiry_date ? `Membership End Date: ${formatDate(m.expiry_date)}` : "—"}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── Viewer ──────────────────────────────────────────────────────────
function ViewerDashboard({ header }: { header: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [activeCount, setActiveCount] = useState(0);
  const [attendanceToday, setAttendanceToday] = useState(0);
  const [pendingSubs, setPendingSubs] = useState(0);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const today = format(new Date(), "yyyy-MM-dd");
      const [{ count: active }, { count: att }, { count: subs }] = await Promise.all([
        supabase.from("members").select("*", { count: "exact", head: true }).eq("status", "active").is("deleted_at", null),
        supabase.from("attendances").select("*", { count: "exact", head: true }).gte("punch_time", `${today}T00:00:00`).lte("punch_time", `${today}T23:59:59`),
        supabase.from("submissions").select("*", { count: "exact", head: true }).eq("status", "pending").is("deleted_at", null),
      ]);
      setActiveCount(active ?? 0);
      setAttendanceToday(att ?? 0);
      setPendingSubs(subs ?? 0);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="flex flex-col flex-1">
      {header}
      <div className="flex-1 p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatsCard title="Active Members" value={activeCount} icon={Users} iconColor="text-[#F06418]" iconBg="bg-[#FEF0E8]" loading={loading} />
          <StatsCard title="Today's Attendance" value={attendanceToday} icon={CalendarCheck} iconColor="text-green-600" iconBg="bg-green-50" loading={loading} />
          <StatsCard title="Pending Submissions" value={pendingSubs} icon={Zap} iconColor="text-amber-600" iconBg="bg-amber-50" loading={loading} />
        </div>
      </div>
    </div>
  );
}
