"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Boxes, AlertTriangle, XCircle, ClipboardList, RefreshCw, Package, Truck, SlidersHorizontal, History } from "lucide-react";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { StatsCard } from "@/components/ui/StatsCard";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { timeAgo } from "@/lib/utils";

interface ActivityRow { id: string; action: string; description: string; created_at: string }

const QUICK_LINKS = [
  { label: "Receive Stock", href: "/dashboard/pos/inventory/receive", icon: Package, hint: "Log a delivery, update quantities" },
  { label: "Stock Adjustments", href: "/dashboard/pos/inventory/adjustments", icon: SlidersHorizontal, hint: "Damage, wastage, loss, corrections" },
  { label: "Physical Counts", href: "/dashboard/pos/inventory/counts", icon: ClipboardList, hint: "Count, review and post variances" },
  { label: "Movement History", href: "/dashboard/pos/inventory/movements", icon: History, hint: "Every stock change, immutable" },
  { label: "Low Stock Alerts", href: "/dashboard/pos/inventory/alerts", icon: AlertTriangle, hint: "Everything Low, Critical or Out" },
  { label: "Suppliers", href: "/dashboard/pos/suppliers", icon: Truck, hint: "Vendor contacts and lead times" },
];

export default function InventoryOverviewPage() {
  useRoleGuard(["owner", "manager"]);

  const [stats, setStats] = useState<{ totalTracked: number; low: number; critical: number; out: number; countsDue: number } | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pos/admin/inventory/overview");
      const json = await res.json();
      setStats({ totalTracked: json.totalTracked, low: json.low, critical: json.critical, out: json.out, countsDue: json.countsDue });
      setActivity(json.recentActivity ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Inventory Overview"
        subtitle="Stock health across the catalogue — tracked at the lowest sellable SKU"
        action={<Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</Button>}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <StatsCard title="Tracked SKUs" value={loading ? "—" : stats?.totalTracked ?? 0} icon={Boxes} loading={loading} />
          <StatsCard title="Low Stock" value={loading ? "—" : stats?.low ?? 0} icon={AlertTriangle} iconColor="text-amber-700" iconBg="bg-amber-50" loading={loading} />
          <StatsCard title="Critical Stock" value={loading ? "—" : stats?.critical ?? 0} icon={AlertTriangle} iconColor="text-orange-700" iconBg="bg-orange-50" loading={loading} />
          <StatsCard title="Out of Stock" value={loading ? "—" : stats?.out ?? 0} icon={XCircle} iconColor="text-red-600" iconBg="bg-red-50" loading={loading} />
          <StatsCard title="Counts Due" value={loading ? "—" : stats?.countsDue ?? 0} icon={ClipboardList} iconColor="text-[#7A7A72]" iconBg="bg-gray-100" loading={loading} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {QUICK_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="bg-white border border-[#E4E4DE] rounded-xl p-5 flex items-start gap-4 hover:border-[#F06418] transition-colors">
              <div className="w-10 h-10 rounded-lg bg-[#FEF0E8] flex items-center justify-center flex-shrink-0">
                <l.icon className="w-5 h-5 text-[#F06418]" />
              </div>
              <div>
                <p className="text-sm font-bold text-[#1A1A16]">{l.label}</p>
                <p className="text-xs text-[#7A7A72] mt-0.5">{l.hint}</p>
              </div>
            </Link>
          ))}
        </div>

        <Card padding={false}>
          <div className="p-5 border-b border-[#E4E4DE]">
            <CardHeader title="Recent Stock Activity" subtitle="Receipts, adjustments and posted counts" />
          </div>
          <div className="divide-y divide-[#E4E4DE]">
            {activity.length === 0 ? (
              <p className="px-5 py-6 text-sm text-[#7A7A72]">No recent stock activity.</p>
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
