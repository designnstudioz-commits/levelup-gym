"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search, UserPlus, RefreshCw, User, ArrowRight,
  SlidersHorizontal, X, ChevronLeft, ChevronRight, Fingerprint, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ViewToggle, type ViewMode } from "@/components/ui/ViewToggle";
import { SortableTh, useSortToggle, compareValues } from "@/components/ui/SortableTh";
import { formatDate, formatPKR, getMemberStatusDisplay, daysUntilExpiry, fetchAllRows } from "@/lib/utils";
import type { Member } from "@/types/database";

type MemberWithJoins = Member & {
  packages?: { name: string; monthly_fee: number; color?: string } | null;
  trainer?: { full_name: string } | null;
};

type StatusFilter = "all" | "active" | "inactive" | "frozen" | "archived";
// Dropdown presets map onto the same flat (sortKey, sortDir) state that
// drives the clickable column headers, so both controls stay in sync.
const SORT_PRESETS: Record<string, { key: string; dir: "asc" | "desc" }> = {
  newest:         { key: "created_at",    dir: "desc" },
  oldest:         { key: "created_at",    dir: "asc" },
  name_asc:       { key: "full_name",     dir: "asc" },
  name_desc:      { key: "full_name",     dir: "desc" },
  membership_asc: { key: "membership_no", dir: "asc" },
  join_newest:    { key: "joining_date",  dir: "desc" },
  join_oldest:    { key: "joining_date",  dir: "asc" },
  expiry_asc:     { key: "expiry_date",   dir: "asc" },
  expiry_desc:    { key: "expiry_date",   dir: "desc" },
};

const PAGE_SIZE = 50;

/** Returns true for members genuinely added by staff in the last 3 days.
 *  Imported GymAutomate members are excluded (their comment starts with "GymAutomate"). */
