"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Search, RefreshCw, UserPlus, Users, Dumbbell,
  Phone, Mail, ArrowRight, X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { StatsCard } from "@/components/ui/StatsCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatPKR } from "@/lib/utils";
import { ViewToggle, type ViewMode } from "@/components/ui/ViewToggle";
import type { StaffMember, StaffRole } from "@/types/database";

type StaffWithCount = StaffMember & { member_count: number };

type RoleFilter = "all" | "Trainer" | "Receptionist" | "Manager" | "Nutritionist" | "Other";

const ROLE_COLORS: Record<string, string> = {
  Trainer:       "bg-[#FEF0E8] text-[#C04E10] border-[#FDDCC8]",
  Receptionist:  "bg-blue-50 text-blue-700 border-blue-200",
  Manager:       "bg-purple-50 text-purple-700 border-purple-200",
  Nutritionist:  "bg-green-50 text-green-700 border-green-200",
  Other:         "bg-gray-100 text-gray-600 border-gray-200",
};

const SPECIALIZATIONS = [
  "Strength & Conditioning",
  "CrossFit & HIIT",
  "MMA & Combat Sports",
  "Bodybuilding & Nutrition",
  "Cardio & Weight Loss",
  "Functional Fitness",
  "Yoga & Flexibility",
  "Zumba & Dance Fitness",
  "Table Tennis Coaching",
  "General Fitness",
];

const defaultForm = {
  full_name: "", role: "Trainer" as StaffRole,
  specialization: "", phone: "", email: "",
  cnic: "", salary: "", joining_date: "", bio: "",
};

