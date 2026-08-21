import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPKR, describeCoveredPeriod } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import { PrintButton } from "./PrintButton";
import { ReceiptStyles } from "../ReceiptStyles";

const PAYMENT_SELECT = `
  *,
  member:members!fee_payments_member_id_fkey(
    full_name, membership_no, phone,
    packages(name, type)
  ),
  collector:system_users!fee_payments_collected_by_fkey(full_name)
`;

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: anchor } = await supabase
    .from("fee_payments")
    .select(PAYMENT_SELECT)
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!anchor) notFound();

  // A payment split across methods (Cash + Bank, etc.) produces multiple
  // rows sharing one receipt_no — fetch every row in that group so the
  // receipt shows all of them, not just the one that was linked to.
  let rows: any[] = [anchor];
  if (anchor.receipt_no) {
    const { data: groupRows } = await supabase
      .from("fee_payments")
      .select(PAYMENT_SELECT)
      .eq("receipt_no", anchor.receipt_no)
      .eq("member_id", anchor.member_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
    if (groupRows && groupRows.length > 0) rows = groupRows;
  }

  const member = anchor.member;
  const pkg = member?.packages;
  const collector = anchor.collector;
  const totalAmount = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  // Only the first row of a split group ever carries balance_due — find
  // whichever row has it (works the same for an unsplit single payment).
  const balanceRow = rows.find((r) => (r.balance_due ?? 0) > 0);
  const noteSource = rows.find((r) => r.note)?.note ?? null;

  const discountMatch = noteSource?.match(/Discount: (Rs [\d,]+) \((\d+)% off original (Rs [\d,]+)\)/);
  const discountAmt   = discountMatch ? discountMatch[1] : null;
  const discountPct   = discountMatch ? discountMatch[2] : null;
  const originalAmt   = discountMatch ? discountMatch[3] : null;

  // Registration's Package Payment can carry a structured per-package
  // discount breakdown instead of the single-discount note above — render
  // one line per package when present, falling back to the note-based
  // display for every other payment type/historical row.
  const packageBreakdown = rows.find((r) => r.package_breakdown)?.package_breakdown as
    | { name: string; original: number; discount_amount: number; final: number }[]
    | undefined;

  const coverageStartValue = rows.find((r) => r.coverage_start)?.coverage_start ?? null;
  const coverageEndValue = rows.find((r) => r.coverage_end)?.coverage_end ?? null;
  const monthsCoveredValue = rows.find((r) => r.months_covered != null)?.months_covered ?? null;
  const monthCoveredValue = rows.find((r) => r.month_covered)?.month_covered ?? null;
  const coverage = (coverageStartValue || monthCoveredValue)
    ? describeCoveredPeriod(coverageStartValue, coverageEndValue, monthCoveredValue, anchor.payment_date, monthsCoveredValue)
    : null;

  const typeLabels: Record<string, string> = {
    membership:     "Monthly Membership",
    admission:      "Admission Fee",
    trainer:        "Trainer / Coaching Fee",
    nutritionist:   "Nutritionist Fee",
    physiotherapy:  "Physiotherapy Fee",
    other:          "Other",
  };

  const receiptNo = anchor.receipt_no ?? `RCP-${anchor.id.slice(-6).toUpperCase()}`;
  const noteText  = noteSource && !discountMatch ? noteSource : null;

  return (
    <>
      <ReceiptStyles />

      <div className="screen-wrap">
        {/* Actions — hidden on print */}
        <div className="actions-bar no-print">
          <Link href="/dashboard/fees" className="back-link">
            <ArrowLeft className="w-4 h-4" />
            Back to Fees
          </Link>
          <PrintButton />
        </div>

        {/* Receipt */}
        <div className="receipt">

          {/* Dark header */}
          <div className="receipt-header">
            <img src="/logo.png" alt="Level Up Fitness Club" />
            <p className="gym-name">Level Up Fitness Club</p>
            <p className="gym-sub">
              3rd Floor, High Street Mall, Paragon City, Lahore<br />
              03000202902 · levelupfitness.com.pk
            </p>
          </div>

          {/* Receipt no + date */}
          <div className="receipt-meta">
            <div>
              <p className="receipt-no-label">Receipt No</p>
              <p className="receipt-no-value">{receiptNo}</p>
            </div>
            <div>
              <p className="date-label">Collection Date</p>
              <p className="date-value">{formatDate(anchor.payment_date)}</p>
            </div>
          </div>

          {/* Member details */}
          <div className="section">
            <p className="section-title">Member Details</p>
            <div className="row">
              <span className="row-label">Member Name</span>
              <span className="row-value">{member?.full_name ?? "—"}</span>
            </div>
            <div className="row">
              <span className="row-label">Membership No</span>
              <span className="row-value mono">{member?.membership_no ?? "—"}</span>
            </div>
            {member?.phone && (
              <div className="row">
                <span className="row-label">Phone</span>
                <span className="row-value">{member.phone}</span>
              </div>
            )}
            {pkg?.name && (
              <div className="row">
                <span className="row-label">Package</span>
                <span className="row-value">{pkg.name}</span>
              </div>
            )}
          </div>

          {/* Payment details */}
          <div className="section">
            <p className="section-title">Payment Details</p>
            <div className="row">
              <span className="row-label">Payment Type</span>
              <span className="row-value">{typeLabels[anchor.payment_type ?? "other"]}</span>
            </div>
            {coverage?.label && (
              <div className="row">
                <span className="row-label">Coverage Period</span>
                <span className="row-value">{coverage.label}</span>
              </div>
            )}
            {packageBreakdown && packageBreakdown.length > 0 && packageBreakdown.map((p, i) => (
              <div className="row" key={i}>
                <span className="row-label">{p.name}{p.discount_amount > 0 ? ` (− ${formatPKR(p.discount_amount)})` : ""}</span>
                <span className="row-value">{formatPKR(p.final)}</span>
              </div>
            ))}
            {rows.map((r) => (
              <div className="row" key={r.id}>
                <span className="row-label">Payment Method{rows.length > 1 ? ` (${r.payment_method ?? "—"})` : ""}</span>
                <span className="row-value">{rows.length > 1 ? formatPKR(r.amount) : (r.payment_method ?? "—")}</span>
              </div>
            ))}
            {collector?.full_name && (
              <div className="row">
                <span className="row-label">Collected by</span>
                <span className="row-value">{collector.full_name}</span>
              </div>
            )}
            {noteText && !packageBreakdown && (
              <div className="row">
                <span className="row-label">Note</span>
                <span className="row-value" style={{ color: "#4A4A44", fontWeight: 400 }}>{noteText}</span>
              </div>
            )}
            {originalAmt && !packageBreakdown && (
              <div className="row" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #E4E4DE" }}>
                <span className="row-label">Original Amount</span>
                <span className="row-value" style={{ textDecoration: "line-through", color: "#7A7A72", fontWeight: 400 }}>{originalAmt}</span>
              </div>
            )}
            {discountAmt && !packageBreakdown && (
              <div className="row">
                <span className="row-label">Discount ({discountPct}%)</span>
                <span className="row-value discount">− {discountAmt}</span>
              </div>
            )}
            <div className="total-row">
              <span className="total-label">Total Paid</span>
              <span className="total-amount">{formatPKR(totalAmount)}</span>
            </div>
            {balanceRow && (balanceRow.balance_due ?? 0) > 0 && (
              <div className="row" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #E4E4DE" }}>
                <span className="row-label" style={{ color: "#C04E10", fontWeight: 700 }}>
                  Balance Due{balanceRow.balance_due_date ? ` (by ${formatDate(balanceRow.balance_due_date)})` : ""}
                </span>
                <span className="row-value" style={{ color: "#C04E10" }}>{formatPKR(balanceRow.balance_due)}</span>
              </div>
            )}
          </div>

          {/* Orange footer */}
          <div className="receipt-footer">
            <p className="footer-text">Thank you for choosing Level Up Fitness Club!</p>
            <p className="footer-id">{anchor.id}</p>
          </div>
        </div>

        {/* Second print link */}
        <div className="print-link-wrap no-print">
          <PrintButton variant="link" />
        </div>
      </div>
    </>
  );
}
