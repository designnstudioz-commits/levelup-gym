import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPKR } from "@/lib/utils";
import { Printer, ArrowLeft } from "lucide-react";

export default async function ReceiptPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();

  const { data: payment } = await supabase
    .from("fee_payments")
    .select(`
      *,
      member:members!fee_payments_member_id_fkey(
        full_name, membership_no, phone,
        packages(name, type)
      ),
      collector:system_users!fee_payments_collected_by_fkey(full_name)
    `)
    .eq("id", params.id)
    .is("deleted_at", null)
    .single();

  if (!payment) notFound();

  const member = (payment as any).member;
  const pkg = member?.packages;
  const collector = (payment as any).collector;

  // Parse discount from note field if present
  const discountMatch = payment.note?.match(/Discount: (Rs [\d,]+) \((\d+)% off original (Rs [\d,]+)\)/);
  const discountAmount = discountMatch ? discountMatch[1] : null;
  const discountPct = discountMatch ? discountMatch[2] : null;
  const originalAmount = discountMatch ? discountMatch[3] : null;

  const typeLabels: Record<string, string> = {
    membership: "Monthly Membership",
    admission: "Admission Fee",
    trainer: "Trainer / Coaching Fee",
    other: "Other",
  };

  return (
    <>
      {/* Print-only styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .receipt-card {
            box-shadow: none !important;
            border: none !important;
            max-width: 100% !important;
          }
        }
        @page { margin: 1cm; size: A5; }
      `}</style>

      {/* Screen wrapper */}
      <div className="min-h-screen bg-[#F8F8F6] flex items-start justify-center pt-8 pb-16 px-4">
        <div className="w-full max-w-md">

          {/* Actions bar — hidden on print */}
          <div className="no-print flex items-center justify-between mb-5">
            <Link href="/dashboard/fees" className="flex items-center gap-1.5 text-sm text-[#4A4A44] hover:text-[#F06418] transition-colors">
              <ArrowLeft className="w-4 h-4" /> Back to Fees
            </Link>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-4 py-2 bg-[#F06418] text-white rounded-lg text-sm font-semibold hover:bg-[#C04E10] transition-colors"
            >
              <Printer className="w-4 h-4" /> Print Receipt
            </button>
          </div>

          {/* Receipt card */}
          <div className="receipt-card bg-white border border-[#E4E4DE] rounded-2xl overflow-hidden shadow-sm">

            {/* Header */}
            <div className="bg-[#111111] px-6 py-5 text-center">
              <img
                src="/logo.png"
                alt="Level Up Fitness Club"
                className="h-14 w-auto object-contain mx-auto mb-2"
              />
              <p className="text-white/60 text-xs">3rd Floor, High Street Mall, Paragon City, Lahore</p>
              <p className="text-white/60 text-xs mt-0.5">03000202902</p>
            </div>

            {/* Receipt header */}
            <div className="border-b border-dashed border-[#E4E4DE] px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide">Payment Receipt</p>
                <p className="text-xl font-bold text-[#F06418] mt-0.5">{payment.receipt_no ?? `RCP-${payment.id.slice(-6).toUpperCase()}`}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-[#7A7A72]">Date</p>
                <p className="text-sm font-semibold text-[#1A1A16]">{formatDate(payment.payment_date)}</p>
              </div>
            </div>

            {/* Member info */}
            <div className="border-b border-dashed border-[#E4E4DE] px-6 py-4">
              <p className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide mb-2">Member Details</p>
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-[#7A7A72]">Name</span>
                  <span className="font-semibold text-[#1A1A16]">{member?.full_name ?? "—"}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#7A7A72]">Membership No</span>
                  <span className="font-mono font-semibold text-[#F06418]">{member?.membership_no ?? "—"}</span>
                </div>
                {member?.phone && (
                  <div className="flex justify-between text-sm">
                    <span className="text-[#7A7A72]">Phone</span>
                    <span className="text-[#1A1A16]">{member.phone}</span>
                  </div>
                )}
                {pkg?.name && (
                  <div className="flex justify-between text-sm">
                    <span className="text-[#7A7A72]">Package</span>
                    <span className="text-[#1A1A16]">{pkg.name}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Payment breakdown */}
            <div className="border-b border-dashed border-[#E4E4DE] px-6 py-4">
              <p className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide mb-3">Payment Details</p>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-[#4A4A44]">
                    {typeLabels[payment.payment_type ?? "other"]}
                    {payment.month_covered && (
                      <span className="text-[#7A7A72] ml-1">({formatDate(payment.month_covered).split(" ").slice(1).join(" ")})</span>
                    )}
                  </span>
                  <span className="font-medium text-[#1A1A16]">
                    {formatPKR(originalAmount ? Number(originalAmount.replace(/[Rs ,]/g, "")) : payment.amount)}
                  </span>
                </div>

                {discountAmount && (
                  <div className="flex justify-between text-sm text-[#F06418]">
                    <span>Discount ({discountPct}%)</span>
                    <span className="font-medium">− {discountAmount}</span>
                  </div>
                )}
              </div>

              <div className="mt-3 pt-3 border-t border-[#E4E4DE] flex justify-between items-center">
                <span className="text-base font-bold text-[#1A1A16]">Total Paid</span>
                <span className="text-xl font-bold text-[#F06418]">{formatPKR(payment.amount)}</span>
              </div>
            </div>

            {/* Payment method + collector */}
            <div className="border-b border-dashed border-[#E4E4DE] px-6 py-4">
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-[#7A7A72]">Payment Method</span>
                <span className="font-semibold text-[#1A1A16]">{payment.payment_method ?? "—"}</span>
              </div>
              {collector?.full_name && (
                <div className="flex justify-between text-sm">
                  <span className="text-[#7A7A72]">Collected by</span>
                  <span className="font-semibold text-[#1A1A16]">{collector.full_name}</span>
                </div>
              )}
              {payment.note && !discountMatch && (
                <div className="mt-2">
                  <span className="text-xs text-[#7A7A72]">{payment.note}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 text-center">
              <p className="text-xs text-[#7A7A72]">Thank you for your payment!</p>
              <p className="text-[10px] text-[#7A7A72] mt-1 font-mono">{payment.id}</p>
            </div>
          </div>

          {/* Second print button at bottom */}
          <div className="no-print mt-4 text-center">
            <button
              onClick={() => window.print()}
              className="text-sm text-[#7A7A72] hover:text-[#F06418] transition-colors underline"
            >
              Print or Save as PDF
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
