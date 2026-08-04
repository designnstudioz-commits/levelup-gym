"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft, User, Phone, Mail, CreditCard, Calendar,
  Edit3, Check, X, Dumbbell, Users, Banknote,
  UserCheck, Clock, CheckCircle, XCircle, Fingerprint, Send, Loader2, Printer,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/contexts/CurrentUserContext";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { StatsCard } from "@/components/ui/StatsCard";
import { formatDate, formatPKR, getMemberStatusDisplay, calculateTrainerCommission, PT_GYM_FEE_PORTION, COMMISSION_ELIGIBLE_TYPES } from "@/lib/utils";
import type { StaffMember, Member, StaffRole, TrainerMemberCommission } from "@/types/database";
import { differenceInMonths, subMonths, startOfMonth, endOfMonth, format } from "date-fns";

type MemberWithPackage = Member & { packages?: { name: string; monthly_fee: number } | null };

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
  "Software Developer": "bg-indigo-50 text-indigo-700 border-indigo-200",
  Designer: "bg-pink-50 text-pink-700 border-pink-200",
  Freelancer: "bg-amber-50 text-amber-700 border-amber-200",
  Other: "bg-gray-100 text-gray-600 border-gray-200",
};

export default function StaffDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const currentUser = useCurrentUser();

  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [assignedMembers, setAssignedMembers] = useState<MemberWithPackage[]>([]);
  // Manually-set commission % per assigned member (independent of package).
  const [commissionRates, setCommissionRates] = useState<TrainerMemberCommission[]>([]);
  // This member's actual collected membership/trainer fee_payments — the
  // basis the manual %/fixed-amount is applied against. id + receipt_no are
  // needed to dedupe a split (Cash+Bank) payment into one logical
  // transaction via countLogicalPayments() for the fixed-amount mode.
  const [memberPayments, setMemberPayments] = useState<{ id: string; member_id: string; amount: number; payment_date: string; receipt_no: string | null }[]>([]);
  const [commissionInputs, setCommissionInputs] = useState<Record<string, string>>({});
  const [commissionTypeInputs, setCommissionTypeInputs] = useState<Record<string, "percent" | "fixed">>({});
  const [commissionAmountInputs, setCommissionAmountInputs] = useState<Record<string, string>>({});
  const [savingCommission, setSavingCommission] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Device enrollment — staff use a single device_user_id column (not the
  // per-device device_enrollments table members use), reserved to 5000+ so
  // it never collides with member PINs (derived from membership numbers,
  // starting at 1).
  const [devices, setDevices] = useState<{ serial_no: string; name: string | null }[]>([]);
  const [editingDeviceId, setEditingDeviceId] = useState(false);
  const [deviceIdInput, setDeviceIdInput] = useState("");
  const [savingDeviceId, setSavingDeviceId] = useState(false);
  const [pushDevice, setPushDevice] = useState("");
  const [pushing, setPushing] = useState(false);

  // Edit form state
  const [editForm, setEditForm] = useState({
    full_name: "", role: "" as StaffRole,
    specialization: "", phone: "", email: "",
    cnic: "", salary: "", joining_date: "", bio: "",
  });

  const fetchStaff = useCallback(async () => {
    const supabase = createClient();
    const [{ data: staffData }, { data: members }, { data: rates }] = await Promise.all([
      supabase.from("staff_members").select("*").eq("id", id).single(),
      supabase
        .from("members")
        .select("*, packages(name, monthly_fee)")
        .eq("trainer_id", id)
        .eq("status", "active")
        .is("deleted_at", null)
        .order("full_name"),
      supabase.from("trainer_member_commissions").select("*").eq("trainer_id", id).is("deleted_at", null),
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
    const membersList = (members as MemberWithPackage[]) ?? [];
    setAssignedMembers(membersList);
    const ratesList = (rates as TrainerMemberCommission[]) ?? [];
    setCommissionRates(ratesList);
    setCommissionInputs(
      Object.fromEntries(membersList.map((m) => [m.id, String(ratesList.find((r) => r.member_id === m.id)?.commission_percent ?? "")]))
    );
    setCommissionTypeInputs(
      Object.fromEntries(membersList.map((m) => [m.id, (ratesList.find((r) => r.member_id === m.id)?.commission_type ?? "percent") as "percent" | "fixed"]))
    );
    setCommissionAmountInputs(
      Object.fromEntries(membersList.map((m) => [m.id, String(ratesList.find((r) => r.member_id === m.id)?.commission_amount ?? "")]))
    );

    // Each assigned member's own collected membership/trainer fee_payments —
    // fetched separately since it depends on membersList, which isn't known
    // until the Promise.all above resolves.
    if (membersList.length > 0) {
      const { data: payments } = await supabase
        .from("fee_payments")
        .select("id, member_id, amount, payment_date, receipt_no")
        .in("member_id", membersList.map((m) => m.id))
        .in("payment_type", COMMISSION_ELIGIBLE_TYPES)
        .is("deleted_at", null);
      setMemberPayments(payments ?? []);
    } else {
      setMemberPayments([]);
    }

    setLoading(false);
  }, [id]);

  useEffect(() => { fetchStaff(); }, [fetchStaff]);

  useEffect(() => {
    createClient().from("devices").select("serial_no, name").order("name").then(({ data }) => setDevices(data ?? []));
  }, []);

  async function suggestNextDeviceId(): Promise<string> {
    const supabase = createClient();
    const { data } = await supabase.from("staff_members").select("device_user_id").gte("device_user_id", "5000").is("deleted_at", null);
    let next = 5000;
    for (const row of data ?? []) {
      const n = parseInt(row.device_user_id ?? "", 10);
      if (!isNaN(n) && n >= next) next = n + 1;
    }
    return String(next);
  }

  async function startEditDeviceId() {
    setDeviceIdInput(staff?.device_user_id || (await suggestNextDeviceId()));
    setEditingDeviceId(true);
  }

  async function saveDeviceId() {
    const val = deviceIdInput.trim();
    if (val && parseInt(val, 10) < 5000) {
      toast.error("Staff device IDs must be 5000 or higher, to avoid colliding with member IDs");
      return;
    }
    setSavingDeviceId(true);
    const supabase = createClient();
    const { error } = await supabase.from("staff_members").update({ device_user_id: val || null }).eq("id", id);
    if (error) { toast.error("Failed to save device ID"); setSavingDeviceId(false); return; }
    await supabase.from("activity_logs").insert({
      user_id: currentUser?.id ?? null,
      action: "updated_staff_device_id",
      entity_type: "staff_member",
      entity_id: id,
      description: `Set device ID ${val || "(cleared)"} for ${staff?.full_name}`,
    });
    toast.success("Device ID saved");
    setEditingDeviceId(false);
    setSavingDeviceId(false);
    fetchStaff();
  }

  async function pushStaffToDevice() {
    if (!pushDevice) { toast.error("Select a device"); return; }
    setPushing(true);
    try {
      const res = await fetch("/api/devices/push-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staff_id: id, device_serial: pushDevice }),
      });
      const data = await res.json();
      if (!res.ok) toast.error(data.error ?? "Push failed");
      else toast.success("Queued — device will pick it up within ~30 seconds");
    } catch {
      toast.error("Push failed");
    }
    setPushing(false);
  }

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
      user_id: currentUser?.id ?? null,
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
      user_id: currentUser?.id ?? null,
      action: "updated_staff_status",
      entity_type: "staff_member",
      entity_id: id,
      description: `Marked ${staff.full_name} as ${newStatus}`,
    });

    toast.success(`${staff.full_name} marked as ${newStatus}`);
    fetchStaff();
  }

  // Manually set/update this trainer's commission for one assigned
  // member — independent of package/tier. Either a percentage (of the
  // payment, minus the flat gym cut) or a flat Rs amount per qualifying
  // payment — never both; the unused column is written as its neutral
  // placeholder (0 / null) since commission_percent stays NOT NULL.
  // Upserts by (trainer_id, member_id) so re-saving just updates the row.
  async function saveCommissionRate(memberId: string) {
    const type = commissionTypeInputs[memberId] ?? "percent";
    let payload: { commission_type: "percent" | "fixed"; commission_percent: number; commission_amount: number | null };

    if (type === "percent") {
      const raw = commissionInputs[memberId] ?? "";
      const percent = Number(raw);
      if (raw.trim() === "" || isNaN(percent) || percent < 0 || percent > 100) {
        toast.error("Enter a valid percentage (0–100)");
        return;
      }
      payload = { commission_type: "percent", commission_percent: percent, commission_amount: null };
    } else {
      const raw = commissionAmountInputs[memberId] ?? "";
      const amount = Number(raw);
      if (raw.trim() === "" || isNaN(amount) || amount < 0) {
        toast.error("Enter a valid fixed amount");
        return;
      }
      payload = { commission_type: "fixed", commission_percent: 0, commission_amount: amount };
    }

    setSavingCommission(memberId);
    const supabase = createClient();
    const existing = commissionRates.find((r) => r.member_id === memberId);

    const { error } = existing
      ? await supabase.from("trainer_member_commissions")
          .update({ ...payload, updated_by: currentUser?.id ?? null, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
      : await supabase.from("trainer_member_commissions")
          .insert({ trainer_id: id, member_id: memberId, ...payload, updated_by: currentUser?.id ?? null });

    if (error) {
      toast.error("Failed to save commission rate");
      setSavingCommission(null);
      return;
    }

    const memberName = assignedMembers.find((m) => m.id === memberId)?.full_name ?? "member";
    await supabase.from("activity_logs").insert({
      user_id: currentUser?.id ?? null,
      action: "updated_trainer_commission",
      entity_type: "staff_member",
      entity_id: id,
      description: type === "percent"
        ? `Set commission rate for ${memberName} to ${payload.commission_percent}%`
        : `Set commission for ${memberName} to a flat ${formatPKR(payload.commission_amount ?? 0)} per payment`,
    });

    toast.success("Commission rate saved");
    setSavingCommission(null);
    fetchStaff();
  }

  // Clears one member's saved commission rate (soft-delete) — used by the
  // per-row clear button. If nothing's been saved yet (just a typed,
  // unsaved input), this just resets the local input instead of hitting
  // the DB at all.
  async function clearCommissionRate(memberId: string) {
    const existing = commissionRates.find((r) => r.member_id === memberId);
    if (!existing) {
      setCommissionInputs((prev) => ({ ...prev, [memberId]: "" }));
      setCommissionAmountInputs((prev) => ({ ...prev, [memberId]: "" }));
      return;
    }
    setSavingCommission(memberId);
    const supabase = createClient();
    const { error } = await supabase.from("trainer_member_commissions").update({ deleted_at: new Date().toISOString() }).eq("id", existing.id);
    if (error) {
      toast.error("Failed to clear commission");
      setSavingCommission(null);
      return;
    }
    const memberName = assignedMembers.find((m) => m.id === memberId)?.full_name ?? "member";
    await supabase.from("activity_logs").insert({
      user_id: currentUser?.id ?? null,
      action: "cleared_trainer_commission",
      entity_type: "staff_member",
      entity_id: id,
      description: `Cleared commission rate for ${memberName}`,
    });
    toast.success("Commission cleared");
    setSavingCommission(null);
    fetchStaff();
  }

  // Bulk-clears every assigned member's saved commission rate at once.
  async function clearAllCommissions() {
    if (commissionRates.length === 0) { toast.info("No commission rates to clear"); return; }
    if (!confirm(`Clear commission rates for all ${commissionRates.length} member(s) with a rate set? This can't be undone — rates can be re-entered individually afterward.`)) return;

    const supabase = createClient();
    const { error } = await supabase
      .from("trainer_member_commissions")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", commissionRates.map((r) => r.id));
    if (error) {
      toast.error("Failed to clear commissions");
      return;
    }
    await supabase.from("activity_logs").insert({
      user_id: currentUser?.id ?? null,
      action: "cleared_all_trainer_commissions",
      entity_type: "staff_member",
      entity_id: id,
      description: `Cleared all ${commissionRates.length} commission rate(s) for ${staff?.full_name}`,
    });
    toast.success("All commission rates cleared");
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

  // Commission = manually-set % × (actual collected payment − flat gym cut),
  // per member, summed. Only counts payments that have actually been
  // collected — nothing is projected off a member's package/monthly_fee.
  const monthStart = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;
  // "This Month"/"All Time" are open-ended ranges (no periodEnd needed —
  // there's nothing dated beyond today). "Last Month" is a closed period,
  // so it needs an explicit end date or it would keep pulling in every
  // payment from last month through today.
  const lastMonthDate = subMonths(new Date(), 1);
  const lastMonthStart = format(startOfMonth(lastMonthDate), "yyyy-MM-dd");
  const lastMonthEnd = format(endOfMonth(lastMonthDate), "yyyy-MM-dd");
  function commissionForMember(memberId: string, periodStart: string | null, periodEnd: string | null = null): number {
    const rate = commissionRates.find((r) => r.member_id === memberId);
    const rows = memberPayments.filter((p) => p.member_id === memberId);
    return calculateTrainerCommission(rate, rows, periodStart, periodEnd);
  }
  const commissionThisMonth = assignedMembers.reduce((sum, m) => sum + commissionForMember(m.id, monthStart), 0);
  const commissionLastMonth = assignedMembers.reduce((sum, m) => sum + commissionForMember(m.id, lastMonthStart, lastMonthEnd), 0);
  const commissionAllTime = assignedMembers.reduce((sum, m) => sum + commissionForMember(m.id, null), 0);

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

        {/* Profile banner — one highlighted row instead of a tall sidebar
            card, so the sections below (Assigned Members especially) get
            the full page width. */}
        <div className="bg-[#FEF0E8] border-2 border-[#FDDCC8] rounded-2xl p-4 sm:p-5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-[#1A1A1A] flex items-center justify-center flex-shrink-0 overflow-hidden">
              {staff.photo_url ? (
                <img src={staff.photo_url} alt="" className="w-14 h-14 object-cover" />
              ) : (
                <span className="text-white font-bold text-lg">
                  {staff.full_name.charAt(0)}
                </span>
              )}
            </div>
            <div>
              <h2 className="text-base font-bold text-[#1A1A16] leading-tight">{staff.full_name}</h2>
              {staff.specialization && (
                <p className="text-xs text-[#7A7A72]">{staff.specialization}</p>
              )}
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border mt-1 ${ROLE_COLORS[staff.role ?? "Other"]}`}>
                {staff.role}
              </span>
            </div>
          </div>

          <div className="hidden sm:block w-px h-10 bg-[#FDDCC8]" />

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-[#4A4A44]">
            {staff.phone && (
              <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-[#C04E10]" /> {staff.phone}</span>
            )}
            {staff.email && (
              <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-[#C04E10]" /> {staff.email}</span>
            )}
            {staff.cnic && (
              <span className="flex items-center gap-1.5"><UserCheck className="w-3.5 h-3.5 text-[#C04E10]" /> {staff.cnic}</span>
            )}
            {staff.joining_date && (
              <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-[#C04E10]" /> Joined {formatDate(staff.joining_date)}</span>
            )}
            {staff.salary && (
              <span className="flex items-center gap-1.5"><CreditCard className="w-3.5 h-3.5 text-[#C04E10]" /> {formatPKR(staff.salary)} / month</span>
            )}
          </div>

          {staff.bio && (
            <p className="text-xs text-[#7A7A72] italic w-full sm:w-auto sm:flex-1 sm:min-w-[160px]">{staff.bio}</p>
          )}

          <button
            onClick={toggleStatus}
            className={`ml-auto px-4 py-2 rounded-lg text-sm font-medium transition-colors border bg-white ${
              staff.status === "active"
                ? "text-red-600 border-red-200 hover:bg-red-50"
                : "text-green-600 border-green-200 hover:bg-green-50"
            }`}
          >
            {staff.status === "active" ? "Mark as Inactive" : "Mark as Active"}
          </button>
        </div>

        <div className="space-y-4">
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
                    <option value="Software Developer">Software Developer</option>
                    <option value="Designer">Designer</option>
                    <option value="Freelancer">Freelancer</option>
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
                <div className="flex items-center gap-4">
                  {staff.role === "Trainer" && commissionRates.length > 0 && (
                    <button onClick={clearAllCommissions} className="text-xs text-red-600 hover:underline flex items-center gap-1">
                      <X className="w-3 h-3" /> Clear All Commissions
                    </button>
                  )}
                  <Link href="/dashboard/members">
                    <span className="text-xs text-[#F06418] hover:underline">All members →</span>
                  </Link>
                </div>
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
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-[#F8F8F6] border-b border-[#E4E4DE]">
                      <tr>
                        <th className="text-left text-xs font-semibold text-[#7A7A72] px-5 py-3">Member</th>
                        <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Package</th>
                        <th className="text-right text-xs font-semibold text-[#7A7A72] px-4 py-3">Package Fee</th>
                        {staff.role === "Trainer" && <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Commission</th>}
                        {staff.role === "Trainer" && <th className="text-right text-xs font-semibold text-[#7A7A72] px-4 py-3">This Month</th>}
                        <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Expiry</th>
                        <th className="text-left text-xs font-semibold text-[#7A7A72] px-5 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E4E4DE]">
                      {assignedMembers.map((m) => {
                        const { label: statusLabel, variant: statusVariant } = getMemberStatusDisplay(m.status, m.expiry_date);
                        const thisMonthCommission = commissionForMember(m.id, monthStart);
                        const hasCommissionValue = (commissionInputs[m.id] ?? "").trim() !== "" || (commissionAmountInputs[m.id] ?? "").trim() !== "";
                        return (
                        <tr
                          key={m.id}
                          onClick={() => router.push(`/dashboard/members/${m.id}`)}
                          className="hover:bg-[#F8F8F6] transition-colors cursor-pointer"
                        >
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-[#FEF0E8] flex items-center justify-center flex-shrink-0 overflow-hidden">
                                {m.photo_url ? (
                                  <img src={m.photo_url} alt="" className="w-8 h-8 object-cover" />
                                ) : (
                                  <span className="text-[#F06418] text-xs font-bold">{m.full_name.charAt(0)}</span>
                                )}
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-[#1A1A16] whitespace-nowrap">{m.full_name}</p>
                                <p className="text-xs text-[#7A7A72] whitespace-nowrap">{m.phone}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-[#4A4A44] whitespace-nowrap">
                            {m.packages?.name ?? "No package"}
                          </td>
                          <td className="px-4 py-3 text-sm text-[#4A4A44] text-right whitespace-nowrap">
                            {m.packages?.monthly_fee ? formatPKR(m.packages.monthly_fee) : "—"}
                          </td>
                          {staff.role === "Trainer" && (
                            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1.5">
                                <select
                                  value={commissionTypeInputs[m.id] ?? "percent"}
                                  onChange={(e) => setCommissionTypeInputs((prev) => ({ ...prev, [m.id]: e.target.value as "percent" | "fixed" }))}
                                  title="Commission mode"
                                  className="text-xs px-1 py-1 rounded border border-[#E4E4DE] bg-white focus:outline-none focus:ring-1 focus:ring-[#F06418]"
                                >
                                  <option value="percent">%</option>
                                  <option value="fixed">Rs</option>
                                </select>
                                {(commissionTypeInputs[m.id] ?? "percent") === "percent" ? (
                                  <input
                                    type="number" min={0} max={100}
                                    value={commissionInputs[m.id] ?? ""}
                                    onChange={(e) => setCommissionInputs((prev) => ({ ...prev, [m.id]: e.target.value }))}
                                    onBlur={() => { if ((commissionInputs[m.id] ?? "").trim() !== "") saveCommissionRate(m.id); }}
                                    placeholder="%"
                                    title="Commission % for this member"
                                    className="w-12 text-xs px-1.5 py-1 rounded border border-[#E4E4DE] text-center focus:outline-none focus:ring-1 focus:ring-[#F06418]"
                                  />
                                ) : (
                                  <input
                                    type="number" min={0}
                                    value={commissionAmountInputs[m.id] ?? ""}
                                    onChange={(e) => setCommissionAmountInputs((prev) => ({ ...prev, [m.id]: e.target.value }))}
                                    onBlur={() => { if ((commissionAmountInputs[m.id] ?? "").trim() !== "") saveCommissionRate(m.id); }}
                                    placeholder="Rs"
                                    title="Flat commission per qualifying payment"
                                    className="w-16 text-xs px-1.5 py-1 rounded border border-[#E4E4DE] text-center focus:outline-none focus:ring-1 focus:ring-[#F06418]"
                                  />
                                )}
                                {(hasCommissionValue) && (
                                  <button
                                    onClick={() => clearCommissionRate(m.id)}
                                    disabled={savingCommission === m.id}
                                    title="Clear commission"
                                    className="p-1 rounded text-[#7A7A72] hover:text-red-600 hover:bg-red-50 disabled:opacity-50 flex-shrink-0"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                )}
                                {savingCommission === m.id && <Loader2 className="w-3 h-3 animate-spin text-[#7A7A72] flex-shrink-0" />}
                              </div>
                            </td>
                          )}
                          {staff.role === "Trainer" && (
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              {thisMonthCommission > 0 ? (
                                <span className="text-xs font-semibold text-[#C04E10]">{formatPKR(thisMonthCommission)}</span>
                              ) : (
                                <span className="text-xs text-[#7A7A72]">—</span>
                              )}
                            </td>
                          )}
                          <td className="px-4 py-3 text-xs text-[#7A7A72] whitespace-nowrap">
                            {m.expiry_date ? formatDate(m.expiry_date) : "—"}
                          </td>
                          <td className="px-5 py-3 whitespace-nowrap">
                            <Badge variant={statusVariant}>
                              {statusLabel}
                            </Badge>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Device Enrollment */}
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-[#1A1A16] flex items-center gap-2">
                  <Fingerprint className="w-4 h-4 text-[#F06418]" /> Device Enrollment
                </h3>
                {!editingDeviceId ? (
                  <button onClick={startEditDeviceId} className="text-xs text-[#F06418] flex items-center gap-1 hover:underline">
                    <Edit3 className="w-3 h-3" /> {staff.device_user_id ? "Change" : "Assign ID"}
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={saveDeviceId} disabled={savingDeviceId} className="text-xs text-green-600 flex items-center gap-1 hover:underline disabled:opacity-50">
                      <Check className="w-3 h-3" /> Save
                    </button>
                    <button onClick={() => setEditingDeviceId(false)} className="text-xs text-red-600 flex items-center gap-1 hover:underline">
                      <X className="w-3 h-3" /> Cancel
                    </button>
                  </div>
                )}
              </div>

              {editingDeviceId ? (
                <div>
                  <Input
                    label="Device ID (5000+)"
                    type="number"
                    value={deviceIdInput}
                    onChange={(e) => setDeviceIdInput(e.target.value)}
                  />
                  <p className="text-xs text-[#7A7A72] mt-1.5">
                    Reserved for staff (5000+) so it never collides with a member's device ID (which matches their membership number).
                  </p>
                </div>
              ) : staff.device_user_id ? (
                <div>
                  <p className="text-base font-semibold text-[#1A1A16] font-mono">{staff.device_user_id}</p>
                  <div className="flex items-center gap-2 mt-3">
                    <select value={pushDevice} onChange={(e) => setPushDevice(e.target.value)}
                      className="flex-1 text-sm px-3 py-2 rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
                    >
                      <option value="">Select device...</option>
                      {devices.map((d) => (
                        <option key={d.serial_no} value={d.serial_no}>{d.name ?? d.serial_no}</option>
                      ))}
                    </select>
                    <Button size="sm" onClick={pushStaffToDevice} loading={pushing} disabled={!pushDevice}>
                      {pushing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Push
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[#7A7A72]">Not enrolled — click Assign ID to reserve a device ID for this staff member (once their fingerprint/face is registered on the machine at that ID).</p>
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
                {staff.role === "Trainer" && (
                  <>
                    <div className="bg-[#FEF0E8] rounded-lg p-3">
                      <p className="text-xs text-[#C04E10]">PT Commission (This Month)</p>
                      <p className="text-base font-bold text-[#1A1A16] mt-1">
                        {formatPKR(commissionThisMonth)}
                      </p>
                    </div>
                    <div className="bg-[#FEF0E8] rounded-lg p-3">
                      <p className="text-xs text-[#C04E10]">PT Commission (Last Month)</p>
                      <p className="text-base font-bold text-[#1A1A16] mt-1">
                        {formatPKR(commissionLastMonth)}
                      </p>
                    </div>
                    <div className="bg-[#FEF0E8] rounded-lg p-3">
                      <p className="text-xs text-[#C04E10]">PT Commission (All Time)</p>
                      <p className="text-base font-bold text-[#1A1A16] mt-1">
                        {formatPKR(commissionAllTime)}
                      </p>
                    </div>
                  </>
                )}
              </div>
              {staff.role === "Trainer" && (
                <>
                  <div className="mt-4 pt-4 border-t border-[#E4E4DE] flex items-center justify-between">
                    <span className="text-sm font-semibold text-[#1A1A16]">Total Payable (This Month)</span>
                    <span className="text-lg font-bold text-[#F06418]">
                      {formatPKR((staff.salary ?? 0) + commissionThisMonth)}
                    </span>
                  </div>
                  <p className="text-xs text-[#7A7A72] mt-2">
                    Commission is set manually per assigned member below (independent of package/tier) and applied to their actual collected payments, minus a flat Rs {PT_GYM_FEE_PORTION.toLocaleString()} gym cut.
                  </p>
                </>
              )}
              <Link
                href={`/dashboard/staff/${id}/salary-slip`}
                className="mt-4 flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-[#F06418] text-white rounded-lg text-sm font-semibold hover:bg-[#C04E10] transition-colors"
              >
                <Printer className="w-4 h-4" /> Generate Salary Slip
              </Link>
              {staff.role === "Trainer" && (
                <p className="text-xs text-[#7A7A72] mt-2 text-center">
                  Need a different month's commission? The salary slip has its own period picker — pick any month there.
                </p>
              )}
            </Card>
            </div>
        </div>
      </div>
    </div>
  );
}
