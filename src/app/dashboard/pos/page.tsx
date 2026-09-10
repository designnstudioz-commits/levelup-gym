"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Package, AlertTriangle, XCircle, EyeOff, RefreshCw, Boxes } from "lucide-react";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { StatsCard } from "@/components/ui/StatsCard";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { timeAgo } from "@/lib/utils";

interface DepartmentStatus {
  id: string; name: string; slug: string; financialOwner: string; status: string;
  productCount: number; lowStockCount: number; outOfStockCount: number;
}
interface ActivityRow { id: string; action: string; description: string; created_at: string }

/**
 * POS Admin Overview — operational catalogue health, deliberately NOT
 * financial reporting (revenue, margin, settlement all live elsewhere —
 * the owner dashboard and the future POS Reports screen). Matches the
 * approved Figma's structure (stat tiles, department status, recent
 * activity) rendered entirely in the existing Level Up design system.
 */
export default function PosOverviewPage() {
  // Matches the pre-existing POS_ROUTE_ROLES entry for "/dashboard/pos"
  // (Phase A) exactly — owner/manager only. HealthBox staff land at their
  // own scoped page (/dashboard/pos/healthbox) instead, so widening this
  // one would be a new access decision, not something already established.
  useRoleGuard(["owner", "manager"]);

  const [stats, setStats] = useState<{ activeProducts: number; lowStock: number; outOfStock: number; hiddenFromPos: number } | null>(null);
  const [departments, setDepartments] = useState<DepartmentStatus[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pos/admin/overview");
      const json = await res.json();
      setStats({ activeProducts: json.activeProducts, lowStock: json.lowStock, outOfStock: json.outOfStock, hiddenFromPos: json.hiddenFromPos });
      setDepartments(json.departments ?? []);
      setActivity(json.recentActivity ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="POS Admin Overview"
        subtitle="Catalogue, stock and operational health across all departments"
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</Button>
            <Link href="/pos"><Button size="sm">Open POS Terminal</Button></Link>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard title="Active Products" value={loading ? "—" : stats?.activeProducts ?? 0} icon={Package} loading={loading} />
          <StatsCard title="Low Stock" value={loading ? "—" : stats?.lowStock ?? 0} icon={AlertTriangle} iconColor="text-amber-700" iconBg="bg-amber-50" loading={loading} />
          <StatsCard title="Out of Stock" value={loading ? "—" : stats?.outOfStock ?? 0} icon={XCircle} iconColor="text-red-600" iconBg="bg-red-50" loading={loading} />
          <StatsCard title="Hidden from POS" value={loading ? "—" : stats?.hiddenFromPos ?? 0} icon={EyeOff} iconColor="text-[#7A7A72]" iconBg="bg-gray-100" loading={loading} />
        </div>

        <Card padding={false}>
          <div className="p-5 border-b border-[#E4E4DE]">
            <CardHeader title="Department Status" subtitle="Active products and stock alerts per department" />
          </div>
          <div className="divide-y divide-[#E4E4DE]">
            {departments.length === 0 ? (
              <p className="px-5 py-6 text-sm text-[#7A7A72]">No departments visible.</p>
            ) : (
              departments.map((d) => (
                <Link key={d.id} href={`/dashboard/pos/catalog/products?department_id=${d.id}`} className="px-5 py-4 flex items-center justify-between hover:bg-[#F7F6F3] transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[#FEF0E8] flex items-center justify-center flex-shrink-0">
                      <Boxes className="w-4 h-4 text-[#F06418]" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-[#1A1A16]">{d.name}</p>
                      <p className="text-xs text-[#7A7A72]">{d.productCount} products · <Badge variant={d.financialOwner === "healthbox" ? "expiring" : "default"}>{d.financialOwner === "healthbox" ? "HealthBox" : "Level Up"}</Badge></p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {d.lowStockCount > 0 && <Badge variant="partial">{d.lowStockCount} low</Badge>}
                    {d.outOfStockCount > 0 && <Badge variant="overdue">{d.outOfStockCount} out</Badge>}
                    {d.lowStockCount === 0 && d.outOfStockCount === 0 && <Badge variant="active">All stocked</Badge>}
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>

        <Card padding={false}>
          <div className="p-5 border-b border-[#E4E4DE]">
            <CardHeader title="Recent Catalogue Activity" subtitle="Products, prices and modifier groups — not every keystroke, just what changed" />
          </div>
          <div className="divide-y divide-[#E4E4DE]">
            {activity.length === 0 ? (
              <p className="px-5 py-6 text-sm text-[#7A7A72]">No recent catalogue activity.</p>
            ) : (
              activity.map((a) => (
                <div key={a.id} className="px-5 py-3 flex items-center justify-between">
                  <p className="text-sm text-[#1A1A16]">{a.description}</p>
                  <p className="text-xs text-[#7A7A72] flex-shrink-0 ml-4">{timeAgo(a.created_at)}</p>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