export default function StaffPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [staff, setStaff] = useState<StaffWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode]     = useState<ViewMode>("grid");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [search, setSearch]         = useState("");
  const [addModal, setAddModal]     = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    const [{ data: staffData }, { data: memberCounts }] = await Promise.all([
      supabase
        .from("staff_members")
        .select("*")
        .eq("status", "active")
        .is("deleted_at", null)
        .order("role")
        .order("full_name"),
      supabase
        .from("members")
        .select("trainer_id")
        .eq("status", "active")
        .is("deleted_at", null)
        .not("trainer_id", "is", null),
    ]);

    // Count members per trainer
    const countMap: Record<string, number> = {};
    (memberCounts ?? []).forEach((m: any) => {
      if (m.trainer_id) countMap[m.trainer_id] = (countMap[m.trainer_id] || 0) + 1;
    });

    const withCounts = (staffData ?? []).map((s: any) => ({
      ...s,
      member_count: countMap[s.id] || 0,
    }));

    setStaff(withCounts);
    setLoading(false);
  }, []);

  useEffect(() => { fetchStaff(); }, [fetchStaff]);

  // Open add modal when ?add=1 in URL
  useEffect(() => {
    if (searchParams.get("add") === "1") setAddModal(true);
  }, [searchParams]);

  const filtered = staff.filter((s) => {
    const matchRole = roleFilter === "all" || s.role === roleFilter;
    const matchSearch = !search ||
      s.full_name.toLowerCase().includes(search.toLowerCase()) ||
      s.phone?.includes(search) ||
      s.email?.toLowerCase().includes(search.toLowerCase()) ||
      s.specialization?.toLowerCase().includes(search.toLowerCase());
    return matchRole && matchSearch;
  });

  const trainers = staff.filter((s) => s.role === "Trainer");
  const totalMembers = trainers.reduce((sum, t) => sum + t.member_count, 0);
  const avgMembers = trainers.length ? Math.round(totalMembers / trainers.length) : 0;

  async function handleAdd() {
    if (!form.full_name.trim()) { toast.error("Full name is required"); return; }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("staff_members").insert({
      full_name: form.full_name.trim(),
      role: form.role,
      specialization: form.specialization || null,
      phone: form.phone || null,
      email: form.email || null,
      cnic: form.cnic || null,
      salary: form.salary ? Number(form.salary) : null,
      joining_date: form.joining_date || null,
      bio: form.bio || null,
      status: "active",
    });
    if (error) { toast.error("Failed to add staff member"); setSaving(false); return; }

    await supabase.from("activity_logs").insert({
      action: "added_staff",
      entity_type: "staff_member",
      description: `Added ${form.role} ${form.full_name}`,
    });

    toast.success(`${form.role} ${form.full_name} added!`);
    setAddModal(false);
    setForm(defaultForm);
    setSaving(false);
    fetchStaff();
  }

  const ROLE_TABS: { key: RoleFilter; label: string }[] = [
    { key: "all", label: "All Staff" },
    { key: "Trainer", label: "Trainers" },
    { key: "Receptionist", label: "Receptionists" },
    { key: "Manager", label: "Managers" },
    { key: "Nutritionist", label: "Nutritionists" },
  ];

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Staff & Trainers"
        subtitle="Manage your team"
        action={
          <Button size="sm" onClick={() => setAddModal(true)}>
            <UserPlus className="w-4 h-4" /> Add Staff
          </Button>
        }
      />

      <div className="flex-1 p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            title="Total Staff"
            value={staff.length}
            icon={Users}
            iconColor="text-[#F06418]"
            iconBg="bg-[#FEF0E8]"
          />
          <StatsCard
            title="Active Trainers"
            value={trainers.length}
            icon={Dumbbell}
            iconColor="text-blue-600"
            iconBg="bg-blue-50"
          />
          <StatsCard
            title="Members in Training"
            value={totalMembers}
            icon={Users}
            iconColor="text-green-600"
            iconBg="bg-green-50"
          />
          <StatsCard
            title="Avg Members / Trainer"
            value={avgMembers}
            icon={Dumbbell}
            iconColor="text-purple-600"
            iconBg="bg-purple-50"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-white border border-[#E4E4DE] rounded-lg p-1 gap-0.5">
            {ROLE_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setRoleFilter(tab.key)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  roleFilter === tab.key ? "bg-[#F06418] text-white" : "text-[#4A4A44] hover:bg-[#F8F8F6]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-w-48 max-w-sm relative">
            <Search className="w-4 h-4 text-[#7A7A72] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Name, phone, specialization..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
            />
          </div>

          <ViewToggle value={viewMode} onChange={setViewMode} options={["grid", "compact", "list"]} />
          <Button variant="ghost" size="sm" onClick={fetchStaff}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {/* Staff grid */}
        {loading ? (
          <div className="py-16 text-center">
            <RefreshCw className="w-6 h-6 text-[#7A7A72] animate-spin mx-auto mb-2" />
            <p className="text-sm text-[#7A7A72]">Loading staff...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-12 h-12 bg-[#F8F8F6] rounded-full flex items-center justify-center mx-auto mb-3">
              <Users className="w-5 h-5 text-[#7A7A72]" />
            </div>
            <p className="text-sm font-medium text-[#4A4A44]">No staff found</p>
            <button onClick={() => setAddModal(true)} className="mt-3 text-sm text-[#F06418] hover:underline">
              Add a staff member
            </button>
          </div>
        ) : viewMode === "list" ? (
          /* List view */
          <div className="bg-white border border-[#E4E4DE] rounded-xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-[#F8F8F6] border-b border-[#E4E4DE]">
                <tr>
                  <th className="text-left text-xs font-semibold text-[#7A7A72] px-5 py-3">Staff Member</th>
                  <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Role</th>
                  <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Specialization</th>
                  <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Phone</th>
                  <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Members</th>
                  <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Salary</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E4DE]">
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-[#F8F8F6] transition-colors cursor-pointer" onClick={() => router.push(`/dashboard/staff/${s.id}`)}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-[#1A1A1A] flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {s.photo_url ? <img src={s.photo_url} alt="" className="w-8 h-8 object-cover" /> : (
                            <span className="text-white text-xs font-bold">{s.full_name.charAt(0)}</span>
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-[#1A1A16]">{s.full_name}</p>
                          {s.email && <p className="text-xs text-[#7A7A72] truncate max-w-[160px]">{s.email}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${ROLE_COLORS[s.role ?? "Other"]}`}>{s.role}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-[#4A4A44]">{s.specialization ?? <span className="text-[#7A7A72]">—</span>}</td>
                    <td className="px-4 py-3 text-sm text-[#4A4A44]">{s.phone ?? "—"}</td>
                    <td className="px-4 py-3">
                      {s.role === "Trainer" ? (
                        <span className={`text-sm font-bold ${s.member_count > 0 ? "text-[#F06418]" : "text-[#7A7A72]"}`}>{s.member_count}</span>
                      ) : <span className="text-[#7A7A72] text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-[#1A1A16]">{s.salary ? formatPKR(s.salary) : "—"}</td>
                    <td className="px-5 py-3 text-right">
                      <ArrowRight className="w-4 h-4 text-[#7A7A72] inline-block" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Grid / Compact view */
          <div className={`grid gap-4 ${viewMode === "compact" ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}`}>
            {filtered.map((member) => (
              <button
                key={member.id}
                onClick={() => router.push(`/dashboard/staff/${member.id}`)}
                className={`bg-white border border-[#E4E4DE] rounded-xl text-left hover:border-[#F06418] hover:shadow-sm transition-all group ${viewMode === "compact" ? "p-3" : "p-5"}`}
              >
                <div className={`flex items-start gap-3 ${viewMode === "compact" ? "mb-2" : "mb-4"}`}>
                  <div className={`rounded-full bg-[#1A1A1A] flex items-center justify-center flex-shrink-0 overflow-hidden ${viewMode === "compact" ? "w-8 h-8" : "w-11 h-11"}`}>
                    {member.photo_url ? (
                      <img src={member.photo_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className={`text-white font-bold ${viewMode === "compact" ? "text-xs" : "text-sm"}`}>{member.full_name.charAt(0)}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-bold text-[#1A1A16] truncate group-hover:text-[#F06418] transition-colors ${viewMode === "compact" ? "text-xs" : "text-sm"}`}>{member.full_name}</p>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border mt-1 ${ROLE_COLORS[member.role ?? "Other"]}`}>{member.role}</span>
                  </div>
                </div>
                {viewMode !== "compact" && (
                  <>
                    {member.specialization && (
                      <p className="text-xs text-[#7A7A72] mb-3 flex items-center gap-1">
                        <Dumbbell className="w-3 h-3 flex-shrink-0" />{member.specialization}
                      </p>
                    )}
                    {member.role === "Trainer" && (
                      <div className="flex items-center justify-between mb-3 bg-[#F8F8F6] rounded-lg px-3 py-2">
                        <span className="text-xs text-[#7A7A72]">Members assigned</span>
                        <span className={`text-sm font-bold ${member.member_count > 0 ? "text-[#F06418]" : "text-[#7A7A72]"}`}>{member.member_count}</span>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      {member.phone && <p className="text-xs text-[#4A4A44] flex items-center gap-1.5"><Phone className="w-3 h-3 text-[#7A7A72]" />{member.phone}</p>}
                      {member.email && <p className="text-xs text-[#4A4A44] flex items-center gap-1.5 truncate"><Mail className="w-3 h-3 text-[#7A7A72] flex-shrink-0" /><span className="truncate">{member.email}</span></p>}
                    </div>
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#E4E4DE]">
                      <div>
                        <p className="text-[10px] text-[#7A7A72]">Salary</p>
                        <p className="text-sm font-semibold text-[#1A1A16]">{member.salary ? formatPKR(member.salary) : "—"}</p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-[#7A7A72] group-hover:text-[#F06418] transition-colors" />
                    </div>
                  </>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Add Staff Modal */}
      <Modal open={addModal} onClose={() => { setAddModal(false); setForm(defaultForm); }} title="Add Staff Member" size="lg">
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Full Name" required
              placeholder="e.g. Muhammad Ali"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
            <Select
              label="Role" required
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}
            >
              <option value="Trainer">Trainer</option>
              <option value="Receptionist">Receptionist</option>
              <option value="Manager">Manager</option>
              <option value="Nutritionist">Nutritionist</option>
              <option value="Other">Other</option>
            </Select>

            {form.role === "Trainer" && (
              <Select
                label="Specialization"
                placeholder="Select specialization"
                value={form.specialization}
                onChange={(e) => setForm({ ...form, specialization: e.target.value })}
              >
                {SPECIALIZATIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            )}

            <Input
              label="Phone"
              type="tel"
              placeholder="0300-0000000"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <Input
              label="Email"
              type="email"
              placeholder="trainer@levelupfitness.com.pk"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <Input
              label="CNIC"
              placeholder="XXXXX-XXXXXXX-X"
              value={form.cnic}
              onChange={(e) => setForm({ ...form, cnic: e.target.value })}
            />
            <Input
              label="Monthly Salary (Rs)"
              type="number"
              placeholder="45000"
              value={form.salary}
              onChange={(e) => setForm({ ...form, salary: e.target.value })}
            />
            <Input
              label="Joining Date"
              type="date"
              value={form.joining_date}
              onChange={(e) => setForm({ ...form, joining_date: e.target.value })}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-[#1A1A16] block mb-1">Bio / Notes</label>
            <textarea
              rows={3}
              placeholder="Brief background, certifications, expertise..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418] resize-none"
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={() => { setAddModal(false); setForm(defaultForm); }} className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleAdd} loading={saving} className="flex-1">
              <UserPlus className="w-4 h-4" /> Add Staff Member
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
