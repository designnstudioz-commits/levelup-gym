"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Users, CheckCircle, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/contexts/CurrentUserContext";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatDate, timeAgo, cn } from "@/lib/utils";
import type { Member } from "@/types/database";

type PendingFamilyMember = Member & {
  primary_member?: { full_name: string; membership_no: string; phone: string } | null;
};

type PricingDecision = "free" | "discounted" | "full";

const PRICING_OPTIONS: { value: PricingDecision; label: string }[] = [
  { value: "free", label: "Free" },
  { value: "discounted", label: "Discounted" },
  { value: "full", label: "Full Price" },
];

export default function FamilyApprovalsPage() {
  useRoleGuard(["owner", "manager"]);
  const router = useRouter();
  const currentUser = useCurrentUser();

  const [pending, setPending] = useState<PendingFamilyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewTarget, setReviewTarget] = useState<PendingFamilyMember | null>(null);
  const [decision, setDecision] = useState<PricingDecision>("full");
  const [decisionNote, setDecisionNote] = useState("");
  const [processing, setProcessing] = useState(false);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("members")
      .select("*, primary_member:members!members_family_primary_member_id_fkey(full_name, membership_no, phone)")
      .eq("status", "pending_family_approval")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    setPending((data as PendingFamilyMember[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  function openReview(m: PendingFamilyMember) {
    setReviewTarget(m);
    setDecision("full");
    setDecisionNote("");
  }

  async function handleApprove() {
    if (!reviewTarget) return;
    setProcessing(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("members")
        .update({
          status: "active",
          family_pricing_decision: decision,
          family_pricing_note: decisionNote.trim() || null,
          family_approved_by: currentUser?.id ?? null,
          family_approved_at: new Date().toISOString(),
        })
        .eq("id", reviewTarget.id);

      if (error) throw error;

      await supabase.from("activity_logs").insert({
        user_id: currentUser?.id ?? null,
        action: "approved_family_member",
        entity_type: "member",
        entity_id: reviewTarget.id,
        description: `Approved family membership for ${reviewTarget.full_name} — pricing: ${decision}${decisionNote ? ` (${decisionNote})` : ""}`,
        metadata: { decision, note: decisionNote || null, primary_member_id: reviewTarget.family_primary_member_id },
      });

      toast.success(`${reviewTarget.full_name} approved — ${decision} pricing`);
      setReviewTarget(null);
      fetchPending();
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error("Failed to approve. Please try again.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Family Approvals"
        subtitle="Review family-linked registrations and decide pricing"
      />

      <div className="flex-1 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-[#7A7A72]">
            Members registered as a family member wait here until an Owner or Manager decides pricing. Payment was already collected in full at registration.
          </p>
          <Button variant="ghost" size="sm" onClick={fetchPending}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        <div className="bg-white border border-[#E4E4DE] rounded-xl overflow-hidden">
          {loading ? (
            <div className="py-16 text-center">
              <RefreshCw className="w-6 h-6 text-[#7A7A72] animate-spin mx-auto mb-2" />
              <p className="text-sm text-[#7A7A72]">Loading...</p>
            </div>
          ) : pending.length === 0 ? (
            <div className="py-16 text-center">
              <div className="w-12 h-12 bg-[#F8F8F6] rounded-full flex items-center justify-center mx-auto">
                <Users className="w-5 h-5 text-[#7A7A72]" />
              </div>
              <p className="text-sm text-[#7A7A72] mt-2">No family registrations waiting for approval</p>
            </div>
          ) : (
            <div className="divide-y divide-[#E4E4DE]">
              {pending.map((m) => (
                <div key={m.id} className="px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#FEF0E8] flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {m.photo_url ? (
                        <img src={m.photo_url} alt="" className="w-10 h-10 object-cover" />
                      ) : (
                        <span className="text-[#F06418] text-sm font-bold">{m.full_name.charAt(0)}</span>
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#1A1A16]">{m.full_name}</p>
                      <p className="text-xs text-[#7A7A72]">
                        {m.family_relationship ?? "—"} of{" "}
                        <span className="font-medium text-[#4A4A44]">
                          {m.primary_member?.full_name ?? "—"}
                        </span>
                        {m.primary_member?.membership_no ? ` (${m.primary_member.membership_no})` : ""}
                      </p>
                      {m.family_notes && (
                        <p className="text-xs text-[#7A7A72] mt-0.5 italic">"{m.family_notes}"</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-[#7A7A72]">{timeAgo(m.created_at)}</span>
                    <Button size="sm" onClick={() => openReview(m)}>
                      <CheckCircle className="w-4 h-4" /> Review
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={!!reviewTarget}
        onClose={() => setReviewTarget(null)}
        title={`Review — ${reviewTarget?.full_name}`}
        size="sm"
      >
        {reviewTarget && (
          <div className="space-y-4">
            <div className="text-sm text-[#4A4A44] bg-[#F8F8F6] rounded-lg p-3">
              <p><strong>{reviewTarget.full_name}</strong> — {reviewTarget.family_relationship ?? "—"} of{" "}
                <strong>{reviewTarget.primary_member?.full_name ?? "—"}</strong>
              </p>
              <p className="text-xs text-[#7A7A72] mt-1">Registered {formatDate(reviewTarget.created_at)} — payment already collected at full price.</p>
            </div>

            <div>
              <label className="text-sm font-medium text-[#1A1A16] block mb-1.5">Pricing Decision</label>
              <div className="grid grid-cols-3 gap-2">
                {PRICING_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDecision(opt.value)}
                    className={cn(
                      "py-2 rounded-lg border-2 text-sm font-semibold transition-all",
                      decision === opt.value
                        ? "bg-[#F06418] border-[#F06418] text-white"
                        : "bg-white border-[#E4E4DE] text-[#4A4A44] hover:border-[#F06418]"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-[#1A1A16] block mb-1.5">Note (optional)</label>
              <textarea
                rows={2}
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder="e.g. 50% off next renewal, refund of Rs 2,000 issued, etc."
                className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418] resize-none"
              />
            </div>

            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setReviewTarget(null)} className="flex-1">
                Cancel
              </Button>
              <Button onClick={handleApprove} loading={processing} className="flex-1">
                <CheckCircle className="w-4 h-4" /> Approve
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
