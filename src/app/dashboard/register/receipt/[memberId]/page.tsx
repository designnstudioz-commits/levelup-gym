import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPKR } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import { PrintButton } from "@/app/dashboard/fees/receipt/[id]/PrintButton";
import { ReceiptStyles } from "@/app/dashboard/fees/receipt/ReceiptStyles";

const TYPE_LABELS: Record<string, string> = {
  admission:  "Admission Fee",
  membership: "Package Fee",
};

const PAYMENT_SELECT = `
  *,
  collector:system_users!fee_payments_collected_by_fkey(full_name)
`;

function parseDiscount(note: string | null) {
  const match = note?.match(/Discount: (Rs [\d,]+) \((\d+)% off original (Rs [\d,]+)\)/);
  return {
    discountAmt: match ? match[1] : null,
    discountPct: match ? match[2] : null,
    originalAmt: match ? match[3] : null,
    plainNote: note && !match ? note : null,
  };
}

export default async function RegistrationReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<{ admission?: string; membership?: string }>;
}) {
  const { memberId } = await params;
  const { admission, membership } = await searchParams;

  if (!admission && !membership) notFound();

  const supabase = await createClient();

  // Each fee type (admission, membership) is its own receipt_no group — a
  // payment split across methods (Cash + Bank) produces multiple rows
  // sharing that type's receipt_no, so expand from the anchor id to every
  // row in its group rather than assuming one row per type.
  async function fetchGroup(anchorId?: string) {
    if (!anchorId) return [];
    const { data: anchor } = await supabase.from("fee_payments").select(PAYMENT_SELECT).eq("id", anchorId).is("deleted_at", null).maybeSingle();
    if (!anchor) return [];
    if (!anchor.receipt_no) return [anchor];
    const { data: groupRows } = await supabase
      .from("fee_payments")
      .select(PAYMENT_SELECT)
      .eq("receipt_no", anchor.receipt_no)
      .eq("member_id", anchor.member_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
    return groupRows && groupRows.length > 0 ? groupRows : [anchor];
  }

  const [{ data: member }, admissionRows, membershipRows] = await Promise.all([
    supabase
      .from("members")
      .select("full_name, membership_no, phone, packages(name, type)")
      .eq("id", memberId)
      .single(),
    fetchGroup(admission),
    fetchGroup(membership),
  ]);

  if (!member) notFound();

  const groups = [
    { type: "admission", rows: admissionRows },
    { type: "membership", rows: membershipRows },
  ].filter((g) => g.rows.length > 0);
  if (groups.length === 0) notFound();

  const pkg = (member as any).packages;
  const grandTotal = groups.reduce((sum, g) => sum + g.rows.reduce((s, r) => s + (r.amount ?? 0), 0), 0);
  const latestDate = groups[0]?.rows[0]?.payment_date;
  const receiptNo = groups[0]?.rows[0]?.receipt_no ?? `RCP-${(groups[0]?.rows[0]?.id as string).slice(-6).toUpperCase()}`;

  return (
    <>
      <ReceiptStyles />

      <div className="screen-wrap">
        <div className="actions-bar no-print">
          <Link href={`/dashboard/members/${memberId}`} className="back-link">
            <ArrowLeft className="w-4 h-4" />
            Back to Member
          </Link>
          <PrintButton />
        </div>

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
              <p className="receipt-no-label">Receipt No</p>
              <p className="receipt-no-value">{receiptNo}</p>
            </div>
            <div>
              <p className="date-label">Date</p>
              <p className="date-value">{formatDate(latestDate)}</p>
            </div>
          </div>

          <div className="section">
            <p className="section-title">Member Details</p>
            <div className="row">
              <span className="row-label">Member Name</span>
              <span className="row-value">{member.full_name}</span>
            </div>
            <div className="row">
              <span className="row-label">Membership No</span>
              <span className="row-value mono">{member.membership_no}</span>
            </div>
            {member.phone && (
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

          {groups.map((group) => {
            const noteSource = group.rows.find((r) => r.note)?.note ?? null;
            const { discountAmt, discountPct, originalAmt, plainNote } = parseDiscount(noteSource);
            const packageBreakdown = group.rows.find((r) => r.package_breakdown)?.package_breakdown as
              | { name: string; original: number; discount_amount: number; final: number }[]
              | undefined;
            const collector = group.rows[0]?.collector;
            const subtotal = group.rows.reduce((s, r) => s + (r.amount ?? 0), 0);
            const balanceRow = group.rows.find((r) => (r.balance_due ?? 0) > 0);
            return (
              <div className="section" key={group.type}>
                <p className="section-title">{TYPE_LABELS[group.type] ?? group.type}</p>
                {/* Package Payment with a structured per-package discount
                    breakdown renders one line per package; everything else
                    (Admission, or historical rows with no breakdown) falls
                    back to the single original/discount display below. */}
                {packageBreakdown && packageBreakdown.length > 0 && (
                  <>
                    {packageBreakdown.map((p, i) => (
                      <div className="row" key={i}>
                        <span className="row-label">{p.name}{p.discount_amount > 0 ? ` (− ${formatPKR(p.discount_amount)})` : ""}</span>
                        <span className="row-value">{formatPKR(p.final)}</span>
                      </div>
                    ))}
                  </>
                )}
                {group.rows.map((r) => (
                  <div className="row" key={r.id}>
                    <span className="row-label">Payment Method{group.rows.length > 1 ? ` (${r.payment_method ?? "—"})` : ""}</span>
                    <span className="row-value">{group.rows.length > 1 ? formatPKR(r.amount) : (r.payment_method ?? "—")}</span>
                  </div>
                ))}
                {collector?.full_name && (
                  <div className="row">
                    <span className="row-label">Collected by</span>
                    <span className="row-value">{collector.full_name}</span>
                  </div>
                )}
                {plainNote && !packageBreakdown && (
                  <div className="row">
                    <span className="row-label">Note</span>
                    <span className="row-value" style={{ color: "#4A4A44", fontWeight: 400 }}>{plainNote}</span>
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
                <div className="row" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #E4E4DE" }}>
                  <span className="row-label">Subtotal</span>
                  <span className="row-value">{formatPKR(subtotal)}</span>
                </div>
                {balanceRow && (
                  <div className="row">
                    <span className="row-label" style={{ color: "#C04E10", fontWeight: 700 }}>
                      Balance Due{balanceRow.balance_due_date ? ` (by ${formatDate(balanceRow.balance_due_date)})` : ""}
                    </span>
                    <span className="row-value" style={{ color: "#C04E10" }}>{formatPKR(balanceRow.balance_due)}</span>
                  </div>
                )}
              </div>
            );
          })}

          <div className="section">
            <div className="total-row">
              <span className="total-label">Total Paid</span>
              <span className="total-amount">{formatPKR(grandTotal)}</span>
            </div>
          </div>

          <div className="receipt-footer">
            <p className="footer-text">Thank you for choosing Level Up Fitness Club!</p>
            <p className="footer-id">{memberId}</p>
          </div>
        </div>

        <div className="print-link-wrap no-print">
          <PrintButton variant="link" />
        </div>
      </div>
    </>
  );
}
