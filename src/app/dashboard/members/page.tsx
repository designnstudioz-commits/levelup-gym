"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search, UserPlus, RefreshCw, User, ArrowRight,
  SlidersHorizontal, X, ChevronLeft, ChevronRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ViewToggle, type ViewMode } from "@/components/ui/ViewToggle";
import { formatDate, formatPKR, getMemberStatusDisplay, daysUntilExpiry } from "@/lib/utils";
import type { Member } from "@/types/database";

type MemberWithJoins = Member & {
  packages?: { name: string; monthly_fee: number; color?: string } | null;
  trainer?: { full_name: string } | null;
};

type StatusFilter = "all" | "active" | "inactive" | "frozen" | "archived";
type SortKey =
  | "newest" | "oldest"
  | "name_asc" | "name_desc"
  | "membership_asc"
  | "join_newest" | "join_oldest"
  | "expiry_asc" | "expiry_desc";

const PAGE_SIZE = 50;

/** Returns true for members genuinely added by staff in the last 3 days.
 *  Imported GymAutomate members are excluded (their comment starts with "GymAutomate"). */
function isNewMember(m: MemberWithJoins): boolean {
  if (m.comment?.startsWith("GymAutomate")) return false;
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  return new Date(m.created_at).getTime() >= threeDaysAgo;
}

