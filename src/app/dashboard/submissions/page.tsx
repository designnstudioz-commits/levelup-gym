"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Search,
  CheckCircle,
  XCircle,
  Eye,
  Filter,
  RefreshCw,
  User,
  Trash2,
  Archive,
  AlertTriangle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { formatDate, timeAgo, formatPKR, generateMembershipNo } from "@/lib/utils";
import type { Submission } from "@/types/database";

type SubmissionWithPackage = Submission & {
  packages?: { name: string } | null;
  trainer?: { full_name: string } | null;
};

type StatusFilter = "all" | "pending" | "approved" | "rejected";

const REJECT_PRESETS = [
  "Duplicate application",
  "Incomplete information provided",
  "Invalid / missing documents",
  "Already an active member",
  "Age requirement not met",
  "Medical condition — not eligible",
  "Payment not confirmed",
  "Policy violation — previously blacklisted",
  "Membership slot not available",
];

export default function SubmissionsPage() {
  const router = useRouter();
  const [submissions, setSubmissions] = useState<SubmissionWithPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [search, setSearch] = useState("");
  const [viewSubmission, setViewSubmission] = useState<SubmissionWithPackage | null>(null);
  const [rejectModal, setRejectModal] = useState<SubmissionWithPackage | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteModal, setBulkDeleteModal] = useState(false);

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from("submissions")
      .select("*, packages(name), trainer:staff_members(full_name)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query;
    if (!error) setSubmissions(data ?? []);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  const filtered = submissions.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.full_name.toLowerCase().includes(q) ||
      s.phone.includes(q) ||
      s.email?.toLowerCase().includes(q) ||
      s.cnic?.includes(q)
    );
  });

  async function handleApprove(sub: SubmissionWithPackage) {
    setProcessing(sub.id);
    try {
      const supabase = createClient();

      const membershipNo = await generateMembershipNo();

      // Insert into members
      const { data: newMember, error: memberError } = await supabase.from("members").insert({
        submission_id: sub.id,
        membership_no: membershipNo,
        full_name: sub.full_name,
        secondary_name: sub.secondary_name,
        dob: sub.dob,
        age: sub.age,
        gender: sub.gender,
        marital_status: sub.marital_status,
        phone: sub.phone,
        whatsapp: sub.whatsapp,
        email: sub.email,
        cnic: sub.cnic,
        address: sub.address,
        blood_group: sub.blood_group,
        vaccinated: sub.vaccinated,
        height: sub.height,
        weight: sub.weight,
        medical_notes: sub.medical_notes,
        emergency_name: sub.emergency_name,
        emergency_phone: sub.emergency_phone,
        photo_url: sub.photo_url,
        package_id: sub.package_id,
        trainer_id: sub.trainer_id,
        joining_date: sub.joining_date,
        expiry_date: sub.expiry_date,
        admission_fee: sub.admission_fee,
        monthly_fee: sub.monthly_fee,
        status: "active",
      }).select("id").single();

      if (memberError) throw memberError;

      // Update submission status
      const { error: subError } = await supabase
        .from("submissions")
        .update({
          status: "approved",
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", sub.id);

      if (subError) throw subError;

      // Log activity
      await supabase.from("activity_logs").insert({
        action: "approved_submission",
        entity_type: "submission",
        entity_id: sub.id,
        description: `Approved registration for ${sub.full_name} — Membership ${membershipNo}`,
        metadata: { membership_no: membershipNo },
      });

      toast.success(`${sub.full_name} approved! Membership: ${membershipNo}`);
      setViewSubmission(null);
      fetchSubmissions();
      // Navigate to new member profile
      if (newMember?.id) {
        router.push(`/dashboard/members/${newMember.id}`);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to approve. Please try again.");
    } finally {
      setProcessing(null);
    }
  }

  async function handleReject() {
    if (!rejectModal) return;
    if (!rejectReason.trim()) {
      toast.error("Please provide a rejection reason");
      return;
    }

    setProcessing(rejectModal.id);
    try {
      const supabase = createClient();
      await supabase
        .from("submissions")
        .update({
          status: "rejected",
          rejection_reason: rejectReason,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", rejectModal.id);

      await supabase.from("activity_logs").insert({
        action: "rejected_submission",
        entity_type: "submission",
        entity_id: rejectModal.id,
        description: `Rejected registration for ${rejectModal.full_name}. Reason: ${rejectReason}`,
      });

      toast.success("Submission rejected");
      setRejectModal(null);
      setRejectReason("");
      fetchSubmissions();
    } catch {
      toast.error("Failed to reject. Please try again.");
    } finally {
      setProcessing(null);
    }
  }

  async function deleteFromArchive(sub: SubmissionWithPackage) {
    if (!confirm(`Permanently remove "${sub.full_name}" from archive?`)) return;
    const supabase = createClient();
    await supabase.from("submissions").update({ deleted_at: new Date().toISOString() }).eq("id", sub.id);
    toast.success("Removed from archive");
    fetchSubmissions();
  }

  async function emptyArchive() {
    if (!confirm("Permanently delete ALL rejected submissions from the archive? This cannot be undone.")) return;
    const supabase = createClient();
    await supabase.from("submissions").update({ deleted_at: new Date().toISOString() }).eq("status", "rejected").is("deleted_at", null);
    toast.success("Archive emptied");
    fetchSubmissions();
  }

  function toggleSelect(id: string) {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelected(newSelected);
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((s) => s.id)));
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected submission(s)? This cannot be undone.`)) return;

    setProcessing("bulk");
    try {
      const supabase = createClient();
      const selectedArray = Array.from(selected);

      for (const id of selectedArray) {
        await supabase.from("submissions").update({ deleted_at: new Date().toISOString() }).eq("id", id);
        await supabase.from("activity_logs").insert({
          action: "deleted_submission",
          entity_type: "submission",
          entity_id: id,
          description: `Deleted submission from bulk removal`,
        });
      }

      toast.success(`Deleted ${selected.size} submission(s)`);
      setSelected(new Set());
      setBulkDeleteModal(false);
      fetchSubmissions();
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete. Please try again.");
    } finally {
      setProcessing(null);
    }
  }

  const STATUS_TABS: { key: StatusFilter; label: string }[] = [
    { key: "pending",  label: "Pending"  },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Archive"  },
    { key: "all",      label: "All"      },
  ];

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Submissions"
        subtitle="Review and approve member registrations"
      />

      <div className="flex-1 p-6 space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Status tabs */}
          <div className="flex bg-white border border-[#E4E4DE] rounded-lg p-1 gap-0.5">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setStatusFilter(tab.key);
                  setSelected(new Set());
                }}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  statusFilter === tab.key
                    ? "bg-[#F06418] text-white"
                    : "text-[#4A4A44] hover:bg-[#F8F8F6]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="flex-1 min-w-48 max-w-sm relative">
            <Search className="w-4 h-4 text-[#7A7A72] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by name, phone, CNIC..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
            />
          </div>

          {selected.size > 0 && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setBulkDeleteModal(true)}
            >
              <Trash2 className="w-4 h-4" /> Delete {selected.size}
            </Button>
          )}

          {statusFilter === "rejected" && filtered.length > 0 && (
            <Button variant="danger" size="sm" onClick={emptyArchive}>
              <Trash2 className="w-4 h-4" /> Empty Archive
            </Button>
          )}

          <Button variant="ghost" size="sm" onClick={fetchSubmissions}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {/* Table */}
        <div className="bg-white border border-[#E4E4DE] rounded-xl overflow-hidden">
          {loading ? (
            <div className="py-16 text-center">
              <RefreshCw className="w-6 h-6 text-[#7A7A72] animate-spin mx-auto mb-2" />
              <p className="text-sm text-[#7A7A72]">Loading submissions...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <ClipboardListEmpty />
              <p className="text-sm text-[#7A7A72] mt-2">No submissions found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#F8F8F6] border-b border-[#E4E4DE]">
                  <tr>
                    <th className="w-12 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.size === filtered.length && filtered.length > 0}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border border-[#E4E4DE] cursor-pointer accent-[#F06418]"
                      />
                    </th>
                    <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Member</th>
                    <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Phone</th>
                    <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Package</th>
                    <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Services</th>
                    <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Submitted</th>
                    <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Status</th>
                    <th className="text-right text-xs font-semibold text-[#7A7A72] px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E4DE]">
                  {filtered.map((sub) => (
                    <tr
                      key={sub.id}
                      className={`hover:bg-[#F8F8F6] transition-colors ${
                        selected.has(sub.id) ? "bg-blue-50" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(sub.id)}
                          onChange={() => toggleSelect(sub.id)}
                          className="w-4 h-4 rounded border border-[#E4E4DE] cursor-pointer accent-[#F06418]"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-[#FEF0E8] flex items-center justify-center flex-shrink-0">
                            {sub.photo_url ? (
                              <img src={sub.photo_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                            ) : (
                              <span className="text-[#F06418] text-xs font-bold">
                                {sub.full_name.charAt(0)}
                              </span>
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-[#1A1A16]">{sub.full_name}</p>
                            <p className="text-xs text-[#7A7A72]">{sub.gender ?? "—"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4A4A44]">{sub.phone}</td>
                      <td className="px-4 py-3 text-sm text-[#4A4A44]">
                        {(sub as any).packages?.name ?? <span className="text-[#7A7A72]">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1 max-w-[140px]">
                          {sub.services_interested?.slice(0, 2).map((s) => (
                            <span key={s} className="text-[10px] bg-[#FEF0E8] text-[#C04E10] px-1.5 py-0.5 rounded-full">
                              {s}
                            </span>
                          ))}
                          {(sub.services_interested?.length ?? 0) > 2 && (
                            <span className="text-[10px] text-[#7A7A72]">
                              +{(sub.services_interested?.length ?? 0) - 2}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#7A7A72]">{timeAgo(sub.created_at)}</td>
                      <td className="px-4 py-3">
                        <Badge variant={sub.status as any}>
                          {sub.status.charAt(0).toUpperCase() + sub.status.slice(1)}
                        </Badge>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setViewSubmission(sub)}
                            className="p-1.5 rounded-lg text-[#7A7A72] hover:bg-[#F8F8F6] hover:text-[#1A1A16] transition-colors"
                            title="View details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {sub.status === "pending" && (
                            <>
                              <button
                                onClick={() => handleApprove(sub)}
                                disabled={processing === sub.id}
                                className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 transition-colors disabled:opacity-50"
                                title="Approve"
                              >
                                <CheckCircle className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => { setRejectModal(sub); setRejectReason(""); }}
                                disabled={processing === sub.id}
                                className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                                title="Reject"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          {sub.status === "rejected" && (
                            <button
                              onClick={() => deleteFromArchive(sub)}
                              className="p-1.5 rounded-lg text-[#7A7A72] hover:bg-red-50 hover:text-red-600 transition-colors"
                              title="Remove from archive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* View submission modal */}
      <Modal
        open={!!viewSubmission}
        onClose={() => setViewSubmission(null)}
        title={`Submission — ${viewSubmission?.full_name}`}
        size="lg"
      >
        {viewSubmission && (
          <div className="p-5 space-y-5">
            {/* Header info */}
            <div className="flex items-center gap-4 pb-4 border-b border-[#E4E4DE]">
              <div className="w-14 h-14 rounded-full bg-[#FEF0E8] flex items-center justify-center flex-shrink-0">
                {viewSubmission.photo_url ? (
                  <img src={viewSubmission.photo_url} alt="" className="w-14 h-14 rounded-full object-cover" />
                ) : (
                  <User className="w-6 h-6 text-[#F06418]" />
                )}
              </div>
              <div>
                <p className="text-lg font-bold text-[#1A1A16]">{viewSubmission.full_name}</p>
                <p className="text-sm text-[#7A7A72]">{viewSubmission.phone} · {viewSubmission.gender}</p>
                <Badge variant={viewSubmission.status as any} className="mt-1">
                  {viewSubmission.status}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              {[
                ["Father / Husband", viewSubmission.secondary_name],
                ["Date of Birth", viewSubmission.dob ? formatDate(viewSubmission.dob) : null],
                ["Age", viewSubmission.age ? `${viewSubmission.age} years` : null],
                ["Marital Status", viewSubmission.marital_status],
                ["Email", viewSubmission.email],
                ["CNIC", viewSubmission.cnic],
                ["WhatsApp", viewSubmission.whatsapp],
                ["Address", viewSubmission.address],
                ["Height", viewSubmission.height],
                ["Weight", viewSubmission.weight],
                ["Blood Group", viewSubmission.blood_group],
                ["Vaccinated", viewSubmission.vaccinated],
                ["Emergency Contact", viewSubmission.emergency_name],
                ["Emergency Phone", viewSubmission.emergency_phone],
                ["Referral Source", viewSubmission.referral_source],
                ["Package", (viewSubmission as any).packages?.name],
                ["Joining Date", viewSubmission.joining_date ? formatDate(viewSubmission.joining_date) : null],
                ["Expiry Date", viewSubmission.expiry_date ? formatDate(viewSubmission.expiry_date) : null],
                ["Monthly Fee", viewSubmission.monthly_fee ? formatPKR(viewSubmission.monthly_fee) : null],
                ["Admission Fee", viewSubmission.admission_fee ? formatPKR(viewSubmission.admission_fee) : null],
                ["Payment Method", viewSubmission.payment_method],
              ]
                .filter(([, v]) => v)
                .map(([label, value]) => (
                  <div key={label as string}>
                    <p className="text-[10px] text-[#7A7A72] font-semibold uppercase tracking-wide">{label}</p>
                    <p className="text-[#1A1A16] mt-0.5">{value}</p>
                  </div>
                ))}
            </div>

            {viewSubmission.services_interested && viewSubmission.services_interested.length > 0 && (
              <div>
                <p className="text-[10px] text-[#7A7A72] font-semibold uppercase tracking-wide mb-2">Services</p>
                <div className="flex flex-wrap gap-1.5">
                  {viewSubmission.services_interested.map((s) => (
                    <span key={s} className="bg-[#FEF0E8] text-[#C04E10] text-xs px-2.5 py-1 rounded-full font-medium">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {viewSubmission.notes && (
              <div>
                <p className="text-[10px] text-[#7A7A72] font-semibold uppercase tracking-wide mb-1">Notes</p>
                <p className="text-sm text-[#4A4A44]">{viewSubmission.notes}</p>
              </div>
            )}

            {viewSubmission.status === "rejected" && viewSubmission.rejection_reason && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-red-700 mb-1">Rejection Reason</p>
                <p className="text-sm text-red-700">{viewSubmission.rejection_reason}</p>
              </div>
            )}

            {viewSubmission.status === "pending" && (
              <div className="flex gap-3 pt-4 border-t border-[#E4E4DE]">
                <Button
                  onClick={() => handleApprove(viewSubmission)}
                  loading={processing === viewSubmission.id}
                  className="flex-1"
                >
                  <CheckCircle className="w-4 h-4" />
                  Approve & Create Member
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    setRejectModal(viewSubmission);
                    setViewSubmission(null);
                    setRejectReason("");
                  }}
                  className="flex-1"
                >
                  <XCircle className="w-4 h-4" />
                  Reject
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Reject modal */}
      <Modal
        open={!!rejectModal}
        onClose={() => setRejectModal(null)}
        title="Reject Submission"
        size="sm"
      >
        {rejectModal && (
          <div className="p-5 space-y-4">
            <p className="text-sm text-[#4A4A44]">
              You are about to reject the registration from{" "}
              <strong>{rejectModal.full_name}</strong>. This will move it to the Archive.
            </p>

            {/* Preset reasons */}
            <div>
              <p className="text-xs font-semibold text-[#7A7A72] uppercase tracking-wide mb-2">Quick select a reason</p>
              <div className="flex flex-wrap gap-1.5">
                {REJECT_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setRejectReason(preset)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                      rejectReason === preset
                        ? "bg-red-600 border-red-600 text-white"
                        : "bg-white border-[#E4E4DE] text-[#4A4A44] hover:border-red-300 hover:text-red-600"
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-[#1A1A16] block mb-1">
                Rejection Reason <span className="text-[#F06418]">*</span>
              </label>
              <textarea
                rows={2}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Or type a custom reason..."
                className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418] resize-none"
              />
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setRejectModal(null)} className="flex-1">
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={handleReject}
                loading={processing === rejectModal.id}
                className="flex-1"
              >
                <Archive className="w-4 h-4" /> Move to Archive
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Bulk delete modal */}
      <Modal
        open={bulkDeleteModal}
        onClose={() => setBulkDeleteModal(false)}
        title="Delete Submissions"
        size="sm"
      >
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-3">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">
              You are about to permanently delete <strong>{selected.size}</strong> submission(s).
              This action cannot be undone.
            </p>
          </div>

          <div className="bg-[#F8F8F6] rounded-lg p-3 max-h-48 overflow-y-auto">
            <p className="text-xs font-semibold text-[#7A7A72] uppercase tracking-wide mb-2">Submissions to delete:</p>
            <ul className="space-y-1">
              {filtered
                .filter((sub) => selected.has(sub.id))
                .map((sub) => (
                  <li key={sub.id} className="text-sm text-[#4A4A44]">
                    • {sub.full_name} ({sub.phone})
                  </li>
                ))}
            </ul>
          </div>

          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => setBulkDeleteModal(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleBulkDelete}
              loading={processing === "bulk"}
              className="flex-1"
            >
              <Trash2 className="w-4 h-4" /> Delete All
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ClipboardListEmpty() {
  return (
    <div className="w-12 h-12 bg-[#F8F8F6] rounded-full flex items-center justify-center mx-auto">
      <Filter className="w-5 h-5 text-[#7A7A72]" />
    </div>
  );
}
