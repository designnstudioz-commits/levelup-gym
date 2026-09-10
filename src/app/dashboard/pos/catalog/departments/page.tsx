"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, Loader2 } from "lucide-react";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/lib/utils";

interface Department {
  id: string;
  name: string;
  slug: string;
  financialOwner: "levelup" | "healthbox";
  description: string | null;
  sortOrder: number;
  status: "active" | "inactive";
}

/**
 * Department status — the four departments are locked business identities
 * (spec §9). This screen edits only sort_order and status; name, slug and
 * financial_owner are never editable here, matching the API route, which
 * never even reads those fields from the request body.
 */
export default function PosDepartmentsPage() {
  useRoleGuard(["owner", "manager"]);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pos/admin/departments");
      const json = await res.json();
      setDepartments(
        (json.departments ?? []).map((d: { id: string; name: string; slug: string; financial_owner: string; description: string | null; sort_order: number; status: string }) => ({
          id: d.id, name: d.name, slug: d.slug,
          financialOwner: d.financial_owner, description: d.description,
          sortOrder: d.sort_order, status: d.status,
        }))
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggleStatus(dept: Department) {
    const newStatus = dept.status === "active" ? "inactive" : "active";
    setSavingId(dept.id);
    try {
      const res = await fetch(`/api/pos/admin/departments/${dept.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not update");
      setDepartments((list) => list.map((d) => (d.id === dept.id ? { ...d, status: newStatus } : d)));
      toast.success(`${dept.name} ${newStatus === "active" ? "activated" : "deactivated"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update department");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader title="Departments" subtitle="The four business sections — identity locked, status and order configurable" />

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <p className="text-sm text-[#7A7A72]">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {departments.map((d) => (
              <Card key={d.id} className={cn("relative", savingId === d.id && "opacity-60")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-[#FEF0E8] flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-5 h-5 text-[#F06418]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-base font-bold text-[#1A1A16]">{d.name}</p>
                      <p className="text-xs text-[#7A7A72] truncate">{d.description}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <Badge variant={d.financialOwner === "healthbox" ? "expiring" : "default"}>
                          {d.financialOwner === "healthbox" ? "HealthBox" : "Level Up"}
                        </Badge>
                        <Badge variant={d.status === "active" ? "active" : "inactive"}>
                          {d.status === "active" ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  {savingId === d.id ? (
                    <Loader2 className="w-4 h-4 animate-spin text-[#7A7A72] flex-shrink-0" />
                  ) : (
                    <Switch checked={d.status === "active"} onChange={() => toggleStatus(d)} />
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

        <p className="mt-6 text-xs text-[#7A7A72] max-w-2xl">
          These four departments are locked business identities — Supplements, Level Up Cafe and
          Accessories belong to Level Up; HealthBox is the third-party operator. Only their active
          status is configurable here; the name and financial ownership cannot be changed from
          this screen.
        </p>
      </div>
    </div>
  );
}
