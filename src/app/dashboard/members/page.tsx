"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search, UserPlus, RefreshCw, User, ArrowRight,
  SlidersHorizontal, X,
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
type SortKey = "name_asc" | "newest" | "expiry_asc" | "expiry_desc";

export default function MembersPage() {
  const router = useRouter();
  const [members, setMembers]   = useState<MemberWithJoins[]>([]);
  const [loading, setLoading]   = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // Filters
  const [search, setSearch]             = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [genderFilter, setGenderFilter] = useState<"all" | "Male" | "Female">("all");
  const [sortKey, setSortKey]           = useState<SortKey>("newest");
  const [expiringOnly, setExpiringOnly] = useState(false);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from("members")
      .select("*, packages(name, monthly_fee, color), trainer:staff_members!members_trainer_id_fkey(full_name)")
      .is("deleted_at", null);

    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    if (genderFilter !== "all") query = query.eq("gender", genderFilter);

    const { data, error } = await query;
    if (!error) setMembers(data ?? []);
    setLoading(false);
  }, [statusFilter, genderFilter]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  const filtered = members
    .filter((m) => {
      if (expiringOnly) {
        const days = daysUntilExpiry(m.expiry_date);
        if (days === null || days > 30 || days < 0) return false;
      }
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
      if (sortKey === "name_asc")    return a.full_name.localeCompare(b.full_name);
      if (sortKey === "newest")      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortKey === "expiry_asc")  return (a.expiry_date ?? "").localeCompare(b.expiry_date ?? "");
      if (sortKey === "expiry_desc") return (b.expiry_date ?? "").localeCompare(a.expiry_date ?? "");
      return 0;
    });

  const hasActiveFilters = genderFilter !== "all" || expiringOnly || !!search;
  function clearFilters() { setSearch(""); setGenderFilter("all"); setExpiringOnly(false); }

  const STATUS_TABS: { key: StatusFilter; label: string }[] = [
    { key: "active", label: "Active" },
    { key: "inactive", label: "Inactive" },
    { key: "frozen", label: "Frozen" },
    { key: "archived", label: "Archived" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Members"
        subtitle={`${filtered.length} member${filtered.length !== 1 ? "s" : ""} shown`}
      />

      <div className="flex-1 p-6 space-y-4">
        {/* Filter + view bar */}
        <div className="bg-white border border-[#E4E4DE] rounded-xl p-4 space-y-3">
          {/* Row 1 */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg p-0.5 gap-0.5">
              {STATUS_TABS.map((tab) => (
                <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${statusFilter === tab.key ? "bg-[#F06418] text-white" : "text-[#4A4A44] hover:bg-white"}`}
                >
                  {tab.label}
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
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${genderFilter === g ? "bg-[#1A1A1A] text-white" : "text-[#4A4A44] hover:bg-white"}`}
                >
                  {g === "all" ? "All Genders" : g}
                </button>
              ))}
            </div>

            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-[#E4E4DE] bg-white text-[#4A4A44] focus:outline-none focus:ring-2 focus:ring-[#F06418]"
            >
              <option value="newest">Newest First</option>
              <option value="name_asc">Name A → Z</option>
              <option value="expiry_asc">Expiry: Soonest</option>
              <option value="expiry_desc">Expiry: Latest</option>
            </select>

            <label className="flex items-center gap-1.5 text-xs text-[#4A4A44] cursor-pointer bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg px-2.5 py-1.5 hover:border-[#F06418] transition-colors">
              <input type="checkbox" className="accent-[#F06418]" checked={expiringOnly} onChange={(e) => setExpiringOnly(e.target.checked)} />
              Expiring in 30 days
            </label>

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
          <MembersTable members={filtered} onNavigate={(id) => router.push(`/dashboard/members/${id}`)} />
        ) : viewMode === "grid" ? (
          <MembersGrid members={filtered} onNavigate={(id) => router.push(`/dashboard/members/${id}`)} compact={false} />
        ) : (
          <MembersGrid members={filtered} onNavigate={(id) => router.push(`/dashboard/members/${id}`)} compact={true} />
        )}
      </div>
    </div>
  );
}

// ── List (Table) View ────────────────────────────────────────────────
function MembersTable({ members, onNavigate }: { members: MemberWithJoins[]; onNavigate: (id: string) => void }) {
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
              <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E4E4DE]">
            {members.map((m) => {
              const { label, variant } = getMemberStatusDisplay(m.status, m.expiry_date);
              const pkgColor = (m as any).packages?.color ?? "#F06418";
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
                        <p className="text-sm font-semibold text-[#1A1A16]">{m.full_name}</p>
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
function MembersGrid({ members, onNavigate, compact }: { members: MemberWithJoins[]; onNavigate: (id: string) => void; compact: boolean }) {
  const cols = compact
    ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
    : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

  return (
    <div className={`grid ${cols} gap-4`}>
      {members.map((m) => {
        const { label, variant } = getMemberStatusDisplay(m.status, m.expiry_date);
        const days = daysUntilExpiry(m.expiry_date);
        const pkgColor = (m as any).packages?.color ?? "#F06418";

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
                <div className="min-w-0">
                  <p className={`font-bold text-[#1A1A16] truncate group-hover:text-[#F06418] transition-colors ${compact ? "text-xs" : "text-sm"}`}>{m.full_name}</p>
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

              <div className="flex items-center justify-between">
                <Badge variant={variant}>{label}</Badge>
                {!compact && <ArrowRight className="w-3.5 h-3.5 text-[#7A7A72] group-hover:text-[#F06418] transition-colors" />}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
