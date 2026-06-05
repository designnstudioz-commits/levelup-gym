"use client";

import { useEffect, useState, useCallback } from "react";
import {
  format, subDays, startOfWeek, startOfMonth, startOfQuarter,
  startOfYear, subMonths, parseISO, eachDayOfInterval,
} from "date-fns";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import {
  Printer, RefreshCw, BarChart2, Users, CalendarCheck,
  CreditCard, ClipboardList, UserCog, FileText, Dumbbell,
  TrendingUp, ChevronRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { StatsCard } from "@/components/ui/StatsCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatPKR, formatDate, getMemberStatusDisplay } from "@/lib/utils";

// ── Constants ────────────────────────────────────────────────────────
type ReportType = "overview" | "revenue" | "membership" | "attendance" | "submissions" | "trainers" | "daily";
type Period = "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "custom";

const BRAND = "#F06418";
const CHART_COLORS = ["#F06418", "#2563EB", "#7C3AED", "#059669", "#DC2626", "#D97706", "#DB2777", "#1A1A1A"];
const METHOD_COLORS: Record<string, string> = {
  Cash: "#F06418", Bank: "#2563EB", Card: "#7C3AED", EasyPaisa: "#059669", JazzCash: "#DC2626",
};

const REPORTS: { key: ReportType; label: string; icon: React.ElementType }[] = [
  { key: "overview",    label: "Overview",         icon: BarChart2 },
  { key: "revenue",     label: "Revenue",          icon: CreditCard },
  { key: "membership",  label: "Membership",       icon: Users },
  { key: "attendance",  label: "Attendance",       icon: CalendarCheck },
  { key: "submissions", label: "Leads & Signups",  icon: ClipboardList },
  { key: "trainers",    label: "Trainers",         icon: UserCog },
  { key: "daily",       label: "Daily Summary",    icon: FileText },
];

// Shared tooltip style
const tooltipStyle = { backgroundColor: "#1A1A1A", border: "none", borderRadius: "8px", color: "#fff", fontSize: 12 };

// ── Date range helpers ───────────────────────────────────────────────
function periodBounds(period: Period, customFrom: string, customTo: string): { from: string; to: string } {
  const today = new Date();
  const t = format(today, "yyyy-MM-dd");
  if (period === "daily")     return { from: t, to: t };
  if (period === "weekly")    return { from: format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd"), to: t };
  if (period === "monthly")   return { from: format(startOfMonth(today), "yyyy-MM-dd"), to: t };
  if (period === "quarterly") return { from: format(startOfQuarter(today), "yyyy-MM-dd"), to: t };
  if (period === "yearly")    return { from: format(startOfYear(today), "yyyy-MM-dd"), to: t };
  return { from: customFrom || format(startOfMonth(today), "yyyy-MM-dd"), to: customTo || t };
}

// Group array of {date, amount} by month label
function groupByMonth(rows: { date: string; amount?: number; count?: number }[], key: "amount" | "count" = "amount") {
  const map: Record<string, number> = {};
  rows.forEach((r) => {
    const label = format(parseISO(r.date), "MMM yy");
    map[label] = (map[label] || 0) + (key === "amount" ? (r.amount ?? 0) : (r.count ?? 1));
  });
  return Object.entries(map).map(([label, value]) => ({ label, value }));
}

// ── Main Page ────────────────────────────────────────────────────────
export default function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>("overview");
  const [period, setPeriod]         = useState<Period>("monthly");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo]     = useState("");
  const [loading, setLoading]       = useState(false);
  const [data, setData]             = useState<any>({});

  const { from, to } = periodBounds(period, customFrom, customTo);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const today = format(new Date(), "yyyy-MM-dd");

    const [
      { data: payments },
      { data: members },
      { data: attendances },
      { data: submissions },
      { data: trainers },
      { data: expenses },
      { data: dailyMembers },
    ] = await Promise.all([
      supabase.from("fee_payments").select("id, amount, payment_type, payment_method, payment_date, member_id").is("deleted_at", null).gte("payment_date", from).lte("payment_date", to),
      supabase.from("members").select("id, full_name, membership_no, gender, status, joining_date, expiry_date, package_id, monthly_fee, packages(name, color), trainer_id").is("deleted_at", null),
      supabase.from("attendances").select("id, punch_time, punch_type, member_id, device_id").gte("punch_time", `${from}T00:00:00+05:00`).lte("punch_time", `${to}T23:59:59+05:00`),
      supabase.from("submissions").select("id, status, referral_source, created_at, reviewed_at, gender").is("deleted_at", null).gte("created_at", `${from}T00:00:00`).lte("created_at", `${to}T23:59:59`),
      supabase.from("staff_members").select("id, full_name, role, salary").eq("role", "Trainer").eq("status", "active").is("deleted_at", null),
      supabase.from("expenses").select("id, amount, expense_date, expense_head").is("deleted_at", null).gte("expense_date", from).lte("expense_date", to),
      supabase.from("daily_members").select("id, fee_paid, visit_date, gender, converted_to_member_id").is("deleted_at", null).gte("visit_date", from).lte("visit_date", to),
    ]);

    // For trainers: count members per trainer
    const trainerMemberCounts: Record<string, number> = {};
    (members ?? []).forEach((m: any) => {
      if (m.trainer_id) trainerMemberCounts[m.trainer_id] = (trainerMemberCounts[m.trainer_id] || 0) + 1;
    });

    setData({ payments: payments ?? [], members: members ?? [], attendances: attendances ?? [], submissions: submissions ?? [], trainers: trainers ?? [], expenses: expenses ?? [], dailyMembers: dailyMembers ?? [], trainerMemberCounts, today });
    setLoading(false);
  }, [from, to]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const PERIOD_TABS: { key: Period; label: string }[] = [
    { key: "daily", label: "Today" }, { key: "weekly", label: "Week" },
    { key: "monthly", label: "Month" }, { key: "quarterly", label: "Quarter" },
    { key: "yearly", label: "Year" }, { key: "custom", label: "Custom" },
  ];

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .report-sidebar { display: none !important; }
          .print-header { display: block !important; }
          .report-section { page-break-inside: avoid; margin-bottom: 24px; }
          body { background: white !important; }
          .recharts-wrapper { max-width: 100% !important; }
        }
        @page { margin: 1.5cm; size: A4 landscape; }
        .print-header { display: none; }
      `}</style>

      <div className="flex h-full">
        {/* ── Sidebar ──────────────────────────────────────────── */}
        <aside className="report-sidebar w-52 bg-white border-r border-[#E4E4DE] flex-shrink-0 flex flex-col no-print">
          <div className="px-4 py-4 border-b border-[#E4E4DE]">
            <p className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide">Reports</p>
          </div>
          <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
            {REPORTS.map(({ key, label, icon: Icon }) => (
              <button key={key} onClick={() => setReportType(key)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${reportType === key ? "bg-[#FEF0E8] text-[#F06418]" : "text-[#4A4A44] hover:bg-[#F8F8F6]"}`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
                {reportType === key && <ChevronRight className="w-3 h-3 ml-auto" />}
              </button>
            ))}
          </nav>
        </aside>

        {/* ── Main content ─────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="no-print bg-white border-b border-[#E4E4DE] px-6 py-4 flex items-center justify-between flex-shrink-0">
            <div>
              <h1 className="text-xl font-bold text-[#1A1A16] uppercase tracking-wide" style={{ fontFamily: "var(--font-barlow-condensed)" }}>
                {REPORTS.find((r) => r.key === reportType)?.label ?? "Reports"}
              </h1>
              <p className="text-xs text-[#7A7A72] mt-0.5">{formatDate(from)} — {formatDate(to)}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={fetchData} disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
              <Button size="sm" onClick={() => window.print()}>
                <Printer className="w-4 h-4" /> Export PDF
              </Button>
            </div>
          </div>

          {/* Period filter */}
          <div className="no-print bg-white border-b border-[#E4E4DE] px-6 py-3 flex flex-wrap items-center gap-3">
            <div className="flex bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg p-0.5 gap-0.5">
              {PERIOD_TABS.map((t) => (
                <button key={t.key} onClick={() => setPeriod(t.key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${period === t.key ? "bg-[#F06418] text-white" : "text-[#4A4A44] hover:bg-white"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {period === "custom" && (
              <div className="flex items-center gap-2">
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
                <span className="text-xs text-[#7A7A72]">to</span>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
              </div>
            )}
            <span className="ml-auto text-xs text-[#7A7A72]">{formatDate(from)} — {formatDate(to)}</span>
          </div>

          {/* Print header (only shows when printing) */}
          <div className="print-header px-6 py-4 border-b border-[#E4E4DE]">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Level Up Fitness Club" className="h-12 w-auto object-contain" />
              <div>
                <p className="text-xs text-[#7A7A72]">Paragon City, Lahore · 03000202902</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-base font-bold">{REPORTS.find((r) => r.key === reportType)?.label} Report</p>
                <p className="text-xs text-[#7A7A72]">{formatDate(from)} — {formatDate(to)} · Generated {format(new Date(), "dd MMM yyyy, hh:mm a")}</p>
              </div>
            </div>
          </div>

          {/* Report content */}
          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center py-24">
                <div className="text-center">
                  <RefreshCw className="w-8 h-8 text-[#F06418] animate-spin mx-auto mb-3" />
                  <p className="text-sm text-[#7A7A72]">Loading report data...</p>
                </div>
              </div>
            ) : (
              <>
                {reportType === "overview"    && <OverviewReport    data={data} from={from} to={to} />}
                {reportType === "revenue"     && <RevenueReport     data={data} from={from} to={to} />}
                {reportType === "membership"  && <MembershipReport  data={data} />}
                {reportType === "attendance"  && <AttendanceReport  data={data} />}
                {reportType === "submissions" && <SubmissionsReport data={data} />}
                {reportType === "trainers"    && <TrainersReport    data={data} />}
                {reportType === "daily"       && <DailySummaryReport data={data} />}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Shared components ────────────────────────────────────────────────
function ChartCard({ title, subtitle, children, className = "" }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`report-section bg-white border border-[#E4E4DE] rounded-xl p-5 ${className}`}>
      <div className="mb-4">
        <p className="text-sm font-semibold text-[#1A1A16]">{title}</p>
        {subtitle && <p className="text-xs text-[#7A7A72] mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function KpiCard({ label, value, sub, color = BRAND }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="report-section bg-white border border-[#E4E4DE] rounded-xl p-4">
      <p className="text-xs text-[#7A7A72] font-medium">{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color, fontFamily: "var(--font-barlow-condensed)" }}>{value}</p>
      {sub && <p className="text-xs text-[#7A7A72] mt-0.5">{sub}</p>}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label, isCurrency = false }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={tooltipStyle} className="px-3 py-2 rounded-lg shadow-xl">
      <p className="text-white/60 text-[10px] mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-xs font-semibold" style={{ color: p.color || "#fff" }}>
          {p.name}: {isCurrency ? formatPKR(p.value) : p.value}
        </p>
      ))}
    </div>
  );
};

// ── 1. Overview Report ───────────────────────────────────────────────
function OverviewReport({ data, from, to }: { data: any; from: string; to: string }) {
  const { payments = [], members = [], attendances = [], submissions = [] } = data;

  const totalRevenue    = payments.reduce((s: number, p: any) => s + (p.amount ?? 0), 0);
  const activeMembers   = members.filter((m: any) => m.status === "active").length;
  const totalCheckIns   = attendances.filter((a: any) => a.punch_type === "in").length;
  const approvedSubs    = submissions.filter((s: any) => s.status === "approved").length;

  // Last 12 months revenue for sparkline
  const revenueByMonth: Record<string, number> = {};
  payments.forEach((p: any) => {
    const label = format(parseISO(p.payment_date), "MMM");
    revenueByMonth[label] = (revenueByMonth[label] || 0) + (p.amount ?? 0);
  });
  const sparkData = Object.entries(revenueByMonth).map(([label, value]) => ({ label, value }));

  // Member status breakdown for donut
  const statusCounts = members.reduce((acc: any, m: any) => {
    acc[m.status] = (acc[m.status] || 0) + 1;
    return acc;
  }, {});
  const statusData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));

  // Daily attendance for bar
  const attByDay: Record<string, number> = {};
  attendances.filter((a: any) => a.punch_type === "in").forEach((a: any) => {
    const day = format(new Date(a.punch_time), "dd/MM");
    attByDay[day] = (attByDay[day] || 0) + 1;
  });
  const attData = Object.entries(attByDay).slice(-14).map(([label, value]) => ({ label, value }));

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 report-section">
        <KpiCard label="Revenue (Period)" value={formatPKR(totalRevenue)} color={BRAND} />
        <KpiCard label="Active Members" value={activeMembers} color="#2563EB" />
        <KpiCard label="Check-ins" value={totalCheckIns} color="#059669" />
        <KpiCard label="New Members" value={approvedSubs} color="#7C3AED" sub="approved submissions" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Revenue trend */}
        <ChartCard title="Revenue Trend" subtitle="Collections over selected period">
          {sparkData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={sparkData}>
                <defs>
                  <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={BRAND} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={BRAND} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F0EE" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
                <Tooltip content={<CustomTooltip isCurrency />} />
                <Area dataKey="value" name="Revenue" stroke={BRAND} fill="url(#grad1)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Member status donut */}
        <ChartCard title="Member Status Breakdown" subtitle="All members by current status">
          {statusData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={statusData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="value" nameKey="name">
                  {statusData.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Attendance trend */}
        <ChartCard title="Attendance Trend" subtitle="Daily check-ins over period">
          {attData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={attData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F0EE" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" name="Check-ins" fill="#059669" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Submissions funnel */}
        <ChartCard title="Leads Conversion" subtitle="Submission pipeline">
          <FunnelChart data={[
            { label: "Submitted", value: submissions.length, color: "#7C3AED" },
            { label: "Approved", value: submissions.filter((s: any) => s.status === "approved").length, color: "#059669" },
            { label: "Rejected", value: submissions.filter((s: any) => s.status === "rejected").length, color: "#DC2626" },
          ]} />
        </ChartCard>
      </div>
    </div>
  );
}

// ── 2. Revenue Report ────────────────────────────────────────────────
function RevenueReport({ data, from, to }: { data: any; from: string; to: string }) {
  const { payments = [], expenses = [] } = data;

  const totalRevenue  = payments.reduce((s: number, p: any) => s + (p.amount ?? 0), 0);
  const totalExpenses = expenses.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
  const netProfit     = totalRevenue - totalExpenses;

  // Revenue by day
  const byDay: Record<string, number> = {};
  payments.forEach((p: any) => {
    const d = format(parseISO(p.payment_date), "dd MMM");
    byDay[d] = (byDay[d] || 0) + (p.amount ?? 0);
  });
  const dayData = Object.entries(byDay).map(([label, value]) => ({ label, value }));

  // By payment method
  const byMethod: Record<string, number> = {};
  payments.forEach((p: any) => { if (p.payment_method) byMethod[p.payment_method] = (byMethod[p.payment_method] || 0) + (p.amount ?? 0); });
  const methodData = Object.entries(byMethod).map(([name, value]) => ({ name, value }));

  // By payment type
  const byType: Record<string, number> = {};
  payments.forEach((p: any) => { if (p.payment_type) byType[p.payment_type] = (byType[p.payment_type] || 0) + (p.amount ?? 0); });
  const typeData = Object.entries(byType).map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }));

  // By package (needs member lookup)
  const packageRevenue: Record<string, number> = {};
  payments.forEach((p: any) => {
    const member = data.members?.find((m: any) => m.id === p.member_id);
    const pkgName = (member as any)?.packages?.name ?? "Unknown";
    packageRevenue[pkgName] = (packageRevenue[pkgName] || 0) + (p.amount ?? 0);
  });
  const pkgData = Object.entries(packageRevenue).sort(([, a], [, b]) => b - a).map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 report-section">
        <KpiCard label="Total Collected" value={formatPKR(totalRevenue)} />
        <KpiCard label="Total Expenses" value={formatPKR(totalExpenses)} color="#DC2626" />
        <KpiCard label="Net Profit" value={formatPKR(netProfit)} color={netProfit >= 0 ? "#059669" : "#DC2626"} />
        <KpiCard label="Transactions" value={payments.length} color="#2563EB" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title="Daily Revenue" subtitle="Collections per day in selected period" className="lg:col-span-2">
          {dayData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dayData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F0EE" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
                <Tooltip content={<CustomTooltip isCurrency />} />
                <Bar dataKey="value" name="Revenue" fill={BRAND} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Revenue by Payment Method" subtitle="How members pay">
          {methodData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={methodData} cx="50%" cy="50%" innerRadius={60} outerRadius={85} dataKey="value" nameKey="name">
                  {methodData.map((m: any) => <Cell key={m.name} fill={METHOD_COLORS[m.name] ?? BRAND} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatPKR(v as number)} />
                <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Revenue by Type" subtitle="Membership vs Trainer vs Admission">
          {typeData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={typeData} cx="50%" cy="50%" innerRadius={60} outerRadius={85} dataKey="value" nameKey="name">
                  {typeData.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatPKR(v as number)} />
                <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Revenue by Package" subtitle="Which packages generate most revenue" className="lg:col-span-2">
          {pkgData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={Math.max(pkgData.length * 44, 150)}>
              <BarChart data={pkgData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F0EE" />
                <XAxis type="number" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={130} />
                <Tooltip content={<CustomTooltip isCurrency />} />
                <Bar dataKey="value" name="Revenue" fill={BRAND} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Transactions table */}
      <ChartCard title="Transactions" subtitle={`${payments.length} records · Total: ${formatPKR(totalRevenue)}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E4E4DE]">
                {["Date", "Member", "Amount", "Type", "Method"].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-[#7A7A72] pb-2 pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F0EE]">
              {payments.slice(0, 20).map((p: any) => {
                const m = data.members?.find((mem: any) => mem.id === p.member_id);
                return (
                  <tr key={p.id}>
                    <td className="py-2 pr-4 text-xs text-[#4A4A44]">{formatDate(p.payment_date)}</td>
                    <td className="py-2 pr-4 text-sm font-medium text-[#1A1A16]">{m?.full_name ?? "—"}</td>
                    <td className="py-2 pr-4 text-sm font-bold text-green-700">{formatPKR(p.amount)}</td>
                    <td className="py-2 pr-4 text-xs text-[#4A4A44] capitalize">{p.payment_type ?? "—"}</td>
                    <td className="py-2 pr-4 text-xs text-[#4A4A44]">{p.payment_method ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}

// ── 3. Membership Report ─────────────────────────────────────────────
function MembershipReport({ data }: { data: any }) {
  const { members = [] } = data;
  const active   = members.filter((m: any) => m.status === "active").length;
  const inactive = members.filter((m: any) => m.status === "inactive").length;
  const frozen   = members.filter((m: any) => m.status === "frozen").length;

  const statusData = [
    { name: "Active",   value: active,   fill: "#059669" },
    { name: "Inactive", value: inactive, fill: "#9CA3AF" },
    { name: "Frozen",   value: frozen,   fill: "#2563EB" },
  ].filter((d) => d.value > 0);

  // By package
  const byPkg: Record<string, number> = {};
  members.forEach((m: any) => {
    const name = (m as any).packages?.name ?? "No Package";
    byPkg[name] = (byPkg[name] || 0) + 1;
  });
  const pkgData = Object.entries(byPkg).sort(([, a], [, b]) => b - a).map(([name, value]) => ({ name, value }));

  // Gender
  const maleCount   = members.filter((m: any) => m.gender === "Male").length;
  const femaleCount = members.filter((m: any) => m.gender === "Female").length;
  const genderData  = [{ name: "Male", value: maleCount, fill: "#2563EB" }, { name: "Female", value: femaleCount, fill: "#DB2777" }].filter((d) => d.value > 0);

  // Joined by month
  const joinedByMonth: Record<string, number> = {};
  members.forEach((m: any) => {
    if (m.joining_date) {
      const label = format(parseISO(m.joining_date), "MMM yy");
      joinedByMonth[label] = (joinedByMonth[label] || 0) + 1;
    }
  });
  const joinData = Object.entries(joinedByMonth).slice(-12).map(([label, value]) => ({ label, value }));

  // Expiring in 30 days
  const today = format(new Date(), "yyyy-MM-dd");
  const exp30 = format(new Date(Date.now() + 30 * 86400000), "yyyy-MM-dd");
  const expiring = members.filter((m: any) => m.status === "active" && m.expiry_date && m.expiry_date >= today && m.expiry_date <= exp30);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 report-section">
        <KpiCard label="Total Members" value={members.length} />
        <KpiCard label="Active" value={active} color="#059669" />
        <KpiCard label="Inactive / Frozen" value={inactive + frozen} color="#9CA3AF" />
        <KpiCard label="Expiring in 30 Days" value={expiring.length} color="#D97706" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title="Joined Per Month" subtitle="New member acquisitions">
          {joinData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={joinData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F0EE" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" name="Joined" fill={BRAND} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Status Breakdown">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={statusData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="value" nameKey="name">
                {statusData.map((d) => <Cell key={d.name} fill={d.fill} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Members by Package">
          {pkgData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={Math.max(pkgData.length * 40, 120)}>
              <BarChart data={pkgData} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={110} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" name="Members" fill={BRAND} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Gender Distribution">
          {genderData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={genderData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="value" nameKey="name">
                  {genderData.map((d) => <Cell key={d.name} fill={d.fill} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Expiring soon table */}
      {expiring.length > 0 && (
        <ChartCard title={`Expiring in 30 Days (${expiring.length} members)`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E4E4DE]">
                {["Member", "Membership No", "Package", "Expiry Date", "Days Left"].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-[#7A7A72] pb-2 pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F0EE]">
              {expiring.map((m: any) => {
                const days = Math.ceil((new Date(m.expiry_date).getTime() - Date.now()) / 86400000);
                return (
                  <tr key={m.id}>
                    <td className="py-2 pr-4 font-medium text-[#1A1A16]">{m.full_name}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-[#F06418]">{m.membership_no}</td>
                    <td className="py-2 pr-4 text-xs text-[#4A4A44]">{(m as any).packages?.name ?? "—"}</td>
                    <td className="py-2 pr-4 text-xs text-[#4A4A44]">{formatDate(m.expiry_date)}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${days <= 7 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{days}d</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ChartCard>
      )}
    </div>
  );
}

// ── 4. Attendance Report ─────────────────────────────────────────────
function AttendanceReport({ data }: { data: any }) {
  const { attendances = [], members = [] } = data;
  const checkIns = attendances.filter((a: any) => a.punch_type === "in");

  // By hour
  const byHour: Record<number, number> = {};
  for (let h = 0; h < 24; h++) byHour[h] = 0;
  checkIns.forEach((a: any) => {
    const h = new Date(a.punch_time).getHours();
    byHour[h] = (byHour[h] || 0) + 1;
  });
  const hourData = Object.entries(byHour).map(([h, count]) => ({ label: `${h}:00`, hour: Number(h), value: count }));

  // By day of week
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const byDow: Record<string, number> = Object.fromEntries(DOW.map((d) => [d, 0]));
  checkIns.forEach((a: any) => {
    const dow = format(new Date(a.punch_time), "EEE");
    if (byDow[dow] !== undefined) byDow[dow]++;
  });
  const dowData = DOW.map((d) => ({ label: d, value: byDow[d] }));

  // By device
  const byDevice: Record<string, number> = {};
  checkIns.forEach((a: any) => { const d = a.device_id ?? "Unknown"; byDevice[d] = (byDevice[d] || 0) + 1; });
  const deviceData = Object.entries(byDevice).map(([name, value]) => ({ name, value }));

  // Top members
  const memberCounts: Record<string, number> = {};
  checkIns.forEach((a: any) => { if (a.member_id) memberCounts[a.member_id] = (memberCounts[a.member_id] || 0) + 1; });
  const topMembers = Object.entries(memberCounts)
    .sort(([, a], [, b]) => b - a).slice(0, 15)
    .map(([id, count]) => {
      const m = members.find((mem: any) => mem.id === id);
      return { name: m?.full_name ?? "Unknown", no: m?.membership_no ?? "—", count };
    });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 report-section">
        <KpiCard label="Total Check-ins" value={checkIns.length} />
        <KpiCard label="Check-outs" value={attendances.filter((a: any) => a.punch_type === "out").length} color="#2563EB" />
        <KpiCard label="Unique Members" value={new Set(checkIns.map((a: any) => a.member_id).filter(Boolean)).size} color="#7C3AED" />
        <KpiCard label="Active Devices" value={new Set(attendances.map((a: any) => a.device_id).filter(Boolean)).size} color="#059669" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title="Peak Hours" subtitle="Check-ins by hour of day" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hourData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F0EE" />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" name="Check-ins" fill={BRAND} radius={[2, 2, 0, 0]}>
                {hourData.map((d) => (
                  <Cell key={d.hour} fill={d.value === Math.max(...hourData.map((h) => h.value)) ? BRAND : "#FDDCC8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Day of Week Distribution" subtitle="Busiest days">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dowData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F0EE" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" name="Check-ins" fill="#2563EB" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="By Device / Door" subtitle="Which machine recorded the most punches">
          {deviceData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={deviceData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="value" nameKey="name">
                  {deviceData.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <ChartCard title="Most Active Members" subtitle="Ranked by check-in frequency">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[#E4E4DE]">
            {["Rank", "Member", "Membership No", "Check-ins"].map((h) => (
              <th key={h} className="text-left text-xs font-semibold text-[#7A7A72] pb-2 pr-4">{h}</th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-[#F0F0EE]">
            {topMembers.map((m, i) => (
              <tr key={m.no}>
                <td className="py-2 pr-4">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${i === 0 ? "bg-amber-100 text-amber-700" : i === 1 ? "bg-gray-100 text-gray-600" : i === 2 ? "bg-orange-100 text-orange-700" : "text-[#7A7A72]"}`}>#{i + 1}</span>
                </td>
                <td className="py-2 pr-4 font-medium text-[#1A1A16]">{m.name}</td>
                <td className="py-2 pr-4 font-mono text-xs text-[#F06418]">{m.no}</td>
                <td className="py-2 pr-4">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-[#F8F8F6] rounded-full max-w-24">
                      <div className="h-1.5 bg-[#F06418] rounded-full" style={{ width: `${(m.count / (topMembers[0]?.count || 1)) * 100}%` }} />
                    </div>
                    <span className="text-sm font-bold text-[#1A1A16]">{m.count}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartCard>
    </div>
  );
}

// ── 5. Submissions Report ────────────────────────────────────────────
function SubmissionsReport({ data }: { data: any }) {
  const { submissions = [] } = data;
  const approved  = submissions.filter((s: any) => s.status === "approved");
  const rejected  = submissions.filter((s: any) => s.status === "rejected");
  const pending   = submissions.filter((s: any) => s.status === "pending");
  const convRate  = submissions.length > 0 ? Math.round((approved.length / submissions.length) * 100) : 0;

  // By month
  const byMonth: Record<string, { submitted: number; approved: number; rejected: number }> = {};
  submissions.forEach((s: any) => {
    const label = format(parseISO(s.created_at), "MMM yy");
    if (!byMonth[label]) byMonth[label] = { submitted: 0, approved: 0, rejected: 0 };
    byMonth[label].submitted++;
    if (s.status === "approved") byMonth[label].approved++;
    if (s.status === "rejected") byMonth[label].rejected++;
  });
  const monthData = Object.entries(byMonth).map(([label, v]) => ({ label, ...v }));

  // By referral source
  const bySrc: Record<string, number> = {};
  submissions.forEach((s: any) => { if (s.referral_source) bySrc[s.referral_source] = (bySrc[s.referral_source] || 0) + 1; });
  const srcData = Object.entries(bySrc).sort(([, a], [, b]) => b - a).map(([name, value]) => ({ name, value }));

  // Status donut
  const statusData = [
    { name: "Approved", value: approved.length, fill: "#059669" },
    { name: "Rejected", value: rejected.length, fill: "#DC2626" },
    { name: "Pending",  value: pending.length,  fill: "#D97706" },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 report-section">
        <KpiCard label="Total Submissions" value={submissions.length} />
        <KpiCard label="Approved" value={approved.length} color="#059669" />
        <KpiCard label="Rejected" value={rejected.length} color="#DC2626" />
        <KpiCard label="Conversion Rate" value={`${convRate}%`} color="#7C3AED" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title="Monthly Pipeline" subtitle="Submitted vs Approved vs Rejected" className="lg:col-span-2">
          {monthData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F0EE" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="submitted" name="Submitted" fill="#7C3AED" radius={[2, 2, 0, 0]} />
                <Bar dataKey="approved"  name="Approved"  fill="#059669" radius={[2, 2, 0, 0]} />
                <Bar dataKey="rejected"  name="Rejected"  fill="#DC2626" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Status Breakdown">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={statusData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="value" nameKey="name">
                {statusData.map((d) => <Cell key={d.name} fill={d.fill} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Referral Sources" subtitle="Where members heard about us">
          {srcData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={srcData} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 9 }} width={140} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" name="Count" fill={BRAND} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

// ── 6. Trainer Report ────────────────────────────────────────────────
function TrainersReport({ data }: { data: any }) {
  const { trainers = [], members = [], payments = [], trainerMemberCounts = {} } = data;

  const trainerData = trainers.map((t: any) => ({
    name: t.full_name,
    members: trainerMemberCounts[t.id] || 0,
    salary: t.salary ?? 0,
    fees: payments.filter((p: any) => {
      const m = members.find((mem: any) => mem.id === p.member_id);
      return m?.trainer_id === t.id && p.payment_type === "trainer";
    }).reduce((s: number, p: any) => s + (p.amount ?? 0), 0),
  })).sort((a: any, b: any) => b.members - a.members);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 report-section">
        <KpiCard label="Total Trainers" value={trainers.length} />
        <KpiCard label="Members in Training" value={Object.values(trainerMemberCounts as Record<string, number>).reduce((s, v) => s + v, 0)} color="#2563EB" />
        <KpiCard label="Avg Members / Trainer" value={trainers.length > 0 ? Math.round((Object.values(trainerMemberCounts as Record<string, number>).reduce((s, v) => s + v, 0)) / trainers.length) : 0} color="#7C3AED" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title="Members per Trainer" className="lg:col-span-2">
          {trainerData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={Math.max(trainerData.length * 44, 150)}>
              <BarChart data={trainerData} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="members" name="Members" fill={BRAND} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <ChartCard title="Trainer Summary">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[#E4E4DE]">
            {["Trainer", "Members", "Training Fees Collected", "Monthly Salary"].map((h) => (
              <th key={h} className="text-left text-xs font-semibold text-[#7A7A72] pb-2 pr-4">{h}</th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-[#F0F0EE]">
            {trainerData.map((t: any) => (
              <tr key={t.name}>
                <td className="py-2 pr-4 font-medium text-[#1A1A16]">{t.name}</td>
                <td className="py-2 pr-4"><span className="font-bold text-[#F06418]">{t.members}</span></td>
                <td className="py-2 pr-4 font-medium text-green-700">{formatPKR(t.fees)}</td>
                <td className="py-2 pr-4 text-[#4A4A44]">{formatPKR(t.salary)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartCard>
    </div>
  );
}

// ── 7. Daily Summary ─────────────────────────────────────────────────
function DailySummaryReport({ data }: { data: any }) {
  const { payments = [], attendances = [], members = [], submissions = [], dailyMembers = [], today } = data;
  const todayStr = today ?? format(new Date(), "yyyy-MM-dd");

  const todayPayments  = payments.filter((p: any) => p.payment_date === todayStr);
  const todayCheckins  = attendances.filter((a: any) => a.punch_type === "in" && format(new Date(a.punch_time), "yyyy-MM-dd") === todayStr);
  const todayJoined    = members.filter((m: any) => m.joining_date === todayStr);
  const todayWalkIns   = dailyMembers.filter((d: any) => d.visit_date === todayStr);
  const todayRevenue   = todayPayments.reduce((s: number, p: any) => s + (p.amount ?? 0), 0);
  const walkInRevenue  = todayWalkIns.reduce((s: number, d: any) => s + (d.fee_paid ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="report-section text-center mb-2">
        <p className="text-lg font-bold text-[#7A7A72] uppercase tracking-widest">Daily Summary</p>
        <p className="text-3xl font-bold text-[#1A1A16]" style={{ fontFamily: "var(--font-barlow-condensed)" }}>
          {format(new Date(), "EEEE, dd MMMM yyyy")}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 report-section">
        <KpiCard label="Fee Revenue" value={formatPKR(todayRevenue)} />
        <KpiCard label="Walk-in Revenue" value={formatPKR(walkInRevenue)} color="#2563EB" />
        <KpiCard label="Member Check-ins" value={todayCheckins.length} color="#059669" />
        <KpiCard label="Walk-in Visitors" value={todayWalkIns.length} color="#7C3AED" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title={`Fee Payments Today (${todayPayments.length})`}>
          {todayPayments.length === 0 ? <p className="text-sm text-[#7A7A72] py-4 text-center">No payments today</p> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[#E4E4DE]">
                {["Member", "Amount", "Type", "Method"].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-[#7A7A72] pb-2 pr-3">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-[#F0F0EE]">
                {todayPayments.map((p: any) => {
                  const m = members.find((mem: any) => mem.id === p.member_id);
                  return (
                    <tr key={p.id}>
                      <td className="py-1.5 pr-3 font-medium text-[#1A1A16] text-xs">{m?.full_name ?? "—"}</td>
                      <td className="py-1.5 pr-3 font-bold text-green-700 text-xs">{formatPKR(p.amount)}</td>
                      <td className="py-1.5 pr-3 text-xs text-[#4A4A44] capitalize">{p.payment_type ?? "—"}</td>
                      <td className="py-1.5 pr-3 text-xs text-[#4A4A44]">{p.payment_method ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </ChartCard>

        <ChartCard title={`Attendance Today (${todayCheckins.length} check-ins)`}>
          {todayCheckins.length === 0 ? <p className="text-sm text-[#7A7A72] py-4 text-center">No check-ins today</p> : (
            <div className="space-y-1.5 max-h-52 overflow-y-auto">
              {todayCheckins.slice(0, 20).map((a: any) => {
                const m = members.find((mem: any) => mem.id === a.member_id);
                const t = format(new Date(a.punch_time), "hh:mm a");
                return (
                  <div key={a.id} className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#1A1A16]">{m?.full_name ?? "Unknown"}</span>
                    <span className="text-[#7A7A72] font-mono">{t}</span>
                  </div>
                );
              })}
            </div>
          )}
        </ChartCard>
      </div>

      {todayJoined.length > 0 && (
        <ChartCard title={`New Members Today (${todayJoined.length})`}>
          <div className="flex flex-wrap gap-2">
            {todayJoined.map((m: any) => (
              <span key={m.id} className="text-xs bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full font-medium">
                ✓ {m.full_name} — {m.membership_no}
              </span>
            ))}
          </div>
        </ChartCard>
      )}
    </div>
  );
}

// ── Shared small components ──────────────────────────────────────────
function EmptyChart() {
  return (
    <div className="h-32 flex items-center justify-center">
      <p className="text-sm text-[#7A7A72]">No data for this period</p>
    </div>
  );
}

function FunnelChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-3 py-2">
      {data.map((d) => (
        <div key={d.label}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-[#4A4A44] font-medium">{d.label}</span>
            <span className="font-bold text-[#1A1A16]">{d.value}</span>
          </div>
          <div className="h-6 bg-[#F8F8F6] rounded-lg overflow-hidden">
            <div className="h-full rounded-lg flex items-center pl-2 transition-all duration-700" style={{ width: `${Math.max((d.value / max) * 100, d.value > 0 ? 8 : 0)}%`, backgroundColor: d.color }}>
              {d.value > 0 && <span className="text-white text-[10px] font-bold">{d.value}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
