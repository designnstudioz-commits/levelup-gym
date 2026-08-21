"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { format, endOfMonth } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/contexts/CurrentUserContext";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { formatDate, formatPKR } from "@/lib/utils";
import { PrintButton } from "@/app/dashboard/fees/receipt/[id]/PrintButton";
import { ReceiptStyles } from "@/app/dashboard/fees/receipt/ReceiptStyles";
import type { StaffMember, Member } from "@/types/database";

type LedgerRow = { member_id: string; commission_amount: number; qualifying_date: string };

export default function SalarySlipPage() {
  useRoleGuard(["owner", "manager"]);
  const { id } = useParams<{ id: string }>();
  const currentUser = useCurrentUser();

  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [assignedMembers, setAssignedMembers] = useState<Member[]>([]);
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [month, setMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [baseSalary, setBaseSalary] = useState("");
  const [savingSalary, setSavingSalary] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: staffData } = await supabase.from("staff_members").select("*").eq("id", id).single();
    if (staffData) {
      setStaff(staffData as StaffMember);
      setBaseSalary(staffData.salary?.toString() ?? "");
    }

    if (staffData?.role === "Trainer") {
      const [{ data: members }, { data: ledger }] = await Promise.all([
        supabase.from("members").select("*").eq("trainer_id", id).eq("status", "active").is("deleted_at", null).order("full_name"),
        // Historical commission ledger — frozen PT Fee x rate per cycle, not
        // a live sum of fee_payments. See src/lib/commission.ts.
        supabase.from("trainer_commission_ledger").select("member_id, commission_amount, qualifying_date").eq("trainer_id", id).is("deleted_at", null),
      ]);
      setAssignedMembers((members as Member[]) ?? []);
      setLedgerRows(ledger ?? []);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const periodStart = `${month}-01`;
  const periodEnd = format(endOfMonth(new Date(`${month}-01T00:00:00`)), "yyyy-MM-dd");
  const periodLabel = format(new Date(`${month}-01T00:00:00`), "MMMM yyyy");

  const commissionBreakdown = assignedMembers
    .map((m) => {
      const amount = ledgerRows
        .filter((l) => l.member_id === m.id && l.qualifying_date >= periodStart && l.qualifying_date <= periodEnd)
        .reduce((sum, l) => sum + l.commission_amount, 0);
      return { member: m, amount };
    })
    .filter((row) => row.amount > 0);

  const totalCommission = commissionBreakdown.reduce((sum, r) => sum + r.amount, 0);
  const baseSalaryNum = Number(baseSalary) || 0;
  const grandTotal = baseSalaryNum + totalCommission;
  const salaryDiffersFromProfile = staff && baseSalaryNum !== (staff.salary ?? 0);

  async function saveAsDefaultSalary() {
    if (!staff) return;
    setSavingSalary(true);
    const supabase = createClient();
    const { error } = await supabase.from("staff_members").update({ salary: baseSalaryNum, updated_at: new Date().toISOString() }).eq("id", staff.id);
    if (error) {
      toast.error("Failed to update salary");
      setSavingSalary(false);
      return;
    }
    await supabase.from("activity_logs").insert({
      user_id: currentUser?.id ?? null,
      action: "updated_staff_salary",
      entity_type: "staff_member",
      entity_id: staff.id,
      description: `Updated ${staff.full_name}'s monthly salary to ${formatPKR(baseSalaryNum)} while generating a salary slip`,
    });
    toast.success("Salary updated on profile");
    setStaff({ ...staff, salary: baseSalaryNum });
    setSavingSalary(false);
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-sm text-[#7A7A72] py-16">Loading...</div>;
  }

  if (!staff) {
    return <div className="flex-1 flex items-center justify-center text-sm text-[#7A7A72] py-16">Staff member not found.</div>;
  }

  return (
    <>
      <ReceiptStyles />
      {/* Salary slips can run much longer than a fee receipt (one row per
          assigned member). Two fixes: (1) print at A4 instead of the tiny
          A5 fee-receipt size, so a long list paginates cleanly instead of
          being cramped; (2) on screen, put the controls in their own column
          beside the slip instead of above it, and let the slip column
          scroll independently — so the full list is visible/scrollable
          before printing rather than requiring a long page-scroll past the
          controls first. The scroll constraint is print-only-disabled
          below so nothing is clipped in the actual print/PDF output. */}
      <style>{`
        @page { size: A4; margin: 1.5cm; }
        .slip-layout { display: flex; align-items: flex-start; gap: 24px; width: 100%; max-width: 780px; }
        .slip-controls { width: 280px; flex-shrink: 0; position: sticky; top: 24px; }
        .slip-scroll-col { flex: 1; min-width: 0; max-height: calc(100vh - 140px); overflow-y: auto; padding: 2px; }
        @media (max-width: 720px) {
          .slip-layout { flex-direction: column; }
          .slip-controls { width: 100%; position: static; }
          .slip-scroll-col { max-height: none; overflow: visible; width: 100%; }
        }
        @media print {
          .slip-scroll-col { max-height: none; overflow: visible; }
        }
      `}</style>

      <div className="screen-wrap">
        <div className="actions-bar no-print">
          <Link href={`/dashboard/staff/${id}`} className="back-link">
            <ArrowLeft className="w-4 h-4" />
            Back to Profile
          </Link>
          <PrintButton label="Print Salary Slip" />
        </div>

        <div className="slip-layout">
          {/* Controls — adjust period / base salary, stays visible while
              the slip column scrolls. Screen-only. */}
          <div className="slip-controls no-print">
            <div className="bg-white border border-[#E4E4DE] rounded-xl p-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-[#7A7A72] uppercase tracking-wide block mb-1">Period</label>
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#7A7A72] uppercase tracking-wide block mb-1">Base Salary (Rs)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={baseSalary}
                    onChange={(e) => setBaseSalary(e.target.value)}
                    placeholder="0"
                    className="flex-1 px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
                  />
                  {salaryDiffersFromProfile && (
                    <button
                      onClick={saveAsDefaultSalary}
                      disabled={savingSalary}
                      className="text-xs text-[#F06418] hover:underline whitespace-nowrap disabled:opacity-50"
                    >
                      {savingSalary ? "Saving..." : "Save as default"}
                    </button>
                  )}
                </div>
                <p className="text-xs text-[#7A7A72] mt-1">
                  Prefilled from the staff profile — adjust here for this slip only, or save it back as the new default.
                </p>
              </div>
            </div>
          </div>

          {/* Slip column — the only thing that actually prints. Scrolls
              independently on screen so the full commission list can be
              reviewed without losing the controls above it. */}
          <div className="slip-scroll-col">
        <div className="receipt">
          <div className="receipt-header">
            <img src="/logo.png" alt="Level Up Fitness Club" />
            <p className="gym-name">Level Up Fitness Club</p>
            <p className="gym-sub">
              3rd Floor, High Street Mall, Paragon City, Lahore<br />
              03000202902 · levelupfitness.com.pk
            </p>
          </div>

          <div className="receipt-meta">
            <div>
              <p className="receipt-no-label">Period</p>
              <p className="receipt-no-value" style={{ fontFamily: "inherit" }}>{periodLabel}</p>
            </div>
            <div>
              <p className="date-label">Generated</p>
              <p className="date-value">{formatDate(format(new Date(), "yyyy-MM-dd"))}</p>
            </div>
          </div>

          <div className="section">
            <p className="section-title">Employee Details</p>
            <div className="row">
              <span className="row-label">Name</span>
              <span className="row-value">{staff.full_name}</span>
            </div>
            <div className="row">
              <span className="row-label">Role</span>
              <span className="row-value">{staff.role ?? "—"}</span>
            </div>
            {staff.specialization && (
              <div className="row">
                <span className="row-label">Specialization</span>
                <span className="row-value">{staff.specialization}</span>
              </div>
            )}
            {staff.joining_date && (
              <div className="row">
                <span className="row-label">Joining Date</span>
                <span className="row-value">{formatDate(staff.joining_date)}</span>
              </div>
            )}
          </div>

          <div className="section">
            <p className="section-title">Salary Breakdown</p>
            <div className="row">
              <span className="row-label">Base Salary</span>
              <span className="row-value">{formatPKR(baseSalaryNum)}</span>
            </div>
            {commissionBreakdown.length > 0 && (
              <div className="commission-list">
                {commissionBreakdown.map(({ member, amount }) => (
                  <div className="row" key={member.id}>
                    <span className="row-label">PT — {member.full_name}</span>
                    <span className="row-value">{formatPKR(amount)}</span>
                  </div>
                ))}
              </div>
            )}
            {staff.role === "Trainer" && (
              <div className="row" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #E4E4DE" }}>
                <span className="row-label">Total Commission</span>
                <span className="row-value">{formatPKR(totalCommission)}</span>
              </div>
            )}
            {staff.role === "Trainer" && (
              <p className="row-label" style={{ marginTop: 6, fontSize: 10 }}>
                Commission is manually set per assigned member, applied to their actual collected payments.
              </p>
            )}
          </div>

          <div className="section">
            <div className="total-row">
              <span className="total-label">Total Payable</span>
              <span className="total-amount">{formatPKR(grandTotal)}</span>
            </div>
          </div>

          <div className="receipt-footer">
            <p className="footer-text">Salary Slip — Confidential</p>
            <p className="footer-id">{staff.id}</p>
          </div>
        </div>

            <div className="print-link-wrap no-print">
              <PrintButton variant="link" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
