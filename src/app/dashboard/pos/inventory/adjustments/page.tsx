"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { timeAgo } from "@/lib/utils";
import { ADJUSTMENT_REASONS, adjustmentReasonLabel } from "@/lib/pos/inventory";

interface SkuRow {
  productId: string; productName: string; variantId: string | null; variantName: string | null;
  stockQty: number; trackInventory: boolean;
}
interface MovementRow {
  id: string; type: string; qty_delta: number; qty_before: number | null; qty_after: number | null;
  productName: string; variantName: string | null; userName: string; reason_note: string | null; created_at: string;
}

function skuLabel(s: SkuRow) {
  return s.variantName ? `${s.productName} — ${s.variantName}` : s.productName;
}

const ADJUSTMENT_TYPES = new Set<string>(ADJUSTMENT_REASONS.map((r) => r.value));

export default function StockAdjustmentsPage() {
  useRoleGuard(["owner", "manager"]);

  const [skus, setSkus] = useState<SkuRow[]>([]);
  const [recent, setRecent] = useState<MovementRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [skuKey, setSkuKey] = useState("");
  const [type, setType] = useState<string>("damage");
  const [qty, setQty] = useState("1");
  const [direction, setDirection] = useState<"decrease" | "increase">("decrease");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [skuRes, movRes] = await Promise.all([
        fetch("/api/pos/admin/inventory/skus"),
        fetch("/api/pos/admin/inventory/movements?limit=30"),
      ]);
      const skuJson = await skuRes.json();
      setSkus((skuJson.skus ?? []).filter((s: SkuRow) => s.trackInventory));
      const movJson = await movRes.json();
      setRecent((movJson.movements ?? []).filter((m: MovementRow) => ADJUSTMENT_TYPES.has(m.type)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const skuByKey = useMemo(() => new Map(skus.map((s) => [`${s.productId}::${s.variantId ?? ""}`, s])), [skus]);
  const selected = skuByKey.get(skuKey);
  const reasonDef = ADJUSTMENT_REASONS.find((r) => r.value === type);
  const current = selected?.stockQty ?? 0;
  const signedQty = (direction === "decrease" ? -1 : 1) * (Number(qty) || 0);
  const resultQty = current + signedQty;

  async function handleSubmit() {
    if (!selected) { toast.error("Choose a product"); return; }
    if (!Number.isFinite(Number(qty)) || Number(qty) <= 0) { toast.error("Enter a quantity greater than zero"); return; }
    if (reasonDef?.requiresNotes && !note.trim()) { toast.error(`A note is required for "${reasonDef.label}"`); return; }
    if (resultQty < 0) { toast.error(`That would take stock below zero (currently ${current})`); return; }

    setSaving(true);
    try {
      const res = await fetch("/api/pos/admin/inventory/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: selected.productId, variantId: selected.variantId, type, qtyDelta: signedQty, note: note || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not record the adjustment");
      toast.success("Adjustment recorded");
      setQty("1"); setNote("");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the adjustment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Stock Adjustments"
        subtitle="Damage, expiry, wastage, loss/theft, internal use, and authorized manual corrections"
        action={<Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</Button>}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Card>
          <CardHeader title="New Adjustment" />
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-[#4A4A44] mb-1">Product</label>
              <select className="w-full h-10 px-3 rounded-lg border border-[#E4E4DE] text-sm bg-white" value={skuKey} onChange={(e) => setSkuKey(e.target.value)}>
                <option value="">Select a product…</option>
                {skus.map((s) => (
                  <option key={`${s.productId}::${s.variantId ?? ""}`} value={`${s.productId}::${s.variantId ?? ""}`}>{skuLabel(s)}</option>
                ))}
              </select>
            </div>
            <Select label="Reason" value={type} onChange={(e) => setType(e.target.value)}>
              {ADJUSTMENT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
            <Select label="Direction" value={direction} onChange={(e) => setDirection(e.target.value as "decrease" | "increase")}>
              <option value="decrease">Decrease stock</option>
              <option value="increase">Increase stock</option>
            </Select>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
            <Input label="Adjustment Quantity" type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
            <div className="sm:col-span-3 bg-[#F7F6F3] rounded-lg p-3 flex items-center gap-6 text-sm">
              <span className="text-[#7A7A72]">Current: <strong className="text-[#1A1A16]">{selected ? current : "—"}</strong></span>
              <span className="text-[#7A7A72]">Resulting: <strong className={resultQty < 0 ? "text-red-600" : "text-[#1A1A16]"}>{selected ? resultQty : "—"}</strong></span>
            </div>
          </div>

          <div className="mt-4">
            <Input label={reasonDef?.requiresNotes ? "Notes (required)" : "Notes (optional)"} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <div className="mt-5 flex justify-end">
            <Button onClick={() => void handleSubmit()} disabled={saving}>{saving ? "Saving…" : "Record Adjustment"}</Button>
          </div>
        </Card>

        <Card padding={false}>
          <div className="p-5 border-b border-[#E4E4DE]">
            <CardHeader title="Recent Adjustments" />
          </div>
          <div className="divide-y divide-[#E4E4DE]">
            {loading ? (
              <p className="px-5 py-6 text-sm text-[#7A7A72]">Loading…</p>
            ) : recent.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-[#7A7A72]"><SlidersHorizontal className="w-8 h-8 mx-auto text-[#CFCEC6] mb-2" />No adjustments recorded yet.</p>
            ) : (
              recent.map((m) => (
                <div key={m.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[#1A1A16]">{m.productName}{m.variantName ? ` — ${m.variantName}` : ""} — {adjustmentReasonLabel(m.type)}</p>
                    <p className="text-xs text-[#7A7A72]">{m.qty_delta > 0 ? "+" : ""}{m.qty_delta} ({m.qty_before} → {m.qty_after}) · {m.userName}{m.reason_note ? ` · "${m.reason_note}"` : ""}</p>
                  </div>
                  <p className="text-xs text-[#7A7A72] flex-shrink-0 ml-4">{timeAgo(m.created_at)}</p>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