function isNewMember(m: MemberWithJoins): boolean {
  if (m.comment?.startsWith("GymAutomate")) return false;
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  return new Date(m.created_at).getTime() >= threeDaysAgo;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function MembersPage() {
  const router = useRouter();
  const [members, setMembers]   = useState<MemberWithJoins[]>([]);
  const [loading, setLoading]   = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [allCounts, setAllCounts] = useState<{ status: string | null; gender: string | null; deleted_at: string | null }[]>([]);
  const [page, setPage] = useState(1);

  // Filters
  const [search, setSearch]             = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [genderFilter, setGenderFilter] = useState<"all" | "Male" | "Female">("all");
  const [sortKey, setSortKey]           = useState("created_at");
  const [sortDir, setSortDir]           = useState<"asc" | "desc">("desc");
  const handleSort = useSortToggle(sortKey, setSortKey, sortDir, setSortDir);
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [newOnly, setNewOnly]           = useState(false);
  // Active tab defaults to Paid-only (paid/unpaid is only a meaningful
  // distinction for currently-active members) — other tabs default to All.
  const [feeFilter, setFeeFilter]       = useState<"all" | "paid" | "pending">("paid");
  const [filtersOpen, setFiltersOpen]   = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);

  // Bulk device enrollment
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [devices, setDevices] = useState<{ serial_no: string; name: string | null }[]>([]);
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [enrollDevice, setEnrollDevice] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [enrollProgress, setEnrollProgress] = useState<{ done: number; total: number } | null>(null);

  // Reset to page 1 whenever any filter changes
  useEffect(() => { setPage(1); }, [search, statusFilter, genderFilter, sortKey, expiringOnly, newOnly, feeFilter]);

  // Fee Status has a different sensible default per tab — reset it whenever
  // the status tab itself changes (not on every feeFilter change, so a
  // manual Paid/Pending pick while staying on the same tab isn't clobbered).
  useEffect(() => {
    setFeeFilter(statusFilter === "active" ? "paid" : "all");
  }, [statusFilter]);

  // Close the filters popover on outside click
  useEffect(() => {
    if (!filtersOpen) return;
    function onClick(e: MouseEvent) {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) setFiltersOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [filtersOpen]);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    try {
      const [data, countData] = await Promise.all([
        fetchAllRows<MemberWithJoins>((from, to) => {
          let q = supabase
            .from("members")
            .select("*, packages(name, monthly_fee, color, duration_months), trainer:staff_members!members_trainer_id_fkey(full_name)");
          // Archived members have deleted_at set (that's how archiving works —
          // see archiveMember() in the member detail page), so the "Archived"
          // tab has to query for deleted_at NOT null instead of excluding it
          // like every other tab does.
          if (statusFilter === "archived") {
            q = q.eq("status", "archived").not("deleted_at", "is", null);
          } else {
            q = q.is("deleted_at", null);
            if (statusFilter !== "all") q = q.eq("status", statusFilter);
          }
          if (genderFilter !== "all") q = q.eq("gender", genderFilter);
          return q.range(from, to) as any;
        }),
        // No deleted_at filter here — this feeds the status-tab counts, and
        // the "Archived" tab's count needs to include the deleted_at-set
        // rows too.
        fetchAllRows<{ status: string | null; gender: string | null; deleted_at: string | null }>((from, to) =>
          supabase.from("members").select("status, gender, deleted_at").range(from, to) as any
        ),
      ]);

      setMembers(data);
      setAllCounts(countData);
    } catch (err) {
      console.error("Failed to fetch members:", err);
    }
    setLoading(false);
  }, [statusFilter, genderFilter]);

  /** A member's fee is current if their stored expiry_date hasn't passed yet.
   *  expiry_date is the single source of truth kept in sync on every fee
   *  collection by extendExpiryDate() (registration, member-profile Collect
   *  Fee, Fees page Quick Collect) — deriving this separately from raw
   *  payment_date history caused it to disagree with the Status/Expiry badge
   *  whenever a member's first-ever recurring payment was made late (after
   *  joining_date, still within the same billing period): it would credit a
   *  fresh period starting from the late payment date instead of recognizing
   *  the period had already started at joining_date. */
  const isFeeCurrent = useCallback((m: MemberWithJoins): boolean => {
    if (!m.expiry_date) return false;
    return m.expiry_date >= todayStr();
  }, []);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  useEffect(() => {
    createClient().from("devices").select("serial_no, name").order("name").then(({ data }) => setDevices(data ?? []));
  }, []);

  const filtered = members
    .filter((m) => {
      if (expiringOnly) {
        const days = daysUntilExpiry(m.expiry_date);
        if (days === null || days > 30 || days < 0) return false;
      }
      if (newOnly && !isNewMember(m)) return false;
      if (feeFilter === "paid"    && !isFeeCurrent(m)) return false;
      if (feeFilter === "pending" &&  isFeeCurrent(m)) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        m.full_name.toLowerCase().includes(q) ||
        m.phone.includes(q) ||
        m.membership_no.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q) ||
        m.cnic?.includes(q)
      );
    })
    .sort((a, b) => compareValues(getSortValue(a, sortKey), getSortValue(b, sortKey), sortDir));

  function getSortValue(m: MemberWithJoins, key: string): string | number | null {
    switch (key) {
      case "package": return (m as any).packages?.name ?? null;
      case "trainer": return (m as any).trainer?.full_name ?? null;
      default:        return (m as any)[key] ?? null;
    }
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // The tab's own default feeFilter ("paid" on Active, "all" elsewhere)
  // shouldn't count as a manually-applied filter.
  const feeFilterDefault = statusFilter === "active" ? "paid" : "all";
  const hasActiveFilters = genderFilter !== "all" || expiringOnly || newOnly || !!search || feeFilter !== feeFilterDefault;
  // Count of filters tucked inside the "Filters" popover (excludes search,
  // which has its own always-visible box)
  const secondaryFilterCount = [genderFilter !== "all", expiringOnly, newOnly, feeFilter !== feeFilterDefault].filter(Boolean).length;
  function clearFilters() { setSearch(""); setGenderFilter("all"); setExpiringOnly(false); setNewOnly(false); setFeeFilter(feeFilterDefault); }

  // Selection tracks against the full filtered set (not just the current
  // page), so "select all" genuinely means every member matching the
  // active filters, even across multiple pages.
  const allFilteredSelected = filtered.length > 0 && filtered.every((m) => selectedIds.has(m.id));
  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (allFilteredSelected) return new Set();
      const next = new Set(prev);
      filtered.forEach((m) => next.add(m.id));
      return next;
    });
  }
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function bulkEnrollToDevice() {
    if (!enrollDevice) { toast.error("Select a device"); return; }
    const targets = members.filter((m) => selectedIds.has(m.id));
    setEnrolling(true);
    setEnrollProgress({ done: 0, total: targets.length });
    const supabase = createClient();
    let enrolledCount = 0, alreadyCount = 0, failedCount = 0;

    // Sequential, not Promise.all — /api/devices/push-user computes each
    // command's id as a count()+1 read-then-write with no unique constraint
    // to catch a collision, so parallel calls against the same device risk
    // duplicate command ids.
    for (const m of targets) {
      try {
        const { data: existing } = await supabase
          .from("device_enrollments")
          .select("id")
          .eq("member_id", m.id)
          .eq("device_serial", enrollDevice)
          .is("deleted_at", null)
          .maybeSingle();

        if (existing) {
          alreadyCount++;
        } else {
          const uid = String(parseInt(m.membership_no?.split("-")[2] ?? "", 10) || "");
          const { error: insertError } = await supabase.from("device_enrollments").insert({
            member_id: m.id, device_serial: enrollDevice, device_user_id: uid,
          });
          if (insertError) { failedCount++; setEnrollProgress((p) => p ? { ...p, done: p.done + 1 } : p); continue; }
          enrolledCount++;
        }

        const res = await fetch("/api/devices/push-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ member_id: m.id, device_serial: enrollDevice }),
        });
        if (!res.ok) failedCount++;
      } catch {
        failedCount++;
      }
      setEnrollProgress((p) => p ? { ...p, done: p.done + 1 } : p);
    }

    setEnrolling(false);
    setEnrollProgress(null);
    setEnrollModalOpen(false);
    setSelectedIds(new Set());
    toast.success(`${enrolledCount} enrolled and queued, ${alreadyCount} already enrolled (re-pushed)${failedCount ? `, ${failedCount} failed` : ""}`);
  }

  // Contextual counts: status counts respect gender filter, gender counts respect status filter
  const statusCounts = useMemo(() => {
    const base = genderFilter === "all" ? allCounts : allCounts.filter((c) => c.gender === genderFilter);
    const map: Record<string, number> = { active: 0, inactive: 0, frozen: 0, archived: 0, all: 0 };
    base.forEach((c) => {
      if (c.status === "archived") { map.archived++; return; }
      if (c.deleted_at) return; // shouldn't happen outside archived, but stay consistent with the main query
      if (c.status && map[c.status] !== undefined) map[c.status]++;
      map.all++;
    });
    return map;
  }, [allCounts, genderFilter]);

  const genderCounts = useMemo(() => {
    const base = statusFilter === "archived"
      ? allCounts.filter((c) => c.status === "archived")
      : statusFilter === "all"
      ? allCounts.filter((c) => !c.deleted_at)
      : allCounts.filter((c) => c.status === statusFilter && !c.deleted_at);
    return {
      all: base.length,
      Male: base.filter((c) => c.gender === "Male").length,
      Female: base.filter((c) => c.gender === "Female").length,
    };
  }, [allCounts, statusFilter]);

  const STATUS_TABS: { key: StatusFilter; label: string; count: number }[] = [
    { key: "all",      label: "All",      count: statusCounts.all },
    { key: "active",   label: "Active",   count: statusCounts.active },
    { key: "inactive", label: "Inactive", count: statusCounts.inactive },
    { key: "frozen",   label: "Frozen",   count: statusCounts.frozen },
    { key: "archived", label: "Archived", count: statusCounts.archived },
  ];

  const rangeStart = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd   = Math.min(safePage * PAGE_SIZE, filtered.length);

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Members"
        subtitle={
          filtered.length === 0
            ? "No members found"
            : filtered.length <= PAGE_SIZE
            ? `${filtered.length} member${filtered.length !== 1 ? "s" : ""}`
            : `${rangeStart}–${rangeEnd} of ${filtered.length} members`
        }
      />

      <div className="flex-1 p-6 space-y-4">
        {/* Filter + view bar */}
        <div className="bg-white border border-[#E4E4DE] rounded-xl p-4 space-y-3">
          {/* Row 1 */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg p-0.5 gap-0.5">
              {STATUS_TABS.map((tab) => (
                <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${statusFilter === tab.key ? "bg-[#F06418] text-white" : "text-[#4A4A44] hover:bg-white"}`}
                >
                  {tab.label}
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${statusFilter === tab.key ? "bg-white/25 text-white" : "bg-[#E4E4DE] text-[#7A7A72]"}`}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex-1 min-w-48 max-w-sm relative">
              <Search className="w-4 h-4 text-[#7A7A72] absolute left-3 top-1/2 -translate-y-1/2" />
              <input type="text" placeholder="Name, phone, CNIC, membership no..." value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
              />
            </div>

            <ViewToggle value={viewMode} onChange={setViewMode} />
            <Button variant="ghost" size="sm" onClick={fetchMembers}><RefreshCw className="w-4 h-4" /></Button>
            <Link href="/dashboard/register"><Button size="sm"><UserPlus className="w-4 h-4" /> Add Member</Button></Link>
          </div>

          {/* Row 2: sort + collapsed filters */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={Object.keys(SORT_PRESETS).find((k) => SORT_PRESETS[k].key === sortKey && SORT_PRESETS[k].dir === sortDir) ?? ""}
              onChange={(e) => {
                const preset = SORT_PRESETS[e.target.value];
                if (preset) { setSortKey(preset.key); setSortDir(preset.dir); }
              }}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-[#E4E4DE] bg-white text-[#4A4A44] focus:outline-none focus:ring-2 focus:ring-[#F06418]"
            >
              <option value="" disabled>Custom (column sort)</option>
              <optgroup label="Date Added">
                <option value="newest">Newest Added</option>
                <option value="oldest">Oldest Added</option>
              </optgroup>
              <optgroup label="Name">
                <option value="name_asc">Name A → Z</option>
                <option value="name_desc">Name Z → A</option>
              </optgroup>
              <optgroup label="Membership / Year">
                <option value="membership_asc">Membership No (A → Z)</option>
                <option value="join_newest">Join Date: Newest</option>
                <option value="join_oldest">Join Date: Oldest</option>
              </optgroup>
              <optgroup label="Expiry">
                <option value="expiry_asc">Expiry: Soonest</option>
                <option value="expiry_desc">Expiry: Latest</option>
              </optgroup>
            </select>

            <div className="relative" ref={filtersRef}>
              <button
                onClick={() => setFiltersOpen((v) => !v)}
                className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
                  filtersOpen || secondaryFilterCount > 0
                    ? "bg-[#FEF0E8] border-[#F06418] text-[#C04E10]"
                    : "bg-white border-[#E4E4DE] text-[#4A4A44] hover:border-[#F06418]"
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" /> Filters
                {secondaryFilterCount > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none bg-[#F06418] text-white">
                    {secondaryFilterCount}
                  </span>
                )}
              </button>

              {filtersOpen && (
                <div className="absolute z-20 top-full left-0 mt-1.5 w-72 bg-white border border-[#E4E4DE] rounded-xl shadow-lg p-3 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-[#7A7A72] mb-1.5">Gender</p>
                    <div className="flex bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg p-0.5 gap-0.5">
                      {(["all", "Male", "Female"] as const).map((g) => (
                        <button key={g} onClick={() => setGenderFilter(g)}
                          className={`flex-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1 ${genderFilter === g ? "bg-[#1A1A1A] text-white" : "text-[#4A4A44] hover:bg-white"}`}
                        >
                          {g === "all" ? "All" : g}
                          <span className={`text-[10px] font-bold px-1 py-0.5 rounded-full leading-none ${genderFilter === g ? "bg-white/20 text-white" : "bg-[#E4E4DE] text-[#7A7A72]"}`}>
                            {g === "all" ? genderCounts.all : genderCounts[g]}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-[#7A7A72] mb-1.5">Fee Status</p>
                    <div className="flex bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg p-0.5 gap-0.5">
                      {([["all", "All"], ["paid", "Paid"], ["pending", "Pending"]] as const).map(([key, label]) => (
                        <button key={key} onClick={() => setFeeFilter(key)}
                          className={`flex-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                            feeFilter === key
                              ? key === "paid" ? "bg-green-600 text-white"
                                : key === "pending" ? "bg-red-500 text-white"
                                : "bg-[#1A1A1A] text-white"
                              : "text-[#4A4A44] hover:bg-white"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-[#4A4A44] cursor-pointer">
                    <input type="checkbox" className="accent-[#F06418]" checked={expiringOnly} onChange={(e) => setExpiringOnly(e.target.checked)} />
                    Expiring in 30 days
                  </label>

                  <label className="flex items-center gap-2 text-xs text-[#4A4A44] cursor-pointer">
                    <input type="checkbox" className="accent-[#F06418]" checked={newOnly} onChange={(e) => setNewOnly(e.target.checked)} />
                    Added in last 3 days
                  </label>

                  {hasActiveFilters && (
                    <button onClick={clearFilters} className="text-xs text-red-600 hover:underline flex items-center gap-1 pt-1 border-t border-[#E4E4DE] w-full">
                      <X className="w-3 h-3" /> Clear all filters
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 bg-[#FEF0E8] border border-[#FDDCC8] rounded-xl px-4 py-2.5">
            <span className="text-sm font-medium text-[#C04E10]">{selectedIds.size} selected</span>
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-[#7A7A72] hover:text-[#1A1A16] hover:underline">
              Clear
            </button>
            <Button size="sm" className="ml-auto" onClick={() => setEnrollModalOpen(true)}>
              <Fingerprint className="w-3.5 h-3.5" /> Enroll to Device
            </Button>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="py-16 text-center">
            <RefreshCw className="w-6 h-6 text-[#7A7A72] animate-spin mx-auto mb-2" />
            <p className="text-sm text-[#7A7A72]">Loading members...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-12 h-12 bg-[#F8F8F6] rounded-full flex items-center justify-center mx-auto mb-3">
              <User className="w-5 h-5 text-[#7A7A72]" />
            </div>
            <p className="text-sm font-medium text-[#4A4A44]">No members found</p>
            <p className="text-xs text-[#7A7A72] mt-1">Try adjusting your filters</p>
          </div>
        ) : viewMode === "list" ? (
          <MembersTable members={paginated} onNavigate={(id) => router.push(`/dashboard/members/${id}`)} isFeeCurrent={isFeeCurrent}
            selectedIds={selectedIds} onToggleSelect={toggleSelect} allSelected={allFilteredSelected} onToggleSelectAll={toggleSelectAll}
            sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
        ) : viewMode === "grid" ? (
          <MembersGrid members={paginated} onNavigate={(id) => router.push(`/dashboard/members/${id}`)} compact={false} isFeeCurrent={isFeeCurrent}
            selectedIds={selectedIds} onToggleSelect={toggleSelect} />
        ) : (
          <MembersGrid members={paginated} onNavigate={(id) => router.push(`/dashboard/members/${id}`)} compact={true} isFeeCurrent={isFeeCurrent}
            selectedIds={selectedIds} onToggleSelect={toggleSelect} />
        )}

        {/* Enroll to Device modal */}
        <Modal open={enrollModalOpen} onClose={() => !enrolling && setEnrollModalOpen(false)} title="Enroll to Device" size="sm">
          <div className="space-y-4">
            <p className="text-sm text-[#4A4A44]">
              Enrolling <span className="font-semibold">{selectedIds.size}</span> member{selectedIds.size !== 1 ? "s" : ""}. Each will be assigned their membership number as the device ID and pushed automatically.
            </p>
            <select value={enrollDevice} onChange={(e) => setEnrollDevice(e.target.value)} disabled={enrolling}
              className="w-full text-sm px-3 py-2 rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418] disabled:opacity-50"
            >
              <option value="">Select device...</option>
              {devices.map((d) => (
                <option key={d.serial_no} value={d.serial_no}>{d.name ?? d.serial_no}</option>
              ))}
            </select>
            {enrollProgress && (
              <p className="text-xs text-[#7A7A72]">Processing {enrollProgress.done}/{enrollProgress.total}...</p>
            )}
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setEnrollModalOpen(false)} disabled={enrolling} className="flex-1">Cancel</Button>
              <Button onClick={bulkEnrollToDevice} loading={enrolling} disabled={!enrollDevice} className="flex-1">
                {enrolling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />} Enroll & Push
              </Button>
            </div>
          </div>
        </Modal>

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between bg-white border border-[#E4E4DE] rounded-xl px-5 py-3">
            <span className="text-xs text-[#7A7A72]">
              Showing <span className="font-semibold text-[#1A1A16]">{rangeStart}–{rangeEnd}</span> of <span className="font-semibold text-[#1A1A16]">{filtered.length}</span> members
            </span>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#E4E4DE] text-[#4A4A44] hover:border-[#F06418] hover:text-[#F06418] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </button>

              <PageNumbers current={safePage} total={totalPages} onSelect={setPage} />

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#E4E4DE] text-[#4A4A44] hover:border-[#F06418] hover:text-[#F06418] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page number buttons ──────────────────────────────────────────────
function PageNumbers({ current, total, onSelect }: { current: number; total: number; onSelect: (p: number) => void }) {
  const pages: (number | "...")[] = [];

  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i);
  } else {
    pages.push(1);
    if (current > 3) pages.push("...");
    for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i);
    if (current < total - 2) pages.push("...");
    pages.push(total);
  }

  return (
    <div className="flex items-center gap-1">
      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`ellipsis-${i}`} className="px-2 text-xs text-[#7A7A72]">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onSelect(p as number)}
            className={`min-w-[28px] h-7 text-xs font-medium rounded-lg border transition-colors ${
              p === current
                ? "bg-[#F06418] text-white border-[#F06418]"
                : "border-[#E4E4DE] text-[#4A4A44] hover:border-[#F06418] hover:text-[#F06418]"
            }`}
          >
            {p}
          </button>
        )
      )}
    </div>
  );
}

// ── List (Table) View ────────────────────────────────────────────────
function MembersTable({ members, onNavigate, isFeeCurrent, selectedIds, onToggleSelect, allSelected, onToggleSelectAll, sortKey, sortDir, onSort }: {
  members: MemberWithJoins[]; onNavigate: (id: string) => void; isFeeCurrent: (m: MemberWithJoins) => boolean;
  selectedIds: Set<string>; onToggleSelect: (id: string) => void; allSelected: boolean; onToggleSelectAll: () => void;
  sortKey: string; sortDir: "asc" | "desc"; onSort: (key: string) => void;
}) {
  return (
    <div className="bg-white border border-[#E4E4DE] rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-[#F8F8F6] border-b border-[#E4E4DE]">
            <tr>
              <th className="px-4 py-3 w-8">
                <input type="checkbox" className="accent-[#F06418]" checked={allSelected} onChange={onToggleSelectAll} />
              </th>
              <SortableTh label="Member" sortKey="full_name" currentKey={sortKey} direction={sortDir} onSort={onSort} className="px-5" />
              <SortableTh label="Membership No" sortKey="membership_no" currentKey={sortKey} direction={sortDir} onSort={onSort} />
              <SortableTh label="Package" sortKey="package" currentKey={sortKey} direction={sortDir} onSort={onSort} />
              <SortableTh label="Trainer" sortKey="trainer" currentKey={sortKey} direction={sortDir} onSort={onSort} />
              <SortableTh label="Phone" sortKey="phone" currentKey={sortKey} direction={sortDir} onSort={onSort} />
              <SortableTh label="Expiry" sortKey="expiry_date" currentKey={sortKey} direction={sortDir} onSort={onSort} />
              <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Fee</th>
              <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E4E4DE]">
            {members.map((m) => {
              const { label, variant } = getMemberStatusDisplay(m.status, m.expiry_date);
              const pkgColor = (m as any).packages?.color ?? "#F06418";
              const feePaid  = isFeeCurrent(m);
              const isNew    = isNewMember(m);
              return (
                <tr key={m.id} className="hover:bg-[#F8F8F6] transition-colors cursor-pointer" onClick={() => onNavigate(m.id)}>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="accent-[#F06418]" checked={selectedIds.has(m.id)} onChange={() => onToggleSelect(m.id)} />
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-[#FEF0E8] flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {m.photo_url ? <img src={m.photo_url} alt="" className="w-8 h-8 object-cover" /> : (
                          <span className="text-[#F06418] text-xs font-bold">{m.full_name.charAt(0)}</span>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[#1A1A16] flex items-center gap-1.5">
                          {m.full_name}
                          {isNew && (
                            <span className="text-[10px] font-bold bg-[#F06418] text-white px-1.5 py-0.5 rounded-full leading-none">New</span>
                          )}
                        </p>
                        <p className="text-xs text-[#7A7A72]">{m.gender ?? "—"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono font-semibold text-[#F06418]">{m.membership_no}</td>
                  <td className="px-4 py-3">
                    {(m as any).packages ? (
                      <span className="text-xs font-medium text-[#1A1A16] flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: pkgColor }} />
                        {(m as any).packages.name}
                      </span>
                    ) : <span className="text-[#7A7A72] text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-[#4A4A44]">{(m as any).trainer?.full_name ?? <span className="text-[#7A7A72]">—</span>}</td>
                  <td className="px-4 py-3 text-sm text-[#4A4A44]">{m.phone}</td>
                  <td className="px-4 py-3 text-sm text-[#4A4A44]">{m.expiry_date ? formatDate(m.expiry_date) : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${feePaid ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${feePaid ? "bg-green-500" : "bg-red-500"}`} />
                      {feePaid ? "Paid" : "Pending"}
                    </span>
                  </td>
                  <td className="px-4 py-3"><Badge variant={variant}>{label}</Badge></td>
                  <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                    <Link href={`/dashboard/members/${m.id}`}>
                      <button className="p-1.5 rounded-lg text-[#7A7A72] hover:text-[#F06418] hover:bg-[#FEF0E8] transition-colors">
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Grid / Compact View ─────────────────────────────────────────────
function MembersGrid({ members, onNavigate, compact, isFeeCurrent, selectedIds, onToggleSelect }: {
  members: MemberWithJoins[]; onNavigate: (id: string) => void; compact: boolean; isFeeCurrent: (m: MemberWithJoins) => boolean;
  selectedIds: Set<string>; onToggleSelect: (id: string) => void;
}) {
  const cols = compact
    ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
    : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

  return (
    <div className={`grid ${cols} gap-4`}>
      {members.map((m) => {
        const { label, variant } = getMemberStatusDisplay(m.status, m.expiry_date);
        const days = daysUntilExpiry(m.expiry_date);
        const pkgColor = (m as any).packages?.color ?? "#F06418";
        const feePaid  = isFeeCurrent(m);
        const isNew    = isNewMember(m);

        return (
          <div key={m.id} className="relative">
            <input
              type="checkbox"
              className="absolute top-2 left-2 z-10 accent-[#F06418] w-4 h-4"
              checked={selectedIds.has(m.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggleSelect(m.id)}
            />
            <button onClick={() => onNavigate(m.id)}
              className="w-full bg-white border border-[#E4E4DE] rounded-xl overflow-hidden text-left hover:border-[#F06418] hover:shadow-sm transition-all group"
            >
            <div className="h-1" style={{ backgroundColor: pkgColor }} />
            <div className={compact ? "p-3" : "p-4"}>
              {/* Avatar + name */}
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-9 h-9 rounded-full bg-[#FEF0E8] flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {m.photo_url ? <img src={m.photo_url} alt="" className="w-9 h-9 object-cover" /> : (
                    <span className="text-[#F06418] text-sm font-bold">{m.full_name.charAt(0)}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className={`font-bold text-[#1A1A16] truncate group-hover:text-[#F06418] transition-colors ${compact ? "text-xs" : "text-sm"}`}>{m.full_name}</p>
                    {isNew && (
                      <span className="text-[10px] font-bold bg-[#F06418] text-white px-1.5 py-0.5 rounded-full leading-none flex-shrink-0">New</span>
                    )}
                  </div>
                  <p className="text-[10px] font-mono text-[#F06418]">{m.membership_no}</p>
                </div>
              </div>

              {!compact && (
                <>
                  <div className="space-y-1 mb-3">
                    {(m as any).packages && (
                      <p className="text-xs text-[#4A4A44] flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: pkgColor }} />
                        {(m as any).packages.name}
                      </p>
                    )}
                    {(m as any).trainer && (
                      <p className="text-xs text-[#7A7A72]">Trainer: {(m as any).trainer.full_name}</p>
                    )}
                    <p className="text-xs text-[#7A7A72]">{m.phone}</p>
                  </div>
                  {m.expiry_date && (
                    <p className={`text-xs mb-2 ${days !== null && days <= 7 ? "text-red-600 font-semibold" : days !== null && days <= 30 ? "text-[#C04E10] font-medium" : "text-[#7A7A72]"}`}>
                      Exp: {formatDate(m.expiry_date)}{days !== null && days >= 0 && ` (${days}d)`}
                    </p>
                  )}
                </>
              )}

              <div className="flex items-center justify-between gap-1.5 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Badge variant={variant}>{label}</Badge>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${feePaid ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${feePaid ? "bg-green-500" : "bg-red-500"}`} />
                    {feePaid ? "Paid" : "Pending"}
                  </span>
                </div>
                {!compact && <ArrowRight className="w-3.5 h-3.5 text-[#7A7A72] group-hover:text-[#F06418] transition-colors" />}
              </div>
            </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}
