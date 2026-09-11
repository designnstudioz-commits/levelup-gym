"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, RefreshCw, Receipt, Paperclip, Pencil, Check, X as XIcon, MessageSquareWarning } from "lucide-react";
import { useCurrentUser } from "@/contexts/CurrentUserContext";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatPKR, formatDate } from "@/lib/utils";
import { EXPENSE_CATEGORIES, EXPENSE_STATUS_LABELS, expenseCategoryLabel, type ExpenseStatus } from "@/lib/pos/healthboxExpenses";

interface ExpenseRow {
  id: string; expense_date: string; category: string; title: string; description: string | null;
  amount: number; attachment_urls: string[] | null; status: ExpenseStatus;
  submitted_by: string; approved_by: string | null; approved_at: string | null;
  rejection_reason: string | null; management_note: string | null;
  submittedByName: string; approvedByName: string | null;
}

const STATUS_BADGE: Record<ExpenseStatus, "pending" | "active" | "rejected" | "partial"> = {
  pending: "pending", approved: "active", rejected: "rejected", needs_correction: "partial",
};

const emptyForm = { id: "", expenseDate: new Date().toISOString().slice(0, 10), category: "cogs", title: "", description: "", amount: "" };

export default function HealthBoxExpensesPage() {
  useRoleGuard(["owner", "manager", "healthbox_staff"]);
  const currentUser = useCurrentUser();
  const isManager = currentUser?.role === "owner" || currentUser?.role === "manager";

  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const [decisionTarget, setDecisionTarget] = useState<ExpenseRow | null>(null);
  const [decisionAction, setDecisionAction] = useState<"approve" | "reject" | "needs_correction" | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [decisionSaving, setDecisionSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      const res = await fetch(`/api/pos/healthbox/expenses?${params.toString()}`);
      const json = await res.json();
      setExpenses(json.expenses ?? []);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter]);

  useEffect(() => { void load(); }, [load]);

  function openAdd() { setForm(emptyForm); setFile(null); setModalOpen(true); }
  function openEdit(e: ExpenseRow) {
    setForm({ id: e.id, expenseDate: e.expense_date, category: e.category, title: e.title, description: e.description ?? "", amount: String(e.amount) });
    setFile(null);
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.title.trim() || !form.amount) { toast.error("Title and amount are required"); return; }
    setSaving(true);
    try {
      const payload = {
        expenseDate: form.expenseDate, category: form.category, title: form.title.trim(),
        description: form.description || null, amount: Number(form.amount),
      };
      const url = form.id ? `/api/pos/healthbox/expenses/${form.id}` : "/api/pos/healthbox/expenses";
      const res = await fetch(url, {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save the expense");
      const expenseId = form.id || json.id;

      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        if (form.id) fd.append("replace", "false");
        const upRes = await fetch(`/api/pos/healthbox/expenses/${expenseId}/receipt`, { method: "POST", body: fd });
        const upJson = await upRes.json();
        if (!upRes.ok) toast.error(upJson.error ?? "Expense saved, but the receipt upload failed");
      }

      toast.success(form.id ? "Expense updated" : "Expense submitted");
      setModalOpen(false);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the expense");
    } finally {
      setSaving(false);
    }
  }

  async function viewReceipt(expenseId: string, path: string) {
    const res = await fetch(`/api/pos/healthbox/expenses/${expenseId}/receipt-url?path=${encodeURIComponent(path)}`);
    const json = await res.json();
    if (!res.ok) { toast.error(json.error ?? "Could not open this receipt"); return; }
    window.open(json.url, "_blank", "noopener,noreferrer");
  }

  function openDecision(e: ExpenseRow, action: "approve" | "reject" | "needs_correction") {
    setDecisionTarget(e);
    setDecisionAction(action);
    setDecisionNote("");
  }

  async function submitDecision() {
    if (!decisionTarget || !decisionAction) return;
    if (decisionAction === "reject" && !decisionNote.trim()) { toast.error("A reason is required to reject"); return; }
    if (decisionAction === "needs_correction" && !decisionNote.trim()) { toast.error("A note is required so the submitter knows what to fix"); return; }
    setDecisionSaving(true);
    try {
      const res = await fetch(`/api/pos/healthbox/expenses/${decisionTarget.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: decisionAction,
          rejectionReason: decisionAction === "reject" ? decisionNote : undefined,
          managementNote: decisionAction !== "reject" ? decisionNote || undefined : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not record the decision");
      toast.success(decisionAction === "approve" ? "Expense approved" : decisionAction === "reject" ? "Expense rejected" : "Correction requested");
      setDecisionTarget(null);
      setDecisionAction(null);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the decision");
    } finally {
      setDecisionSaving(false);
    }
  }

  const editable = (e: ExpenseRow) => (e.status === "pending" || e.status === "needs_correction") && (isManager || e.submitted_by === currentUser?.id);

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title={isManager ? "HealthBox Expense Approvals" : "HealthBox Expenses"}
        subtitle={isManager ? "Review, approve or reject HealthBox expense claims" : "Submit and track your HealthBox expense claims"}
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</Button>
            <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" /> Add Expense</Button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="sm:w-56">
            <option value="all">All statuses</option>
            {Object.entries(EXPENSE_STATUS_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </Select>
          <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="sm:w-64">
            <option value="all">All categories</option>
            {EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </div>

        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E4E4DE] text-left text-xs font-semibold text-[#7A7A72] uppercase tracking-wide">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Title</th>
                  {isManager && <th className="px-4 py-3">Submitted By</th>}
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Receipt</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-[#7A7A72]">Loading…</td></tr>
                ) : expenses.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-14 text-center text-[#7A7A72]"><Receipt className="w-8 h-8 mx-auto text-[#CFCEC6] mb-2" />No expenses yet.</td></tr>
                ) : (
                  expenses.map((e) => (
                    <tr key={e.id} className="border-b border-[#E4E4DE] last:border-0 align-top">
                      <td className="px-4 py-3 whitespace-nowrap text-[#4A4A44]">{formatDate(e.expense_date)}</td>
                      <td className="px-4 py-3 text-[#4A4A44]">{expenseCategoryLabel(e.category)}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#1A1A16]">{e.title}</p>
                        {e.description && <p className="text-xs text-[#7A7A72] mt-0.5">{e.description}</p>}
                        {e.status === "rejected" && e.rejection_reason && (
                          <p className="text-xs text-red-600 mt-1">Rejected: {e.rejection_reason}</p>
                        )}
                        {e.status === "needs_correction" && e.management_note && (
                          <p className="text-xs text-amber-700 mt-1 flex items-start gap-1"><MessageSquareWarning className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {e.management_note}</p>
                        )}
                        {e.status === "approved" && e.management_note && (
                          <p className="text-xs text-[#7A7A72] mt-1">Note: {e.management_note}</p>
                        )}
                      </td>
                      {isManager && <td className="px-4 py-3 text-[#4A4A44]">{e.submittedByName}</td>}
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{formatPKR(e.amount)}</td>
                      <td className="px-4 py-3">
                        {Array.isArray(e.attachment_urls) && e.attachment_urls.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {e.attachment_urls.map((p, i) => (
                              <button key={p} type="button" onClick={() => void viewReceipt(e.id, p)} className="text-xs text-[#F06418] hover:underline flex items-center gap-1">
                                <Paperclip className="w-3 h-3" /> Receipt {e.attachment_urls!.length > 1 ? i + 1 : ""}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-[#7A7A72]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3"><Badge variant={STATUS_BADGE[e.status]}>{EXPENSE_STATUS_LABELS[e.status]}</Badge></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          {editable(e) && (
                            <button onClick={() => openEdit(e)} className="p-2 rounded-lg text-[#4A4A44] hover:bg-[#F7F6F3]" title="Edit"><Pencil className="w-4 h-4" /></button>
                          )}
                          {isManager && (e.status === "pending" || e.status === "needs_correction") && (
                            <>
                              <button onClick={() => openDecision(e, "approve")} className="p-2 rounded-lg text-green-700 hover:bg-green-50" title="Approve"><Check className="w-4 h-4" /></button>
                              <button onClick={() => openDecision(e, "needs_correction")} className="p-2 rounded-lg text-amber-700 hover:bg-amber-50" title="Request Correction"><MessageSquareWarning className="w-4 h-4" /></button>
                              <button onClick={() => openDecision(e, "reject")} className="p-2 rounded-lg text-red-600 hover:bg-red-50" title="Reject"><XIcon className="w-4 h-4" /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Add / Edit */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? "Edit Expense" : "Add HealthBox Expense"} size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Expense Date" type="date" required value={form.expenseDate} onChange={(e) => setForm((f) => ({ ...f, expenseDate: e.target.value }))} />
            <Select label="Category" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </div>
          <Input label="Title" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          <Input label="Description (optional)" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          <Input label="Amount (Rs)" type="number" required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          <div>
            <label className="block text-xs font-medium text-[#4A4A44] mb-1">Receipt / Proof (optional)</label>
            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleSave()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </Modal>

      {/* Decision */}
      <Modal open={decisionTarget != null} onClose={() => { setDecisionTarget(null); setDecisionAction(null); }} title={decisionAction === "approve" ? "Approve Expense" : decisionAction === "reject" ? "Reject Expense" : "Request Correction"} size="sm">
        {decisionTarget && (
          <div className="space-y-4">
            <p className="text-sm text-[#4A4A44]">{decisionTarget.title} — {formatPKR(decisionTarget.amount)}</p>
            {decisionAction !== "approve" ? (
              <Input label={decisionAction === "reject" ? "Reason (required)" : "What needs to be corrected? (required)"} required value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} />
            ) : (
              <Input label="Note (optional)" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} />
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => { setDecisionTarget(null); setDecisionAction(null); }}>Cancel</Button>
              <Button onClick={() => void submitDecision()} disabled={decisionSaving}>{decisionSaving ? "Saving…" : "Confirm"}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
