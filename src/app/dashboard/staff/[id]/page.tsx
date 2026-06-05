"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft, User, Phone, Mail, CreditCard, Calendar,
  Edit3, Check, X, Dumbbell, Users, Banknote,
  UserCheck, Clock, CheckCircle, XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { StatsCard } from "@/components/ui/StatsCard";
import { formatDate, formatPKR } from "@/lib/utils";
import type { StaffMember, Member, StaffRole } from "@/types/database";
import { differenceInMonths } from "date-fns";

type MemberWithPackage = Member & { packages?: { name: string } | null };

const SPECIALIZATIONS = [
  "Strength & Conditioning", "CrossFit & HIIT", "MMA & Combat Sports",
  "Bodybuilding & Nutrition", "Cardio & Weight Loss", "Functional Fitness",
  "Yoga & Flexibility", "Zumba & Dance Fitness", "Table Tennis Coaching", "General Fitness",
];

const ROLE_COLORS: Record<string, string> = {
  Trainer: "bg-[#FEF0E8] text-[#C04E10] border-[#FDDCC8]",
  Receptionist: "bg-blue-50 text-blue-700 border-blue-200",
  Manager: "bg-purple-50 text-purple-700 border-purple-200",
  Nutritionist: "bg-green-50 text-green-700 border-green-200",
  Other: "bg-gray-100 text-gray-600 border-gray-200",
};

