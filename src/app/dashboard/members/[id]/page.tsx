"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  User, Phone, Mail, MapPin, Calendar, CreditCard, Dumbbell,
  Edit3, Check, X, ArrowLeft, UserCheck, Package,
  Stethoscope, AlertTriangle, Plus, Snowflake, Archive, Tag,
  Percent, Minus, Fingerprint, Printer, Camera, Trash2, Loader2,
  Send, Clock,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatDate, formatPKR, getMemberStatusDisplay, daysUntilExpiry, formatCnic, formatPhone, generateReceiptNo } from "@/lib/utils";
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

function buildReceiptHtml(r: {
  memberName: string; memberNo: string; packageName: string;
  amount: number; originalAmount: number; discountAmount: number;
  type: string; method: string; date: string; note: string | null; receiptNo: string;
}): string {
  const typeLabel: Record<string, string> = {
    membership: "Monthly Membership", admission: "Admission Fee",
    trainer: "Trainer / Coaching Fee", nutritionist: "Nutritionist Fee",
    physiotherapy: "Physiotherapy Fee", other: "Other",
  };
  const discountRow = r.discountAmount > 0 ? `
    <tr><td style="padding:4px 0;color:#7A7A72;font-size:13px;">Original Amount</td>
        <td style="padding:4px 0;text-align:right;font-size:13px;text-decoration:line-through;color:#7A7A72;">${new Intl.NumberFormat("en-PK").format(r.originalAmount)} Rs</td></tr>
    <tr><td style="padding:4px 0;color:#F06418;font-size:13px;">Discount</td>
        <td style="padding:4px 0;text-align:right;font-size:13px;color:#F06418;">− ${new Intl.NumberFormat("en-PK").format(r.discountAmount)} Rs</td></tr>` : "";
  const noteRow = r.note ? `
    <tr><td style="padding:4px 0;color:#7A7A72;font-size:13px;">Note</td>
        <td style="padding:4px 0;text-align:right;font-size:13px;color:#4A4A44;">${r.note}</td></tr>` : "";
  const pkgRow = r.packageName !== "—" ? `
    <tr><td style="padding:4px 0;color:#7A7A72;font-size:13px;">Package</td>
        <td style="padding:4px 0;text-align:right;font-size:13px;font-weight:600;">${r.packageName}</td></tr>` : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Receipt ${r.receiptNo}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:Arial,Helvetica,sans-serif;background:#fff;color:#1A1A16;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .wrap{max-width:400px;margin:0 auto;padding:0;}
    .hdr{background:#111111!important;padding:20px;text-align:center;}
    .hdr-name{color:#F06418!important;font-size:14px;font-weight:800;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;}
    .hdr-sub{color:rgba(255,255,255,0.65)!important;font-size:10px;line-height:1.5;}
    .meta{display:flex;justify-content:space-between;align-items:center;padding:12px 20px;background:#FAFAF8;border-bottom:2px dashed #E4E4DE;}
    .rcp-label{font-size:9px;font-weight:700;color:#7A7A72;text-transform:uppercase;letter-spacing:0.5px;}
    .rcp-no{font-size:17px;font-weight:800;color:#F06418!important;font-family:monospace;}
    .date-val{font-size:12px;font-weight:600;text-align:right;}
    .sec{padding:12px 20px;border-bottom:1px dashed #E4E4DE;}
    .sec-title{font-size:9px;font-weight:700;color:#7A7A72;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;}
    table{width:100%;border-collapse:collapse;}
    .total-row td{padding-top:12px;border-top:2px solid #1A1A16;font-size:15px;font-weight:800;}
    .ftr{background:#F06418!important;padding:14px 20px;text-align:center;}
    .ftr-text{color:#fff!important;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;}
    .ftr-id{color:rgba(255,255,255,0.65)!important;font-size:8px;font-family:monospace;margin-top:2px;}
    @page{size:A5;margin:1cm;}
    @media print{body{background:#fff!important;}.hdr{background:#111111!important;}.hdr-name{color:#F06418!important;}.hdr-sub{color:rgba(255,255,255,0.65)!important;}.rcp-no{color:#F06418!important;}.ftr{background:#F06418!important;}.ftr-text{color:#fff!important;}.ftr-id{color:rgba(255,255,255,0.65)!important;}}
  </style></head><body>
  <div class="wrap">
    <div class="hdr">
      <div class="hdr-name">Level Up Fitness Club</div>
      <div class="hdr-sub">3rd Floor, High Street Mall, Paragon City, Lahore<br>03000202902</div>
    </div>
    <div class="meta">
      <div><div class="rcp-label">Receipt No</div><div class="rcp-no">${r.receiptNo}</div></div>
      <div><div class="rcp-label" style="text-align:right;">Date</div><div class="date-val">${r.date}</div></div>
    </div>
    <div class="sec">
      <div class="sec-title">Member Details</div>
      <table>
        <tr><td style="padding:4px 0;color:#7A7A72;font-size:13px;">Member Name</td>
            <td style="padding:4px 0;text-align:right;font-size:13px;font-weight:600;">${r.memberName}</td></tr>
        <tr><td style="padding:4px 0;color:#7A7A72;font-size:13px;">Membership No</td>
            <td style="padding:4px 0;text-align:right;font-size:13px;font-weight:700;color:#F06418;font-family:monospace;">${r.memberNo}</td></tr>
        ${pkgRow}
      </table>
    </div>
    <div class="sec">
      <div class="sec-title">Payment Details</div>
      <table>
        <tr><td style="padding:4px 0;color:#7A7A72;font-size:13px;">Payment Type</td>
            <td style="padding:4px 0;text-align:right;font-size:13px;font-weight:600;">${typeLabel[r.type] ?? r.type}</td></tr>
        <tr><td style="padding:4px 0;color:#7A7A72;font-size:13px;">Payment Method</td>
            <td style="padding:4px 0;text-align:right;font-size:13px;font-weight:600;">${r.method}</td></tr>
        ${noteRow}${discountRow}
        <tr class="total-row">
          <td>Total Paid</td>
          <td style="text-align:right;">Rs ${new Intl.NumberFormat("en-PK").format(r.amount)}</td>
        </tr>
      </table>
    </div>
    <div class="ftr">
      <div class="ftr-text">Thank you for choosing Level Up Fitness Club!</div>
      <div class="ftr-id">${r.receiptNo}</div>
    </div>
  </div>
</body></html>`;
}

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
  const [editProfileModal, setEditProfileModal] = useState(false);
  const [feeModal, setFeeModal] = useState(false);
  const [renewModal, setRenewModal] = useState(false);
  const [freezeModal, setFreezeModal] = useState(false);
  const [receiptModal, setReceiptModal] = useState(false);
  const [receiptData, setReceiptData] = useState<{
    memberName: string; memberNo: string; packageName: string;
    amount: number; originalAmount: number; discountAmount: number;
    type: string; method: string; date: string; note: string | null;
    receiptNo: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  // Profile edit form
  const [profileForm, setProfileForm] = useState({
    full_name: "", secondary_name: "", phone: "", whatsapp: "",
    email: "", cnic: "", address: "", dob: "", gender: "",
    marital_status: "", blood_group: "", height: "", weight: "",
    medical_notes: "", emergency_name: "", emergency_phone: "",
    joining_date: "", expiry_date: "", admission_fee: "",
  });
  const [editPhotoUrl, setEditPhotoUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  function openEditProfile() {
    if (!member) return;
    setProfileForm({
      full_name: member.full_name ?? "",
      secondary_name: member.secondary_name ?? "",
      phone: member.phone ?? "",
      whatsapp: member.whatsapp ?? "",
      email: member.email ?? "",
      cnic: member.cnic ?? "",
      address: member.address ?? "",
      dob: member.dob ?? "",
      gender: member.gender ?? "",
      marital_status: member.marital_status ?? "",
      blood_group: member.blood_group ?? "",
      height: member.height ?? "",
      weight: member.weight ?? "",
      medical_notes: member.medical_notes ?? "",
      emergency_name: member.emergency_name ?? "",
      emergency_phone: member.emergency_phone ?? "",
      joining_date: member.joining_date ?? "",
      expiry_date: member.expiry_date ?? "",
      admission_fee: member.admission_fee ? String(member.admission_fee) : "",
    });
    setEditPhotoUrl(member.photo_url ?? null);
    setEditProfileModal(true);
  }

  async function handleEditPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Only images allowed"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5 MB"); return; }
    setPhotoUploading(true);
    const preview = URL.createObjectURL(file);
    setEditPhotoUrl(preview);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/photo", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || json.error) {
        toast.error(json.error ?? "Upload failed");
        setEditPhotoUrl(member?.photo_url ?? null);
      } else {
        setEditPhotoUrl(json.url);
        toast.success("Photo uploaded");
      }
    } catch {
      toast.error("Upload failed");
      setEditPhotoUrl(member?.photo_url ?? null);
    } finally {
      setPhotoUploading(false);
    }
  }

  async function saveProfile() {
    if (!profileForm.full_name.trim() || !profileForm.phone.trim()) {
      toast.error("Name and phone are required");
      return;
    }
    if (!profileForm.joining_date) {
      toast.error("Joining date is required");
      return;
    }
    setSaving(true);
    const supabase = createClient();

    // If gender changed, swap the membership number prefix accordingly
    let updatedMembershipNo = member?.membership_no ?? null;
    if (profileForm.gender && profileForm.gender !== member?.gender && updatedMembershipNo) {
      const newPrefix = profileForm.gender === "Female" ? "LUF" : "LUM";
      updatedMembershipNo = updatedMembershipNo.replace(/^(LUM|LUF|LUS)/, newPrefix);
    }

    const { error } = await supabase.from("members").update({
      full_name:         profileForm.full_name.trim(),
      secondary_name:    profileForm.secondary_name.trim() || null,
      phone:             profileForm.phone.trim(),
      whatsapp:          profileForm.whatsapp.trim() || null,
      email:             profileForm.email.trim() || null,
      cnic:              profileForm.cnic.trim() || null,
      address:           profileForm.address.trim() || null,
      dob:               profileForm.dob || null,
      gender:            profileForm.gender || null,
      marital_status:    profileForm.marital_status || null,
      blood_group:       profileForm.blood_group || null,
      height:            profileForm.height.trim() || null,
      weight:            profileForm.weight.trim() || null,
      medical_notes:     profileForm.medical_notes.trim() || null,
      emergency_name:    profileForm.emergency_name.trim() || null,
      emergency_phone:   profileForm.emergency_phone.trim() || null,
      photo_url:         editPhotoUrl?.startsWith("blob:") ? member?.photo_url ?? null : (editPhotoUrl || null),
      membership_no:     updatedMembershipNo,
      joining_date:      profileForm.joining_date || null,
      expiry_date:       profileForm.expiry_date || null,
      admission_fee:     profileForm.admission_fee ? parseFloat(profileForm.admission_fee) : null,
      updated_at:        new Date().toISOString(),
    }).eq("id", id);

    if (error) { toast.error(error.message); setSaving(false); return; }

    await supabase.from("activity_logs").insert({
      action: "edited_member",
      entity_type: "member",
      entity_id: id,
      description: `Updated profile for ${profileForm.full_name}`,
    });
    toast.success("Profile updated");
    setEditProfileModal(false);
    setSaving(false);
    fetchMember();
  }

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
  const [commissionStaffId, setCommissionStaffId] = useState("");
  const [commissionRate, setCommissionRate] = useState("");
  const [allStaff, setAllStaff] = useState<StaffMember[]>([]);
  const [alreadyPaidWarning, setAlreadyPaidWarning] = useState(false);

  async function openFeeModal() {
    // Pre-fill with package monthly fee (prefer package record, fall back to member field)
    const prefill = (member as any)?.packages?.monthly_fee ?? member?.monthly_fee;
    setFeeAmount(prefill ? String(prefill) : "");
    setFeeType("membership");
    setFeeMethod("Cash");
    setFeeNote("");
    setDiscountType("none");
    setDiscountValue("");
    setCommissionStaffId(member?.trainer_id ?? "");
    setCommissionRate("");
    // Check if already paid membership this month
    if (id) {
      const supabase = createClient();
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const { count } = await supabase
        .from("fee_payments")
        .select("*", { count: "exact", head: true })
        .eq("member_id", id)
        .eq("payment_type", "membership")
        .gte("payment_date", monthStart)
        .is("deleted_at", null);
      setAlreadyPaidWarning((count ?? 0) > 0);
    }
    setFeeModal(true);
  }
  const [freezeUntil, setFreezeUntil] = useState("");
  const [freezeReason, setFreezeReason] = useState("");

  const fetchMember = useCallback(async () => {
    const supabase = createClient();
    const [{ data: memberData }, { data: pkgs }, { data: trnrs }, { data: pays }, { data: allStaffData }] = await Promise.all([
      supabase
        .from("members")
        .select("*, packages(*), trainer:staff_members!members_trainer_id_fkey(*)")
        .eq("id", id)
        .single(),
      supabase.from("packages").select("*").eq("status", "active").is("deleted_at", null),
      supabase.from("staff_members").select("*").eq("role", "Trainer").eq("status", "active").is("deleted_at", null),
      supabase.from("fee_payments").select("*").eq("member_id", id).is("deleted_at", null).order("payment_date", { ascending: false }).limit(10),
      supabase.from("staff_members").select("*").in("role", ["Trainer","Nutritionist","Other"]).eq("status", "active").is("deleted_at", null),
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
    setAllStaff((allStaffData as StaffMember[]) ?? []);
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

  // Commission computed values (must be after finalAmount)
  const COMMISSION_TYPES = ["trainer", "nutritionist", "physiotherapy"];
  const showCommission = COMMISSION_TYPES.includes(feeType);
  const commissionAmount = showCommission && commissionRate
    ? Math.round(finalAmount * (Number(commissionRate) / 100))
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
    const receiptNo = await generateReceiptNo();

    await supabase.from("fee_payments").insert({
      member_id: id,
      amount: finalAmount,
      payment_type: feeType as any,
      payment_method: feeMethod as any,
      payment_date: new Date().toISOString().split("T")[0],
      receipt_no: receiptNo,
      note: fullNote,
      commission_staff_id: showCommission && commissionStaffId ? commissionStaffId : null,
      commission_rate: showCommission && commissionRate ? Number(commissionRate) : null,
      commission_amount: showCommission && commissionAmount > 0 ? commissionAmount : null,
    });
    await supabase.from("activity_logs").insert({
      action: "paid_fee",
      entity_type: "member",
      entity_id: id,
      description: `${member?.full_name} paid ${formatPKR(finalAmount)} (${feeType})${discountAmount > 0 ? ` — discount ${formatPKR(discountAmount)}` : ""}`,
      metadata: { original: originalAmount, discount: discountAmount, final: finalAmount, type: feeType, method: feeMethod },
    });
    // Build receipt data and open receipt modal
    setReceiptData({
      memberName:     member?.full_name ?? "",
      memberNo:       member?.membership_no ?? "",
      packageName:    (member as any)?.packages?.name ?? "—",
      amount:         finalAmount,
      originalAmount,
      discountAmount,
      type:           feeType,
      method:         feeMethod,
      date:           new Date().toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" }),
      note:           feeNote || null,
      receiptNo,
    });

    toast.success(`Fee of ${formatPKR(finalAmount)} recorded`);
    setFeeModal(false);
    setFeeAmount("");
    setFeeNote("");
    setDiscountType("none");
    setDiscountValue("");
    setSaving(false);
    fetchMember();
    setReceiptModal(true);
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

  async function unfreezeMembership() {
    if (!confirm(`Unfreeze membership for ${member?.full_name}?`)) return;
    setSaving(true);
    const supabase = createClient();
    await supabase.from("members").update({
      status: "active",
      frozen_until: null,
      freeze_reason: null,
    }).eq("id", id);
    await supabase.from("activity_logs").insert({
      action: "unfroze_membership",
      entity_type: "member",
      entity_id: id,
      description: `Unfroze membership for ${member?.full_name}`,
    });
    toast.success("Membership unfrozen");
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
            <Button variant="secondary" size="sm" onClick={openEditProfile}>
              <Edit3 className="w-4 h-4" /> Edit Profile
            </Button>
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
                  <img
                    src={member.photo_url}
                    alt=""
                    className="w-20 h-20 object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
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
              <DeviceEnrollmentsField memberId={member.id} onSaved={fetchMember} />
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
              {member.status === "frozen" ? (
                <Button
                  size="sm"
                  className="w-full justify-start bg-[#F06418] text-white hover:bg-[#C04E10]"
                  onClick={unfreezeMembership}
                >
                  <Snowflake className="w-4 h-4" /> Unfreeze Membership
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setFreezeModal(true)}
                >
                  <Snowflake className="w-4 h-4" /> Freeze Membership
                </Button>
              )}
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

      {/* Edit Profile Modal */}
      <Modal open={editProfileModal} onClose={() => setEditProfileModal(false)} title="Edit Member Profile" size="lg">
        <div className="space-y-5">

          {/* Photo upload */}
          <div className="flex items-center gap-4 pb-4 border-b border-[#E4E4DE]">
            <div className="relative flex-shrink-0">
              <div className="w-20 h-20 rounded-full bg-[#FEF0E8] border-2 border-[#FDDCC8] overflow-hidden flex items-center justify-center">
                {photoUploading ? (
                  <Loader2 className="w-7 h-7 text-[#F06418] animate-spin" />
                ) : editPhotoUrl ? (
                  <img src={editPhotoUrl} alt="" className="w-full h-full object-cover" onError={() => setEditPhotoUrl(null)} />
                ) : (
                  <User className="w-9 h-9 text-[#F06418]" />
                )}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-[#1A1A16]">Profile Photo</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={photoUploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#FEF0E8] text-[#C04E10] border border-[#FDDCC8] rounded-lg hover:bg-[#FDDCC8] disabled:opacity-50 transition-colors"
                >
                  <Camera className="w-3.5 h-3.5" />
                  {editPhotoUrl ? "Change Photo" : "Upload Photo"}
                </button>
                {editPhotoUrl && (
                  <button
                    type="button"
                    onClick={() => setEditPhotoUrl(null)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-600 border border-red-200 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove
                  </button>
                )}
              </div>
              <p className="text-xs text-[#7A7A72]">JPG, PNG or WEBP · Max 5 MB</p>
            </div>
            <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handleEditPhotoChange} />
          </div>

          {/* Personal */}
          <div>
            <p className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide mb-3">Personal Information</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Full Name" required value={profileForm.full_name}
                onChange={(e) => setProfileForm((f) => ({ ...f, full_name: e.target.value }))} />
              <Input label="Secondary Name (S/o, D/o)" value={profileForm.secondary_name}
                onChange={(e) => setProfileForm((f) => ({ ...f, secondary_name: e.target.value }))} />
              <div>
                <label className="block text-sm font-medium text-[#1A1A16] mb-1">Gender</label>
                <select className="w-full px-3 py-2 text-sm border border-[#E4E4DE] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
                  value={profileForm.gender} onChange={(e) => setProfileForm((f) => ({ ...f, gender: e.target.value }))}>
                  <option value="">Select</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1A1A16] mb-1">Marital Status</label>
                <select className="w-full px-3 py-2 text-sm border border-[#E4E4DE] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
                  value={profileForm.marital_status} onChange={(e) => setProfileForm((f) => ({ ...f, marital_status: e.target.value }))}>
                  <option value="">Select</option>
                  <option value="Single">Single</option>
                  <option value="Married">Married</option>
                </select>
              </div>
              <Input label="Date of Birth" type="date" value={profileForm.dob}
                onChange={(e) => setProfileForm((f) => ({ ...f, dob: e.target.value }))} />
              <Input label="Blood Group" placeholder="e.g. B+" value={profileForm.blood_group}
                onChange={(e) => setProfileForm((f) => ({ ...f, blood_group: e.target.value }))} />
            </div>
          </div>

          {/* Contact */}
          <div>
            <p className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide mb-3">Contact</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Phone" required type="tel" value={profileForm.phone}
                onChange={(e) => setProfileForm((f) => ({ ...f, phone: formatPhone(e.target.value) }))} />
              <Input label="WhatsApp" type="tel" value={profileForm.whatsapp}
                onChange={(e) => setProfileForm((f) => ({ ...f, whatsapp: formatPhone(e.target.value) }))} />
              <Input label="Email" type="email" value={profileForm.email}
                onChange={(e) => setProfileForm((f) => ({ ...f, email: e.target.value }))} />
              <Input label="CNIC" placeholder="XXXXX-XXXXXXX-X" value={profileForm.cnic}
                onChange={(e) => setProfileForm((f) => ({ ...f, cnic: formatCnic(e.target.value) }))} />
              <div className="sm:col-span-2">
                <Input label="Home Address" value={profileForm.address}
                  onChange={(e) => setProfileForm((f) => ({ ...f, address: e.target.value }))} />
              </div>
            </div>
          </div>

          {/* Physical */}
          <div>
            <p className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide mb-3">Physical</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Height" placeholder="e.g. 5'10&quot;" value={profileForm.height}
                onChange={(e) => setProfileForm((f) => ({ ...f, height: e.target.value }))} />
              <Input label="Weight" placeholder="e.g. 75 kg" value={profileForm.weight}
                onChange={(e) => setProfileForm((f) => ({ ...f, weight: e.target.value }))} />
            </div>
          </div>

          {/* Emergency */}
          <div>
            <p className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide mb-3">Emergency Contact</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input label="Name" value={profileForm.emergency_name}
                onChange={(e) => setProfileForm((f) => ({ ...f, emergency_name: e.target.value }))} />
              <Input label="Phone" type="tel" value={profileForm.emergency_phone}
                onChange={(e) => setProfileForm((f) => ({ ...f, emergency_phone: formatPhone(e.target.value) }))} />
            </div>
          </div>

          {/* Medical */}
          <div>
            <label className="block text-xs font-bold text-[#7A7A72] uppercase tracking-wide mb-2">Medical Notes</label>
            <textarea rows={2} placeholder="Injuries, conditions, allergies..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white text-[#1A1A16] placeholder-[#7A7A72] focus:outline-none focus:ring-2 focus:ring-[#F06418] resize-none"
              value={profileForm.medical_notes}
              onChange={(e) => setProfileForm((f) => ({ ...f, medical_notes: e.target.value }))}
            />
          </div>

          {/* Membership */}
          <div>
            <p className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide mb-3">Membership Details</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input label="Joining Date *" type="date" required value={profileForm.joining_date}
                onChange={(e) => setProfileForm((f) => ({ ...f, joining_date: e.target.value }))} />
              <Input label="Expiry Date" type="date" value={profileForm.expiry_date}
                onChange={(e) => setProfileForm((f) => ({ ...f, expiry_date: e.target.value }))} />
              <Input label="Admission Fee (Rs)" type="number" placeholder="e.g. 15000" value={profileForm.admission_fee}
                onChange={(e) => setProfileForm((f) => ({ ...f, admission_fee: e.target.value }))} />
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <Button variant="secondary" className="flex-1" onClick={() => setEditProfileModal(false)}>Cancel</Button>
            <Button className="flex-1" onClick={saveProfile} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
          </div>
        </div>
      </Modal>

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

          {/* Already paid this month warning */}
          {alreadyPaidWarning && feeType === "membership" && (
            <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2.5">
              <span className="text-amber-500 text-base leading-none mt-0.5">⚠</span>
              <div>
                <p className="text-xs font-semibold text-amber-800">Already paid this month</p>
                <p className="text-xs text-amber-700 mt-0.5">This member has a membership payment recorded for the current month. You can still proceed for corrections or advance payments.</p>
              </div>
            </div>
          )}

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
            <Select label="Payment Type" value={feeType} onChange={(e) => { setFeeType(e.target.value); setCommissionRate(""); if (e.target.value !== "membership") setAlreadyPaidWarning(false); }}>
              <option value="membership">Monthly Membership</option>
              <option value="admission">Admission Fee</option>
              <option value="trainer">Trainer Fee</option>
              <option value="nutritionist">Nutritionist Fee</option>
              <option value="physiotherapy">Physiotherapy Fee</option>
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

          {/* Commission section — shown for trainer / nutritionist / physiotherapy */}
          {showCommission && (
            <div className="bg-[#FEF0E8] border border-[#FDDCC8] rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold text-[#C04E10] uppercase tracking-wide">
                Commission
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Select
                    label="Staff Member"
                    value={commissionStaffId}
                    onChange={(e) => setCommissionStaffId(e.target.value)}
                  >
                    <option value="">— Select staff —</option>
                    {allStaff
                      .filter((s) => {
                        if (feeType === "trainer") return s.role === "Trainer";
                        if (feeType === "nutritionist") return s.role === "Nutritionist";
                        return true; // physiotherapy → show all
                      })
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.full_name} ({s.role})
                        </option>
                      ))}
                  </Select>
                </div>
                <Input
                  label="Commission Rate %"
                  type="number"
                  placeholder="e.g. 10"
                  min={0}
                  max={100}
                  value={commissionRate}
                  onChange={(e) => setCommissionRate(e.target.value)}
                />
                {Number(commissionRate) > 0 && (
                  <div className="mt-6 bg-white border border-[#FDDCC8] rounded-lg px-3 py-2 text-center">
                    <p className="text-xs text-[#7A7A72]">Commission</p>
                    <p className="text-sm font-bold text-[#F06418]">{formatPKR(commissionAmount)}</p>
                  </div>
                )}
              </div>
            </div>
          )}

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

      {/* Receipt Modal */}
      {receiptData && (
        <Modal open={receiptModal} onClose={() => setReceiptModal(false)} title="Payment Receipt" size="sm">
          <div className="p-5">
            {/* Printable receipt */}
            <div id="luf-receipt" className="bg-white border border-[#E4E4DE] rounded-xl overflow-hidden text-[#1A1A16]">
              {/* Header */}
              <div className="bg-[#111111] px-5 py-4 text-center">
                <p className="text-[#F06418] text-xs font-semibold tracking-widest uppercase mb-0.5">Level Up Fitness Club</p>
                <p className="text-white text-[10px] opacity-70">3rd Floor, High Street Mall, Paragon City, Lahore</p>
                <p className="text-white text-[10px] opacity-70">03000202902</p>
              </div>

              {/* Receipt meta */}
              <div className="px-5 py-3 border-b border-[#E4E4DE] bg-[#F8F8F6] flex justify-between items-center">
                <div>
                  <p className="text-[10px] text-[#7A7A72] uppercase tracking-wide">Receipt No</p>
                  <p className="text-sm font-bold font-mono text-[#F06418]">{receiptData.receiptNo}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-[#7A7A72] uppercase tracking-wide">Date</p>
                  <p className="text-sm font-semibold">{receiptData.date}</p>
                </div>
              </div>

              {/* Member info */}
              <div className="px-5 py-3 border-b border-[#E4E4DE] space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-[#7A7A72]">Member</span>
                  <span className="font-semibold">{receiptData.memberName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#7A7A72]">Member No</span>
                  <span className="font-mono font-semibold text-[#F06418]">{receiptData.memberNo}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#7A7A72]">Package</span>
                  <span className="font-medium">{receiptData.packageName}</span>
                </div>
              </div>

              {/* Payment info */}
              <div className="px-5 py-3 border-b border-[#E4E4DE] space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-[#7A7A72]">Payment Type</span>
                  <span className="capitalize font-medium">{receiptData.type}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#7A7A72]">Payment Method</span>
                  <span className="font-medium">{receiptData.method}</span>
                </div>
                {receiptData.discountAmount > 0 && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-[#7A7A72]">Original Amount</span>
                      <span className="line-through text-[#7A7A72]">{formatPKR(receiptData.originalAmount)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[#F06418]">Discount</span>
                      <span className="text-[#F06418]">− {formatPKR(receiptData.discountAmount)}</span>
                    </div>
                  </>
                )}
                {receiptData.note && (
                  <div className="flex justify-between text-sm">
                    <span className="text-[#7A7A72]">Note</span>
                    <span className="text-[#4A4A44] text-right max-w-[55%]">{receiptData.note}</span>
                  </div>
                )}
              </div>

              {/* Amount */}
              <div className="px-5 py-4 flex justify-between items-center">
                <span className="text-sm font-semibold text-[#4A4A44]">Amount Paid</span>
                <span className="text-2xl font-bold text-[#1A1A16]" style={{ fontFamily: "var(--font-barlow-condensed)" }}>
                  {formatPKR(receiptData.amount)}
                </span>
              </div>

              {/* Footer */}
              <div className="bg-[#FEF0E8] px-5 py-3 text-center border-t border-[#FDDCC8]">
                <p className="text-xs text-[#C04E10] font-medium">Thank you for choosing Level Up Fitness Club!</p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 mt-4">
              <Button variant="secondary" onClick={() => setReceiptModal(false)} className="flex-1">
                Close
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  if (!receiptData) return;
                  const w = window.open("", "_blank");
                  if (!w) return;
                  const html = buildReceiptHtml(receiptData);
                  w.document.write(html);
                  w.document.close();
                  w.focus();
                  setTimeout(() => w.print(), 400);
                }}
              >
                <Printer className="w-4 h-4" /> Print / PDF
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Device Enrollments Field ──────────────────────────────────────────
type Device = { id: string; serial_no: string; name: string | null };
type Enrollment = { id: string; device_serial: string; device_user_id: string };
type CmdStatus = "pending" | "sent" | "acked" | "failed";
type LastCmd = { status: CmdStatus; created_at: string };

function DeviceEnrollmentsField({ memberId, onSaved }: {
  memberId: string;
  onSaved: () => void;
}) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [lastCmds, setLastCmds] = useState<Record<string, LastCmd>>({});
  const [loading, setLoading] = useState(true);
  const [editingSerial, setEditingSerial] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState<string | null>(null);
  const [nextIds, setNextIds] = useState<Record<string, number>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const supabase = createClient();

  async function load() {
    setLoading(true);
    const [{ data: devs }, { data: enrs }, { data: cmds }, { data: allEnrs }] = await Promise.all([
      supabase.from("devices").select("id, serial_no, name").order("name"),
      supabase.from("device_enrollments").select("id, device_serial, device_user_id")
        .eq("member_id", memberId).is("deleted_at", null),
      supabase.from("device_commands").select("device_serial, status, created_at")
        .eq("member_id", memberId).eq("command_type", "push_user")
        .order("created_at", { ascending: false }).limit(20),
      // All enrollments across all members to compute next available ID per device
      supabase.from("device_enrollments").select("device_serial, device_user_id").is("deleted_at", null),
    ]);
    setDevices(devs ?? []);
    setEnrollments(enrs ?? []);
    const map: Record<string, LastCmd> = {};
    for (const c of (cmds ?? [])) {
      if (!map[c.device_serial]) map[c.device_serial] = { status: c.status, created_at: c.created_at };
    }
    setLastCmds(map);
    // Compute next available user ID per device (max existing + 1, default 1)
    const maxMap: Record<string, number> = {};
    for (const row of (allEnrs ?? [])) {
      const n = parseInt(row.device_user_id, 10);
      if (!isNaN(n)) maxMap[row.device_serial] = Math.max(maxMap[row.device_serial] ?? 0, n);
    }
    const nextMap: Record<string, number> = {};
    for (const serial in maxMap) nextMap[serial] = maxMap[serial] + 1;
    setNextIds(nextMap);
    setLoading(false);
    return map;
  }

  // Poll only command statuses every 5s while any command is pending/sent
  async function refreshCmds(): Promise<Record<string, LastCmd>> {
    const { data: cmds } = await supabase
      .from("device_commands").select("device_serial, status, created_at")
      .eq("member_id", memberId).eq("command_type", "push_user")
      .order("created_at", { ascending: false }).limit(20);
    const map: Record<string, LastCmd> = {};
    for (const c of (cmds ?? [])) {
      if (!map[c.device_serial]) map[c.device_serial] = { status: c.status, created_at: c.created_at };
    }
    setLastCmds(map);
    return map;
  }

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const map = await refreshCmds();
      const hasActive = Object.values(map).some((c) => c.status === "pending" || c.status === "sent");
      if (!hasActive) {
        clearInterval(pollRef.current!);
        pollRef.current = null;
      }
    }, 5000);
  }

  useEffect(() => {
    load();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [memberId]); // eslint-disable-line react-hooks/exhaustive-deps

  function enrollmentFor(serial: string) {
    return enrollments.find((e) => e.device_serial === serial) ?? null;
  }

  function startEdit(serial: string) {
    const existing = enrollmentFor(serial);
    // Pre-fill with next available ID when enrolling fresh; keep existing ID when editing
    setEditValue(existing?.device_user_id ?? String(nextIds[serial] ?? 1));
    setEditingSerial(serial);
  }

  async function saveEnrollment(serial: string) {
    setSaving(true);
    const uid = editValue.trim();
    const existing = enrollmentFor(serial);

    if (!uid) {
      if (existing) {
        await supabase.from("device_enrollments")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", existing.id);
        toast.success("Enrollment removed");
      }
    } else if (existing) {
      const { error } = await supabase.from("device_enrollments")
        .update({ device_user_id: uid })
        .eq("id", existing.id);
      if (error) { toast.error(`Save failed: ${error.message}`); setSaving(false); return; }
      toast.success("Enrollment updated");
    } else {
      const { error } = await supabase.from("device_enrollments").insert({
        member_id: memberId, device_serial: serial, device_user_id: uid,
      });
      if (error) { toast.error(`Save failed: ${error.message}`); setSaving(false); return; }
      toast.success("Enrollment saved");
    }

    setSaving(false);
    setEditingSerial(null);
    // Clear cmd status so Push button reappears after an edit
    setLastCmds((prev) => { const next = { ...prev }; delete next[serial]; return next; });
    await load();
    onSaved();
  }

  async function removeEnrollment(serial: string) {
    const existing = enrollmentFor(serial);
    if (!existing) return;
    await supabase.from("device_enrollments")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", existing.id);
    toast.success("Enrollment removed");
    await load();
    onSaved();
  }

  async function pushToDevice(serial: string) {
    setPushing(serial);
    try {
      const res = await fetch("/api/devices/push-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, device_serial: serial }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Push failed");
      } else {
        toast.success(`Queued — device will pick it up within ~30 seconds`);
        await load();
        startPolling();
      }
    } catch {
      toast.error("Network error");
    } finally {
      setPushing(null);
    }
  }

  function CmdBadge({ serial }: { serial: string }) {
    const cmd = lastCmds[serial];
    if (!cmd) return null;
    const cfg: Record<CmdStatus, { label: string; cls: string; icon: React.ReactNode }> = {
      pending: { label: "Queued", cls: "text-amber-600 bg-amber-50 border-amber-200", icon: <Clock className="w-2.5 h-2.5" /> },
      sent:    { label: "Sent",   cls: "text-blue-600 bg-blue-50 border-blue-200",   icon: <Send className="w-2.5 h-2.5" /> },
      acked:   { label: "Done ✓", cls: "text-green-600 bg-green-50 border-green-200", icon: <Check className="w-2.5 h-2.5" /> },
      failed:  { label: "Failed", cls: "text-red-600 bg-red-50 border-red-200",      icon: <X className="w-2.5 h-2.5" /> },
    };
    const { label, cls, icon } = cfg[cmd.status];
    return (
      <span className={`inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${cls}`}>
        {icon} {label}
      </span>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-3">
        <Fingerprint className="w-3.5 h-3.5 text-[#F06418]" />
        <span className="text-xs font-semibold text-[#1A1A16]">Biometric Device Enrollments</span>
      </div>

      {loading ? (
        <p className="text-xs text-[#7A7A72]">Loading devices…</p>
      ) : devices.length === 0 ? (
        <p className="text-xs text-[#7A7A72]">No devices registered yet.</p>
      ) : (
        <div className="space-y-2">
          {devices.map((dev) => {
            const enr = enrollmentFor(dev.serial_no);
            const isEditing = editingSerial === dev.serial_no;
            const isPushing = pushing === dev.serial_no;
            const label = dev.name || dev.serial_no;
            const cmdStatus = lastCmds[dev.serial_no]?.status;
            const showPushBtn = enr && cmdStatus !== "acked";

            return (
              <div key={dev.serial_no} className="rounded-lg border border-[#E4E4DE] bg-[#F8F8F6] px-2.5 py-2">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-[#1A1A16]">{label}</span>
                    <CmdBadge serial={dev.serial_no} />
                  </div>
                  {!isEditing ? (
                    <div className="flex items-center gap-2">
                      {showPushBtn && (
                        <button
                          onClick={() => pushToDevice(dev.serial_no)}
                          disabled={isPushing}
                          title="Send user info to this device — device picks it up within ~30s"
                          className="text-[10px] text-[#F06418] hover:underline flex items-center gap-0.5 disabled:opacity-50"
                        >
                          {isPushing
                            ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            : <Send className="w-2.5 h-2.5" />
                          }
                          {isPushing ? "Sending…" : "Push to Device"}
                        </button>
                      )}
                      <button onClick={() => startEdit(dev.serial_no)}
                        className="text-[10px] text-[#4A4A44] hover:text-[#F06418] hover:underline flex items-center gap-0.5">
                        <Edit3 className="w-2.5 h-2.5" /> {enr ? "Edit" : `Enroll (ID ${nextIds[dev.serial_no] ?? 1})`}
                      </button>
                      {enr && (
                        <button onClick={() => removeEnrollment(dev.serial_no)}
                          className="text-[10px] text-red-500 hover:underline flex items-center gap-0.5">
                          <X className="w-2.5 h-2.5" /> Remove
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button onClick={() => saveEnrollment(dev.serial_no)} disabled={saving}
                        className="text-[10px] text-green-600 hover:underline flex items-center gap-0.5 disabled:opacity-50">
                        <Check className="w-2.5 h-2.5" /> Save
                      </button>
                      <button onClick={() => setEditingSerial(null)}
                        className="text-[10px] text-red-500 hover:underline">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <>
                    <input
                      type="text"
                      placeholder="User ID from ZKTeco (e.g. 1)"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      autoFocus
                      className="w-full px-2 py-1 text-xs rounded border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
                    />
                    <p className="text-[10px] text-[#7A7A72] mt-1">Leave blank to remove enrollment.</p>
                  </>
                ) : enr ? (
                  <div className="flex items-center gap-1.5 text-xs text-green-700">
                    <Fingerprint className="w-3 h-3 text-green-600" />
                    <span className="font-semibold">Enrolled — User ID: {enr.device_user_id}</span>
                  </div>
                ) : (
                  <span className="text-[11px] text-[#7A7A72]">Not enrolled</span>
                )}

              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
