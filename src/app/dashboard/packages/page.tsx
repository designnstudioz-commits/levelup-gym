"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Plus, Edit3, Trash2, RefreshCw, Star, Users,
  Check, Dumbbell, Package as PackageIcon, CreditCard,
  SlidersHorizontal, X,
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
import { formatPKR } from "@/lib/utils";
import type { Package, PackageType } from "@/types/database";

type PackageWithCount = Package & { member_count: number };

type SortKey = "price_asc" | "price_desc" | "name_asc" | "popular" | "newest";

const ALL_SERVICES = [
  "Gym", "Cardio", "Personal Training", "CrossFit", "MMA",
  "Table Tennis", "Zumba", "Hybrid Workout", "METCON",
  "Nutritionist", "Paid Locker", "Shower Facility",
];

const SERVICE_ICONS: Record<string, string> = {
  "Gym": "🏋️", "Cardio": "🚴", "Personal Training": "👤",
  "CrossFit": "⚡", "MMA": "🥊", "Table Tennis": "🏓",
  "Zumba": "💃", "Hybrid Workout": "🔥", "METCON": "⏱️",
  "Nutritionist": "🥗", "Paid Locker": "🔒", "Shower Facility": "🚿",
};

const PACKAGE_COLORS = [
  { label: "Orange", value: "#F06418" },
  { label: "Blue",   value: "#2563EB" },
  { label: "Purple", value: "#7C3AED" },
  { label: "Red",    value: "#DC2626" },
  { label: "Amber",  value: "#D97706" },
  { label: "Green",  value: "#059669" },
  { label: "Dark",   value: "#1A1A1A" },
  { label: "Pink",   value: "#DB2777" },
];

const DURATIONS = [
  { label: "1 Month",          value: 1  },
  { label: "3 Months",         value: 3  },
  { label: "6 Months",         value: 6  },
  { label: "12 Months (Annual)", value: 12 },
];

const emptyForm = {
  name: "", type: "Individual" as PackageType,
  duration_months: 1, admission_fee: "15000",
  monthly_fee: "", max_members: "1",
  description: "", services_included: [] as string[],
  training_sessions: "0", color: "#F06418",
  is_featured: false, status: "active" as "active" | "inactive",
};