export default function StaffDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [assignedMembers, setAssignedMembers] = useState<MemberWithPackage[]>([]);
  const [totalTrainerFees, setTotalTrainerFees] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [editForm, setEditForm] = useState({
    full_name: "", role: "" as StaffRole,
    specialization: "", phone: "", email: "",
    cnic: "", salary: "", joining_date: "", bio: "",
  });

  const fetchStaff = useCallback(async () => {
    const supabase = createClient();
    const [{ data: staffData }, { data: members }, { data: fees }] = await Promise.all([
      supabase.from("staff_members").select("*").eq("id", id).single(),
      supabase
        .from("members")
        .select("*, packages(name)")
        .eq("trainer_id", id)
        .eq("status", "active")
        .is("deleted_at", null)
        .order("full_name"),
      supabase
        .from("fee_payments")
        .select("amount")
        .eq("payment_type", "trainer")
        .is("deleted_at", null),
    ]);

    if (staffData) {
      setStaff(staffData as StaffMember);
      setEditForm({
        full_name: staffData.full_name ?? "",
        role: staffData.role ?? "Trainer",
        specialization: staffData.specialization ?? "",
        phone: staffData.phone ?? "",
        email: staffData.email ?? "",
        cnic: staffData.cnic ?? "",
        salary: staffData.salary?.toString() ?? "",
        joining_date: staffData.joining_date ?? "",
        bio: staffData.bio ?? "",
      });
    }
    setAssignedMembers((members as MemberWithPackage[]) ?? []);
    setTotalTrainerFees(fees?.reduce((sum: number, f: any) => sum + (f.amount ?? 0), 0) ?? 0);
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchStaff(); }, [fetchStaff]);

  async function handleSave() {
    if (!editForm.full_name.trim()) { toast.error("Full name is required"); return; }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("staff_members").update({
      full_name: editForm.full_name.trim(),
      role: editForm.role,
      specialization: editForm.specialization || null,
      phone: editForm.phone || null,
      email: editForm.email || null,
      cnic: editForm.cnic || null,
      salary: editForm.salary ? Number(editForm.salary) : null,
      joining_date: editForm.joining_date || null,
      bio: editForm.bio || null,
    }).eq("id", id);

    if (error) { toast.error("Failed to save"); setSaving(false); return; }

    await supabase.from("activity_logs").insert({
      action: "updated_staff",
      entity_type: "staff_member",
      entity_id: id,
      description: `Updated profile for ${editForm.full_name}`,
    });

    toast.success("Profile updated");
    setEditing(false);
    setSaving(false);
    fetchStaff();
  }

  async function toggleStatus() {
    if (!staff) return;
    const newStatus = staff.status === "active" ? "inactive" : "active";
    const confirmed = confirm(`Mark ${staff.full_name} as ${newStatus}?`);
    if (!confirmed) return;

    const supabase = createClient();
    await supabase.from("staff_members").update({ status: newStatus }).eq("id", id);
    await supabase.from("activity_logs").insert({
      action: "updated_staff_status",
      entity_type: "staff_member",
      entity_id: id,
      description: `Marked ${staff.full_name} as ${newStatus}`,
    });

    toast.success(`${staff.full_name} marked as ${newStatus}`);
    fetchStaff();
  }

  if (loading) {
    return (
      <div className="flex flex-col flex-1">
        <DashboardHeader title="Staff Profile" />
        <div className="flex-1 flex items-center justify-center text-sm text-[#7A7A72]">Loading...</div>
      </div>
    );
  }

  if (!staff) {
    return (
      <div className="flex flex-col flex-1">
        <DashboardHeader title="Not Found" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-[#4A4A44] mb-3">Staff member not found.</p>
            <Link href="/dashboard/staff"><Button variant="secondary">Back to Staff</Button></Link>
          </div>
        </div>
      </div>
    );
  }

  const experienceMonths = staff.joining_date
    ? differenceInMonths(new Date(), new Date(staff.joining_date))
    : 0;
  const experienceText = experienceMonths >= 12
    ? `${Math.floor(experienceMonths / 12)}y ${experienceMonths % 12}m`
    : `${experienceMonths}m`;

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title={staff.full_name}
        subtitle={staff.specialization ?? staff.role ?? "Staff"}
        action={
          <div className="flex items-center gap-2">
            <Link href="/dashboard/staff">
              <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4" /> Staff</Button>
            </Link>
            {!editing ? (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                <Edit3 className="w-4 h-4" /> Edit Profile
              </Button>
            ) : (
              <>
                <Button size="sm" variant="secondary" onClick={() => { setEditing(false); fetchStaff(); }}>
                  <X className="w-4 h-4" /> Cancel
                </Button>
                <Button size="sm" onClick={handleSave} loading={saving}>
                  <Check className="w-4 h-4" /> Save Changes
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="flex-1 p-6 space-y-5">
        {/* Stats row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            title="Members Assigned"
            value={assignedMembers.length}
            icon={Users}
            iconColor="text-[#F06418]"
            iconBg="bg-[#FEF0E8]"
          />
          <StatsCard
            title="Monthly Salary"
            value={staff.salary ? formatPKR(staff.salary) : "—"}
            icon={Banknote}
            iconColor="text-green-600"
            iconBg="bg-green-50"
          />
          <StatsCard
            title="Experience"
            value={staff.joining_date ? experienceText : "—"}
            icon={Clock}
            iconColor="text-blue-600"
            iconBg="bg-blue-50"
          />
          <StatsCard
            title="Status"
            value={staff.status === "active" ? "Active" : "Inactive"}
            icon={staff.status === "active" ? CheckCircle : XCircle}
            iconColor={staff.status === "active" ? "text-green-600" : "text-gray-400"}
            iconBg={staff.status === "active" ? "bg-green-50" : "bg-gray-100"}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Profile card */}
          <div className="lg:col-span-1 space-y-4">
            <Card>
              {/* Avatar + badge */}
              <div className="flex flex-col items-center text-center pb-4 border-b border-[#E4E4DE] mb-4">
                <div className="w-20 h-20 rounded-full bg-[#1A1A1A] flex items-center justify-center mb-3 overflow-hidden">
                  {staff.photo_url ? (
                    <img src={staff.photo_url} alt="" className="w-20 h-20 object-cover" />
                  ) : (
                    <span className="text-white font-bold text-2xl">
                      {staff.full_name.charAt(0)}
                    </span>
                  )}
                </div>
                <h2 className="text-lg font-bold text-[#1A1A16]">{staff.full_name}</h2>
                {staff.specialization && (
                  <p className="text-sm text-[#7A7A72] mt-0.5">{staff.specialization}</p>
                )}
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border mt-2 ${ROLE_COLORS[staff.role ?? "Other"]}`}>
                  {staff.role}
                </span>
              </div>

              {/* Contact details */}
              <div className="space-y-2.5 text-sm">
                {staff.phone && (
                  <div className="flex items-center gap-2 text-[#4A4A44]">
                    <Phone className="w-3.5 h-3.5 text-[#7A7A72]" /> {staff.phone}
                  </div>
                )}
                {staff.email && (
                  <div className="flex items-center gap-2 text-[#4A4A44]">
                    <Mail className="w-3.5 h-3.5 text-[#7A7A72]" /> {staff.email}
                  </div>
                )}
                {staff.cnic && (
                  <div className="flex items-center gap-2 text-[#4A4A44]">
                    <UserCheck className="w-3.5 h-3.5 text-[#7A7A72]" /> {staff.cnic}
                  </div>
                )}
                {staff.joining_date && (
                  <div className="flex items-center gap-2 text-[#4A4A44]">
                    <Calendar className="w-3.5 h-3.5 text-[#7A7A72]" />
                    Joined {formatDate(staff.joining_date)}
                  </div>
                )}
                {staff.salary && (
                  <div className="flex items-center gap-2 text-[#4A4A44]">
                    <CreditCard className="w-3.5 h-3.5 text-[#7A7A72]" />
                    {formatPKR(staff.salary)} / month
                  </div>
                )}
              </div>

              {staff.bio && (
                <div className="mt-4 pt-4 border-t border-[#E4E4DE]">
                  <p className="text-xs text-[#7A7A72] font-semibold uppercase tracking-wide mb-1">Bio</p>
                  <p className="text-sm text-[#4A4A44]">{staff.bio}</p>
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-[#E4E4DE]">
                <button
                  onClick={toggleStatus}
                  className={`w-full py-2 rounded-lg text-sm font-medium transition-colors border ${
                    staff.status === "active"
                      ? "text-red-600 border-red-200 hover:bg-red-50"
                      : "text-green-600 border-green-200 hover:bg-green-50"
                  }`}
                >
                  {staff.status === "active" ? "Mark as Inactive" : "Mark as Active"}
                </button>
              </div>
            </Card>
          </div>

          {/* Right column */}
          <div className="lg:col-span-2 space-y-4">
            {/* Edit form */}
            {editing && (
              <Card>
                <h3 className="text-sm font-semibold text-[#1A1A16] mb-4 flex items-center gap-2">
                  <Edit3 className="w-4 h-4 text-[#F06418]" /> Edit Profile
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Full Name" required
                    value={editForm.full_name}
                    onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                  />
                  <Select
                    label="Role"
                    value={editForm.role}
                    onChange={(e) => setEditForm({ ...editForm, role: e.target.value as StaffRole })}
                  >
                    <option value="Trainer">Trainer</option>
                    <option value="Receptionist">Receptionist</option>
                    <option value="Manager">Manager</option>
                    <option value="Nutritionist">Nutritionist</option>
                    <option value="Other">Other</option>
                  </Select>
                  <Select
                    label="Specialization"
                    value={editForm.specialization}
                    onChange={(e) => setEditForm({ ...editForm, specialization: e.target.value })}
                    placeholder="Select specialization"
                  >
                    {SPECIALIZATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                  <Input
                    label="Phone"
                    value={editForm.phone}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  />
                  <Input
                    label="Email"
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  />
                  <Input
                    label="CNIC"
                    value={editForm.cnic}
                    onChange={(e) => setEditForm({ ...editForm, cnic: e.target.value })}
                  />
                  <Input
                    label="Monthly Salary (Rs)"
                    type="number"
                    value={editForm.salary}
                    onChange={(e) => setEditForm({ ...editForm, salary: e.target.value })}
                  />
                  <Input
                    label="Joining Date"
                    type="date"
                    value={editForm.joining_date}
                    onChange={(e) => setEditForm({ ...editForm, joining_date: e.target.value })}
                  />
                  <div className="sm:col-span-2">
                    <label className="text-sm font-medium text-[#1A1A16] block mb-1">Bio / Notes</label>
                    <textarea
                      rows={3}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418] resize-none"
                      value={editForm.bio}
                      onChange={(e) => setEditForm({ ...editForm, bio: e.target.value })}
                    />
                  </div>
                </div>
              </Card>
            )}

            {/* Assigned Members */}
            <Card padding={false}>
              <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Dumbbell className="w-4 h-4 text-[#F06418]" />
                  <h3 className="text-sm font-semibold text-[#1A1A16]">
                    Assigned Members
                    <span className="ml-2 text-xs font-normal text-[#7A7A72]">({assignedMembers.length})</span>
                  </h3>
                </div>
                <Link href="/dashboard/members">
                  <span className="text-xs text-[#F06418] hover:underline">All members →</span>
                </Link>
              </div>

              {assignedMembers.length === 0 ? (
                <div className="py-10 text-center">
                  <div className="w-10 h-10 bg-[#F8F8F6] rounded-full flex items-center justify-center mx-auto mb-2">
                    <Users className="w-5 h-5 text-[#7A7A72]" />
                  </div>
                  <p className="text-sm text-[#7A7A72]">No members assigned yet</p>
                  <p className="text-xs text-[#7A7A72] mt-0.5">
                    Assign this trainer from a member's profile page
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[#E4E4DE]">
                  {assignedMembers.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => router.push(`/dashboard/members/${m.id}`)}
                      className="w-full px-5 py-3 flex items-center justify-between hover:bg-[#F8F8F6] transition-colors text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-[#FEF0E8] flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {m.photo_url ? (
                            <img src={m.photo_url} alt="" className="w-8 h-8 object-cover" />
                          ) : (
                            <span className="text-[#F06418] text-xs font-bold">{m.full_name.charAt(0)}</span>
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-[#1A1A16]">{m.full_name}</p>
                          <p className="text-xs text-[#7A7A72]">
                            {(m as any).packages?.name ?? "No package"} · {m.phone}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {m.expiry_date && (
                          <span className="text-xs text-[#7A7A72]">
                            Exp: {formatDate(m.expiry_date)}
                          </span>
                        )}
                        <Badge variant={m.status === "active" ? "active" : "inactive"}>
                          {m.status}
                        </Badge>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Card>

            {/* Salary summary card */}
            <Card>
              <h3 className="text-sm font-semibold text-[#1A1A16] mb-4 flex items-center gap-2">
                <Banknote className="w-4 h-4 text-[#F06418]" /> Salary Information
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#F8F8F6] rounded-lg p-3">
                  <p className="text-xs text-[#7A7A72]">Monthly Salary</p>
                  <p className="text-base font-bold text-[#1A1A16] mt-1">
                    {staff.salary ? formatPKR(staff.salary) : "Not set"}
                  </p>
                </div>
                <div className="bg-[#F8F8F6] rounded-lg p-3">
                  <p className="text-xs text-[#7A7A72]">Annual Package</p>
                  <p className="text-base font-bold text-[#1A1A16] mt-1">
                    {staff.salary ? formatPKR(staff.salary * 12) : "—"}
                  </p>
                </div>
                <div className="bg-[#F8F8F6] rounded-lg p-3">
                  <p className="text-xs text-[#7A7A72]">Joining Date</p>
                  <p className="text-base font-bold text-[#1A1A16] mt-1">
                    {staff.joining_date ? formatDate(staff.joining_date) : "—"}
                  </p>
                </div>
                <div className="bg-[#F8F8F6] rounded-lg p-3">
                  <p className="text-xs text-[#7A7A72]">Experience</p>
                  <p className="text-base font-bold text-[#1A1A16] mt-1">
                    {staff.joining_date ? experienceText : "—"}
                  </p>
                </div>
              </div>
              <p className="text-xs text-[#7A7A72] mt-3">
                Payroll processing coming in Phase 2.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
