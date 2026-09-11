"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, RefreshCw, Pencil, Truck, Archive } from "lucide-react";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";

interface Supplier {
  id: string; name: string; contact_person: string | null; phone: string | null; email: string | null;
  address: string | null; notes: string | null; status: "active" | "inactive"; lead_time_days: number | null;
  lastReceivedDate: string | null;
}

const emptyForm = { id: "", name: "", contactPerson: "", phone: "", email: "", address: "", notes: "", leadTimeDays: "", status: true };

export default function SuppliersPage() {
  useRoleGuard(["owner", "manager"]);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pos/admin/suppliers");
      const json = await res.json();
      setSuppliers(json.suppliers ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function openAdd() { setForm(emptyForm); setModalOpen(true); }
  function openEdit(s: Supplier) {
    setForm({
      id: s.id, name: s.name, contactPerson: s.contact_person ?? "", phone: s.phone ?? "", email: s.email ?? "",
      address: s.address ?? "", notes: s.notes ?? "", leadTimeDays: s.lead_time_days != null ? String(s.lead_time_days) : "",
      status: s.status === "active",
    });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Supplier name is required"); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(), contactPerson: form.contactPerson || null, phone: form.phone || null,
        email: form.email || null, address: form.address || null, notes: form.notes || null,
        leadTimeDays: form.leadTimeDays || null, status: form.status ? "active" : "inactive",
      };
      const url = form.id ? `/api/pos/admin/suppliers/${form.id}` : "/api/pos/admin/suppliers";
      const res = await fetch(url, {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save the supplier");
      toast.success(form.id ? "Supplier updated" : "Supplier added");
      setModalOpen(false);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the supplier");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(s: Supplier) {
    if (!confirm(`Archive "${s.name}"?`)) return;
    const res = await fetch(`/api/pos/admin/suppliers/${s.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Could not archive this supplier"); return; }
    toast.success("Supplier archived");
    void load();
  }

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Suppliers"
        subtitle="Vendor contacts referenced by stock receipts"
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</Button>
            <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" /> Add Supplier</Button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E4E4DE] text-left text-xs font-semibold text-[#7A7A72] uppercase tracking-wide">
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Lead Time</th>
                  <th className="px-4 py-3">Last Received</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-[#7A7A72]">Loading…</td></tr>
                ) : suppliers.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-14 text-center text-[#7A7A72]"><Truck className="w-8 h-8 mx-auto text-[#CFCEC6] mb-2" />No suppliers yet.</td></tr>
                ) : (
                  suppliers.map((s) => (
                    <tr key={s.id} className="border-b border-[#E4E4DE] last:border-0">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#1A1A16]">{s.name}</p>
                        {s.contact_person && <p className="text-xs text-[#7A7A72]">{s.contact_person}</p>}
                      </td>
                      <td className="px-4 py-3 text-[#4A4A44]">{s.phone ?? s.email ?? "—"}</td>
                      <td className="px-4 py-3 text-[#4A4A44]">{s.lead_time_days != null ? `${s.lead_time_days} days` : "—"}</td>
                      <td className="px-4 py-3 text-[#4A4A44]">{s.lastReceivedDate ?? "—"}</td>
                      <td className="px-4 py-3"><Badge variant={s.status === "active" ? "active" : "inactive"}>{s.status}</Badge></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => openEdit(s)} className="p-2 rounded-lg text-[#4A4A44] hover:bg-[#F7F6F3]"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => void handleArchive(s)} className="p-2 rounded-lg text-red-600 hover:bg-red-50"><Archive className="w-4 h-4" /></button>
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? "Edit Supplier" : "Add Supplier"} size="md">
        <div className="space-y-4">
          <Input label="Supplier Name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Contact Person" value={form.contactPerson} onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))} />
            <Input label="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            <Input label="Lead Time (days)" type="number" value={form.leadTimeDays} onChange={(e) => setForm((f) => ({ ...f, leadTimeDays: e.target.value }))} />
          </div>
          <Input label="Address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          <Input label="Notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          {form.id && <Switch checked={form.status} onChange={(c) => setForm((f) => ({ ...f, status: c }))} label="Active" />}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleSave()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
