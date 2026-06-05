"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { format, subDays, startOfWeek, startOfMonth } from "date-fns";
import { toast } from "sonner";
import {
  UserPlus, RefreshCw, Search, X, Users, CreditCard,
  TrendingUp, ArrowRight, CheckCircle2, Calendar,
  Zap, ChevronDown,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { StatsCard } from "@/components/ui/StatsCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { ViewToggle, type ViewMode } from "@/components/ui/ViewToggle";
import { formatDate, formatPKR, generateMembershipNo } from "@/lib/utils";
import type { DailyMember, Package, StaffMember } from "@/types/database";
import { addMonths } from "date-fns";

// ── Constants ────────────────────────────────────────────────────────
const PURPOSES = ["Day Pass", "Trial", "Guest of Member", "Enquiry", "Event", "Other"];
const PAYMENT_METHODS = ["Cash", "Bank", "Card", "EasyPaisa", "JazzCash"];

type DateRange = "today" | "yesterday" | "week" | "month" | "custom";

const PURPOSE_COLORS: Record<string, string> = {
  "Day Pass":         "bg-[#FEF0E8] text-[#C04E10] border-[#FDDCC8]",
  "Trial":            "bg-blue-50 text-blue-700 border-blue-200",
  "Guest of Member":  "bg-purple-50 text-purple-700 border-purple-200",
  "Enquiry":          "bg-yellow-50 text-yellow-700 border-yellow-200",
  "Event":            "bg-green-50 text-green-700 border-green-200",
  "Other":            "bg-gray-100 text-gray-600 border-gray-200",
};

const emptyForm = {
  full_name: "", phone: "", gender: "", age: "",
  purpose: "Day Pass", fee_paid: "", payment_method: "Cash", notes: "",
};

// ── Page ────────────────────────────────────────────────────────────
export default function DailyMembersPage() {
  const router = useRouter();

  const [visitors, setVisitors]   = useState<DailyMember[]>([]);
  const [loading, setLoading]     = useState(true);
  const [viewMode, setViewMode]   = useState<ViewMode>("list");

  // Filters
  const [dateRange, setDateRange]     = useState<DateRange>("today");
  const [customDate, setCustomDate]   = useState("");
  const [search, setSearch]           = useState("");
  const [genderFilter, setGenderFilter] = useState<"all" | "Male" | "Female">("all");
  const [purposeFilter, setPurposeFilter] = useState("all");
  const [convertedFilter, setConvertedFilter] = useState<"all" | "converted" | "unconverted">("all");

  // Modals
  const [addModal, setAddModal]         = useState(false);
  const [convertModal, setConvertModal] = useState<DailyMember | null>(null);
  const [viewModal, setViewModal]       = useState<DailyMember | null>(null);
  const [form, setForm]                 = useState(emptyForm);
  const [saving, setSaving]             = useState(false);

  // For convert flow
  const [packages, setPackages]   = useState<Package[]>([]);
  const [trainers, setTrainers]   = useState<StaffMember[]>([]);
  const [convertForm, setConvertForm] = useState({
    package_id: "", trainer_id: "",
    joining_date: format(new Date(), "yyyy-MM-dd"),
    expiry_date: format(addMonths(new Date(), 1), "yyyy-MM-dd"),
    admission_fee: "15000", monthly_fee: "", payment_method: "Cash",
  });

  // ── Date range helpers ──────────────────────────────────────────
  function getDateBounds(): { from: string; to: string } {
    const today = new Date();
    if (dateRange === "today")     return { from: format(today, "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
    if (dateRange === "yesterday") { const y = subDays(today, 1); return { from: format(y, "yyyy-MM-dd"), to: format(y, "yyyy-MM-dd") }; }
    if (dateRange === "week")      return { from: format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
    if (dateRange === "month")     return { from: format(startOfMonth(today), "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
    if (dateRange === "custom" && customDate) return { from: customDate, to: customDate };
    return { from: format(today, "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
  }

  const fetchVisitors = useCallback(async () => {
    setLoading(true);
    const { from, to } = getDateBounds();
    const supabase = createClient();
    const { data } = await supabase
      .from("daily_members")
      .select("*")
      .is("deleted_at", null)
      .gte("visit_date", from)
      .lte("visit_date", to)
      .order("created_at", { ascending: false });
    setVisitors(data ?? []);
    setLoading(false);
  }, [dateRange, customDate]);

  useEffect(() => { fetchVisitors(); }, [fetchVisitors]);

  useEffect(() => {
    const supabase = createClient();
    supabase.from("packages").select("*").eq("status", "active").is("deleted_at", null)
      .then(({ data }) => setPackages(data ?? []));
    supabase.from("staff_members").select("*").eq("role", "Trainer").eq("status", "active").is("deleted_at", null)
      .then(({ data }) => setTrainers(data ?? []));
  }, []);

  // ── Filtered list ───────────────────────────────────────────────
  const filtered = visitors.filter((v) => {
    if (genderFilter !== "all" && v.gender !== genderFilter) return false;
    if (purposeFilter !== "all" && v.purpose !== purposeFilter) return false;
    if (convertedFilter === "converted" && !v.converted_to_member_id) return false;
    if (convertedFilter === "unconverted" && v.converted_to_member_id) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!v.full_name.toLowerCase().includes(q) && !v.phone?.includes(q)) return false;
    }
    return true;
  });

  // ── Stats ───────────────────────────────────────────────────────
  const todayRevenue   = visitors.reduce((s, v) => s + (v.fee_paid ?? 0), 0);
  const convertedCount = visitors.filter((v) => v.converted_to_member_id).length;
  const conversionRate = visitors.length > 0 ? Math.round((convertedCount / visitors.length) * 100) : 0;

  // ── Add walk-in ─────────────────────────────────────────────────
  async function handleAdd() {
    if (!form.full_name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    const supabase = createClient();
    await supabase.from("daily_members").insert({
      full_name: form.full_name.trim(),
      phone: form.phone || null,
      gender: form.gender || null,
      age: form.age ? Number(form.age) : null,
      purpose: form.purpose,
      fee_paid: form.fee_paid ? Number(form.fee_paid) : null,
      payment_method: form.fee_paid ? form.payment_method : null,
      notes: form.notes || null,
      visit_date: format(new Date(), "yyyy-MM-dd"),
    });
    await supabase.from("activity_logs").insert({
      action: "logged_daily_visitor",
      entity_type: "daily_member",
      description: `Logged walk-in: ${form.full_name} (${form.purpose})${form.fee_paid ? ` — paid ${formatPKR(Number(form.fee_paid))}` : ""}`,
      metadata: { purpose: form.purpose, fee_paid: form.fee_paid },
    });
    toast.success(`Walk-in logged: ${form.full_name}`);
    setAddModal(false);
    setForm(emptyForm);
    setSaving(false);
    fetchVisitors();
  }

  // ── Convert to member ───────────────────────────────────────────
  async function handleConvert() {
    if (!convertModal) return;
    if (!convertForm.package_id) { toast.error("Select a package"); return; }
    setSaving(true);
    try {
      const supabase = createClient();
      const membershipNo = await generateMembershipNo();
      const pkg = packages.find((p) => p.id === convertForm.package_id);

      const { data: newMember, error } = await supabase.from("members").insert({
        membership_no: membershipNo,
        full_name: convertModal.full_name,
        phone: convertModal.phone ?? "—",
        gender: convertModal.gender,
        age: convertModal.age,
        package_id: convertForm.package_id,
        trainer_id: convertForm.trainer_id || null,
        joining_date: convertForm.joining_date,
        expiry_date: convertForm.expiry_date,
        admission_fee: Number(convertForm.admission_fee),
        monthly_fee: Number(convertForm.monthly_fee) || pkg?.monthly_fee,
        status: "active",
      }).select("id").single();

      if (error) throw error;

      // Link daily member to new member
      await supabase.from("daily_members").update({ converted_to_member_id: newMember.id }).eq("id", convertModal.id);

      // Log
      await supabase.from("activity_logs").insert({
        action: "converted_daily_member",
        entity_type: "member",
        entity_id: newMember.id,
        description: `Converted walk-in ${convertModal.full_name} to member — ${membershipNo}`,
        metadata: { membership_no: membershipNo, package: pkg?.name },
      });

      toast.success(`${convertModal.full_name} is now a member! (${membershipNo})`);
      setConvertModal(null);
      setSaving(false);
      fetchVisitors();
      router.push(`/dashboard/members/${newMember.id}`);
    } catch (err) {
      console.error(err);
      toast.error("Conversion failed. Try again.");
      setSaving(false);
    }
  }

  async function handleDelete(v: DailyMember) {
    if (!confirm(`Remove ${v.full_name}'s visit record?`)) return;
    const supabase = createClient();
    await supabase.from("daily_members").update({ deleted_at: new Date().toISOString() }).eq("id", v.id);
    toast.success("Record removed");
    fetchVisitors();
  }

  // ── Derived range label ─────────────────────────────────────────
  const DATE_LABELS: Record<DateRange, string> = {
    today: "Today", yesterday: "Yesterday",
    week: "This Week", month: "This Month", custom: customDate || "Custom",
  };

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Daily Members"
        subtitle="Walk-in visitors & day pass tracking"
        action={
          <Button size="sm" onClick={() => { setForm(emptyForm); setAddModal(true); }}>
            <UserPlus className="w-4 h-4" /> Log Walk-in
          </Button>
        }
      />

      <div className="flex-1 p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard title={`Visitors (${DATE_LABELS[dateRange]})`} value={visitors.length} icon={Users} iconColor="text-[#F06418]" iconBg="bg-[#FEF0E8]" />
          <StatsCard title="Revenue" value={formatPKR(todayRevenue)} icon={CreditCard} iconColor="text-green-600" iconBg="bg-green-50" />
          <StatsCard title="Converted to Members" value={convertedCount} icon={CheckCircle2} iconColor="text-blue-600" iconBg="bg-blue-50" />
          <StatsCard title="Conversion Rate" value={`${conversionRate}%`} icon={TrendingUp} iconColor="text-purple-600" iconBg="bg-purple-50" />
        </div>

        {/* Filter + View bar */}
        <div className="bg-white border border-[#E4E4DE] rounded-xl p-4 space-y-3">
          {/* Row 1: date range + view toggle */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Date range tabs */}
            <div className="flex bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg p-0.5 gap-0.5">
              {(["today", "yesterday", "week", "month"] as DateRange[]).map((d) => (
                <button key={d} onClick={() => setDateRange(d)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${dateRange === d ? "bg-[#F06418] text-white" : "text-[#4A4A44] hover:bg-white"}`}
                >
                  {DATE_LABELS[d]}
                </button>
              ))}
              <div className="flex items-center">
                <button onClick={() => setDateRange("custom")}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${dateRange === "custom" ? "bg-[#F06418] text-white" : "text-[#4A4A44] hover:bg-white"}`}
                >
                  <Calendar className="w-3 h-3" /> Custom
                </button>
              </div>
            </div>

            {dateRange === "custom" && (
              <input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)}
                className="text-xs px-3 py-1.5 rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
              />
            )}

            <div className="flex-1 min-w-40 max-w-sm relative">
              <Search className="w-4 h-4 text-[#7A7A72] absolute left-3 top-1/2 -translate-y-1/2" />
              <input type="text" placeholder="Search name or phone..."
                value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
              />
            </div>

            <ViewToggle value={viewMode} onChange={setViewMode} />
            <Button variant="ghost" size="sm" onClick={fetchVisitors}><RefreshCw className="w-4 h-4" /></Button>
          </div>

          {/* Row 2: secondary filters */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Gender */}
            <div className="flex bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg p-0.5 gap-0.5">
              {(["all", "Male", "Female"] as const).map((g) => (
                <button key={g} onClick={() => setGenderFilter(g)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${genderFilter === g ? "bg-[#1A1A1A] text-white" : "text-[#4A4A44] hover:bg-white"}`}
                >
                  {g === "all" ? "All" : g}
                </button>
              ))}
            </div>

            {/* Purpose filter */}
            <select value={purposeFilter} onChange={(e) => setPurposeFilter(e.target.value)}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-[#E4E4DE] bg-white text-[#4A4A44] focus:outline-none focus:ring-2 focus:ring-[#F06418]"
            >
              <option value="all">All Purposes</option>
              {PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>

            {/* Converted filter */}
            <div className="flex bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg p-0.5 gap-0.5">
              {([["all", "All"], ["unconverted", "Walk-ins"], ["converted", "Converted ✓"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setConvertedFilter(k)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${convertedFilter === k ? "bg-[#F06418] text-white" : "text-[#4A4A44] hover:bg-white"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {(search || genderFilter !== "all" || purposeFilter !== "all" || convertedFilter !== "all") && (
              <button onClick={() => { setSearch(""); setGenderFilter("all"); setPurposeFilter("all"); setConvertedFilter("all"); }}
                className="text-xs text-red-600 hover:underline flex items-center gap-1"
              >
                <X className="w-3 h-3" /> Clear filters
              </button>
            )}

            <span className="ml-auto text-xs text-[#7A7A72]">{filtered.length} visitor{filtered.length !== 1 ? "s" : ""}</span>
          </div>
        </div>

        {/* Purpose breakdown chips */}
        {visitors.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {PURPOSES.map((p) => {
              const count = visitors.filter((v) => v.purpose === p).length;
              if (!count) return null;
              return (
                <button key={p} onClick={() => setPurposeFilter(purposeFilter === p ? "all" : p)}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-all ${purposeFilter === p ? PURPOSE_COLORS[p] + " ring-1 ring-offset-1 ring-current" : PURPOSE_COLORS[p]}`}
                >
                  {p} <span className="font-bold">{count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="py-16 text-center">
            <RefreshCw className="w-6 h-6 text-[#7A7A72] animate-spin mx-auto mb-2" />
            <p className="text-sm text-[#7A7A72]">Loading visitors...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-14 h-14 bg-[#FEF0E8] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Users className="w-7 h-7 text-[#F06418]" />
            </div>
            <p className="text-base font-semibold text-[#1A1A16]">No visitors {DATE_LABELS[dateRange].toLowerCase()}</p>
            <p className="text-sm text-[#7A7A72] mt-1 mb-4">Log walk-ins as they arrive at the front desk</p>
            <Button onClick={() => { setForm(emptyForm); setAddModal(true); }}>
              <UserPlus className="w-4 h-4" /> Log Walk-in
            </Button>
          </div>
        ) : viewMode === "list" ? (
          <ListView visitors={filtered} onView={setViewModal} onConvert={(v) => { setConvertModal(v); setConvertForm({ package_id: "", trainer_id: "", joining_date: format(new Date(), "yyyy-MM-dd"), expiry_date: format(addMonths(new Date(), 1), "yyyy-MM-dd"), admission_fee: "15000", monthly_fee: "", payment_method: "Cash" }); }} onDelete={handleDelete} />
        ) : (
          <GridView visitors={filtered} compact={viewMode === "compact"} onView={setViewModal} onConvert={(v) => { setConvertModal(v); setConvertForm({ package_id: "", trainer_id: "", joining_date: format(new Date(), "yyyy-MM-dd"), expiry_date: format(addMonths(new Date(), 1), "yyyy-MM-dd"), admission_fee: "15000", monthly_fee: "", payment_method: "Cash" }); }} onDelete={handleDelete} />
        )}
      </div>

      {/* ── Add Walk-in Modal ───────────────────────────────────── */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="Log Walk-in Visitor" size="md">
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Input label="Full Name" required placeholder="e.g. Muhammad Hassan"
                value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <Input label="Phone" type="tel" placeholder="0300-0000000"
              value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Input label="Age" type="number" placeholder="25"
              value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} />
            <Select label="Gender" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} placeholder="Select">
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </Select>
            <Select label="Purpose" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}>
              {PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </div>

          {/* Fee section */}
          <div className="rounded-xl border-2 border-dashed border-[#E4E4DE] p-4 space-y-3">
            <p className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide">Fee Collection (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Fee Paid (Rs)" type="number" placeholder="500"
                value={form.fee_paid} onChange={(e) => setForm({ ...form, fee_paid: e.target.value })} />
              <Select label="Payment Method" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-[#1A1A16] block mb-1">Notes</label>
            <textarea rows={2} placeholder="Any notes about this visitor..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418] resize-none"
              value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setAddModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleAdd} loading={saving} className="flex-1">
              <UserPlus className="w-4 h-4" /> Log Visit
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── View Visitor Modal ─────────────────────────────────── */}
      <Modal open={!!viewModal} onClose={() => setViewModal(null)} title="Visitor Details" size="sm">
        {viewModal && (
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-3 pb-4 border-b border-[#E4E4DE]">
              <div className="w-12 h-12 rounded-full bg-[#FEF0E8] flex items-center justify-center flex-shrink-0">
                <span className="text-[#F06418] text-lg font-bold">{viewModal.full_name.charAt(0)}</span>
              </div>
              <div>
                <p className="text-base font-bold text-[#1A1A16]">{viewModal.full_name}</p>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${PURPOSE_COLORS[viewModal.purpose ?? "Other"]}`}>
                  {viewModal.purpose ?? "—"}
                </span>
              </div>
              {viewModal.converted_to_member_id && (
                <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                  <CheckCircle2 className="w-3 h-3" /> Member
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ["Phone", viewModal.phone], ["Gender", viewModal.gender],
                ["Age", viewModal.age ? `${viewModal.age} years` : null],
                ["Visit Date", formatDate(viewModal.visit_date)],
                ["Fee Paid", viewModal.fee_paid ? formatPKR(viewModal.fee_paid) : "—"],
                ["Payment", viewModal.payment_method],
              ].filter(([, v]) => v).map(([label, value]) => (
                <div key={label as string}>
                  <p className="text-[10px] text-[#7A7A72] uppercase tracking-wide font-semibold">{label}</p>
                  <p className="text-[#1A1A16] font-medium mt-0.5">{value}</p>
                </div>
              ))}
            </div>
            {viewModal.notes && (
              <div className="bg-[#F8F8F6] rounded-lg p-3">
                <p className="text-xs text-[#7A7A72] font-semibold mb-1">Notes</p>
                <p className="text-sm text-[#4A4A44]">{viewModal.notes}</p>
              </div>
            )}
            {!viewModal.converted_to_member_id && (
              <Button className="w-full" onClick={() => { setViewModal(null); setConvertModal(viewModal); setConvertForm({ package_id: "", trainer_id: "", joining_date: format(new Date(), "yyyy-MM-dd"), expiry_date: format(addMonths(new Date(), 1), "yyyy-MM-dd"), admission_fee: "15000", monthly_fee: "", payment_method: "Cash" }); }}>
                <Zap className="w-4 h-4" /> Convert to Full Member
              </Button>
            )}
          </div>
        )}
      </Modal>

      {/* ── Convert to Member Modal ────────────────────────────── */}
      <Modal open={!!convertModal} onClose={() => setConvertModal(null)} title="Convert to Full Member" size="lg">
        {convertModal && (
          <div className="p-5 space-y-5">
            {/* Visitor info strip */}
            <div className="bg-[#F8F8F6] rounded-xl px-4 py-3 flex items-center justify-between border border-[#E4E4DE]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#FEF0E8] flex items-center justify-center font-bold text-[#F06418]">
                  {convertModal.full_name.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-bold text-[#1A1A16]">{convertModal.full_name}</p>
                  <p className="text-xs text-[#7A7A72]">{convertModal.phone ?? "No phone"} · {convertModal.gender ?? "—"}</p>
                </div>
              </div>
              <Zap className="w-5 h-5 text-[#F06418]" />
            </div>

            {/* Package picker */}
            <div>
              <p className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide mb-3">Select Package <span className="text-[#F06418]">*</span></p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto">
                {packages.map((pkg) => {
                  const accent = pkg.color ?? "#F06418";
                  const selected = convertForm.package_id === pkg.id;
                  return (
                    <button key={pkg.id} type="button"
                      onClick={() => setConvertForm({ ...convertForm, package_id: pkg.id, monthly_fee: pkg.monthly_fee.toString(), admission_fee: pkg.admission_fee.toString() })}
                      className={`text-left p-3 rounded-xl border-2 transition-all ${selected ? "border-[#F06418] bg-[#FEF0E8]" : "border-[#E4E4DE] hover:border-[#F06418] bg-white"}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-bold text-[#1A1A16]">{pkg.name}</span>
                        {selected && <CheckCircle2 className="w-4 h-4 text-[#F06418]" />}
                      </div>
                      <span className="text-base font-bold" style={{ color: accent }}>{formatPKR(pkg.monthly_fee)}</span>
                      <span className="text-xs text-[#7A7A72]">/month</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Select label="Assign Trainer (optional)" value={convertForm.trainer_id}
                onChange={(e) => setConvertForm({ ...convertForm, trainer_id: e.target.value })} placeholder="No trainer">
                {trainers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
              </Select>
              <Select label="Payment Method" value={convertForm.payment_method}
                onChange={(e) => setConvertForm({ ...convertForm, payment_method: e.target.value })}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
              <Input label="Joining Date" type="date" value={convertForm.joining_date}
                onChange={(e) => { setConvertForm({ ...convertForm, joining_date: e.target.value, expiry_date: format(addMonths(new Date(e.target.value), 1), "yyyy-MM-dd") }); }} />
              <Input label="Expiry Date" type="date" value={convertForm.expiry_date}
                onChange={(e) => setConvertForm({ ...convertForm, expiry_date: e.target.value })} />
              <Input label="Admission Fee (Rs)" type="number" value={convertForm.admission_fee}
                onChange={(e) => setConvertForm({ ...convertForm, admission_fee: e.target.value })} />
              <Input label="Monthly Fee (Rs)" type="number" value={convertForm.monthly_fee}
                onChange={(e) => setConvertForm({ ...convertForm, monthly_fee: e.target.value })} />
            </div>

            {convertForm.package_id && (
              <div className="bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-[#4A4A44]">First payment (admission + 1st month):</span>
                <span className="text-base font-bold text-[#1A1A16]">
                  {formatPKR(Number(convertForm.admission_fee) + Number(convertForm.monthly_fee))}
                </span>
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setConvertModal(null)} className="flex-1">Cancel</Button>
              <Button onClick={handleConvert} loading={saving} className="flex-1">
                <Zap className="w-4 h-4" /> Convert & Create Member
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── List View ────────────────────────────────────────────────────────
function ListView({ visitors, onView, onConvert, onDelete }: {
  visitors: DailyMember[];
  onView: (v: DailyMember) => void;
  onConvert: (v: DailyMember) => void;
  onDelete: (v: DailyMember) => void;
}) {
  return (
    <div className="bg-white border border-[#E4E4DE] rounded-xl overflow-hidden">
      <table className="w-full">
        <thead className="bg-[#F8F8F6] border-b border-[#E4E4DE]">
          <tr>
            <th className="text-left text-xs font-semibold text-[#7A7A72] px-5 py-3">Visitor</th>
            <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Purpose</th>
            <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Phone</th>
            <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Fee Paid</th>
            <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Date</th>
            <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Status</th>
            <th className="text-right text-xs font-semibold text-[#7A7A72] px-5 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E4E4DE]">
          {visitors.map((v) => (
            <tr key={v.id} className="hover:bg-[#F8F8F6] transition-colors cursor-pointer" onClick={() => onView(v)}>
              <td className="px-5 py-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-[#FEF0E8] flex items-center justify-center flex-shrink-0">
                    <span className="text-[#F06418] text-xs font-bold">{v.full_name.charAt(0)}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#1A1A16]">{v.full_name}</p>
                    <p className="text-xs text-[#7A7A72]">{v.gender ?? "—"}{v.age ? ` · ${v.age}y` : ""}</p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${PURPOSE_COLORS[v.purpose ?? "Other"]}`}>
                  {v.purpose ?? "—"}
                </span>
              </td>
              <td className="px-4 py-3 text-sm text-[#4A4A44]">{v.phone ?? "—"}</td>
              <td className="px-4 py-3">
                {v.fee_paid ? (
                  <span className="text-sm font-semibold text-green-700">{formatPKR(v.fee_paid)}</span>
                ) : (
                  <span className="text-xs text-[#7A7A72]">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-sm text-[#4A4A44]">{formatDate(v.visit_date)}</td>
              <td className="px-4 py-3">
                {v.converted_to_member_id ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-green-700">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Member
                  </span>
                ) : (
                  <span className="text-xs text-[#7A7A72]">Walk-in</span>
                )}
              </td>
              <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-end gap-1">
                  {!v.converted_to_member_id && (
                    <button onClick={() => onConvert(v)}
                      className="p-1.5 rounded-lg text-[#7A7A72] hover:text-[#F06418] hover:bg-[#FEF0E8] transition-colors" title="Convert to Member">
                      <Zap className="w-4 h-4" />
                    </button>
                  )}
                  <button onClick={() => onDelete(v)}
                    className="p-1.5 rounded-lg text-[#7A7A72] hover:text-red-600 hover:bg-red-50 transition-colors" title="Remove">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Grid View ────────────────────────────────────────────────────────
function GridView({ visitors, compact, onView, onConvert, onDelete }: {
  visitors: DailyMember[]; compact: boolean;
  onView: (v: DailyMember) => void; onConvert: (v: DailyMember) => void; onDelete: (v: DailyMember) => void;
}) {
  const cols = compact
    ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
    : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

  return (
    <div className={`grid ${cols} gap-4`}>
      {visitors.map((v) => (
        <div key={v.id} className="bg-white border border-[#E4E4DE] rounded-xl overflow-hidden hover:border-[#F06418] hover:shadow-sm transition-all">
          <div className={`${PURPOSE_COLORS[v.purpose ?? "Other"]} h-1.5`} style={{ background: v.purpose === "Day Pass" ? "#F06418" : v.purpose === "Trial" ? "#2563EB" : v.purpose === "Guest of Member" ? "#7C3AED" : v.purpose === "Enquiry" ? "#D97706" : v.purpose === "Event" ? "#059669" : "#9CA3AF" }} />
          <div className={compact ? "p-3" : "p-4"}>
            <div className="flex items-start gap-2 mb-3 cursor-pointer" onClick={() => onView(v)}>
              <div className="w-9 h-9 rounded-full bg-[#FEF0E8] flex items-center justify-center flex-shrink-0">
                <span className="text-[#F06418] font-bold text-sm">{v.full_name.charAt(0)}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className={`font-bold text-[#1A1A16] truncate ${compact ? "text-xs" : "text-sm"}`}>{v.full_name}</p>
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${PURPOSE_COLORS[v.purpose ?? "Other"]}`}>
                  {v.purpose ?? "—"}
                </span>
              </div>
              {v.converted_to_member_id && <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />}
            </div>

            {!compact && (
              <div className="space-y-1 mb-3 text-xs text-[#4A4A44]">
                {v.phone && <p>{v.phone}</p>}
                {v.fee_paid && <p className="font-semibold text-green-700">{formatPKR(v.fee_paid)} paid</p>}
                <p className="text-[#7A7A72]">{formatDate(v.visit_date)}</p>
              </div>
            )}

            <div className="flex items-center gap-1 mt-auto">
              {!v.converted_to_member_id ? (
                <button onClick={() => onConvert(v)}
                  className="flex-1 py-1.5 rounded-lg text-xs font-semibold border border-[#F06418] text-[#F06418] hover:bg-[#FEF0E8] transition-colors flex items-center justify-center gap-1">
                  <Zap className="w-3 h-3" /> Convert
                </button>
              ) : (
                <span className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-green-50 text-green-700 text-center border border-green-200">
                  ✓ Member
                </span>
              )}
              <button onClick={() => onDelete(v)}
                className="p-1.5 rounded-lg border border-[#E4E4DE] text-[#7A7A72] hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