export default function PackagesPage() {
  const [packages, setPackages]     = useState<PackageWithCount[]>([]);
  const [loading, setLoading]       = useState(true);
  const [viewMode, setViewMode]     = useState<ViewMode>("grid");
  const [addModal, setAddModal]     = useState(false);
  const [editTarget, setEditTarget] = useState<PackageWithCount | null>(null);
  const [form, setForm]             = useState(emptyForm);
  const [saving, setSaving]         = useState(false);

  // Filters
  const [search, setSearch]               = useState("");
  const [typeFilter, setTypeFilter]       = useState<PackageType | "all">("all");
  const [sortKey, setSortKey]             = useState<SortKey>("price_asc");
  const [showInactive, setShowInactive]   = useState(false);
  const [featuredOnly, setFeaturedOnly]   = useState(false);
  const [maxFeeFilter, setMaxFeeFilter]   = useState("");
  const [serviceFilter, setServiceFilter] = useState("");

  const fetchPackages = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const [{ data: pkgs }, { data: memberCounts }] = await Promise.all([
      supabase.from("packages").select("*").is("deleted_at", null),
      supabase.from("members").select("package_id").eq("status", "active").is("deleted_at", null).not("package_id", "is", null),
    ]);
    const countMap: Record<string, number> = {};
    (memberCounts ?? []).forEach((m: any) => {
      if (m.package_id) countMap[m.package_id] = (countMap[m.package_id] || 0) + 1;
    });
    setPackages((pkgs ?? []).map((p: any) => ({ ...p, member_count: countMap[p.id] || 0 })));
    setLoading(false);
  }, []);

  useEffect(() => { fetchPackages(); }, [fetchPackages]);

  // ── Filtering & sorting ─────────────────────────────────────────
  const visible = packages
    .filter((p) => {
      if (!showInactive && p.status === "inactive") return false;
      if (typeFilter !== "all" && p.type !== typeFilter) return false;
      if (featuredOnly && !p.is_featured) return false;
      if (maxFeeFilter && p.monthly_fee > Number(maxFeeFilter)) return false;
      if (serviceFilter && !p.services_included?.includes(serviceFilter)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !p.description?.toLowerCase().includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortKey === "price_asc")  return a.monthly_fee - b.monthly_fee;
      if (sortKey === "price_desc") return b.monthly_fee - a.monthly_fee;
      if (sortKey === "name_asc")   return a.name.localeCompare(b.name);
      if (sortKey === "popular")    return b.member_count - a.member_count;
      if (sortKey === "newest")     return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return 0;
    });

  const hasActiveFilters = typeFilter !== "all" || featuredOnly || !!maxFeeFilter || !!serviceFilter || !!search;

  function clearFilters() {
    setSearch(""); setTypeFilter("all"); setFeaturedOnly(false);
    setMaxFeeFilter(""); setServiceFilter("");
  }

  // ── Form helpers ────────────────────────────────────────────────
  function openAdd() { setForm(emptyForm); setEditTarget(null); setAddModal(true); }

  function openEdit(pkg: PackageWithCount) {
    setForm({
      name: pkg.name, type: pkg.type ?? "Individual",
      duration_months: pkg.duration_months ?? 1,
      admission_fee: pkg.admission_fee?.toString() ?? "15000",
      monthly_fee: pkg.monthly_fee?.toString() ?? "",
      max_members: pkg.max_members?.toString() ?? "1",
      description: pkg.description ?? "",
      services_included: pkg.services_included ?? [],
      training_sessions: pkg.training_sessions?.toString() ?? "0",
      color: pkg.color ?? "#F06418", is_featured: pkg.is_featured ?? false,
      status: pkg.status,
    });
    setEditTarget(pkg); setAddModal(true);
  }

  function toggleService(s: string) {
    setForm((prev) => ({
      ...prev,
      services_included: prev.services_included.includes(s)
        ? prev.services_included.filter((x) => x !== s)
        : [...prev.services_included, s],
    }));
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Package name is required"); return; }
    if (!form.monthly_fee || Number(form.monthly_fee) <= 0) { toast.error("Monthly fee is required"); return; }
    setSaving(true);
    const supabase = createClient();
    const payload = {
      name: form.name.trim(), type: form.type,
      duration_months: Number(form.duration_months),
      admission_fee: Number(form.admission_fee), monthly_fee: Number(form.monthly_fee),
      max_members: Number(form.max_members), description: form.description || null,
      services_included: form.services_included.length ? form.services_included : null,
      training_sessions: Number(form.training_sessions),
      color: form.color, is_featured: form.is_featured, status: form.status,
    };

    if (editTarget) {
      await supabase.from("packages").update(payload).eq("id", editTarget.id);
      await supabase.from("activity_logs").insert({ action: "updated_package", entity_type: "package", entity_id: editTarget.id, description: `Updated package "${form.name}"` });
      toast.success("Package updated");
    } else {
      await supabase.from("packages").insert(payload);
      await supabase.from("activity_logs").insert({ action: "added_package", entity_type: "package", description: `Added package "${form.name}" at ${formatPKR(Number(form.monthly_fee))}/mo` });
      toast.success("Package created");
    }
    setAddModal(false); setSaving(false); fetchPackages();
  }

  async function toggleStatus(pkg: PackageWithCount) {
    const supabase = createClient();
    const ns = pkg.status === "active" ? "inactive" : "active";
    await supabase.from("packages").update({ status: ns }).eq("id", pkg.id);
    toast.success(`"${pkg.name}" marked as ${ns}`);
    fetchPackages();
  }

  async function deletePackage(pkg: PackageWithCount) {
    if (pkg.member_count > 0) { toast.error(`${pkg.member_count} active member(s) on this package — cannot delete`); return; }
    if (!confirm(`Delete "${pkg.name}"?`)) return;
    const supabase = createClient();
    await supabase.from("packages").update({ deleted_at: new Date().toISOString(), status: "inactive" }).eq("id", pkg.id);
    toast.success(`"${pkg.name}" deleted`);
    fetchPackages();
  }

  // ── Stats ───────────────────────────────────────────────────────
  const activeCount   = packages.filter((p) => p.status === "active").length;
  const totalMembers  = packages.reduce((s, p) => s + p.member_count, 0);
  const mostPopular   = [...packages].sort((a, b) => b.member_count - a.member_count)[0];

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Packages"
        subtitle="Manage membership packages and pricing"
        action={<Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" /> Add Package</Button>}
      />

      <div className="flex-1 p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard title="Total Packages"    value={packages.length}            icon={PackageIcon}  iconColor="text-[#F06418]"   iconBg="bg-[#FEF0E8]" />
          <StatsCard title="Active Packages"   value={activeCount}                icon={Check}        iconColor="text-green-600"   iconBg="bg-green-50" />
          <StatsCard title="Members Enrolled"  value={totalMembers}               icon={Users}        iconColor="text-blue-600"    iconBg="bg-blue-50" />
          <StatsCard title="Most Popular"      value={mostPopular?.name ?? "—"}   icon={Star}         iconColor="text-amber-500"   iconBg="bg-amber-50" />
        </div>

        {/* Filter + view bar */}
        <div className="bg-white border border-[#E4E4DE] rounded-xl p-4 space-y-3">
          {/* Row 1: search + view toggle + sort */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-48 max-w-sm relative">
              <input
                type="text"
                placeholder="Search packages..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
              />
              <SlidersHorizontal className="w-4 h-4 text-[#7A7A72] absolute left-3 top-1/2 -translate-y-1/2" />
            </div>

            <Select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="w-44"
            >
              <option value="price_asc">Price: Low → High</option>
              <option value="price_desc">Price: High → Low</option>
              <option value="name_asc">Name: A → Z</option>
              <option value="popular">Most Popular</option>
              <option value="newest">Newest First</option>
            </Select>

            <ViewToggle value={viewMode} onChange={setViewMode} />

            <Button variant="ghost" size="sm" onClick={fetchPackages}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>

          {/* Row 2: filter chips */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Type filter */}
            <div className="flex bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg p-0.5 gap-0.5">
              {(["all", "Individual", "Family", "Couple", "Daily"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    typeFilter === t ? "bg-[#F06418] text-white" : "text-[#4A4A44] hover:bg-white"
                  }`}
                >
                  {t === "all" ? "All Types" : t}
                </button>
              ))}
            </div>

            {/* Service filter */}
            <select
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-[#E4E4DE] bg-white text-[#4A4A44] focus:outline-none focus:ring-2 focus:ring-[#F06418]"
            >
              <option value="">All Services</option>
              {ALL_SERVICES.map((s) => <option key={s} value={s}>{SERVICE_ICONS[s]} {s}</option>)}
            </select>

            {/* Max fee */}
            <div className="relative">
              <input
                type="number"
                placeholder="Max fee (Rs)"
                value={maxFeeFilter}
                onChange={(e) => setMaxFeeFilter(e.target.value)}
                className="text-xs pl-2.5 pr-8 py-1.5 rounded-lg border border-[#E4E4DE] bg-white w-32 focus:outline-none focus:ring-2 focus:ring-[#F06418]"
              />
              {maxFeeFilter && (
                <button onClick={() => setMaxFeeFilter("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#7A7A72] hover:text-[#1A1A16]">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Featured toggle */}
            <label className="flex items-center gap-1.5 text-xs text-[#4A4A44] cursor-pointer bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg px-2.5 py-1.5 hover:border-[#F06418] transition-colors">
              <input type="checkbox" className="accent-[#F06418]" checked={featuredOnly} onChange={(e) => setFeaturedOnly(e.target.checked)} />
              <Star className="w-3 h-3 text-amber-500" /> Featured only
            </label>

            {/* Inactive toggle */}
            <label className="flex items-center gap-1.5 text-xs text-[#4A4A44] cursor-pointer bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg px-2.5 py-1.5 hover:border-[#F06418] transition-colors">
              <input type="checkbox" className="accent-[#F06418]" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show inactive
            </label>

            {hasActiveFilters && (
              <button onClick={clearFilters} className="text-xs text-red-600 hover:underline flex items-center gap-1">
                <X className="w-3 h-3" /> Clear filters
              </button>
            )}

            <span className="ml-auto text-xs text-[#7A7A72]">{visible.length} package{visible.length !== 1 ? "s" : ""}</span>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="py-16 text-center">
            <RefreshCw className="w-6 h-6 text-[#7A7A72] animate-spin mx-auto mb-2" />
            <p className="text-sm text-[#7A7A72]">Loading packages...</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-12 h-12 bg-[#F8F8F6] rounded-full flex items-center justify-center mx-auto mb-3">
              <PackageIcon className="w-5 h-5 text-[#7A7A72]" />
            </div>
            <p className="text-sm font-medium text-[#4A4A44]">No packages match your filters</p>
            <button onClick={clearFilters} className="mt-2 text-sm text-[#F06418] hover:underline">Clear filters</button>
          </div>
        ) : viewMode === "list" ? (
          <ListView packages={visible} onEdit={openEdit} onToggle={toggleStatus} onDelete={deletePackage} />
        ) : (
          <GridView packages={visible} compact={viewMode === "compact"} onEdit={openEdit} onToggle={toggleStatus} onDelete={deletePackage} onAdd={openAdd} />
        )}
      </div>

      {/* Add / Edit Modal */}
      <Modal
        open={addModal}
        onClose={() => { setAddModal(false); setEditTarget(null); }}
        title={editTarget ? `Edit — ${editTarget.name}` : "New Membership Package"}
        size="xl"
      >
        <div className="p-5 space-y-5">
          <div>
            <h4 className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide mb-3">Basic Information</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Package Name" required placeholder="e.g. Gym + Cardio Pro" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Select label="Package Type" required value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as PackageType })}>
                <option value="Individual">Individual</option>
                <option value="Family">Family</option>
                <option value="Couple">Couple</option>
                <option value="Daily">Daily Pass</option>
              </Select>
              <Select label="Duration" value={String(form.duration_months)} onChange={(e) => setForm({ ...form, duration_months: Number(e.target.value) })}>
                {DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </Select>
              <Input label="Max Members" type="number" hint="For family/couple" value={form.max_members} onChange={(e) => setForm({ ...form, max_members: e.target.value })} />
            </div>
          </div>

          <div>
            <h4 className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide mb-3">Pricing</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input label="Monthly Fee (Rs)" required type="number" placeholder="7500" value={form.monthly_fee} onChange={(e) => setForm({ ...form, monthly_fee: e.target.value })} />
              <Input label="Admission Fee (Rs)" type="number" placeholder="15000" value={form.admission_fee} onChange={(e) => setForm({ ...form, admission_fee: e.target.value })} />
              <Input label="PT Sessions / Month" type="number" placeholder="0" hint="0 = not included" value={form.training_sessions} onChange={(e) => setForm({ ...form, training_sessions: e.target.value })} />
            </div>
            {form.monthly_fee && (
              <div className="mt-3 bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg px-4 py-3 flex flex-wrap gap-6 text-sm">
                <div><span className="text-[#7A7A72]">Monthly: </span><span className="font-bold text-[#F06418]">{formatPKR(Number(form.monthly_fee))}</span></div>
                {Number(form.duration_months) > 1 && (
                  <div><span className="text-[#7A7A72]">{form.duration_months}-month: </span><span className="font-bold">{formatPKR(Number(form.monthly_fee) * Number(form.duration_months))}</span></div>
                )}
                <div><span className="text-[#7A7A72]">With admission: </span><span className="font-bold">{formatPKR(Number(form.monthly_fee) + Number(form.admission_fee || 0))}</span></div>
              </div>
            )}
          </div>

          <div>
            <h4 className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide mb-3">
              Services Included <span className="font-normal normal-case text-[#7A7A72] ml-1">({form.services_included.length} selected)</span>
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {ALL_SERVICES.map((s) => {
                const selected = form.services_included.includes(s);
                return (
                  <button key={s} type="button" onClick={() => toggleService(s)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${selected ? "bg-[#FEF0E8] border-[#F06418] text-[#C04E10]" : "bg-white border-[#E4E4DE] text-[#4A4A44] hover:border-[#F06418]"}`}
                  >
                    <span>{SERVICE_ICONS[s]}</span><span>{s}</span>
                    {selected && <Check className="w-3 h-3 ml-auto" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide mb-3">Appearance & Settings</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-[#1A1A16] block mb-2">Card Color</label>
                <div className="flex flex-wrap gap-2">
                  {PACKAGE_COLORS.map((c) => (
                    <button key={c.value} type="button" onClick={() => setForm({ ...form, color: c.value })} title={c.label}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${form.color === c.value ? "border-[#1A1A16] scale-110" : "border-transparent hover:scale-105"}`}
                      style={{ backgroundColor: c.value }} />
                  ))}
                </div>
              </div>
              <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as "active" | "inactive" })}>
                <option value="active">Active</option>
                <option value="inactive">Inactive (hidden from registration)</option>
              </Select>
            </div>
            <label className="flex items-center gap-3 mt-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-[#F06418]" checked={form.is_featured} onChange={(e) => setForm({ ...form, is_featured: e.target.checked })} />
              <div>
                <p className="text-sm font-medium text-[#1A1A16]">Featured Package</p>
                <p className="text-xs text-[#7A7A72]">Shows a star badge — highlight recommended packages</p>
              </div>
            </label>
            <div className="mt-3">
              <label className="text-sm font-medium text-[#1A1A16] block mb-1">Description</label>
              <textarea rows={2} placeholder="Brief description of what's included..." className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418] resize-none" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={() => { setAddModal(false); setEditTarget(null); }} className="flex-1">Cancel</Button>
            <Button onClick={handleSave} loading={saving} className="flex-1">{editTarget ? "Save Changes" : "Create Package"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Grid View ───────────────────────────────────────────────────────
function GridView({ packages, compact, onEdit, onToggle, onDelete, onAdd }: {
  packages: PackageWithCount[]; compact: boolean;
  onEdit: (p: PackageWithCount) => void; onToggle: (p: PackageWithCount) => void;
  onDelete: (p: PackageWithCount) => void; onAdd: () => void;
}) {
  const cols = compact
    ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
    : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

  return (
    <div className={`grid ${cols} gap-4`}>
      {packages.map((pkg) => (
        <PackageCard key={pkg.id} pkg={pkg} compact={compact} onEdit={onEdit} onToggle={onToggle} onDelete={onDelete} />
      ))}
      <button onClick={onAdd}
        className={`border-2 border-dashed border-[#E4E4DE] rounded-xl flex flex-col items-center justify-center gap-2 text-[#7A7A72] hover:border-[#F06418] hover:text-[#F06418] hover:bg-[#FEF0E8] transition-all ${compact ? "py-8" : "min-h-[200px] p-6"}`}
      >
        <Plus className={compact ? "w-5 h-5" : "w-8 h-8"} />
        <span className="text-sm font-medium">Add Package</span>
      </button>
    </div>
  );
}

// ── List View ───────────────────────────────────────────────────────
function ListView({ packages, onEdit, onToggle, onDelete }: {
  packages: PackageWithCount[];
  onEdit: (p: PackageWithCount) => void; onToggle: (p: PackageWithCount) => void;
  onDelete: (p: PackageWithCount) => void;
}) {
  return (
    <div className="bg-white border border-[#E4E4DE] rounded-xl overflow-hidden">
      <table className="w-full">
        <thead className="bg-[#F8F8F6] border-b border-[#E4E4DE]">
          <tr>
            <th className="text-left text-xs font-semibold text-[#7A7A72] px-5 py-3">Package</th>
            <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Type</th>
            <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Monthly Fee</th>
            <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Admission</th>
            <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Duration</th>
            <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Services</th>
            <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Members</th>
            <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Status</th>
            <th className="text-right text-xs font-semibold text-[#7A7A72] px-5 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E4E4DE]">
          {packages.map((pkg) => {
            const accent = pkg.color ?? "#F06418";
            return (
              <tr key={pkg.id} className="hover:bg-[#F8F8F6] transition-colors">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: accent }} />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-[#1A1A16]">{pkg.name}</p>
                        {pkg.is_featured && <Star className="w-3 h-3" style={{ color: accent }} fill={accent} />}
                      </div>
                      {pkg.description && <p className="text-xs text-[#7A7A72] truncate max-w-[180px]">{pkg.description}</p>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs font-medium text-[#4A4A44] bg-[#F8F8F6] border border-[#E4E4DE] px-2 py-0.5 rounded-full">{pkg.type}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm font-bold" style={{ color: accent }}>{formatPKR(pkg.monthly_fee)}</span>
                </td>
                <td className="px-4 py-3 text-sm text-[#4A4A44]">{formatPKR(pkg.admission_fee)}</td>
                <td className="px-4 py-3 text-sm text-[#4A4A44]">
                  {pkg.duration_months === 1 ? "Monthly" : `${pkg.duration_months} months`}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1 max-w-[160px]">
                    {pkg.services_included?.slice(0, 3).map((s) => (
                      <span key={s} className="text-[10px] px-1.5 py-0.5 bg-[#F8F8F6] border border-[#E4E4DE] rounded text-[#4A4A44]">
                        {SERVICE_ICONS[s]} {s}
                      </span>
                    ))}
                    {(pkg.services_included?.length ?? 0) > 3 && (
                      <span className="text-[10px] text-[#7A7A72]">+{(pkg.services_included?.length ?? 0) - 3}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 text-sm">
                    <Users className="w-3.5 h-3.5 text-[#7A7A72]" />
                    <span className="font-medium text-[#1A1A16]">{pkg.member_count}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={pkg.status === "active" ? "active" : "inactive"}>{pkg.status}</Badge>
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => onEdit(pkg)} className="p-1.5 rounded-lg text-[#7A7A72] hover:text-[#F06418] hover:bg-[#FEF0E8] transition-colors" title="Edit">
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => onToggle(pkg)} className="p-1.5 rounded-lg text-[#7A7A72] hover:text-amber-600 hover:bg-amber-50 transition-colors" title={pkg.status === "active" ? "Deactivate" : "Activate"}>
                      {pkg.status === "active" ? <X className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => onDelete(pkg)} disabled={pkg.member_count > 0}
                      className="p-1.5 rounded-lg text-[#7A7A72] hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title="Delete">
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
  );
}

// ── Package Card ────────────────────────────────────────────────────
function PackageCard({ pkg, compact, onEdit, onToggle, onDelete }: {
  pkg: PackageWithCount; compact: boolean;
  onEdit: (p: PackageWithCount) => void; onToggle: (p: PackageWithCount) => void;
  onDelete: (p: PackageWithCount) => void;
}) {
  const accent = pkg.color ?? "#F06418";
  const inactive = pkg.status === "inactive";

  return (
    <div className={`bg-white border border-[#E4E4DE] rounded-xl overflow-hidden flex flex-col ${inactive ? "opacity-60" : ""}`}>
      <div className="h-1.5" style={{ backgroundColor: accent }} />
      <div className={`flex flex-col flex-1 ${compact ? "p-3" : "p-5"}`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className={`font-bold text-[#1A1A16] truncate ${compact ? "text-sm" : "text-base"}`}>{pkg.name}</h3>
              {pkg.is_featured && <Star className="w-3 h-3 flex-shrink-0" style={{ color: accent }} fill={accent} />}
            </div>
            <div className="flex gap-1 mt-1 flex-wrap">
              {pkg.type && (
                <span className="text-[10px] font-semibold text-[#7A7A72] bg-[#F8F8F6] border border-[#E4E4DE] px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                  {pkg.type}
                </span>
              )}
              {pkg.duration_months > 1 && (
                <span className="text-[10px] font-semibold text-[#7A7A72] bg-[#F8F8F6] border border-[#E4E4DE] px-1.5 py-0.5 rounded-full">
                  {pkg.duration_months}mo
                </span>
              )}
              <Badge variant={pkg.status === "active" ? "active" : "inactive"}>{pkg.status}</Badge>
            </div>
          </div>
        </div>

        {/* Price */}
        <div className={compact ? "mb-2" : "mb-3"}>
          <div className="flex items-baseline gap-1">
            <span className={`font-bold ${compact ? "text-lg" : "text-2xl"}`} style={{ color: accent }}>
              {formatPKR(pkg.monthly_fee)}
            </span>
            <span className="text-xs text-[#7A7A72]">/mo</span>
          </div>
          {!compact && <p className="text-xs text-[#7A7A72]">Admission: {formatPKR(pkg.admission_fee)}</p>}
          {!compact && pkg.training_sessions != null && pkg.training_sessions > 0 && (
            <p className="text-xs text-[#4A4A44] mt-0.5 flex items-center gap-1">
              <Dumbbell className="w-3 h-3" style={{ color: accent }} />
              {pkg.training_sessions} PT sessions/month
            </p>
          )}
        </div>

        {/* Services */}
        {!compact && pkg.services_included && pkg.services_included.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {pkg.services_included.slice(0, compact ? 2 : 4).map((s) => (
              <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-[#F8F8F6] text-[#4A4A44] border border-[#E4E4DE]">
                {SERVICE_ICONS[s]} {s}
              </span>
            ))}
            {pkg.services_included.length > 4 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F8F8F6] text-[#7A7A72] border border-[#E4E4DE]">
                +{pkg.services_included.length - 4} more
              </span>
            )}
          </div>
        )}

        {!compact && pkg.description && (
          <p className="text-xs text-[#7A7A72] mb-3 line-clamp-2">{pkg.description}</p>
        )}

        {/* Member count */}
        <div className={`mt-auto border-t border-[#E4E4DE] flex items-center justify-between ${compact ? "pt-2" : "pt-3"}`}>
          <div className="flex items-center gap-1">
            <Users className="w-3.5 h-3.5 text-[#7A7A72]" />
            <span className="text-xs text-[#4A4A44] font-medium">{pkg.member_count} member{pkg.member_count !== 1 ? "s" : ""}</span>
          </div>
        </div>

        {/* Actions */}
        <div className={`flex items-center gap-1.5 ${compact ? "mt-2" : "mt-3"}`}>
          <button onClick={() => onEdit(pkg)} className="flex-1 py-1.5 rounded-lg text-xs font-semibold border border-[#E4E4DE] text-[#4A4A44] hover:border-[#F06418] hover:text-[#F06418] hover:bg-[#FEF0E8] transition-colors">Edit</button>
          <button onClick={() => onToggle(pkg)} className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${pkg.status === "active" ? "border-[#E4E4DE] text-[#4A4A44] hover:border-amber-400 hover:text-amber-600 hover:bg-amber-50" : "border-green-200 text-green-600 hover:bg-green-50"}`}>
            {pkg.status === "active" ? "Deactivate" : "Activate"}
          </button>
          <button onClick={() => onDelete(pkg)} disabled={pkg.member_count > 0}
            className="p-1.5 rounded-lg border border-[#E4E4DE] text-[#7A7A72] hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
