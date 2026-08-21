"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/contexts/CurrentUserContext";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { formatDate, formatDateTime, formatPKR, describeCoveredPeriod, safeDateValue } from "@/lib/utils";
import Link from "next/link";

interface Row {
  id: string;
  member_id: string;
  amount: number;
  payment_type: string | null;
  payment_method: string | null;
  payment_date: string;
  coverage_start: string | null;
  coverage_end: string | null;
  months_covered: number | null;
  month_covered: string | null;
  receipt_no: string | null;
  note: string | null;
  balance_due: number;
  balance_due_date: string | null;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  membership: "Monthly Membership", trainer: "Trainer / Coaching Fee", admission: "Admission Fee",
  nutritionist: "Nutritionist Fee", physiotherapy: "Physiotherapy Fee", other: "Other",
};

/** Shared read/edit view of one logical payment transaction (every
 *  fee_payments row sharing one receipt_no) — used from both the Fees
 *  Payments table and a member profile's Payment History. Separates
 *  TRANSACTION / COVERAGE / BALANCE exactly as the redesigned Finance UX
 *  calls for, and is the one place Collection Date can be backdated
 *  independently of Coverage Period. */
export function PaymentDetailModal({ paymentId, onClose, onUpdated }: {
  paymentId: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const currentUser = useCurrentUser();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [member, setMember] = useState<{ full_name: string; membership_no: string; expiry_date: string | null } | null>(null);
  const [packageName, setPackageName] = useState<string | null>(null);
  const [collectorName, setCollectorName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editCoverageStart, setEditCoverageStart] = useState("");
  const [editCoverageEnd, setEditCoverageEnd] = useState("");
  const [confirmCoverageChange, setConfirmCoverageChange] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: anchor } = await supabase.from("fee_payments").select("*").eq("id", paymentId).is("deleted_at", null).single();
      if (!anchor) { setLoading(false); return; }

      let group: Row[] = [anchor as unknown as Row];
      if (anchor.receipt_no) {
        const { data: groupRows } = await supabase
          .from("fee_payments").select("*")
          .eq("receipt_no", anchor.receipt_no).eq("member_id", anchor.member_id)
          .is("deleted_at", null).order("created_at", { ascending: true });
        if (groupRows && groupRows.length > 0) group = groupRows as unknown as Row[];
      }
      setRows(group);

      const [{ data: mem }, { data: collector }] = await Promise.all([
        supabase.from("members").select("full_name, membership_no, expiry_date, packages(name)").eq("id", anchor.member_id).single(),
        anchor.collected_by
          ? supabase.from("system_users").select("full_name").eq("id", anchor.collected_by).single()
          : Promise.resolve({ data: null }),
      ]);
      if (mem) { setMember(mem as any); setPackageName((mem as any).packages?.name ?? null); }
      setCollectorName(collector?.full_name ?? null);
      setLoading(false);
    })();
  }, [paymentId]);

  function startEdit() {
    if (!rows) return;
    const anchor = rows[0];
    setEditDate(anchor.payment_date);
    setEditCoverageStart(anchor.coverage_start ?? "");
    setEditCoverageEnd(anchor.coverage_end ?? "");
    setConfirmCoverageChange(false);
    setEditing(true);
  }

  async function saveEdit(force = false) {
    if (!rows) return;
    const anchor = rows[0];
    const coverageChanged = editCoverageStart !== (anchor.coverage_start ?? "") || editCoverageEnd !== (anchor.coverage_end ?? "");
    if (coverageChanged && !force) { setConfirmCoverageChange(true); return; }

    setSaving(true);
    const supabase = createClient();
    const ids = rows.map((r) => r.id);

    // Collection Date is when the money was received — true of the whole
    // transaction, so every row in the split-method group is kept in sync.
    const { error: dateErr } = await supabase.from("fee_payments").update({ payment_date: editDate }).in("id", ids);
    // Coverage fields follow the first-row-only convention.
    const { error: covErr } = await supabase.from("fee_payments").update({
      coverage_start: editCoverageStart || null,
      coverage_end: editCoverageEnd || null,
    }).eq("id", anchor.id);

    if (dateErr || covErr) {
      toast.error("Failed to update payment");
      setSaving(false);
      return;
    }

    await supabase.from("activity_logs").insert({
      user_id: currentUser?.id ?? null,
      action: "edited_payment", entity_type: "fee_payment", entity_id: anchor.id,
      description: `${member?.full_name ?? "Member"}'s payment ${anchor.receipt_no ?? anchor.id} — Collection Date${editDate !== anchor.payment_date ? ` changed to ${editDate}` : " unchanged"}${coverageChanged ? `, Coverage Period changed to ${editCoverageStart || "—"} – ${editCoverageEnd || "—"}` : ""}`,
      metadata: { receipt_no: anchor.receipt_no, old_payment_date: anchor.payment_date, new_payment_date: editDate, old_coverage_start: anchor.coverage_start, new_coverage_start: editCoverageStart, old_coverage_end: anchor.coverage_end, new_coverage_end: editCoverageEnd },
    });

    toast.success("Payment updated");
    setSaving(false);
    setEditing(false);
    setConfirmCoverageChange(false);
    onUpdated();
    // Refresh local view
    setRows(rows.map((r) => (r.id === anchor.id ? { ...r, payment_date: editDate, coverage_start: editCoverageStart || null, coverage_end: editCoverageEnd || null } : { ...r, payment_date: editDate })));
  }

  const anchor = rows?.[0];
  const totalPaid = rows?.reduce((s, r) => s + (r.amount ?? 0), 0) ?? 0;
  const balanceDue = anchor?.balance_due ?? 0;
  const totalDue = totalPaid + balanceDue;
  const coverage = anchor ? describeCoveredPeriod(anchor.coverage_start, anchor.coverage_end, anchor.month_covered, anchor.payment_date, anchor.months_covered) : { label: null, inferred: false };

  return (
    <Modal open onClose={onClose} title="Payment Detail" size="md">
      <div className="p-5 space-y-5">
        {loading ? (
          <div className="py-10 text-center text-sm text-[#7A7A72]">Loading…</div>
        ) : !rows || !anchor ? (
          <div className="py-10 text-center text-sm text-[#7A7A72]">Payment not found</div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-[#1A1A16]">{member?.full_name ?? "—"}</p>
                <p className="text-xs text-[#7A7A72]">{member?.membership_no ?? "—"}</p>
              </div>
              {!editing && (
                <button onClick={startEdit} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E4E4DE] text-xs font-semibold text-[#4A4A44] hover:border-[#F06418] hover:text-[#F06418] hover:bg-[#FEF0E8] transition-colors">
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
              )}
            </div>

            {editing ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-[#E4E4DE] p-4 space-y-3">
                  <p className="text-xs font-bold text-[#1A1A16] uppercase tracking-wide">Collection Date</p>
                  <input type="date" value={editDate} min="1900-01-01" max="2099-12-31"
                    onChange={(e) => { const v = safeDateValue(e.target.value); if (v) setEditDate(v); }}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
                  <p className="text-[11px] text-[#7A7A72]">When the money was actually received. Changing this only affects which day this payment appears under in reports/search — it never changes the Coverage Period or the member's membership expiry.</p>
                </div>

                <div className="rounded-xl border border-[#E4E4DE] p-4 space-y-3">
                  <p className="text-xs font-bold text-[#1A1A16] uppercase tracking-wide">Coverage Period</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-[#7A7A72] block mb-1">Start</label>
                      <input type="date" value={editCoverageStart} min="1900-01-01" max="2099-12-31"
                        onChange={(e) => { const v = safeDateValue(e.target.value); if (v !== null) setEditCoverageStart(v); }}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
                    </div>
                    <div>
                      <label className="text-xs text-[#7A7A72] block mb-1">End</label>
                      <input type="date" value={editCoverageEnd} min="1900-01-01" max="2099-12-31"
                        onChange={(e) => { const v = safeDateValue(e.target.value); if (v !== null) setEditCoverageEnd(v); }}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
                    </div>
                  </div>
                  <p className="text-[11px] text-[#7A7A72]">What period this payment pays for. Editing this does <strong>not</strong> automatically change the member's current membership expiry — update that separately on the member's profile if needed.</p>
                </div>

                {confirmCoverageChange && (
                  <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-amber-800">You're changing the Coverage Period</p>
                      <p className="text-xs text-amber-700 mt-0.5">
                        The member's current membership expiry{member?.expiry_date ? ` (${formatDate(member.expiry_date)})` : ""} will stay exactly as it is — this only changes what this payment record says it paid for. Continue?
                      </p>
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => saveEdit(true)} disabled={saving} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors disabled:opacity-60">
                          {saving ? "Saving…" : "Yes, Save Anyway"}
                        </button>
                        <button onClick={() => setConfirmCoverageChange(false)} className="px-3 py-1.5 rounded-lg border border-amber-300 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {!confirmCoverageChange && (
                  <div className="flex gap-3">
                    <Button variant="secondary" onClick={() => setEditing(false)} className="flex-1">Cancel</Button>
                    <Button onClick={() => saveEdit(false)} loading={saving} className="flex-1">Save Changes</Button>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* TRANSACTION */}
                <div>
                  <p className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide mb-2">Transaction</p>
                  <div className="rounded-xl border border-[#E4E4DE] divide-y divide-[#E4E4DE]">
                    <Field label="Receipt #" value={anchor.receipt_no ?? anchor.id.slice(-8).toUpperCase()} mono />
                    <Field label="Collection Date" value={formatDate(anchor.payment_date)} />
                    <Field label="Collected By" value={collectorName ?? "Not recorded"} />
                    {rows.map((r) => (
                      <Field key={r.id} label={rows.length > 1 ? `Method (${r.payment_method})` : "Payment Method"} value={formatPKR(r.amount)} />
                    ))}
                    <Field label="Total Paid" value={formatPKR(totalPaid)} strong />
                  </div>
                </div>

                {/* COVERAGE */}
                <div>
                  <p className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide mb-2">Coverage</p>
                  <div className="rounded-xl border border-[#E4E4DE] divide-y divide-[#E4E4DE]">
                    <Field label="Payment Type" value={TYPE_LABELS[anchor.payment_type ?? "other"] ?? anchor.payment_type ?? "—"} />
                    <Field label="Coverage Start" value={anchor.coverage_start ? formatDate(anchor.coverage_start) : "—"} />
                    <Field label="Coverage End" value={anchor.coverage_end ? formatDate(anchor.coverage_end) : "—"} />
                    <Field label="Number of Months" value={anchor.months_covered ? String(anchor.months_covered) : "—"} />
                    <Field label="Package" value={packageName ?? "—"} />
                  </div>
                  {coverage.inferred && (
                    <p className="text-[11px] text-[#7A7A72] mt-1.5 px-1">This is an older payment recorded before explicit coverage tracking — the period shown is inferred, not stored.</p>
                  )}
                </div>

                {/* BALANCE */}
                <div>
                  <p className="text-xs font-bold text-[#7A7A72] uppercase tracking-wide mb-2">Balance</p>
                  <div className="rounded-xl border border-[#E4E4DE] divide-y divide-[#E4E4DE]">
                    <Field label="Total Due" value={formatPKR(totalDue)} />
                    <Field label="Paid" value={formatPKR(totalPaid)} />
                    <Field label="Remaining" value={formatPKR(balanceDue)} highlight={balanceDue > 0} />
                    {balanceDue > 0 && <Field label="Due Date" value={anchor.balance_due_date ? formatDate(anchor.balance_due_date) : "—"} />}
                  </div>
                </div>

                {anchor.note && (
                  <div className="text-xs text-[#7A7A72] bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg px-3 py-2">{anchor.note}</div>
                )}

                <Link href={`/dashboard/fees/receipt/${anchor.id}`}>
                  <span className="block text-center text-xs font-semibold text-[#F06418] hover:underline">View Printable Receipt</span>
                </Link>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function Field({ label, value, mono, strong, highlight }: { label: string; value: string; mono?: boolean; strong?: boolean; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-xs text-[#7A7A72]">{label}</span>
      <span className={`text-sm ${mono ? "font-mono" : ""} ${strong ? "font-bold text-[#1A1A16]" : highlight ? "font-bold text-[#C04E10]" : "text-[#1A1A16]"}`}>{value}</span>
    </div>
  );
}