export default function MembersPage() {
  const router = useRouter();
  const [members, setMembers]   = useState<MemberWithJoins[]>([]);
  const [loading, setLoading]   = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [paidThisMonth, setPaidThisMonth] = useState<Set<string>>(new Set());
  const [allCounts, setAllCounts] = useState<{ status: string | null; gender: string | null }[]>([]);
  const [page, setPage] = useState(1);

  // Filters
  const [search, setSearch]             = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [genderFilter, setGenderFilter] = useState<"all" | "Male" | "Female">("all");
  const [sortKey, setSortKey]           = useState<SortKey>("newest");
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [newOnly, setNewOnly]           = useState(false);
  const [feeFilter, setFeeFilter]       = useState<"all" | "paid" | "pending">("all");

  // Reset to page 1 whenever any filter changes
  useEffect(() => { setPage(1); }, [search, statusFilter, genderFilter, sortKey, expiringOnly, newOnly, feeFilter]);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];

    let query = supabase
      .from("members")
      .select("*, packages(name, monthly_fee, color), trainer:staff_members!members_trainer_id_fkey(full_name)")
      .is("deleted_at", null);

    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    if (genderFilter !== "all") query = query.eq("gender", genderFilter);

    const [{ data, error }, { data: feeData }, { data: countData }] = await Promise.all([
      query,
      supabase
        .from("fee_payments")
        .select("member_id")
        .is("deleted_at", null)
        .gte("payment_date", monthStart)
        .lte("payment_date", monthEnd),
      supabase
        .from("members")
        .select("status, gender")
        .is("deleted_at", null),
    ]);

    if (!error) setMembers(data ?? []);
    setAllCounts(countData ?? []);
    setPaidThisMonth(new Set((feeData ?? []).map((f: any) => f.member_id)));
    setLoading(false);
  }, [statusFilter, genderFilter]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  const filtered = members
    .filter((m) => {
      if (expiringOnly) {
        const days = daysUntilExpiry(m.expiry_date);
        if (days === null || days > 30 || days < 0) return false;
      }
      if (newOnly && !isNewMember(m)) return false;
      if (feeFilter === "paid"    && !paidThisMonth.has(m.id)) return false;
      if (feeFilter === "pending" &&  paidThisMonth.has(m.id)) return false;
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
    .sort((a, b) => {
      switch (sortKey) {
        case "newest":         return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case "oldest":         return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case "name_asc":       return a.full_name.localeCompare(b.full_name);
        case "name_desc":      return b.full_name.localeCompare(a.full_name);
        case "membership_asc": return (a.membership_no ?? "").localeCompare(b.membership_no ?? "");
        case "join_newest":    return (b.joining_date ?? "").localeCompare(a.joining_date ?? "");
        case "join_oldest":    return (a.joining_date ?? "").localeCompare(b.joining_date ?? "");
        case "expiry_asc":     return (a.expiry_date ?? "").localeCompare(b.expiry_date ?? "");
        case "expiry_desc":    return (b.expiry_date ?? "").localeCompare(a.expiry_date ?? "");
        default:               return 0;
      }
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const hasActiveFilters = genderFilter !== "all" || expiringOnly || newOnly || !!search || feeFilter !== "all";
  function clearFilters() { setSearch(""); setGenderFilter("all"); setExpiringOnly(false); setNewOnly(false); setFeeFilter("all"); }

  // Contextual counts: status counts respect gender filter, gender counts respect status filter
  const statusCounts = useMemo(() => {
    const base = genderFilter === "all" ? allCounts : allCounts.filter((c) => c.gender === genderFilter);
    const map: Record<string, number> = { active: 0, inactive: 0, frozen: 0, archived: 0, all: 0 };
    base.forEach((c) => { if (c.status && map[c.status] !== undefined) map[c.status]++; map.all++; });
    return map;
  }, [allCounts, genderFilter]);

  const genderCounts = useMemo(() => {
    const base = statusFilter === "all" ? allCounts : allCounts.filter((c) => c.status === statusFilter);
    return {
      all: base.length,
      Male: base.filter((c) => c.gender === "Male").length,
      Female: base.filter((c) => c.gender === "Female").length,
    };
  }, [allCounts, statusFilter]);

  const STATUS_TABS: { key: StatusFilter; label: string; count: number }[] = [
    { key: "active",   label: "Active",   count: statusCounts.active },
    { key: "inactive", label: "Inactive", count: statusCounts.inactive },
    { key: "frozen",   label: "Frozen",   count: statusCounts.frozen },
    { key: "archived", label: "Archived", count: statusCounts.archived },
    { key: "all",      label: "All",      count: statusCounts.all },
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

          {/* Row 2: secondary filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg p-0.5 gap-0.5">
              {(["all", "Male", "Female"] as const).map((g) => (
                <button key={g} onClick={() => setGenderFilter(g)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${genderFilter === g ? "bg-[#1A1A1A] text-white" : "text-[#4A4A44] hover:bg-white"}`}
                >
                  {g === "all" ? "All Genders" : g}
                  <span className={`text-[10px] font-bold px-1 py-0.5 rounded-full leading-none ${genderFilter === g ? "bg-white/20 text-white" : "bg-[#E4E4DE] text-[#7A7A72]"}`}>
                    {g === "all" ? genderCounts.all : genderCounts[g]}
                  </span>
                </button>
              ))}
            </div>

            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-[#E4E4DE] bg-white text-[#4A4A44] focus:outline-none focus:ring-2 focus:ring-[#F06418]"
            >
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

            <label className="flex items-center gap-1.5 text-xs text-[#4A4A44] cursor-pointer bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg px-2.5 py-1.5 hover:border-[#F06418] transition-colors">
              <input type="checkbox" className="accent-[#F06418]" checked={expiringOnly} onChange={(e) => setExpiringOnly(e.target.checked)} />
              Expiring in 30 days
            </label>

            <button
              onClick={() => setNewOnly((v) => !v)}
              className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
                newOnly
                  ? "bg-[#F06418] text-white border-[#F06418]"
                  : "bg-[#F8F8F6] text-[#4A4A44] border-[#E4E4DE] hover:border-[#F06418] hover:text-[#F06418]"
              }`}
            >
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${newOnly ? "bg-white/25 text-white" : "bg-[#F06418] text-white"}`}>New</span>
              Added in last 3 days
            </button>

            {/* Fee status filter */}
            <div className="flex bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg p-0.5 gap-0.5">
              {([["all", "All Fees"], ["paid", "Paid"], ["pending", "Pending"]] as const).map(([key, label]) => (
                <button key={key} onClick={() => setFeeFilter(key)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
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

            {hasActiveFilters && (
              <button onClick={clearFilters} className="text-xs text-red-600 hover:underline flex items-center gap-1">
                <X className="w-3 h-3" /> Clear filters
              </button>
            )}

            <span className="ml-auto text-xs text-[#7A7A72]">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
          </div>
        </div>

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
          <MembersTable members={paginated} onNavigate={(id) => router.push(`/dashboard/members/${id}`)} paidThisMonth={paidThisMonth} />
        ) : viewMode === "grid" ? (
          <MembersGrid members={paginated} onNavigate={(id) => router.push(`/dashboard/members/${id}`)} compact={false} paidThisMonth={paidThisMonth} />
        ) : (
          <MembersGrid members={paginated} onNavigate={(id) => router.push(`/dashboard/members/${id}`)} compact={true} paidThisMonth={paidThisMonth} />
        )}

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
function MembersTable({ members, onNavigate, paidThisMonth }: { members: MemberWithJoins[]; onNavigate: (id: string) => void; paidThisMonth: Set<string> }) {
  return (
    <div className="bg-white border border-[#E4E4DE] rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-[#F8F8F6] border-b border-[#E4E4DE]">
            <tr>
              <th className="text-left text-xs font-semibold text-[#7A7A72] px-5 py-3">Member</th>
              <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Membership No</th>
              <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Package</th>
              <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Trainer</th>
              <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Phone</th>
              <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Expiry</th>
              <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Fee</th>
              <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E4E4DE]">
            {members.map((m) => {
              const { label, variant } = getMemberStatusDisplay(m.status, m.expiry_date);
              const pkgColor = (m as any).packages?.color ?? "#F06418";
              const feePaid  = paidThisMonth.has(m.id);
              const isNew    = isNewMember(m);
              return (
                <tr key={m.id} className="hover:bg-[#F8F8F6] transition-colors cursor-pointer" onClick={() => onNavigate(m.id)}>
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
function MembersGrid({ members, onNavigate, compact, paidThisMonth }: { members: MemberWithJoins[]; onNavigate: (id: string) => void; compact: boolean; paidThisMonth: Set<string> }) {
  const cols = compact
    ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
    : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

  return (
    <div className={`grid ${cols} gap-4`}>
      {members.map((m) => {
        const { label, variant } = getMemberStatusDisplay(m.status, m.expiry_date);
        const days = daysUntilExpiry(m.expiry_date);
        const pkgColor = (m as any).packages?.color ?? "#F06418";
        const feePaid  = paidThisMonth.has(m.id);
        const isNew    = isNewMember(m);

        return (
          <button key={m.id} onClick={() => onNavigate(m.id)}
            className="bg-white border border-[#E4E4DE] rounded-xl overflow-hidden text-left hover:border-[#F06418] hover:shadow-sm transition-all group"
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
        );
      })}
    </div>
  );
}
