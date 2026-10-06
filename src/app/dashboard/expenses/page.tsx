"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { format, startOfMonth, endOfMonth, addMonths, parseISO } from "date-fns";
import {
  Wallet, TrendingUp, Receipt, Plus, Search, RefreshCw, Settings2,
  Pencil, Ban, FileText, ChevronLeft, ChevronRight, HandCoins, History,
  ArrowDownToLine, ArrowUpFromLine, AlertTriangle,
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
import {
  EXPENSE_CATEGORIES, expenseCategoryLabel, EXPENSE_VIEW_ROLES,
  EXPENSE_VOID_ROLES, canEditExpense, expenseStatus, outstandingOn, paidAgainst,
  EXPENSE_STATUS_LABELS, isBackdated, billLiveAsOf, amountAsOf,
  type ExpenseBillRow, type ExpensePaymentRow, type ExpenseStatus, type ExpenseMonthSummary,
} from "@/lib/expenses";
import { toast } from "sonner";

const PAYMENT_METHODS = ["Cash", "Bank", "Card", "EasyPaisa", "JazzCash"];
const PAGE_SIZE = 25;

const STATUS_STYLES: Record<ExpenseStatus, string> = {
  unpaid:  "bg-red-50 text-red-700 border-red-200",
  partial: "bg-amber-50 text-amber-700 border-amber-200",
  paid:    "bg-green-50 text-green-700 border-green-200",
};

const emptyBillForm = () => ({
  expense_date: format(new Date(), "yyyy-MM-dd"),
  due_date: "",
  title: "",
  expense_head: "",
  amount: "",
  payment_method: "Cash",
  paid_to: "",
  note: "",
  receipt_path: "",
  is_opening_bill: false,
  // "Paid in full now" is the common counter case, so it defaults on for a
  // new bill. Unticking it is how an unpaid bill is entered.
  pay_now: true,
  pay_amount: "",
  pay_on: format(new Date(), "yyyy-MM-dd"),
  reason: "",
  amount_change_kind: "correction" as "correction" | "revision",
  amount_effective_from: "",
});

export default function ExpensesPage() {
  useRoleGuard(EXPENSE_VIEW_ROLES);
  const currentUser = useCurrentUser();

  // The whole page is scoped to ONE month, because carry-forward is only
  // meaningful per month: a range like "last 90 days" has no opening balance.
  const [month, setMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const monthStart = useMemo(() => `${month}-01`, [month]);
  const monthEnd = useMemo(() => format(endOfMonth(parseISO(`${month}-01`)), "yyyy-MM-dd"), [month]);

  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<"all" | ExpenseStatus>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [bills, setBills] = useState<ExpenseBillRow[]>([]);
  const [summary, setSummary] = useState<ExpenseMonthSummary | null>(null);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [billModal, setBillModal] = useState(false);
  const [editing, setEditing] = useState<ExpenseBillRow | null>(null);
  const [form, setForm] = useState(emptyBillForm());
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [payFor, setPayFor] = useState<ExpenseBillRow | null>(null);
  const [payForm, setPayForm] = useState({ amount: "", paid_on: "", payment_method: "Cash", reference: "", note: "" });
  const [payToken, setPayToken] = useState("");
  const [paying, setPaying] = useState(false);

  const [historyFor, setHistoryFor] = useState<ExpenseBillRow | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupForm, setSetupForm] = useState({ start_month: "", opening_funds: "" });
  const [savingSetup, setSavingSetup] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    // Bills raised up to the END of the viewed month, each with every payment
    // ever made against it. Later payments are needed even when viewing an
    // earlier month, because the payment history modal shows them — the
    // as-of-month-end cut is applied in the table maths, not in this query.
    const [{ data: billRows }, { data: users }, summaryRes] = await Promise.all([
      supabase.from("expenses")
        .select("id, expense_date, due_date, title, expense_head, amount, payment_method, paid_to, note, receipt_path, is_opening_bill, added_by, created_at, updated_at, deleted_at, payments:expense_payments(id, expense_id, amount, paid_on, payment_method, reference, note, receipt_path, added_by, created_at, deleted_at, deleted_by, void_reason), amount_history:expense_amount_history(id, expense_id, amount, effective_from, reason, changed_by, recorded_at)")
        .lte("expense_date", monthEnd)
        .order("expense_date", { ascending: false })
        .limit(2000),
      supabase.from("system_users").select("id, full_name"),
      fetch(`/api/expenses/summary?month=${month}`).then((r) => r.json()).catch(() => null),
    ]);

    setBills((billRows ?? []) as unknown as ExpenseBillRow[]);
    setUserNames(Object.fromEntries((users ?? []).map((u: { id: string; full_name: string }) => [u.id, u.full_name])));
    setSummary(summaryRes?.summary ?? null);
    setLoading(false);
  }, [month, monthEnd]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { setPage(1); }, [search, category, status, month]);

  // Which bills belong on this month's screen: those raised in the month,
  // plus anything still owed from an earlier month. That is what "keep old
  // unpaid bills visible until settled" means — the same bill row appears
  // again, it is never copied forward as a new record.
  const monthBills = useMemo(() => bills.filter((b) => {
    // A bill voided later was still real in this month, so liveness is judged
    // as at month end rather than by today's deleted_at.
    if (!billLiveAsOf(b, monthEnd)) return false;
    const raisedThisMonth = b.expense_date >= monthStart && b.expense_date <= monthEnd;
    if (raisedThisMonth) return true;
    return outstandingOn(b, monthEnd) > 0.005;
  }), [bills, monthStart, monthEnd]);

  const filtered = useMemo(() => monthBills.filter((b) => {
    if (category !== "all" && b.expense_head !== category) return false;
    if (status !== "all" && expenseStatus(b, monthEnd) !== status) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      b.title?.toLowerCase().includes(q) ||
      b.paid_to?.toLowerCase().includes(q) ||
      b.note?.toLowerCase().includes(q)
    );
  }), [monthBills, category, status, search, monthEnd]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const role = currentUser?.role;
  const canVoid = !!role && EXPENSE_VOID_ROLES.includes(role);
  const isCurrentMonth = month === format(new Date(), "yyyy-MM");

  function openAdd() {
    setEditing(null);
    const f = emptyBillForm();
    // A bill added while viewing a past month defaults to that month, which
    // is almost always what was meant.
    if (!isCurrentMonth) { f.expense_date = monthEnd; f.pay_on = monthEnd; }
    setForm(f);
    setBillModal(true);
  }

  function openEdit(b: ExpenseBillRow) {
    setEditing(b);
    setForm({
      ...emptyBillForm(),
      expense_date: b.expense_date,
      due_date: b.due_date ?? "",
      title: b.title ?? "",
      expense_head: b.expense_head ?? "",
      amount: String(b.amount ?? ""),
      payment_method: b.payment_method ?? "Cash",
      paid_to: b.paid_to ?? "",
      note: b.note ?? "",
      receipt_path: b.receipt_path ?? "",
      is_opening_bill: b.is_opening_bill ?? false,
      pay_now: false,
    });
    setBillModal(true);
  }

  function openPayment(b: ExpenseBillRow) {
    setPayFor(b);
    setPayForm({
      amount: String(outstandingOn(b)),
      paid_on: isCurrentMonth ? format(new Date(), "yyyy-MM-dd") : monthEnd,
      payment_method: b.payment_method ?? "Cash",
      reference: "",
      note: "",
    });
    // One token per opened dialog. A double-clicked Record button sends the
    // same token twice and the second call returns the first payment instead
    // of creating a duplicate.
    setPayToken(crypto.randomUUID());
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

  async function saveBill() {
    if (!form.expense_date || !form.title.trim() || !form.expense_head || !form.amount || !form.payment_method) {
      toast.error("Bill date, name, category, amount and method are required");
      return;
    }
    const total = Number(form.amount);
    if (!(total > 0)) { toast.error("Amount must be greater than 0"); return; }

    const amountChanged = !!editing && Number(form.amount) !== Number(editing.amount);
    const dateMoved = !!editing && form.expense_date !== editing.expense_date;
    const needsReason =
      isBackdated(form.expense_date) ||
      (form.pay_now && isBackdated(form.pay_on)) ||
      amountChanged ||
      (dateMoved && (isBackdated(form.expense_date) || isBackdated(editing!.expense_date)));
    if (needsReason && !form.reason.trim()) {
      toast.error("A reason is required — this change updates historical totals");
      return;
    }
    if (amountChanged && form.amount_change_kind === "revision" && !form.amount_effective_from) {
      toast.error("A revision needs the date it takes effect from");
      return;
    }

    let initial_payment = null;
    if (!editing && form.pay_now) {
      const payAmount = form.pay_amount ? Number(form.pay_amount) : total;
      if (!(payAmount > 0)) { toast.error("Payment amount must be greater than 0"); return; }
      if (payAmount > total) { toast.error("Payment cannot exceed the bill total"); return; }
      if (!form.pay_on) { toast.error("Payment date is required"); return; }
      initial_payment = {
        amount: payAmount,
        paid_on: form.pay_on,
        payment_method: form.payment_method,
        client_token: crypto.randomUUID(),
      };
    }

    setSaving(true);
    try {
      const url = editing ? `/api/expenses/${editing.id}` : "/api/expenses";
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: form.reason,
          ...(editing && Number(form.amount) !== Number(editing.amount)
            ? {
                amount_change_kind: form.amount_change_kind,
                amount_effective_from: form.amount_effective_from || undefined,
              }
            : {}),
          expense_date: form.expense_date,
          due_date: form.due_date || null,
          title: form.title,
          expense_head: form.expense_head,
          amount: total,
          payment_method: form.payment_method,
          paid_to: form.paid_to,
          note: form.note,
          receipt_path: form.receipt_path,
          is_opening_bill: form.is_opening_bill,
          ...(initial_payment ? { initial_payment } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "Could not save"); return; }
      // The bill saved but its payment did not — say so instead of a plain
      // success, because the bill is now sitting unpaid.
      if (json.paymentError) toast.error(`Bill saved, but the payment failed: ${json.paymentError}`);
      else toast.success(editing ? "Bill updated" : "Bill recorded");
      setBillModal(false);
      await fetchData();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function recordPayment() {
    if (!payFor) return;
    const amount = Number(payForm.amount);
    if (!(amount > 0)) { toast.error("Payment amount must be greater than 0"); return; }
    if (!payForm.paid_on) { toast.error("Payment date is required"); return; }

    setPaying(true);
    try {
      const res = await fetch(`/api/expenses/${payFor.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payForm, amount, client_token: payToken }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "Could not record the payment"); return; }
      toast.success(json.duplicate ? "That payment was already recorded" : "Payment recorded");
      setPayFor(null);
      await fetchData();
    } catch {
      toast.error("Network error");
    } finally {
      setPaying(false);
    }
  }

  async function voidPayment(p: ExpensePaymentRow) {
    const reason = prompt(
      `Void this ${formatPKR(p.amount)} payment dated ${formatDate(p.paid_on)}?\n\n` +
      "This CORRECTS A MISTAKEN ENTRY — use it when the payment should never have been recorded.\n" +
      "It is NOT a refund. If the supplier actually gave money back, record that separately.\n\n" +
      `${formatDate(p.paid_on)} is restated: the amount returns to that month's funds and the bill goes back to outstanding. The voided record is kept.\n\nReason (optional):`
    );
    if (reason === null) return;
    const res = await fetch(`/api/expenses/payments/${p.id}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const json = await res.json();
    if (!res.ok) { toast.error(json.error ?? "Could not void the payment"); return; }
    toast.success("Payment voided");
    setHistoryFor(null);
    await fetchData();
  }

  async function voidBill(b: ExpenseBillRow) {
    const reason = prompt(`Void bill "${b.title}" (${formatPKR(b.amount)})?\n\nThis removes it from all totals. The record is kept for audit.\n\nReason (optional):`);
    if (reason === null) return;
    const res = await fetch(`/api/expenses/${b.id}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const json = await res.json();
    if (!res.ok) { toast.error(json.error ?? "Could not void"); return; }
    toast.success("Bill voided");
    await fetchData();
  }

  async function openReceipt(path: string) {
    const res = await fetch(`/api/expenses/receipt?path=${encodeURIComponent(path)}`);
    const json = await res.json();
    if (!res.ok) { toast.error(json.error ?? "Could not open receipt"); return; }
    window.open(json.url, "_blank", "noopener,noreferrer");
  }

  async function openSetup() {
    const res = await fetch("/api/expenses/settings");
    const json = await res.json();
    const s = json?.settings;
    setSetupForm({
      start_month: s?.start_month ? String(s.start_month).slice(0, 7) : month,
      opening_funds: s?.opening_funds != null ? String(s.opening_funds) : "",
    });
    setSetupOpen(true);
  }

  async function saveSetup() {
    if (!setupForm.start_month) { toast.error("Choose the first month to track"); return; }
    const funds = Number(setupForm.opening_funds || 0);
    if (!Number.isFinite(funds)) { toast.error("Opening funds must be a number"); return; }
    setSavingSetup(true);
    try {
      const res = await fetch("/api/expenses/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_month: setupForm.start_month, opening_funds: funds }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "Could not save"); return; }
      toast.success("Starting balance saved");
      setSetupOpen(false);
      await fetchData();
    } finally {
      setSavingSetup(false);
    }
  }

  // Until an owner sets a starting balance there IS no opening balance.
  // Showing Rs 0 would assert the gym started with nothing, which is a
  // different claim from "we do not know yet".
  const configured = summary?.configured === true;
  const opening = summary?.opening_balance ?? 0;
  const income = summary?.income_collected ?? 0;
  const paidOut = summary?.expenses_paid ?? 0;
  const closing = summary?.closing_balance ?? 0;
  const monthlyNet = summary?.monthly_net ?? 0;
  const outstanding = summary?.outstanding_at_month_end ?? 0;

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Expenses"
        subtitle="Bills, payments and what carries forward month to month."
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={openSetup} title="Starting balance">
              <Settings2 className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={fetchData}><RefreshCw className="w-4 h-4" /></Button>
            <Button onClick={openAdd}><Plus className="w-4 h-4" /> Add Bill</Button>
          </div>
        }
      />

      <div className="flex-1 p-6 space-y-5">
        {/* ── Month navigator ─────────────────────────────────────── */}
        <div className="flex items-center justify-between bg-white border border-[#E4E4DE] rounded-xl px-4 py-3">
          <button onClick={() => setMonth(format(addMonths(parseISO(monthStart), -1), "yyyy-MM"))}
            className="p-1.5 rounded-lg text-[#4A4A44] hover:bg-[#F8F8F6]" title="Previous month">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-center">
            <p className="text-sm font-bold text-[#1A1A16]">{format(parseISO(monthStart), "MMMM yyyy")}</p>
            {!isCurrentMonth && (
              <p className="text-[11px] text-[#7A7A72]">
                Showing this month as it stood on {formatDate(monthEnd)}
              </p>
            )}
          </div>
          <button onClick={() => setMonth(format(addMonths(parseISO(monthStart), 1), "yyyy-MM"))}
            className="p-1.5 rounded-lg text-[#4A4A44] hover:bg-[#F8F8F6]" title="Next month">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {summary && !summary.configured && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-amber-800">
              <span className="font-semibold">Starting balance not configured.</span>{" "}
              Opening and closing balances are unavailable until it is set. Income, payments and outstanding bills below are unaffected.
              <button onClick={openSetup} className="ml-1 underline font-medium">Set it now</button>
            </div>
          </div>
        )}

        {/* ── Balance cards. These come from the server summary, never from
             the table below, so searching or filtering cannot move them. ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard title="Opening Balance" value={configured ? formatPKR(opening) : "Not configured"}
            icon={ArrowDownToLine}
            iconColor={!configured ? "text-amber-600" : opening >= 0 ? "text-[#4A4A44]" : "text-red-600"}
            iconBg={!configured ? "bg-amber-50" : opening >= 0 ? "bg-[#F8F8F6]" : "bg-red-50"} loading={loading} />
          <StatsCard title="Income Collected" value={formatPKR(income)} icon={TrendingUp}
            iconColor="text-green-600" iconBg="bg-green-50" loading={loading} />
          <StatsCard title="Expenses Paid" value={formatPKR(paidOut)} icon={Receipt}
            iconColor="text-[#F06418]" iconBg="bg-[#FEF0E8]" loading={loading} />
          {/* Closing depends on opening, so it is equally unknown until the
              starting balance is set. A number here would present an
              unconfirmed figure as real cash on hand. */}
          <StatsCard title="Closing Balance" value={configured ? formatPKR(closing) : "Not configured"}
            icon={Wallet}
            iconColor={!configured ? "text-amber-600" : closing >= 0 ? "text-green-600" : "text-red-600"}
            iconBg={!configured ? "bg-amber-50" : closing >= 0 ? "bg-green-50" : "bg-red-50"} loading={loading} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatsCard title="Monthly Net (income − paid)" value={formatPKR(monthlyNet)} icon={ArrowUpFromLine}
            iconColor={monthlyNet >= 0 ? "text-green-600" : "text-red-600"}
            iconBg={monthlyNet >= 0 ? "bg-green-50" : "bg-red-50"} loading={loading} />
          <StatsCard title="Outstanding Bills" value={formatPKR(outstanding)} icon={AlertTriangle}
            iconColor={outstanding > 0 ? "text-amber-600" : "text-[#4A4A44]"}
            iconBg={outstanding > 0 ? "bg-amber-50" : "bg-[#F8F8F6]"} loading={loading} />
        </div>

        {/* ── Filters ─────────────────────────────────────────────── */}
        <div className="bg-white border border-[#E4E4DE] rounded-xl p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg p-0.5 gap-0.5">
              {([["all", "All"], ["unpaid", "Unpaid"], ["partial", "Partial"], ["paid", "Paid"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setStatus(k)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${status === k ? "bg-[#F06418] text-white" : "text-[#4A4A44] hover:bg-white"}`}
                >{label}</button>
              ))}
            </div>

            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="text-xs px-3 py-1.5 rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]">
              <option value="all">All Categories</option>
              {EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>

            <div className="flex-1 min-w-40 max-w-sm relative">
              <Search className="w-4 h-4 text-[#7A7A72] absolute left-3 top-1/2 -translate-y-1/2" />
              <input type="text" placeholder="Search bill, paid to, notes..." value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
            </div>

            <span className="text-xs text-[#7A7A72] ml-auto">
              {filtered.length} bill{filtered.length !== 1 ? "s" : ""} listed
            </span>
          </div>
        </div>

        {/* ── Table ───────────────────────────────────────────────── */}
        {loading ? (
          <div className="py-16 text-center">
            <RefreshCw className="w-6 h-6 text-[#7A7A72] animate-spin mx-auto mb-2" />
            <p className="text-sm text-[#7A7A72]">Loading…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-14 h-14 bg-[#FEF0E8] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Receipt className="w-7 h-7 text-[#F06418]" />
            </div>
            <p className="text-base font-semibold text-[#1A1A16]">No bills for this month</p>
            <p className="text-sm text-[#7A7A72] mt-1">Rent, utilities, salaries and other running costs appear here once recorded.</p>
            <Button className="mt-4" onClick={openAdd}><Plus className="w-4 h-4" /> Add Bill</Button>
          </div>
        ) : (
          <Card padding={false}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#F8F8F6] border-b border-[#E4E4DE]">
                  <tr>
                    {["Bill Date", "Expense", "Category", "Paid To", "Total", "Paid", "Outstanding", "Status", ""].map((h, i) => (
                      <th key={h || i} className={`text-xs font-semibold text-[#7A7A72] px-4 py-3 whitespace-nowrap ${["Total", "Paid", "Outstanding"].includes(h) ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E4DE]">
                  {paginated.map((b) => {
                    // As-of-month-end, so viewing September never shows a
                    // September bill settled by an October payment.
                    const st = expenseStatus(b, monthEnd);
                    const paid = paidAgainst(b.payments, monthEnd);
                    const due = outstandingOn(b, monthEnd);
                    const mayEdit = !!role && canEditExpense(role, currentUser?.id ?? "", b.added_by);
                    const fromEarlier = b.expense_date < monthStart;
                    return (
                      <tr key={b.id} className="hover:bg-[#F8F8F6] transition-colors">
                        <td className="px-4 py-3 text-sm text-[#1A1A16] whitespace-nowrap">
                          {formatDate(b.expense_date)}
                          {fromEarlier && (
                            <span className="block text-[10px] text-amber-700 font-medium">carried forward</span>
                          )}
                          {b.due_date && (
                            <span className="block text-[10px] text-[#7A7A72]">due {formatDate(b.due_date)}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-[#1A1A16]">{b.title}</span>
                            {b.is_opening_bill && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[#F8F8F6] border border-[#E4E4DE] text-[#7A7A72]">opening</span>
                            )}
                            {b.receipt_path && (
                              <button onClick={() => openReceipt(b.receipt_path!)} title="View receipt"
                                className="p-1 rounded text-[#7A7A72] hover:text-[#F06418] hover:bg-[#FEF0E8] transition-colors">
                                <FileText className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          {b.note && <p className="text-xs text-[#7A7A72] mt-0.5 truncate max-w-xs">{b.note}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-medium px-2 py-1 rounded-full bg-[#F8F8F6] border border-[#E4E4DE] text-[#4A4A44] whitespace-nowrap">
                            {expenseCategoryLabel(b.expense_head)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-[#4A4A44]">{b.paid_to || "—"}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-[#1A1A16] text-right whitespace-nowrap">{formatPKR(amountAsOf(b, monthEnd))}</td>
                        <td className="px-4 py-3 text-sm text-[#4A4A44] text-right whitespace-nowrap">{formatPKR(paid)}</td>
                        <td className={`px-4 py-3 text-sm font-semibold text-right whitespace-nowrap ${due > 0 ? "text-amber-700" : "text-[#7A7A72]"}`}>{formatPKR(due)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-[11px] font-semibold px-2 py-1 rounded-full border whitespace-nowrap ${STATUS_STYLES[st]}`}>
                            {EXPENSE_STATUS_LABELS[st]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            {due > 0.005 && mayEdit && (
                              <button onClick={() => openPayment(b)} title="Record payment"
                                className="p-1.5 rounded-lg text-[#7A7A72] hover:text-green-700 hover:bg-green-50 transition-colors">
                                <HandCoins className="w-4 h-4" />
                              </button>
                            )}
                            <button onClick={() => setHistoryFor(b)} title="Payment history"
                              className="p-1.5 rounded-lg text-[#7A7A72] hover:text-[#F06418] hover:bg-[#FEF0E8] transition-colors">
                              <History className="w-4 h-4" />
                            </button>
                            {mayEdit && (
                              <button onClick={() => openEdit(b)} title="Edit bill"
                                className="p-1.5 rounded-lg text-[#7A7A72] hover:text-[#F06418] hover:bg-[#FEF0E8] transition-colors">
                                <Pencil className="w-4 h-4" />
                              </button>
                            )}
                            {canVoid && (
                              <button onClick={() => voidBill(b)} title="Void bill"
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

      {/* ── Add / Edit bill ───────────────────────────────────────── */}
      <Modal open={billModal} onClose={() => setBillModal(false)}
        title={editing ? "Edit Bill" : "Add Bill"} size="md">
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Bill Date" type="date" required value={form.expense_date}
              min="1900-01-01" max="2099-12-31"
              onChange={(e) => { const v = safeDateValue(e.target.value); if (v !== null) setForm({ ...form, expense_date: v }); }} />
            <Input label="Due Date (optional)" type="date" value={form.due_date}
              min="1900-01-01" max="2099-12-31"
              onChange={(e) => { const v = safeDateValue(e.target.value); if (v !== null) setForm({ ...form, due_date: v }); }} />
          </div>
          <p className="text-xs text-[#7A7A72] -mt-2">
            The bill date is when the cost was incurred and may be in the past. Who entered it, and when, is recorded separately.
          </p>

          <Input label="Expense Name" required placeholder="e.g. Electricity Bill" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} />

          <div className="grid grid-cols-2 gap-4">
            <Input label="Bill Total (Rs)" type="number" required min="1" step="0.01" value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <Select label="Category" required value={form.expense_head}
              onChange={(e) => setForm({ ...form, expense_head: e.target.value })}>
              <option value="">Select category</option>
              {EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Select label="Payment Method" required value={form.payment_method}
              onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
            <Input label="Paid To (optional)" placeholder="e.g. WAPDA" value={form.paid_to}
              onChange={(e) => setForm({ ...form, paid_to: e.target.value })} />
          </div>

          {!editing && (
            <div className="rounded-lg border border-[#E4E4DE] bg-[#F8F8F6] p-3 space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-[#1A1A16]">
                <input type="checkbox" checked={form.pay_now}
                  onChange={(e) => setForm({ ...form, pay_now: e.target.checked })}
                  className="rounded border-[#E4E4DE] text-[#F06418] focus:ring-[#F06418]" />
                Record a payment now
              </label>
              {form.pay_now ? (
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Amount Paid (Rs)" type="number" min="0.01" step="0.01"
                    placeholder={form.amount || "Full amount"} value={form.pay_amount}
                    onChange={(e) => setForm({ ...form, pay_amount: e.target.value })} />
                  <Input label="Paid On" type="date" value={form.pay_on}
                    min="1900-01-01" max="2099-12-31"
                    onChange={(e) => { const v = safeDateValue(e.target.value); if (v !== null) setForm({ ...form, pay_on: v }); }} />
                </div>
              ) : (
                <p className="text-xs text-[#7A7A72]">
                  The bill will be saved as <span className="font-semibold">Unpaid</span> and stay visible each month until it is settled. It does not reduce funds until a payment is recorded.
                </p>
              )}
              <label className="flex items-center gap-2 text-xs text-[#4A4A44]">
                <input type="checkbox" checked={form.is_opening_bill}
                  onChange={(e) => setForm({ ...form, is_opening_bill: e.target.checked })}
                  className="rounded border-[#E4E4DE] text-[#F06418] focus:ring-[#F06418]" />
                This bill was already outstanding before tracking began
              </label>
            </div>
          )}

          {(() => {
            const amountChanged = !!editing && Number(form.amount) !== Number(editing.amount);
            const dateMoved = !!editing && form.expense_date !== editing.expense_date;
            const warn =
              isBackdated(form.expense_date) ||
              (!editing && form.pay_now && isBackdated(form.pay_on)) ||
              amountChanged ||
              (dateMoved && (isBackdated(form.expense_date) || isBackdated(editing!.expense_date)));
            if (!warn) return null;
            return (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-amber-800 font-medium">
                    This change will update historical totals and subsequent balances.
                  </p>
                </div>

                {amountChanged && (
                  <div className="space-y-2">
                    <label className="flex items-start gap-2 text-xs text-amber-900">
                      <input type="radio" name="amtkind" checked={form.amount_change_kind === "correction"}
                        onChange={() => setForm({ ...form, amount_change_kind: "correction" })}
                        className="mt-0.5 text-[#F06418] focus:ring-[#F06418]" />
                      <span><span className="font-semibold">Correcting an error</span> — the total was always this. Every past month is restated.</span>
                    </label>
                    <label className="flex items-start gap-2 text-xs text-amber-900">
                      <input type="radio" name="amtkind" checked={form.amount_change_kind === "revision"}
                        onChange={() => setForm({ ...form, amount_change_kind: "revision" })}
                        className="mt-0.5 text-[#F06418] focus:ring-[#F06418]" />
                      <span><span className="font-semibold">Revised amount</span> — it genuinely changed. Months before the date below keep the old figure.</span>
                    </label>
                    {form.amount_change_kind === "revision" && (
                      <Input label="Effective from" type="date" value={form.amount_effective_from}
                        min="1900-01-01" max="2099-12-31"
                        onChange={(e) => { const v = safeDateValue(e.target.value); if (v !== null) setForm({ ...form, amount_effective_from: v }); }} />
                    )}
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-amber-900 block mb-1">Reason (required)</label>
                  <input type="text" value={form.reason}
                    onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    placeholder="e.g. invoice arrived late, corrected a typo"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-amber-300 bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
                  <p className="text-[11px] text-amber-800 mt-1">Kept in the audit history with your name and the time.</p>
                </div>
              </div>
            );
          })()}

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
            <Button variant="secondary" onClick={() => setBillModal(false)} className="flex-1">Cancel</Button>
            <Button onClick={saveBill} loading={saving} className="flex-1">
              {editing ? "Save Changes" : "Add Bill"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Record payment ────────────────────────────────────────── */}
      <Modal open={!!payFor} onClose={() => setPayFor(null)} title="Record Payment" size="sm">
        {payFor && (
          <div className="p-5 space-y-4">
            <div className="rounded-lg bg-[#F8F8F6] border border-[#E4E4DE] p-3 text-sm">
              <p className="font-semibold text-[#1A1A16]">{payFor.title}</p>
              <div className="flex justify-between mt-1 text-xs text-[#4A4A44]">
                <span>Bill total</span><span className="font-semibold">{formatPKR(payFor.amount)}</span>
              </div>
              <div className="flex justify-between text-xs text-[#4A4A44]">
                <span>Already paid</span><span className="font-semibold">{formatPKR(paidAgainst(payFor.payments))}</span>
              </div>
              <div className="flex justify-between text-xs text-amber-700 mt-1 pt-1 border-t border-[#E4E4DE]">
                <span>Outstanding</span><span className="font-bold">{formatPKR(outstandingOn(payFor))}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="Amount (Rs)" type="number" required min="0.01" step="0.01" value={payForm.amount}
                onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
              <Input label="Paid On" type="date" required value={payForm.paid_on}
                min="1900-01-01" max="2099-12-31"
                onChange={(e) => { const v = safeDateValue(e.target.value); if (v !== null) setPayForm({ ...payForm, paid_on: v }); }} />
            </div>
            <p className="text-xs text-[#7A7A72] -mt-2">
              The payment counts in the month it was paid, which may differ from the bill&apos;s month.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <Select label="Method" value={payForm.payment_method}
                onChange={(e) => setPayForm({ ...payForm, payment_method: e.target.value })}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
              <Input label="Reference (optional)" placeholder="Cheque / txn no."
                value={payForm.reference}
                onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} />
            </div>

            <div className="flex gap-3 pt-1">
              <Button variant="secondary" onClick={() => setPayFor(null)} className="flex-1">Cancel</Button>
              <Button onClick={recordPayment} loading={paying} className="flex-1">Record Payment</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Payment history ───────────────────────────────────────── */}
      <Modal open={!!historyFor} onClose={() => setHistoryFor(null)} title="Payment History" size="md">
        {historyFor && (
          <div className="p-5 space-y-3">
            <div className="rounded-lg bg-[#F8F8F6] border border-[#E4E4DE] p-3 text-sm">
              <p className="font-semibold text-[#1A1A16]">{historyFor.title}</p>
              <p className="text-xs text-[#7A7A72] mt-0.5">
                Bill dated {formatDate(historyFor.expense_date)} · total {formatPKR(historyFor.amount)} ·
                outstanding {formatPKR(outstandingOn(historyFor))}
              </p>
            </div>

            {/* Payment voids are the one thing here that is NOT effective-dated,
                because a mistaken entry means the money never moved — so it is
                removed from the month it was dated in, not from today. */}
            <p className="text-xs text-[#7A7A72]">
              Voiding a payment <span className="font-semibold">corrects a mistaken entry</span> and restates the month that payment was dated in.
              It does not record a refund. If the supplier actually returned money, record that separately.
            </p>

            {(historyFor.payments ?? []).length === 0 ? (
              <p className="text-sm text-[#7A7A72] py-6 text-center">No payments recorded against this bill yet.</p>
            ) : (
              <div className="divide-y divide-[#E4E4DE] border border-[#E4E4DE] rounded-lg">
                {[...(historyFor.payments ?? [])]
                  .sort((a, b) => (a.paid_on < b.paid_on ? 1 : -1))
                  .map((p) => (
                    <div key={p.id} className="flex items-center justify-between px-3 py-2.5">
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold ${p.deleted_at ? "text-[#7A7A72] line-through" : "text-[#1A1A16]"}`}>
                          {formatPKR(p.amount)}
                          <span className="ml-2 text-xs font-normal text-[#7A7A72]">{formatDate(p.paid_on)}</span>
                        </p>
                        <p className="text-xs text-[#7A7A72] truncate">
                          {p.payment_method ?? "—"}
                          {p.reference ? ` · ${p.reference}` : ""}
                          {p.added_by ? ` · entered by ${userNames[p.added_by] ?? "—"}` : ""}
                          {p.created_at ? ` on ${formatDate(p.created_at.slice(0, 10))}` : ""}
                        </p>
                        {p.deleted_at && (
                          <p className="text-xs text-red-600">
                            Voided{p.void_reason ? ` — ${p.void_reason}` : ""}
                          </p>
                        )}
                      </div>
                      {!p.deleted_at && canVoid && (
                        <button onClick={() => voidPayment(p)} title="Void payment — corrects a mistaken entry, not a refund"
                          className="p-1.5 rounded-lg text-[#7A7A72] hover:text-red-600 hover:bg-red-50 transition-colors flex-shrink-0">
                          <Ban className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Starting balance ──────────────────────────────────────── */}
      <Modal open={setupOpen} onClose={() => setSetupOpen(false)} title="Starting Balance" size="sm">
        <div className="p-5 space-y-4">
          <p className="text-sm text-[#4A4A44]">
            Set the first month you want tracked and the funds on hand at the start of it. Every later
            month&apos;s opening balance is carried forward from here.
          </p>
          <Input label="First month tracked" type="month" required value={setupForm.start_month}
            onChange={(e) => setSetupForm({ ...setupForm, start_month: e.target.value })} />
          <Input label="Opening funds (Rs)" type="number" step="0.01" placeholder="0"
            value={setupForm.opening_funds}
            onChange={(e) => setSetupForm({ ...setupForm, opening_funds: e.target.value })} />
          <p className="text-xs text-[#7A7A72]">
            May be negative. Bills already outstanding before this month should be added as ordinary bills
            with their real date and the &ldquo;already outstanding&rdquo; box ticked — they will not deduct
            funds until you record a payment.
          </p>
          <div className="flex gap-3 pt-1">
            <Button variant="secondary" onClick={() => setSetupOpen(false)} className="flex-1">Cancel</Button>
            <Button onClick={saveSetup} loading={savingSetup} className="flex-1">Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
