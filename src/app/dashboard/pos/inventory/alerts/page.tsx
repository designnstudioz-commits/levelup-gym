"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

interface AlertRow {
  productId: string; productName: string; variantId: string | null; variantName: string | null;
  departmentName: string; stockQty: number; lowStockThreshold: number | null; level: "out" | "critical" | "low";
}

export default function InventoryAlertsPage() {
  useRoleGuard(["owner", "manager"]);

  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pos/admin/inventory/alerts");
      const json = await res.json();
      setAlerts(json.alerts ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Low Stock Alerts"
        subtitle="Every product or variant currently Low, Critical or Out of Stock"
        action={<Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</Button>}
      />
      <div className="flex-1 overflow-y-auto p-6">
        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E4E4DE] text-left text-xs font-semibold text-[#7A7A72] uppercase tracking-wide">
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3 text-right">Stock</th>
                  <th className="px-4 py-3 text-right">Threshold</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-[#7A7A72]">Loading…</td></tr>
                ) : alerts.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-14 text-center text-[#7A7A72]"><AlertTriangle className="w-8 h-8 mx-auto text-[#CFCEC6] mb-2" />Nothing needs attention right now.</td></tr>
                ) : (
                  alerts.map((a, i) => (
                    <tr key={`${a.productId}-${a.variantId ?? i}`} className="border-b border-[#E4E4DE] last:border-0">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#1A1A16]">{a.productName}{a.variantName ? ` — ${a.variantName}` : ""}</p>
                      </td>
                      <td className="px-4 py-3 text-[#4A4A44]">{a.departmentName}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{a.stockQty}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#7A7A72]">{a.lowStockThreshold ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Badge variant={a.level === "out" ? "overdue" : a.level === "critical" ? "overdue" : "partial"}>
                          {a.level === "out" ? "Out of Stock" : a.level === "critical" ? "Critical" : "Low"}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
