"use client";

import { useEffect, useState, useCallback } from "react";
import { format, startOfMonth } from "date-fns";
import {
  Wallet, TrendingUp, Receipt, Plus, Search, RefreshCw,
  Calendar, Pencil, Ban, FileText, ChevronLeft, ChevronRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/contexts/CurrentUserContext";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { StatsCard } from "@/components/ui/StatsCard";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatPKR, formatDate, safeDateValue } from "@/lib/utils";
import { calcGymProfit } from "@/lib/finance";
import {
  EXPENSE_CATEGORIES, expenseCategoryLabel, EXPENSE_VIEW_ROLES,
  EXPENSE_VOID_ROLES, canEditExpense, type ExpenseRow,
} from "@/lib/expenses";
import { toast } from "sonner";

const PAYMENT_METHODS = ["Cash", "Bank", "Card", "EasyPaisa", "JazzCash"];
const PAGE_SIZE = 25;

type RangeKey = "today" | "month" | "custom";

const EMPTY_FORM = {
  expense_date: format(new Date(), "yyyy-MM-dd"),
  title: "",
  expense_head: "",
  amount: "",
  payment_method: "Cash",
  paid_to: "",
  note: "",
  receipt_path: "",
};

export default function ExpensesPage() {
  useRoleGuard(EXPENSE_VIEW_ROLES);
  const currentUser = useCurrentUser();

  const [range, setRange] = useState<RangeKey>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [feesCollected, setFeesCollected] = useState(0);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  function bounds(): { from: string; to: string } {
    const today = format(new Date(), "yyyy-MM-dd");
    if (range === "today") return { from: today, to: today };
    if (range === "custom" && customFrom && customTo) return { from: customFrom, to: customTo };
    return { from: format(startOfMonth(new Date()), "yyyy-MM-dd"), to: today };
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { from, to } = bounds();
    const supabase = createClient();

    // Fees come from the rows the rest of the app already uses — this page
    // never recomputes membership revenue, it only sums what fee collection
    // has already recorded. Walk-ins are included because the Revenue report
    // counts them too (see src/lib/finance.ts).
    const [{ data: exp }, { data: pays }, { data: walkIns }, { data: users }] = await Promise.all([
      supabase.from("expenses")
        .select("id, expense_date, title, expense_head, amount, payment_method, paid_to, note, receipt_path, added_by, created_at, updated_at, deleted_at")
        .is("deleted_at", null)
        .gte("expense_date", from).lte("expense_date", to)
        .order("expense_date", { ascending: false }),
      supabase.from("fee_payments").select("amount")
        .is("deleted_at", null)
        .gte("payment_date", from).lte("payment_date", to),
      supabase.from("daily_members").select("fee_paid")
        .is("deleted_at", null)
        .gte("visit_date", from).lte("visit_date", to),
      supabase.from("system_users").select("id, full_name"),
    ]);

    const rows = (exp ?? []) as ExpenseRow[];
    setExpenses(rows);
    const { feesCollected } = calcGymProfit({ feePayments: pays ?? [], walkIns: walkIns ?? [], expenses: [] });
    setFeesCollected(feesCollected);
    setUserNames(Object.fromEntries((users ?? []).map((u: { id: string; full_name: string }) => [u.id, u.full_name])));
    setLoading(false);
  }, [range, customFrom, customTo]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { setPage(1); }, [search, category, range, customFrom, customTo]);

  const filtered = expenses.filter((e) => {
    if (category !== "all" && e.expense_head !== category) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.title?.toLowerCase().includes(q) ||
      e.paid_to?.toLowerCase().includes(q) ||
      e.note?.toLowerCase().includes(q)
    );
  });

  // Cards always describe the SELECTED PERIOD, and Total Expenses reflects
  // the category filter too, so the number under the table and the card can
  // never disagree with what is actually listed.
  const { totalExpenses, netProfit } = calcGymProfit({
    feePayments: [], walkIns: [], expenses: filtered,
  });
  const net = feesCollected - totalExpenses;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const role = currentUser?.role;
  const canVoid = !!role && EXPENSE_VOID_ROLES.includes(role);

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setModalOpen(true);
  }

  function openEdit(e: ExpenseRow) {
    setEditing(e);
    setForm({
      expense_date: e.expense_date,
      title: e.title ?? "",
      expense_head: e.expense_head ?? "",
      amount: String(e.amount ?? ""),
      payment_method: e.payment_method ?? "Cash",
      paid_to: e.paid_to ?? "",
      note: e.note ?? "",
      receipt_path: e.receipt_path ?? "",
    });
    setModalOpen(true);
  }

  async function handleReceipt(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/expenses/receipt", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "Upload failed"); return; }
      setForm((f) => ({ ...f, receipt_path: json.path }));
      toast.success("Receipt attached");
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!form.expense_date || !form.title.trim() || !form.expense_head || !form.amount || !form.payment_method) {
      toast.error("Date, name, category, amount and payment method are required");
      return;
    }
    if (Number(form.amount) <= 0) { toast.error("Amount must be greater than 0"); return; }

    setSaving(true);
    try {
      const url = editing ? `/api/expenses/${editing.id}` : "/api/expenses";
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, amount: Number(form.amount) }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "Could not save expense"); return; }
      toast.success(editing ? "Expense updated" : "Expense recorded");
      setModalOpen(false);
      await fetchData();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function voidExpense(e: ExpenseRow) {
    const reason = prompt(`Void "${e.title}" (${formatPKR(e.amount)})?\n\nThis removes it from all totals. The record is kept for audit.\n\nReason (optional):`);
    if (reason === null) return;
    const res = await fetch(`/api/expenses/${e.id}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const json = await res.json();
    if (!res.ok) { toast.error(json.error ?? "Could not void expense"); return; }
    toast.success("Expense voided");
    await fetchData();
  }

  async function openReceipt(path: string) {
    const res = await fetch(`/api/expenses/receipt?path=${encodeURIComponent(path)}`);
    const json = await res.json();
    if (!res.ok) { toast.error(json.error ?? "Could not open receipt"); return; }
    window.open(json.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Expenses"
        subtitle="Track gym operating costs and see what remains after expenses."
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={fetchData}><RefreshCw className="w-4 h-4" /></Button>
            <Button onClick={openAdd}><Plus className="w-4 h-4" /> Add Expense</Button>
          </div>
        }
      />

      <div className="flex-1 p-6 space-y-5">
        {/* ── Summary ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatsCard title="Fees Collected" value={formatPKR(feesCollected)} icon={TrendingUp}
            iconColor="text-green-600" iconBg="bg-green-50" loading={loading} />
          <StatsCard title="Total Expenses" value={formatPKR(totalExpenses)} icon={Receipt}
            iconColor="text-[#F06418]" iconBg="bg-[#FEF0E8]" loading={loading} />
          <StatsCard title="Net Profit" value={formatPKR(net)} icon={Wallet}
            iconColor={net >= 0 ? "text-green-600" : "text-red-600"}
            iconBg={net >= 0 ? "bg-green-50" : "bg-red-50"} loading={loading} />
        </div>

        {/* ── Filters ─────────────────────────────────────────────── */}
        <div className="bg-white border border-[#E4E4DE] rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg p-0.5 gap-0.5">
              {([["today", "Today"], ["month", "This Month"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setRange(k)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${range === k ? "bg-[#F06418] text-white" : "text-[#4A4A44] hover:bg-white"}`}
                >{label}</button>
              ))}
              <button onClick={() => setRange("custom")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${range === "custom" ? "bg-[#F06418] text-white" : "text-[#4A4A44] hover:bg-white"}`}
              ><Calendar className="w-3 h-3" /> Custom</button>
            </div>

            {range === "custom" && (
              <div className="flex items-center gap-2">
                <input type="date" value={customFrom} min="1900-01-01" max="2099-12-31"
                  onChange={(e) => { const v = safeDateValue(e.target.value); if (v !== null) setCustomFrom(v); }}
                  className="text-xs px-3 py-1.5 rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
                <span className="text-xs text-[#7A7A72]">to</span>
                <input type="date" value={customTo} min="1900-01-01" max="2099-12-31"
                  onChange={(e) => { const v = safeDateValue(e.target.value); if (v !== null) setCustomTo(v); }}
                  className="text-xs px-3 py-1.5 rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
              </div>
            )}

            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="text-xs px-3 py-1.5 rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]">
              <option value="all">All Categories</option>
              {EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>

            <div className="flex-1 min-w-40 max-w-sm relative">
              <Search className="w-4 h-4 text-[#7A7A72] absolute left-3 top-1/2 -translate-y-1/2" />
              <input type="text" placeholder="Search expense, paid to, notes..." value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
            </div>

            <span className="text-xs text-[#7A7A72] ml-auto">
              Total Expenses: <span className="font-semibold text-[#1A1A16]">{formatPKR(totalExpenses)}</span>
              {" · "}{filtered.length} record{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* ── Table ───────────────────────────────────────────────── */}
        {loading ? (
          <div className="py-16 text-center">
            <RefreshCw className="w-6 h-6 text-[#7A7A72] animate-spin mx-auto mb-2" />
            <p className="text-sm text-[#7A7A72]">Loading expenses...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-14 h-14 bg-[#FEF0E8] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Receipt className="w-7 h-7 text-[#F06418]" />
            </div>
            <p className="text-base font-semibold text-[#1A1A16]">No expenses recorded for this period</p>
            <p className="text-sm text-[#7A7A72] mt-1">Add rent, utilities, salaries and other running costs to see net profit.</p>
            <Button className="mt-4" onClick={openAdd}><Plus className="w-4 h-4" /> Add Expense</Button>
          </div>
        ) : (
          <Card padding={false}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#F8F8F6] border-b border-[#E4E4DE]">
                  <tr>
                    {["Date", "Expense", "Category", "Paid To", "Method", "Amount", "Added By", ""].map((h, i) => (
                      <th key={h || i} className={`text-xs font-semibold text-[#7A7A72] px-4 py-3 ${h === "Amount" ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E4DE]">
                  {paginated.map((e) => {
                    const mayEdit = !!role && canEditExpense(role, currentUser?.id ?? "", e.added_by);
                    return (
                      <tr key={e.id} className="hover:bg-[#F8F8F6] transition-colors">
                        <td className="px-4 py-3 text-sm text-[#1A1A16] whitespace-nowrap">{formatDate(e.expense_date)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-[#1A1A16]">{e.title}</span>
                            {e.receipt_path && (
                              <button onClick={() => openReceipt(e.receipt_path!)} title="View receipt"
                                className="p-1 rounded text-[#7A7A72] hover:text-[#F06418] hover:bg-[#FEF0E8] transition-colors">
                                <FileText className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          {e.note && <p className="text-xs text-[#7A7A72] mt-0.5 truncate max-w-xs">{e.note}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-medium px-2 py-1 rounded-full bg-[#F8F8F6] border border-[#E4E4DE] text-[#4A4A44] whitespace-nowrap">
                            {expenseCategoryLabel(e.expense_head)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-[#4A4A44]">{e.paid_to || "—"}</td>
                        <td className="px-4 py-3 text-sm text-[#4A4A44]">{e.payment_method || "—"}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-[#1A1A16] text-right whitespace-nowrap">{formatPKR(e.amount)}</td>
                        <td className="px-4 py-3 text-xs text-[#7A7A72]">{e.added_by ? (userNames[e.added_by] ?? "—") : "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            {mayEdit && (
                              <button onClick={() => openEdit(e)} title="Edit"
                                className="p-1.5 rounded-lg text-[#7A7A72] hover:text-[#F06418] hover:bg-[#FEF0E8] transition-colors">
                                <Pencil className="w-4 h-4" />
                              </button>
                            )}
                            {canVoid && (
                              <button onClick={() => voidExpense(e)} title="Void expense"
                                className="p-1.5 rounded-lg text-[#7A7A72] hover:text-red-600 hover:bg-red-50 transition-colors">
                                <Ban className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-[#E4E4DE]">
                <span className="text-xs text-[#7A7A72]">
                  {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}
                    className="p-1.5 rounded-lg text-[#4A4A44] hover:bg-[#F8F8F6] disabled:opacity-40 disabled:cursor-not-allowed">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-[#4A4A44] px-2">Page {safePage} of {totalPages}</span>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
                    className="p-1.5 rounded-lg text-[#4A4A44] hover:bg-[#F8F8F6] disabled:opacity-40 disabled:cursor-not-allowed">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* ── Add / Edit ────────────────────────────────────────────── */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editing ? "Edit Expense" : "Add Expense"} size="md">
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Expense Date" type="date" required value={form.expense_date}
              min="1900-01-01" max="2099-12-31"
              onChange={(e) => { const v = safeDateValue(e.target.value); if (v !== null) setForm({ ...form, expense_date: v }); }} />
            <Input label="Amount (Rs)" type="number" required min="1" step="0.01" value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>

          <Input label="Expense Name" required placeholder="e.g. Electricity Bill" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} />

          <div className="grid grid-cols-2 gap-4">
            <Select label="Category" required value={form.expense_head}
              onChange={(e) => setForm({ ...form, expense_head: e.target.value })}>
              <option value="">Select category</option>
              {EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
            <Select label="Payment Method" required value={form.payment_method}
              onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </div>

          <Input label="Paid To (optional)" placeholder="e.g. WAPDA" value={form.paid_to}
            onChange={(e) => setForm({ ...form, paid_to: e.target.value })} />

          <div>
            <label className="text-sm font-medium text-[#1A1A16] block mb-1.5">Notes (optional)</label>
            <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
          </div>

          <div>
            <label className="text-sm font-medium text-[#1A1A16] block mb-1.5">Receipt (optional)</label>
            {form.receipt_path ? (
              <div className="flex items-center gap-2 text-sm">
                <FileText className="w-4 h-4 text-green-600" />
                <span className="text-green-700 font-medium">Receipt attached</span>
                <button onClick={() => setForm({ ...form, receipt_path: "" })}
                  className="text-xs text-[#7A7A72] hover:text-red-600 underline">remove</button>
              </div>
            ) : (
              <input type="file" accept="image/*,application/pdf" disabled={uploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleReceipt(f); }}
                className="block w-full text-sm text-[#4A4A44] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-[#E4E4DE] file:text-sm file:bg-[#F8F8F6] file:text-[#1A1A16] hover:file:bg-[#FEF0E8]" />
            )}
            {uploading && <p className="text-xs text-[#7A7A72] mt-1">Uploading…</p>}
          </div>

          <div className="flex gap-3 pt-1">
            <Button variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">Cancel</Button>
            <Button onClick={save} loading={saving} className="flex-1">
              {editing ? "Save Changes" : "Add Expense"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
