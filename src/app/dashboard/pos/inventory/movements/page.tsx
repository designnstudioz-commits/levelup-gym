"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, History, Search } from "lucide-react";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { MOVEMENT_TYPE_LABELS } from "@/lib/pos/inventory";

interface MovementRow {
  id: string; type: string; qty_delta: number; qty_before: number | null; qty_after: number | null;
  productName: string; sku: string | null; variantName: string | null; userName: string;
  reference: string | null; reason_note: string | null; created_at: string;
}

export default function StockMovementsPage() {
  useRoleGuard(["owner", "manager"]);

  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      const res = await fetch(`/api/pos/admin/inventory/movements?${params.toString()}`);
      const json = await res.json();
      setMovements(json.movements ?? []);
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => { void load(); }, [load]);

  const filtered = movements.filter((m) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return m.productName.toLowerCase().includes(q) || (m.sku ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Stock Movement History"
        subtitle="Every stock change, immutable — searchable and filterable"
        action={<Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</Button>}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#7A7A72]" />
            <input
              className="w-full h-10 pl-9 pr-3 rounded-lg border border-[#E4E4DE] text-sm"
              placeholder="Search by product or SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={type} onChange={(e) => setType(e.target.value)} className="sm:w-64">
            <option value="">All movement types</option>
            {Object.entries(MOVEMENT_TYPE_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </Select>
        </div>

        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E4E4DE] text-left text-xs font-semibold text-[#7A7A72] uppercase tracking-wide">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Change</th>
                  <th className="px-4 py-3 text-right">Before → After</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Reference / Notes</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-[#7A7A72]">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-14 text-center text-[#7A7A72]"><History className="w-8 h-8 mx-auto text-[#CFCEC6] mb-2" />No movements match.</td></tr>
                ) : (
                  filtered.map((m) => (
                    <tr key={m.id} className="border-b border-[#E4E4DE] last:border-0">
                      <td className="px-4 py-3 text-xs text-[#7A7A72] whitespace-nowrap">{new Date(m.created_at).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#1A1A16]">{m.productName}{m.variantName ? ` — ${m.variantName}` : ""}</p>
                        {m.sku && <p className="text-xs text-[#7A7A72]">{m.sku}</p>}
                      </td>
                      <td className="px-4 py-3"><Badge variant={m.qty_delta < 0 ? "overdue" : "active"}>{MOVEMENT_TYPE_LABELS[m.type] ?? m.type}</Badge></td>
                      <td className={`px-4 py-3 text-right tabular-nums font-semibold ${m.qty_delta < 0 ? "text-red-600" : "text-green-700"}`}>{m.qty_delta > 0 ? "+" : ""}{m.qty_delta}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#7A7A72]">{m.qty_before ?? "—"} → {m.qty_after ?? "—"}</td>
                      <td className="px-4 py-3 text-[#4A4A44]">{m.userName}</td>
                      <td className="px-4 py-3 text-xs text-[#7A7A72]">{m.reference ?? ""}{m.reason_note ? ` "${m.reason_note}"` : ""}</td>
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
