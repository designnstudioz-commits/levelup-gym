"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, SlidersHorizontal, Pencil, Trash2, X } from "lucide-react";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { formatPKR, cn } from "@/lib/utils";

interface Department { id: string; name: string }
interface Option { id?: string; name: string; priceDelta: string; isDefault: boolean; isAvailable: boolean }
interface Group {
  id: string; department_id: string | null; name: string; selection_type: "single" | "multiple";
  is_required: boolean; min_select: number; max_select: number | null; status: string;
  options: { id: string; name: string; price_delta: number; is_default: boolean; is_available: boolean }[];
}

const emptyForm = {
  id: "", departmentId: "", name: "", selectionType: "single" as "single" | "multiple",
  isRequired: false, minSelect: 0, maxSelect: "", status: "active" as "active" | "inactive",
};

/**
 * Modifier group management — HealthBox needs this especially (spec §7),
 * but it's the same screen for any department. Nothing here is hardcoded
 * into the terminal; ModifierSheet.tsx reads whatever exists in the
 * database, exactly as it always has.
 */
export default function PosModifiersPage() {
  useRoleGuard(["owner", "manager", "healthbox_staff"]);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [options, setOptions] = useState<Option[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, gRes] = await Promise.all([
        fetch("/api/pos/admin/departments"),
        fetch("/api/pos/admin/modifier-groups"),
      ]);
      const dJson = await dRes.json();
      const gJson = await gRes.json();
      setDepartments((dJson.departments ?? []).map((d: { id: string; name: string }) => ({ id: d.id, name: d.name })));
      setGroups(gJson.groups ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function openAdd() {
    setForm({ ...emptyForm, departmentId: departments[0]?.id ?? "" });
    setOptions([{ name: "", priceDelta: "0", isDefault: false, isAvailable: true }]);
    setModalOpen(true);
  }

  function openEdit(g: Group) {
    setForm({
      id: g.id, departmentId: g.department_id ?? "", name: g.name, selectionType: g.selection_type,
      isRequired: g.is_required, minSelect: g.min_select, maxSelect: g.max_select != null ? String(g.max_select) : "",
      status: g.status as "active" | "inactive",
    });
    setOptions(g.options.map((o) => ({ id: o.id, name: o.name, priceDelta: String(o.price_delta), isDefault: o.is_default, isAvailable: o.is_available })));
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Group name is required"); return; }
    const cleanOptions = options.filter((o) => o.name.trim());
    if (cleanOptions.length === 0) { toast.error("Add at least one option"); return; }

    setSaving(true);
    try {
      const payload = {
        departmentId: form.departmentId || null, name: form.name.trim(), selectionType: form.selectionType,
        isRequired: form.isRequired, minSelect: form.minSelect, maxSelect: form.maxSelect ? Number(form.maxSelect) : null,
        status: form.status,
        options: cleanOptions.map((o) => ({ id: o.id, name: o.name.trim(), priceDelta: Number(o.priceDelta) || 0, isDefault: o.isDefault, isAvailable: o.isAvailable })),
      };
      const url = form.id ? `/api/pos/admin/modifier-groups/${form.id}` : "/api/pos/admin/modifier-groups";
      const res = await fetch(url, { method: form.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save the group");

      toast.success(form.id ? "Modifier group updated" : "Modifier group created");
      setModalOpen(false);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the group");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(g: Group) {
    if (!confirm(`Remove "${g.name}"? Products it was linked to will keep working, just without this group.`)) return;
    const res = await fetch(`/api/pos/admin/modifier-groups/${g.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Could not remove the group"); return; }
    toast.success("Modifier group removed");
    void load();
  }

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Modifier Groups"
        subtitle="Required choices, optional extras and paid add-ons for any product"
        action={<Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" /> Add Group</Button>}
      />

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <p className="text-sm text-[#7A7A72]">Loading…</p>
        ) : groups.length === 0 ? (
          <Card className="text-center py-12">
            <SlidersHorizontal className="w-8 h-8 mx-auto text-[#CFCEC6] mb-2" />
            <p className="text-sm text-[#7A7A72]">No modifier groups yet.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {groups.map((g) => (
              <Card key={g.id} padding={false}>
                <div className="p-4 border-b border-[#E4E4DE] flex items-start justify-between">
                  <CardHeader
                    title={g.name}
                    subtitle={departments.find((d) => d.id === g.department_id)?.name ?? "Any department"}
                  />
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => openEdit(g)} className="p-2 rounded-lg text-[#7A7A72] hover:bg-[#F7F6F3] hover:text-[#F06418] transition-colors cursor-pointer"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => handleRemove(g)} className="p-2 rounded-lg text-[#7A7A72] hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                <div className="p-4 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant={g.is_required ? "expiring" : "default"}>{g.is_required ? "Required" : "Optional"}</Badge>
                    <Badge variant="default">{g.selection_type === "single" ? "Choose 1" : `Choose up to ${g.max_select ?? "any"}`}</Badge>
                    <Badge variant={g.status === "active" ? "active" : "inactive"}>{g.status}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {g.options.map((o) => (
                      <span key={o.id} className="text-xs px-2 py-1 rounded-full bg-[#F7F6F3] border border-[#E4E4DE] text-[#4A4A44]">
                        {o.name}{o.price_delta > 0 ? ` +${formatPKR(o.price_delta)}` : ""}
                      </span>
                    ))}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? "Edit Modifier Group" : "Add Modifier Group"} size="lg">
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Group Name" required className="col-span-2" placeholder="e.g. Sauce, Toppings, Add-ons" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <Select label="Department" value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))} hint="Blank = usable by any department">
              <option value="">Any department</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
            <Select label="Selection Type" value={form.selectionType} onChange={(e) => setForm((f) => ({ ...f, selectionType: e.target.value as "single" | "multiple" }))}>
              <option value="single">Single Select</option>
              <option value="multiple">Multi Select</option>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-4 items-end">
            <Switch checked={form.isRequired} onChange={(c) => setForm((f) => ({ ...f, isRequired: c }))} label="Required" />
            {form.selectionType === "multiple" && (
              <>
                <Input label="Minimum Selection" type="number" value={form.minSelect} onChange={(e) => setForm((f) => ({ ...f, minSelect: Number(e.target.value) || 0 }))} />
                <Input label="Maximum Selection" type="number" placeholder="Unlimited" value={form.maxSelect} onChange={(e) => setForm((f) => ({ ...f, maxSelect: e.target.value }))} />
              </>
            )}
          </div>

          <div>
            <p className="text-sm font-medium text-[#1A1A16] mb-2">Options</p>
            <div className="space-y-2">
              {options.map((o, i) => (
                <div key={i} className="flex items-end gap-2">
                  <Input label={i === 0 ? "Name" : undefined} className="flex-1" value={o.name} onChange={(e) => setOptions((os) => os.map((x, xi) => xi === i ? { ...x, name: e.target.value } : x))} />
                  <Input label={i === 0 ? "Price Adjustment" : undefined} type="number" className="w-32" value={o.priceDelta} onChange={(e) => setOptions((os) => os.map((x, xi) => xi === i ? { ...x, priceDelta: e.target.value } : x))} />
                  <button type="button" onClick={() => setOptions((os) => os.filter((_, xi) => xi !== i))} className="p-2.5 rounded-lg text-red-600 hover:bg-red-50 flex-shrink-0"><X className="w-4 h-4" /></button>
                </div>
              ))}
              <Button variant="secondary" size="sm" type="button" onClick={() => setOptions((os) => [...os, { name: "", priceDelta: "0", isDefault: false, isAvailable: true }])}>
                <Plus className="w-4 h-4" /> Add Option
              </Button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-4 mt-4 border-t border-[#E4E4DE]">
          <Button variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">Cancel</Button>
          <Button onClick={handleSave} loading={saving} className="flex-1">Save Group</Button>
        </div>
      </Modal>
    </div>
  );
}
