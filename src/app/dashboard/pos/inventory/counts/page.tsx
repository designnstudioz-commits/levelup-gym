"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, RefreshCw, ClipboardList } from "lucide-react";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { timeAgo } from "@/lib/utils";

interface Department { id: string; name: string }
interface CountRow {
  id: string; departmentName: string; name: string | null; due_date: string | null;
  status: "draft" | "submitted" | "applied" | "cancelled"; itemCount: number; created_at: string;
}

const STATUS_BADGE: Record<CountRow["status"], "pending" | "partial" | "active" | "inactive"> = {
  draft: "inactive", submitted: "pending", applied: "active", cancelled: "inactive",
};

export default function StockCountsPage() {
  useRoleGuard(["owner", "manager"]);

  const [counts, setCounts] = useState<CountRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ departmentId: "", name: "", dueDate: "", note: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [countsRes, deptRes] = await Promise.all([
        fetch("/api/pos/admin/inventory/counts"),
        fetch("/api/pos/admin/departments"),
      ]);
      const countsJson = await countsRes.json();
      setCounts(countsJson.counts ?? []);
      const deptJson = await deptRes.json();
      setDepartments(deptJson.departments ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate() {
    if (!form.departmentId) { toast.error("Choose a department"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/pos/admin/inventory/counts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentId: form.departmentId, name: form.name || null, dueDate: form.dueDate || null, note: form.note || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not start the stock count");
      toast.success("Stock count started");
      setModalOpen(false);
      setForm({ departmentId: "", name: "", dueDate: "", note: "" });
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the stock count");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Physical Stock Counts"
        subtitle="Count, review, then post — posting creates the correction movements"
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</Button>
            <Button size="sm" onClick={() => setModalOpen(true)}><Plus className="w-4 h-4" /> New Count</Button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E4E4DE] text-left text-xs font-semibold text-[#7A7A72] uppercase tracking-wide">
                  <th className="px-4 py-3">Count</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Due</th>
                  <th className="px-4 py-3">Lines</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Started</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-[#7A7A72]">Loading…</td></tr>
                ) : counts.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-14 text-center text-[#7A7A72]"><ClipboardList className="w-8 h-8 mx-auto text-[#CFCEC6] mb-2" />No stock counts yet.</td></tr>
                ) : (
                  counts.map((c) => (
                    <tr key={c.id} className="border-b border-[#E4E4DE] last:border-0 hover:bg-[#F7F6F3]">
                      <td className="px-4 py-3"><Link href={`/dashboard/pos/inventory/counts/${c.id}`} className="font-semibold text-[#1A1A16] hover:text-[#F06418]">{c.name || "Untitled count"}</Link></td>
                      <td className="px-4 py-3 text-[#4A4A44]">{c.departmentName}</td>
                      <td className="px-4 py-3 text-[#4A4A44]">{c.due_date ?? "—"}</td>
                      <td className="px-4 py-3 tabular-nums">{c.itemCount}</td>
                      <td className="px-4 py-3"><Badge variant={STATUS_BADGE[c.status]}>{c.status}</Badge></td>
                      <td className="px-4 py-3 text-xs text-[#7A7A72]">{timeAgo(c.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Start a Stock Count" size="sm">
        <div className="space-y-4">
          <Select label="Department" value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
            <option value="">Select…</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Input label="Count Name (optional)" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Input label="Due Date" type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
          <Input label="Notes (optional)" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
          <p className="text-xs text-[#7A7A72]">This snapshots the current system quantity for every tracked product (and variant) in the department. You'll enter counted quantities next.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleCreate()} disabled={saving}>{saving ? "Starting…" : "Start Count"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
