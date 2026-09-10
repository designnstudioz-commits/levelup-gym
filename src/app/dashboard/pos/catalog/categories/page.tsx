"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Tags, Pencil, RefreshCw } from "lucide-react";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";

interface Department { id: string; name: string; financialOwner: string }
interface Category { id: string; departmentId: string; name: string; sortOrder: number; status: string }

const emptyForm = { id: "", departmentId: "", name: "", sortOrder: 0, status: "active" as "active" | "inactive" };

/** Categories belong to a department; add/edit/reorder is fully supported,
 *  matching spec §10. Nothing here is hardcoded into the component — the
 *  starting structure was seeded as real data (migration
 *  20260912100100), and every category shown is loaded from the database. */
export default function PosCategoriesPage() {
  useRoleGuard(["owner", "manager"]);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, cRes] = await Promise.all([
        fetch("/api/pos/admin/departments"),
        fetch("/api/pos/admin/categories"),
      ]);
      const dJson = await dRes.json();
      const cJson = await cRes.json();
      setDepartments((dJson.departments ?? []).map((d: { id: string; name: string; financial_owner: string }) => ({ id: d.id, name: d.name, financialOwner: d.financial_owner })));
      setCategories((cJson.categories ?? []).map((c: { id: string; department_id: string; name: string; sort_order: number; status: string }) => ({ id: c.id, departmentId: c.department_id, name: c.name, sortOrder: c.sort_order, status: c.status })));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function openAdd(departmentId?: string) {
    setForm({ ...emptyForm, departmentId: departmentId ?? departments[0]?.id ?? "" });
    setModalOpen(true);
  }
  function openEdit(c: Category) {
    setForm({ id: c.id, departmentId: c.departmentId, name: c.name, sortOrder: c.sortOrder, status: c.status as "active" | "inactive" });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.departmentId) {
      toast.error("Name and department are required");
      return;
    }
    setSaving(true);
    try {
      const url = form.id ? `/api/pos/admin/categories/${form.id}` : "/api/pos/admin/categories";
      const method = form.id ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentId: form.departmentId, name: form.name.trim(), sortOrder: form.sortOrder, status: form.status }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save the category");
      toast.success(form.id ? "Category updated" : "Category added");
      setModalOpen(false);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the category");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Categories"
        subtitle="Organised by department"
        action={<Button size="sm" onClick={() => openAdd()}><Plus className="w-4 h-4" /> Add Category</Button>}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {loading ? (
          <p className="text-sm text-[#7A7A72]">Loading…</p>
        ) : (
          departments.map((dept) => {
            const deptCategories = categories.filter((c) => c.departmentId === dept.id).sort((a, b) => a.sortOrder - b.sortOrder);
            return (
              <Card key={dept.id} padding={false}>
                <div className="p-5 border-b border-[#E4E4DE] flex items-center justify-between">
                  <CardHeader title={dept.name} subtitle={`${deptCategories.length} categories`} />
                  <Button size="sm" variant="secondary" onClick={() => openAdd(dept.id)}>
                    <Plus className="w-4 h-4" /> Add
                  </Button>
                </div>
                <div className="divide-y divide-[#E4E4DE]">
                  {deptCategories.length === 0 ? (
                    <p className="px-5 py-6 text-sm text-[#7A7A72] flex items-center gap-2">
                      <Tags className="w-4 h-4" /> No categories yet
                    </p>
                  ) : (
                    deptCategories.map((c) => (
                      <div key={c.id} className="px-5 py-3 flex items-center justify-between hover:bg-[#F7F6F3]">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-[#1A1A16]">{c.name}</span>
                          <Badge variant={c.status === "active" ? "active" : "inactive"}>
                            {c.status === "active" ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          className="p-2 rounded-lg text-[#7A7A72] hover:bg-white hover:text-[#F06418] transition-colors cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? "Edit Category" : "Add Category"} size="sm">
        <div className="space-y-4">
          <Select
            label="Department"
            required
            value={form.departmentId}
            onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
          >
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Input
            label="Category Name"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            label="Sort Order"
            type="number"
            value={form.sortOrder}
            onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) || 0 }))}
          />
          {form.id && (
            <Switch
              checked={form.status === "active"}
              onChange={(checked) => setForm((f) => ({ ...f, status: checked ? "active" : "inactive" }))}
              label="Active"
            />
          )}
          <div className="flex items-center gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleSave} loading={saving} className="flex-1">Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
