"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, CheckCircle2 } from "lucide-react";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

interface CountItem {
  id: string; product_id: string; variant_id: string | null; system_qty: number;
  counted_qty: number | null; variance: number | null; productName: string; variantName: string | null; sku: string | null;
}
interface CountDetail {
  id: string; name: string | null; status: "draft" | "submitted" | "applied" | "cancelled"; due_date: string | null;
}

export default function StockCountDetailPage() {
  useRoleGuard(["owner", "manager"]);
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [count, setCount] = useState<CountDetail | null>(null);
  const [items, setItems] = useState<CountItem[]>([]);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pos/admin/inventory/counts/${params.id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not load this count");
      setCount(json.count);
      setItems(json.items ?? []);
      const initial: Record<string, string> = {};
      for (const it of json.items ?? []) initial[it.id] = it.counted_qty != null ? String(it.counted_qty) : "";
      setCounted(initial);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load this count");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { void load(); }, [load]);

  const editable = count?.status === "draft" || count?.status === "submitted";

  async function handleSaveDraft(nextStatus?: "submitted") {
    setSaving(true);
    try {
      const res = await fetch(`/api/pos/admin/inventory/counts/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((it) => ({ id: it.id, countedQty: counted[it.id] !== "" ? Number(counted[it.id]) : null })),
          status: nextStatus,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      toast.success(nextStatus === "submitted" ? "Count submitted for review" : "Progress saved");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function handleApply() {
    if (!confirm("Post this count? This will create stock correction movements and update live quantities.")) return;
    setApplying(true);
    try {
      const res = await fetch(`/api/pos/admin/inventory/counts/${params.id}/apply`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not apply the count");
      toast.success(`Count applied — ${json.corrections} correction${json.corrections === 1 ? "" : "s"} posted`);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply the count");
    } finally {
      setApplying(false);
    }
  }

  const previewVariance = (it: CountItem) => {
    const v = counted[it.id];
    if (v === "" || v == null) return null;
    return Number(v) - it.system_qty;
  };

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title={count?.name || "Stock Count"}
        subtitle={count ? `Status: ${count.status}${count.due_date ? ` · Due ${count.due_date}` : ""}` : ""}
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => router.push("/dashboard/pos/inventory/counts")}>Back to counts</Button>
            <Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</Button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {count && (
          <div className="flex items-center gap-2">
            <Badge variant={count.status === "applied" ? "active" : count.status === "submitted" ? "pending" : "inactive"}>{count.status}</Badge>
            {count.status === "applied" && <span className="text-xs text-[#7A7A72] flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Movements posted — quantities are final</span>}
          </div>
        )}

        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E4E4DE] text-left text-xs font-semibold text-[#7A7A72] uppercase tracking-wide">
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3 text-right">Expected</th>
                  <th className="px-4 py-3 text-right">Counted</th>
                  <th className="px-4 py-3 text-right">Variance</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-[#7A7A72]">Loading…</td></tr>
                ) : (
                  items.map((it) => {
                    const variance = count?.status === "applied" ? it.variance : previewVariance(it);
                    return (
                      <tr key={it.id} className="border-b border-[#E4E4DE] last:border-0">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-[#1A1A16]">{it.productName}{it.variantName ? ` — ${it.variantName}` : ""}</p>
                          {it.sku && <p className="text-xs text-[#7A7A72]">{it.sku}</p>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-[#7A7A72]">{it.system_qty}</td>
                        <td className="px-4 py-3 text-right">
                          {editable ? (
                            <input
                              type="number"
                              className="w-24 h-9 px-2 rounded-lg border border-[#E4E4DE] text-right tabular-nums"
                              value={counted[it.id] ?? ""}
                              onChange={(e) => setCounted((c) => ({ ...c, [it.id]: e.target.value }))}
                            />
                          ) : (
                            <span className="tabular-nums">{it.counted_qty ?? "—"}</span>
                          )}
                        </td>
                        <td className={`px-4 py-3 text-right tabular-nums font-semibold ${variance != null && variance !== 0 ? (variance > 0 ? "text-green-700" : "text-red-600") : "text-[#7A7A72]"}`}>
                          {variance != null ? (variance > 0 ? `+${variance}` : variance) : "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {editable && (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => void handleSaveDraft()} disabled={saving}>{saving ? "Saving…" : "Save Progress"}</Button>
            {count?.status === "draft" && (
              <Button variant="secondary" onClick={() => void handleSaveDraft("submitted")} disabled={saving}>Submit for Review</Button>
            )}
            <Button onClick={() => void handleApply()} disabled={applying}>{applying ? "Posting…" : "Post Count"}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
