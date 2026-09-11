"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, X, Package, RefreshCw } from "lucide-react";
import { useCurrentUser } from "@/contexts/CurrentUserContext";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatPKR, timeAgo } from "@/lib/utils";

interface SkuRow {
  productId: string; productName: string; variantId: string | null; variantName: string | null;
  departmentId: string; departmentName: string; financialOwner: "levelup" | "healthbox";
  trackInventory: boolean; stockQty: number; lowStockThreshold: number | null; sku: string | null;
}
interface Supplier { id: string; name: string }
interface ReceiptLine { key: string; productId: string; variantId: string | null; label: string; qty: string; unitCost: string }
interface ReceiptRow {
  id: string; received_date: string; reference: string | null; total_qty: number; total_cost: number;
  supplierName: string | null; created_at: string;
}

function skuLabel(s: SkuRow) {
  return s.variantName ? `${s.productName} — ${s.variantName}` : s.productName;
}

export default function ReceiveStockPage() {
  useRoleGuard(["owner", "manager", "healthbox_staff"]);
  const user = useCurrentUser();
  const isHealthBox = user?.role === "healthbox_staff";

  const [skus, setSkus] = useState<SkuRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [recent, setRecent] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Receive form
  const [supplierId, setSupplierId] = useState("");
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<ReceiptLine[]>([{ key: "0", productId: "", variantId: null, label: "", qty: "1", unitCost: "" }]);
  const [saving, setSaving] = useState(false);

  // HealthBox wastage/expiry
  const [wProductKey, setWProductKey] = useState("");
  const [wType, setWType] = useState<"wastage" | "expiry">("wastage");
  const [wQty, setWQty] = useState("1");
  const [wNote, setWNote] = useState("");
  const [wSaving, setWSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [skuRes, supRes, recRes] = await Promise.all([
        fetch("/api/pos/admin/inventory/skus"),
        isHealthBox ? Promise.resolve(null) : fetch("/api/pos/admin/suppliers"),
        fetch("/api/pos/admin/inventory/receipts?limit=10"),
      ]);
      const skuJson = await skuRes.json();
      setSkus(skuJson.skus ?? []);
      if (supRes) {
        const supJson = await supRes.json();
        setSuppliers((supJson.suppliers ?? []).filter((s: { status: string }) => s.status === "active"));
      }
      const recJson = await recRes.json();
      setRecent(recJson.receipts ?? []);
    } finally {
      setLoading(false);
    }
  }, [isHealthBox]);

  useEffect(() => { void load(); }, [load]);

  const skuByKey = useMemo(() => new Map(skus.map((s) => [`${s.productId}::${s.variantId ?? ""}`, s])), [skus]);

  function updateLine(key: string, patch: Partial<ReceiptLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function pickSkuForLine(key: string, skuKey: string) {
    const s = skuByKey.get(skuKey);
    if (!s) return;
    updateLine(key, { productId: s.productId, variantId: s.variantId, label: skuLabel(s) });
  }

  async function handleReceive() {
    const validLines = lines.filter((l) => l.productId && Number(l.qty) > 0);
    if (validLines.length === 0) {
      toast.error("Add at least one line with a product and quantity");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/pos/admin/inventory/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: supplierId || null,
          receivedDate,
          reference: reference || null,
          note: note || null,
          items: validLines.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: Number(l.qty), unitCost: l.unitCost ? Number(l.unitCost) : null })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not post the receipt");
      toast.success("Stock received");
      setLines([{ key: String(Date.now()), productId: "", variantId: null, label: "", qty: "1", unitCost: "" }]);
      setReference(""); setNote("");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not post the receipt");
    } finally {
      setSaving(false);
    }
  }

  async function handleRecordWastage() {
    const s = skuByKey.get(wProductKey);
    if (!s) { toast.error("Choose a product"); return; }
    const qty = Number(wQty);
    if (!Number.isFinite(qty) || qty <= 0) { toast.error("Enter a quantity greater than zero"); return; }
    setWSaving(true);
    try {
      const res = await fetch("/api/pos/admin/inventory/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: s.productId, variantId: s.variantId, type: wType, qtyDelta: -qty, note: wNote || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not record this");
      toast.success(`Recorded ${wType} for ${skuLabel(s)}`);
      setWQty("1"); setWNote("");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record this");
    } finally {
      setWSaving(false);
    }
  }

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Receive Stock"
        subtitle={isHealthBox ? "Receive HealthBox stock and record wastage or expiry" : "Log a delivery — updates quantities immediately"}
        action={<Button variant="secondary" size="sm" onClick={() => void load()}><RefreshCw className="w-4 h-4" /> Refresh</Button>}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Card>
          <CardHeader title="New Receipt" subtitle="One or more products per receipt" />
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {!isHealthBox && (
              <Select label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">No supplier</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            )}
            <Input label="Received Date" type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
            <Input label="Invoice / Reference #" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>

          <div className="mt-5 space-y-3">
            {lines.map((l, i) => (
              <div key={l.key} className="border border-[#E4E4DE] rounded-lg p-3 grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
                <div className="sm:col-span-2">
                  {i === 0 && <label className="block text-xs font-medium text-[#4A4A44] mb-1">Product</label>}
                  <select
                    className="w-full h-10 px-3 rounded-lg border border-[#E4E4DE] text-sm bg-white"
                    value={l.productId ? `${l.productId}::${l.variantId ?? ""}` : ""}
                    onChange={(e) => pickSkuForLine(l.key, e.target.value)}
                  >
                    <option value="">Select a product…</option>
                    {skus.map((s) => (
                      <option key={`${s.productId}::${s.variantId ?? ""}`} value={`${s.productId}::${s.variantId ?? ""}`}>
                        {skuLabel(s)} {s.sku ? `(${s.sku})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <Input label={i === 0 ? "Quantity" : undefined} type="number" value={l.qty} onChange={(e) => updateLine(l.key, { qty: e.target.value })} />
                <Input label={i === 0 ? "Unit Cost (Rs)" : undefined} type="number" value={l.unitCost} onChange={(e) => updateLine(l.key, { unitCost: e.target.value })} />
                <div className="flex items-center gap-2">
                  <p className="text-xs text-[#7A7A72] flex-1">
                    Line total: {formatPKR((Number(l.qty) || 0) * (Number(l.unitCost) || 0))}
                  </p>
                  <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="p-2 rounded-lg text-red-600 hover:bg-red-50"><X className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
            <Button variant="secondary" size="sm" type="button" onClick={() => setLines((ls) => [...ls, { key: String(Date.now()), productId: "", variantId: null, label: "", qty: "1", unitCost: "" }])}>
              <Plus className="w-4 h-4" /> Add Line
            </Button>
          </div>

          <div className="mt-4">
            <label className="block text-xs font-medium text-[#4A4A44] mb-1">Notes</label>
            <textarea className="w-full min-h-[70px] px-3 py-2 rounded-lg border border-[#E4E4DE] text-sm" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <div className="mt-5 flex justify-end">
            <Button onClick={() => void handleReceive()} disabled={saving}>{saving ? "Posting…" : "Post Receipt"}</Button>
          </div>
        </Card>

        {isHealthBox && (
          <Card>
            <CardHeader title="Record Wastage / Expiry" subtitle="HealthBox stock only — for anything else, ask an Owner or Manager" />
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#4A4A44] mb-1">Product</label>
                <select className="w-full h-10 px-3 rounded-lg border border-[#E4E4DE] text-sm bg-white" value={wProductKey} onChange={(e) => setWProductKey(e.target.value)}>
                  <option value="">Select a product…</option>
                  {skus.map((s) => (
                    <option key={`${s.productId}::${s.variantId ?? ""}`} value={`${s.productId}::${s.variantId ?? ""}`}>{skuLabel(s)}</option>
                  ))}
                </select>
              </div>
              <Select label="Reason" value={wType} onChange={(e) => setWType(e.target.value as "wastage" | "expiry")}>
                <option value="wastage">Wastage</option>
                <option value="expiry">Expiry</option>
              </Select>
              <Input label="Quantity" type="number" value={wQty} onChange={(e) => setWQty(e.target.value)} />
            </div>
            <div className="mt-4">
              <Input label="Note (optional)" value={wNote} onChange={(e) => setWNote(e.target.value)} />
            </div>
            <div className="mt-5 flex justify-end">
              <Button onClick={() => void handleRecordWastage()} disabled={wSaving}>{wSaving ? "Saving…" : "Record"}</Button>
            </div>
          </Card>
        )}

        <Card padding={false}>
          <div className="p-5 border-b border-[#E4E4DE]">
            <CardHeader title="Recent Receipts" />
          </div>
          <div className="divide-y divide-[#E4E4DE]">
            {loading ? (
              <p className="px-5 py-6 text-sm text-[#7A7A72]">Loading…</p>
            ) : recent.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-[#7A7A72]"><Package className="w-8 h-8 mx-auto text-[#CFCEC6] mb-2" />No receipts yet.</p>
            ) : (
              recent.map((r) => (
                <div key={r.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[#1A1A16]">{r.supplierName ?? "No supplier"} {r.reference ? `· ${r.reference}` : ""}</p>
                    <p className="text-xs text-[#7A7A72]">{r.total_qty} units · {formatPKR(r.total_cost)}</p>
                  </div>
                  <p className="text-xs text-[#7A7A72] flex-shrink-0 ml-4">{timeAgo(r.created_at)}</p>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
