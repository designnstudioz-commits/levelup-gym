"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  User, Phone, Mail, MapPin, Calendar, CreditCard, Dumbbell,
  Edit3, Check, X, ArrowLeft, UserCheck, Package,
  Stethoscope, AlertTriangle, Plus, Snowflake, Archive, Tag,
  Percent, Minus, Fingerprint,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatDate, formatPKR, getMemberStatusDisplay, daysUntilExpiry } from "@/lib/utils";
import type { Member, Package as PackageType, StaffMember, FeePayment } from "@/types/database";
import Link from "next/link";
import { addMonths, format } from "date-fns";

const SERVICES = [
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

export default function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [member, setMember] = useState<Member & { packages?: PackageType | null; trainer?: StaffMember | null } | null>(null);
  const [packages, setPackages] = useState<PackageType[]>([]);
  const [trainers, setTrainers] = useState<StaffMember[]>([]);
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit states
  const [editPackage, setEditPackage] = useState(false);
  const [editTrainer, setEditTrainer] = useState(false);
  const [editServices, setEditServices] = useState(false);
  const [feeModal, setFeeModal] = useState(false);
  const [renewModal, setRenewModal] = useState(false);
  const [freezeModal, setFreezeModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form states
  const [selectedPackage, setSelectedPackage] = useState("");
  const [selectedTrainer, setSelectedTrainer] = useState("");
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [joiningDate, setJoiningDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [feeAmount, setFeeAmount] = useState("");
  const [feeType, setFeeType] = useState("membership");
  const [feeMethod, setFeeMethod] = useState("Cash");
  const [feeNote, setFeeNote] = useState("");
  const [discountType, setDiscountType] = useState<"none" | "percent" | "amount">("none");
  const [discountValue, setDiscountValue] = useState("");

  function openFeeModal() {
    // Pre-fill with package monthly fee (prefer package record, fall back to member field)
    const prefill = (member as any)?.packages?.monthly_fee ?? member?.monthly_fee;
    setFeeAmount(prefill ? String(prefill) : "");
    setFeeType("membership");
    setFeeMethod("Cash");
    setFeeNote("");
    setDiscountType("none");
    setDiscountValue("");
    setFeeModal(true);
  }
  const [freezeUntil, setFreezeUntil] = useState("");
  const [freezeReason, setFreezeReason] = useState("");

  const fetchMember = useCallback(async () => {
    const supabase = createClient();
    const [{ data: memberData }, { data: pkgs }, { data: trnrs }, { data: pays }] = await Promise.all([
      supabase
        .from("members")
        .select("*, packages(*), trainer:staff_members!members_trainer_id_fkey(*)")
        .eq("id", id)
        .single(),
      supabase.from("packages").select("*").eq("status", "active").is("deleted_at", null),
      supabase.from("staff_members").select("*").eq("role", "Trainer").eq("status", "active").is("deleted_at", null),
      supabase.from("fee_payments").select("*").eq("member_id", id).is("deleted_at", null).order("payment_date", { ascending: false }).limit(10),
    ]);

    if (memberData) {
      setMember(memberData as any);
      setSelectedPackage(memberData.package_id ?? "");
      setSelectedTrainer(memberData.trainer_id ?? "");
      setJoiningDate(memberData.joining_date ?? "");
      setExpiryDate(memberData.expiry_date ?? "");
    }
    setPackages(pkgs ?? []);
    setTrainers(trnrs ?? []);
    setPayments(pays ?? []);
    setLoading(false);
  }, [id]);

  // Fetch services from submission or member metadata
  useEffect(() => {
    fetchMember();
  }, [fetchMember]);

  // Load saved services from submission if available
  useEffect(() => {
    if (!member) return;
    const fetchServices = async () => {
      const supabase = createClient();
      if (member.submission_id) {
        const { data } = await supabase
          .from("submissions")
          .select("services_interested")
          .eq("id", member.submission_id)
          .single();
        setServices(data?.services_interested ?? []);
        setSelectedServices(data?.services_interested ?? []);
      }
    };
    fetchServices();
  }, [member]);

  async function savePackage() {
    setSaving(true);
    const supabase = createClient();
    const pkg = packages.find((p) => p.id === selectedPackage);
    await supabase.from("members").update({
      package_id: selectedPackage || null,
      monthly_fee: pkg?.monthly_fee ?? member?.monthly_fee,
    }).eq("id", id);
    await supabase.from("activity_logs").insert({
      action: "updated_package",
      entity_type: "member",
      entity_id: id,
      description: `Updated package for ${member?.full_name} to ${pkg?.name ?? "None"}`,
    });
    toast.success("Package updated");
    setEditPackage(false);
    setSaving(false);
    fetchMember();
  }

  async function saveTrainer() {
    setSaving(true);
    const supabase = createClient();
    const trainer = trainers.find((t) => t.id === selectedTrainer);
    await supabase.from("members").update({ trainer_id: selectedTrainer || null }).eq("id", id);
    await supabase.from("activity_logs").insert({
      action: "updated_trainer",
      entity_type: "member",
      entity_id: id,
      description: `Assigned trainer ${trainer?.full_name ?? "None"} to ${member?.full_name}`,
    });
    toast.success("Trainer updated");
    setEditTrainer(false);
    setSaving(false);
    fetchMember();
  }

  async function saveServices() {
    setSaving(true);
    const supabase = createClient();
    // Update submission if exists
    if (member?.submission_id) {
      await supabase.from("submissions").update({ services_interested: selectedServices }).eq("id", member.submission_id);
    }
    await supabase.from("activity_logs").insert({
      action: "updated_services",
      entity_type: "member",
      entity_id: id,
      description: `Updated services for ${member?.full_name}: ${selectedServices.join(", ")}`,
    });
    setServices(selectedServices);
    toast.success("Services updated");
    setEditServices(false);
    setSaving(false);
  }

  // Computed discount values
  const originalAmount = Number(feeAmount) || 0;
  const discountAmount =
    discountType === "percent"
      ? Math.round((originalAmount * (Number(discountValue) || 0)) / 100)
      : discountType === "amount"
      ? Math.min(Number(discountValue) || 0, originalAmount)
      : 0;
  const finalAmount = Math.max(originalAmount - discountAmount, 0);
  const discountPercent =
    discountType === "percent"
      ? Number(discountValue) || 0
      : originalAmount > 0
      ? Math.round((discountAmount / originalAmount) * 100)
      : 0;

  async function recordFee() {
    if (!feeAmount || originalAmount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setSaving(true);
    const supabase = createClient();

    const discountNote =
      discountAmount > 0
        ? `Discount: ${formatPKR(discountAmount)} (${discountPercent}% off original ${formatPKR(originalAmount)})`
        : null;
    const fullNote = [discountNote, feeNote].filter(Boolean).join(" · ") || null;

    await supabase.from("fee_payments").insert({
      member_id: id,
      amount: finalAmount,
      payment_type: feeType as any,
      payment_method: feeMethod as any,
      payment_date: new Date().toISOString().split("T")[0],
      note: fullNote,
    });
    await supabase.from("activity_logs").insert({
      action: "paid_fee",
      entity_type: "member",
      entity_id: id,
      description: `${member?.full_name} paid ${formatPKR(finalAmount)} (${feeType})${discountAmount > 0 ? ` — discount ${formatPKR(discountAmount)}` : ""}`,
      metadata: { original: originalAmount, discount: discountAmount, final: finalAmount, type: feeType, method: feeMethod },
    });
    toast.success(`Fee of ${formatPKR(finalAmount)} recorded${discountAmount > 0 ? ` (${formatPKR(discountAmount)} discount applied)` : ""}`);
    setFeeModal(false);
    setFeeAmount("");
    setFeeNote("");
    setDiscountType("none");
    setDiscountValue("");
    setSaving(false);
    fetchMember();
  }

  async function renewMembership() {
    if (!joiningDate || !expiryDate) {
      toast.error("Set joining and expiry dates");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    await supabase.from("members").update({
      joining_date: joiningDate,
      expiry_date: expiryDate,
      status: "active",
    }).eq("id", id);
    await supabase.from("activity_logs").insert({
      action: "renewed_membership",
      entity_type: "member",
      entity_id: id,
      description: `Renewed membership for ${member?.full_name} until ${formatDate(expiryDate)}`,
    });
    toast.success("Membership renewed");
    setRenewModal(false);
    setSaving(false);
    fetchMember();
  }

  async function freezeMembership() {
    if (!freezeUntil) {
      toast.error("Select freeze until date");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    await supabase.from("members").update({
      status: "frozen",
      frozen_until: freezeUntil,
      freeze_reason: freezeReason || null,
    }).eq("id", id);
    await supabase.from("activity_logs").insert({
      action: "froze_membership",
      entity_type: "member",
      entity_id: id,
      description: `Froze membership for ${member?.full_name} until ${formatDate(freezeUntil)}`,
    });
    toast.success("Membership frozen");
    setFreezeModal(false);
    setSaving(false);
    fetchMember();
  }

  async function archiveMember() {
    if (!confirm(`Archive ${member?.full_name}? They will be hidden from active lists.`)) return;
    const supabase = createClient();
    await supabase.from("members").update({ status: "archived", deleted_at: new Date().toISOString() }).eq("id", id);
    await supabase.from("activity_logs").insert({
      action: "archived_member",
      entity_type: "member",
      entity_id: id,
      description: `Archived member ${member?.full_name}`,
    });
    toast.success("Member archived");
    router.push("/dashboard/members");
  }

  function toggleService(s: string) {
    setSelectedServices((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col flex-1">
        <DashboardHeader title="Member Profile" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-sm text-[#7A7A72]">Loading...</div>
        </div>
      </div>
    );
  }

  if (!member) {
    return (
      <div className="flex flex-col flex-1">
        <DashboardHeader title="Member Not Found" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-[#4A4A44] mb-3">This member doesn't exist.</p>
            <Link href="/dashboard/members"><Button variant="secondary">Back to Members</Button></Link>
          </div>
        </div>
      </div>
    );
  }

  const { label: statusLabel, variant: statusVariant } = getMemberStatusDisplay(member.status, member.expiry_date);
  const daysLeft = daysUntilExpiry(member.expiry_date);
  const currentPackage = (member as any).packages as PackageType | null;
  const currentTrainer = (member as any).trainer as StaffMember | null;
  const totalPaid = payments.reduce((sum, p) => sum + (p.amount ?? 0), 0);

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title={member.full_name}
        subtitle={member.membership_no}
        action={
          <div className="flex items-center gap-2">
            <Link href="/dashboard/members">
              <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4" /> Members</Button>
            </Link>
            <Button size="sm" onClick={openFeeModal}>
              <CreditCard className="w-4 h-4" /> Collect Fee
            </Button>
          </div>
        }
      />

      <div className="flex-1 p-6 space-y-5">
        {/* Top row: profile + stats */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Profile card */}
          <Card className="lg:col-span-1">
            <div className="flex flex-col items-center text-center pb-4 border-b border-[#E4E4DE] mb-4">
              <div className="w-20 h-20 rounded-full bg-[#FEF0E8] flex items-center justify-center mb-3 overflow-hidden">
                {member.photo_url ? (
                  <img src={member.photo_url} alt="" className="w-20 h-20 object-cover" />
                ) : (
                  <User className="w-9 h-9 text-[#F06418]" />
                )}
              </div>
              <h2 className="text-lg font-bold text-[#1A1A16]">{member.full_name}</h2>
              {member.secondary_name && (
                <p className="text-sm text-[#7A7A72]">S/o {member.secondary_name}</p>
              )}
              <p className="text-sm font-mono font-semibold text-[#F06418] mt-1">{member.membership_no}</p>
              <div className="flex gap-2 mt-2 flex-wrap justify-center">
                <Badge variant={statusVariant}>{statusLabel}</Badge>
                {member.gender && <Badge variant="default">{member.gender}</Badge>}
              </div>
            </div>

            <div className="space-y-2.5 text-sm">
              {member.phone && (
                <div className="flex items-center gap-2 text-[#4A4A44]">
                  <Phone className="w-3.5 h-3.5 text-[#7A7A72] flex-shrink-0" />
                  {member.phone}
                </div>
              )}
              {member.email && (
                <div className="flex items-center gap-2 text-[#4A4A44]">
                  <Mail className="w-3.5 h-3.5 text-[#7A7A72] flex-shrink-0" />
                  {member.email}
                </div>
              )}
              {member.address && (
                <div className="flex items-start gap-2 text-[#4A4A44]">
                  <MapPin className="w-3.5 h-3.5 text-[#7A7A72] flex-shrink-0 mt-0.5" />
                  {member.address}
                </div>
              )}
              {member.cnic && (
                <div className="flex items-center gap-2 text-[#4A4A44]">
                  <UserCheck className="w-3.5 h-3.5 text-[#7A7A72] flex-shrink-0" />
                  {member.cnic}
                </div>
              )}
              {member.dob && (
                <div className="flex items-center gap-2 text-[#4A4A44]">
                  <Calendar className="w-3.5 h-3.5 text-[#7A7A72] flex-shrink-0" />
                  {formatDate(member.dob)}
                  {member.age && <span className="text-[#7A7A72]">({member.age} yrs)</span>}
                </div>
              )}
              {member.blood_group && (
                <div className="flex items-center gap-2 text-[#4A4A44]">
                  <span className="text-xs font-bold text-red-500 w-3.5 text-center">🩸</span>
                  Blood Group: <strong>{member.blood_group}</strong>
                </div>
              )}
            </div>

            {/* Biometric / Device ID */}
            <div className="mt-4 pt-4 border-t border-[#E4E4DE]">
              <DeviceIdField memberId={member.id} deviceUserId={member.device_user_id} thumbRegistered={member.thumb_registered} onSaved={fetchMember} />
            </div>

            {/* Quick actions */}
            <div className="mt-4 pt-4 border-t border-[#E4E4DE] space-y-2">
              <Button
                variant="secondary"
                size="sm"
                className="w-full justify-start"
                onClick={() => { setRenewModal(true); }}
              >
                <Calendar className="w-4 h-4" /> Renew Membership
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="w-full justify-start"
                onClick={() => setFreezeModal(true)}
              >
                <Snowflake className="w-4 h-4" /> Freeze Membership
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-red-600 hover:bg-red-50"
                onClick={archiveMember}
              >
                <Archive className="w-4 h-4" /> Archive Member
              </Button>
            </div>
          </Card>

          {/* Right column: membership + stats */}
          <div className="lg:col-span-2 space-y-4">
            {/* Membership summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="bg-white border border-[#E4E4DE] rounded-xl p-4">
                <p className="text-xs text-[#7A7A72] font-medium">Joining Date</p>
                <p className="text-base font-bold text-[#1A1A16] mt-1">
                  {member.joining_date ? formatDate(member.joining_date) : "—"}
                </p>
              </div>
              <div className={`border rounded-xl p-4 ${daysLeft !== null && daysLeft <= 7 ? "bg-red-50 border-red-200" : daysLeft !== null && daysLeft <= 30 ? "bg-[#FEF0E8] border-[#FDDCC8]" : "bg-white border-[#E4E4DE]"}`}>
                <p className="text-xs text-[#7A7A72] font-medium">Expiry Date</p>
                <p className="text-base font-bold text-[#1A1A16] mt-1">
                  {member.expiry_date ? formatDate(member.expiry_date) : "—"}
                </p>
                {daysLeft !== null && (
                  <p className={`text-xs mt-0.5 font-medium ${daysLeft <= 0 ? "text-red-600" : daysLeft <= 7 ? "text-red-500" : daysLeft <= 30 ? "text-[#C04E10]" : "text-green-600"}`}>
                    {daysLeft <= 0 ? "Expired" : `${daysLeft} days left`}
                  </p>
                )}
              </div>
              <div className="bg-white border border-[#E4E4DE] rounded-xl p-4">
                <p className="text-xs text-[#7A7A72] font-medium">Monthly Fee</p>
                <p className="text-base font-bold text-[#F06418] mt-1">
                  {formatPKR(member.monthly_fee)}
                </p>
              </div>
              <div className="bg-white border border-[#E4E4DE] rounded-xl p-4">
                <p className="text-xs text-[#7A7A72] font-medium">Admission Fee</p>
                <p className="text-base font-bold text-[#1A1A16] mt-1">
                  {formatPKR(member.admission_fee)}
                </p>
              </div>
              <div className="bg-white border border-[#E4E4DE] rounded-xl p-4">
                <p className="text-xs text-[#7A7A72] font-medium">Total Paid</p>
                <p className="text-base font-bold text-green-700 mt-1">
                  {formatPKR(totalPaid)}
                </p>
              </div>
              <div className="bg-white border border-[#E4E4DE] rounded-xl p-4">
                <p className="text-xs text-[#7A7A72] font-medium">Payments</p>
                <p className="text-base font-bold text-[#1A1A16] mt-1">
                  {payments.length} records
                </p>
              </div>
            </div>

            {/* Package */}
            <Card>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-[#F06418]" />
                  <h3 className="text-sm font-semibold text-[#1A1A16]">Membership Package</h3>
                </div>
                {!editPackage ? (
                  <button onClick={() => setEditPackage(true)} className="text-xs text-[#F06418] flex items-center gap-1 hover:underline">
                    <Edit3 className="w-3 h-3" /> Change
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={savePackage} disabled={saving} className="text-xs text-green-600 flex items-center gap-1 hover:underline disabled:opacity-50">
                      <Check className="w-3 h-3" /> Save
                    </button>
                    <button onClick={() => { setEditPackage(false); setSelectedPackage(member.package_id ?? ""); }} className="text-xs text-red-600 flex items-center gap-1 hover:underline">
                      <X className="w-3 h-3" /> Cancel
                    </button>
                  </div>
                )}
              </div>

              {editPackage ? (
                <Select value={selectedPackage} onChange={(e) => setSelectedPackage(e.target.value)} placeholder="Select package">
                  <option value="">No package</option>
                  {packages.map((pkg) => (
                    <option key={pkg.id} value={pkg.id}>
                      {pkg.name} — {formatPKR(pkg.monthly_fee)}/mo
                    </option>
                  ))}
                </Select>
              ) : currentPackage ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-base font-semibold text-[#1A1A16]">{currentPackage.name}</p>
                      <p className="text-sm text-[#7A7A72]">{formatPKR(currentPackage.monthly_fee)}/month · Admission {formatPKR(currentPackage.admission_fee)}</p>
                    </div>
                    <Badge variant="active">Active</Badge>
                  </div>
                  {(currentPackage as any).services_included?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-[#E4E4DE]">
                      {((currentPackage as any).services_included as string[]).map((s: string) => (
                        <span key={s} className="text-xs px-2 py-0.5 bg-[#FEF0E8] text-[#C04E10] border border-[#FDDCC8] rounded-full">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-[#7A7A72]">No package assigned — click Change to assign one</p>
              )}
            </Card>

            {/* Trainer */}
            <Card>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Dumbbell className="w-4 h-4 text-[#F06418]" />
                  <h3 className="text-sm font-semibold text-[#1A1A16]">Assigned Trainer / Coach</h3>
                </div>
                {!editTrainer ? (
                  <button onClick={() => setEditTrainer(true)} className="text-xs text-[#F06418] flex items-center gap-1 hover:underline">
                    <Edit3 className="w-3 h-3" /> Change
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={saveTrainer} disabled={saving} className="text-xs text-green-600 flex items-center gap-1 hover:underline disabled:opacity-50">
                      <Check className="w-3 h-3" /> Save
                    </button>
                    <button onClick={() => { setEditTrainer(false); setSelectedTrainer(member.trainer_id ?? ""); }} className="text-xs text-red-600 flex items-center gap-1 hover:underline">
                      <X className="w-3 h-3" /> Cancel
                    </button>
                  </div>
                )}
              </div>

              {editTrainer ? (
                <Select value={selectedTrainer} onChange={(e) => setSelectedTrainer(e.target.value)} placeholder="Select trainer">
                  <option value="">No trainer</option>
                  {trainers.map((t) => (
                    <option key={t.id} value={t.id}>{t.full_name}</option>
                  ))}
                </Select>
              ) : currentTrainer ? (
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-[#1A1A1A] rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-xs font-bold">{currentTrainer.full_name.charAt(0)}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#1A1A16]">{currentTrainer.full_name}</p>
                    <p className="text-xs text-[#7A7A72]">Trainer · {currentTrainer.phone ?? "—"}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[#7A7A72]">No trainer assigned — click Change to assign one</p>
              )}
            </Card>
          </div>
        </div>

        {/* Services */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#1A1A16]">Services & Activities</h3>
            {!editServices ? (
              <button onClick={() => { setEditServices(true); setSelectedServices([...services]); }} className="text-xs text-[#F06418] flex items-center gap-1 hover:underline">
                <Edit3 className="w-3 h-3" /> Edit Services
              </button>
            ) : (
              <div className="flex gap-2">
                <button onClick={saveServices} disabled={saving} className="text-xs text-green-600 flex items-center gap-1 hover:underline disabled:opacity-50">
                  <Check className="w-3 h-3" /> Save
                </button>
                <button onClick={() => setEditServices(false)} className="text-xs text-red-600 flex items-center gap-1 hover:underline">
                  <X className="w-3 h-3" /> Cancel
                </button>
              </div>
            )}
          </div>

          {editServices ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {SERVICES.map((s) => {
                const active = selectedServices.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleService(s)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                      active ? "bg-[#FEF0E8] border-[#F06418] text-[#C04E10]" : "bg-white border-[#E4E4DE] text-[#4A4A44] hover:border-[#F06418]"
                    }`}
                  >
                    <span>{SERVICE_ICONS[s]}</span>
                    <span className="text-xs">{s}</span>
                  </button>
                );
              })}
            </div>
          ) : services.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {services.map((s) => (
                <span key={s} className="flex items-center gap-1.5 bg-[#FEF0E8] text-[#C04E10] text-sm px-3 py-1.5 rounded-full font-medium border border-[#FDDCC8]">
                  <span>{SERVICE_ICONS[s] ?? "•"}</span> {s}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#7A7A72]">No services assigned. Click Edit Services to add.</p>
          )}
        </Card>

        {/* Health info */}
        {(member.medical_notes || member.blood_group || member.emergency_name) && (
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Stethoscope className="w-4 h-4 text-[#F06418]" />
              <h3 className="text-sm font-semibold text-[#1A1A16]">Health & Emergency</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              {member.blood_group && (
                <div><p className="text-xs text-[#7A7A72]">Blood Group</p><p className="font-semibold text-[#1A1A16]">{member.blood_group}</p></div>
              )}
              {member.height && (
                <div><p className="text-xs text-[#7A7A72]">Height</p><p className="font-medium text-[#1A1A16]">{member.height}</p></div>
              )}
              {member.weight && (
                <div><p className="text-xs text-[#7A7A72]">Weight</p><p className="font-medium text-[#1A1A16]">{member.weight}</p></div>
              )}
              {member.emergency_name && (
                <div><p className="text-xs text-[#7A7A72]">Emergency Contact</p><p className="font-medium text-[#1A1A16]">{member.emergency_name}</p></div>
              )}
              {member.emergency_phone && (
                <div><p className="text-xs text-[#7A7A72]">Emergency Phone</p><p className="font-medium text-[#1A1A16]">{member.emergency_phone}</p></div>
              )}
            </div>
            {member.medical_notes && (
              <div className="mt-3 bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-yellow-800">{member.medical_notes}</p>
              </div>
            )}
          </Card>
        )}

        {/* Payment history */}
        <Card padding={false}>
          <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#1A1A16]">Payment History</h3>
            <Button size="sm" onClick={openFeeModal}>
              <Plus className="w-3.5 h-3.5" /> Record Payment
            </Button>
          </div>
          {payments.length === 0 ? (
            <div className="py-10 text-center text-sm text-[#7A7A72]">No payments recorded yet</div>
          ) : (
            <div className="divide-y divide-[#E4E4DE]">
              {payments.map((p) => {
                const hasDiscount = p.note?.includes("Discount:");
                return (
                  <div key={p.id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-[#1A1A16] capitalize">
                          {p.payment_type?.replace("_", " ") ?? "Payment"}
                        </p>
                        {hasDiscount && (
                          <span className="inline-flex items-center gap-1 text-[10px] bg-[#FEF0E8] text-[#C04E10] border border-[#FDDCC8] px-1.5 py-0.5 rounded-full font-semibold">
                            <Tag className="w-2.5 h-2.5" /> Discounted
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#7A7A72]">{formatDate(p.payment_date)} · {p.payment_method}</p>
                      {p.note && <p className="text-xs text-[#7A7A72] italic mt-0.5 truncate max-w-xs">{p.note}</p>}
                    </div>
                    <span className="text-base font-bold text-green-700 flex-shrink-0">{formatPKR(p.amount)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Record Fee Modal */}
      <Modal open={feeModal} onClose={() => { setFeeModal(false); setDiscountType("none"); setDiscountValue(""); }} title="Record Fee Payment" size="md">
        <div className="p-5 space-y-4">

          {/* Member info strip */}
          <div className="bg-[#FEF0E8] rounded-lg px-4 py-3 flex items-center justify-between">
            <div>
              <p className="font-semibold text-[#C04E10] text-sm">{member.full_name}</p>
              <p className="text-[#7A7A72] text-xs">{member.membership_no}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-[#7A7A72]">Standard monthly fee</p>
              <p className="text-base font-bold text-[#F06418]">{formatPKR(member.monthly_fee)}</p>
            </div>
          </div>

          {/* Fee amount + type */}
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Original Amount (Rs)"
              type="number"
              placeholder={member.monthly_fee?.toString() ?? "0"}
              value={feeAmount}
              onChange={(e) => setFeeAmount(e.target.value)}
              required
            />
            <Select label="Payment Type" value={feeType} onChange={(e) => setFeeType(e.target.value)}>
              <option value="membership">Monthly Membership</option>
              <option value="admission">Admission Fee</option>
              <option value="trainer">Trainer Fee</option>
              <option value="other">Other</option>
            </Select>
          </div>

          {/* ── DISCOUNT SECTION ── */}
          <div className="rounded-xl border-2 border-dashed border-[#F06418] bg-[#FEF0E8]/40 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-[#F06418] rounded-full flex items-center justify-center flex-shrink-0">
                <Tag className="w-3 h-3 text-white" />
              </div>
              <p className="text-sm font-bold text-[#C04E10] uppercase tracking-wide">Special Discount</p>
            </div>

            {/* Discount type selector */}
            <div className="flex gap-2">
              {([
                { key: "none", label: "No Discount" },
                { key: "percent", label: "% Percentage" },
                { key: "amount", label: "Rs Fixed Amount" },
              ] as const).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => { setDiscountType(opt.key); setDiscountValue(""); }}
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold border transition-all ${
                    discountType === opt.key
                      ? "bg-[#F06418] text-white border-[#F06418]"
                      : "bg-white text-[#4A4A44] border-[#E4E4DE] hover:border-[#F06418]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Discount value input */}
            {discountType !== "none" && (
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <Input
                    label={discountType === "percent" ? "Discount %" : "Discount Amount (Rs)"}
                    type="number"
                    placeholder={discountType === "percent" ? "e.g. 10" : "e.g. 500"}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    max={discountType === "percent" ? 100 : originalAmount}
                  />
                </div>
                {discountType === "percent" && Number(discountValue) > 0 && (
                  <div className="mt-6 bg-white border border-[#E4E4DE] rounded-lg px-3 py-2 text-center min-w-[90px]">
                    <p className="text-xs text-[#7A7A72]">Saves</p>
                    <p className="text-sm font-bold text-[#F06418]">{formatPKR(discountAmount)}</p>
                  </div>
                )}
              </div>
            )}

            {/* Breakdown — only show when discount is active */}
            {discountType !== "none" && originalAmount > 0 && discountAmount > 0 && (
              <div className="bg-white rounded-lg border border-[#FDDCC8] p-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-[#4A4A44]">Original amount</span>
                  <span className="font-medium text-[#1A1A16]">{formatPKR(originalAmount)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#F06418] flex items-center gap-1">
                    <Minus className="w-3 h-3" /> Discount ({discountPercent}%)
                  </span>
                  <span className="font-medium text-[#F06418]">− {formatPKR(discountAmount)}</span>
                </div>
                <div className="flex justify-between text-base font-bold pt-1 border-t border-[#FDDCC8]">
                  <span className="text-[#1A1A16]">Amount to collect</span>
                  <span className="text-green-700">{formatPKR(finalAmount)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Payment method + note */}
          <div className="grid grid-cols-2 gap-3">
            <Select label="Payment Method" value={feeMethod} onChange={(e) => setFeeMethod(e.target.value)}>
              {["Cash", "Bank", "Card", "EasyPaisa", "JazzCash"].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </Select>
            <Input
              label="Note (optional)"
              placeholder="e.g. June 2026 fee"
              value={feeNote}
              onChange={(e) => setFeeNote(e.target.value)}
            />
          </div>

          {/* Final summary before submit */}
          <div className={`rounded-lg px-4 py-3 flex items-center justify-between ${finalAmount < originalAmount && discountAmount > 0 ? "bg-green-50 border border-green-200" : "bg-[#F8F8F6] border border-[#E4E4DE]"}`}>
            <span className="text-sm font-medium text-[#4A4A44]">
              {discountAmount > 0 ? "Final amount to collect:" : "Amount to collect:"}
            </span>
            <span className="text-xl font-bold text-[#1A1A16]">
              {formatPKR(finalAmount || originalAmount)}
            </span>
          </div>

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => { setFeeModal(false); setDiscountType("none"); setDiscountValue(""); }} className="flex-1">
              Cancel
            </Button>
            <Button onClick={recordFee} loading={saving} className="flex-1">
              <CreditCard className="w-4 h-4" />
              Collect {formatPKR(finalAmount || originalAmount)}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Renew Membership Modal */}
      <Modal open={renewModal} onClose={() => setRenewModal(false)} title="Renew Membership" size="sm">
        <div className="p-5 space-y-4">
          <Input label="New Joining Date" type="date" value={joiningDate} onChange={(e) => {
            setJoiningDate(e.target.value);
            if (e.target.value) setExpiryDate(format(addMonths(new Date(e.target.value), 1), "yyyy-MM-dd"));
          }} />
          <Input label="New Expiry Date" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={() => setRenewModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={renewMembership} loading={saving} className="flex-1">Renew</Button>
          </div>
        </div>
      </Modal>

      {/* Freeze Modal */}
      <Modal open={freezeModal} onClose={() => setFreezeModal(false)} title="Freeze Membership" size="sm">
        <div className="p-5 space-y-4">
          <p className="text-sm text-[#4A4A44]">Member will be marked as frozen and excluded from active counts.</p>
          <Input label="Freeze Until" type="date" value={freezeUntil} onChange={(e) => setFreezeUntil(e.target.value)} required />
          <Input label="Reason (optional)" placeholder="e.g. Travelling, injury..." value={freezeReason} onChange={(e) => setFreezeReason(e.target.value)} />
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={() => setFreezeModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={freezeMembership} loading={saving} className="flex-1"><Snowflake className="w-4 h-4" /> Freeze</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Device ID Field ──────────────────────────────────────────────────
function DeviceIdField({ memberId, deviceUserId, thumbRegistered, onSaved }: {
  memberId: string;
  deviceUserId: string | null;
  thumbRegistered: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(deviceUserId ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const supabase = createClient();
    await supabase.from("members").update({
      device_user_id: value.trim() || null,
      thumb_registered: !!value.trim(),
    }).eq("id", memberId);
    setSaving(false);
    setEditing(false);
    onSaved();
    toast.success("Device ID saved");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Fingerprint className="w-3.5 h-3.5 text-[#F06418]" />
          <span className="text-xs font-semibold text-[#1A1A16]">Biometric Device ID</span>
        </div>
        {!editing ? (
          <button onClick={() => { setValue(deviceUserId ?? ""); setEditing(true); }}
            className="text-xs text-[#F06418] hover:underline flex items-center gap-1">
            <Edit3 className="w-3 h-3" /> {deviceUserId ? "Edit" : "Set"}
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="text-xs text-green-600 hover:underline flex items-center gap-1 disabled:opacity-50">
              <Check className="w-3 h-3" /> Save
            </button>
            <button onClick={() => setEditing(false)} className="text-xs text-red-600 hover:underline">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <input type="text" placeholder="e.g. 1 (from ZKTeco device)" value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
        />
      ) : (
        <div className={`flex items-center gap-2 text-xs rounded-lg px-2.5 py-1.5 ${deviceUserId ? "bg-green-50 border border-green-200" : "bg-[#F8F8F6] border border-[#E4E4DE]"}`}>
          <Fingerprint className={`w-3.5 h-3.5 ${deviceUserId ? "text-green-600" : "text-[#7A7A72]"}`} />
          {deviceUserId ? (
            <span className="text-green-700 font-semibold">Enrolled — ID: {deviceUserId}</span>
          ) : (
            <span className="text-[#7A7A72]">Not enrolled on device yet</span>
          )}
        </div>
      )}

      {editing && (
        <p className="text-[10px] text-[#7A7A72] mt-1">
          This is the User ID assigned when you enrolled this member on the SpeedFace V5L.
        </p>
      )}
    </div>
  );
}
