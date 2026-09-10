"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Plus, Search, Package, RefreshCw, Pencil, Archive, ImagePlus, Loader2, X } from "lucide-react";
import Image from "next/image";
import { useCurrentUser } from "@/contexts/CurrentUserContext";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { formatPKR, cn } from "@/lib/utils";
import { canSeeCostAndMargin } from "@/lib/pos/permissions";

interface Department { id: string; name: string; financialOwner: "levelup" | "healthbox" }
interface Category { id: string; departmentId: string; name: string }
interface ModifierGroupLite { id: string; departmentId: string | null; name: string }

interface ProductRow {
  id: string; department_id: string; category_id: string | null; name: string; brand: string | null;
  sku: string | null; barcode: string | null; image_url: string | null; selling_price: number;
  cost_price?: number; member_price_type: string; is_active: boolean; show_on_pos: boolean;
  is_available: boolean; track_inventory: boolean; stock_qty: number; low_stock_threshold: number | null;
  departmentName: string; effectiveFinancialOwner: "levelup" | "healthbox"; stockStatus: string;
  hasVariants: boolean; priceMin: number | null; priceMax: number | null;
}

interface VariantForm {
  // price/cost are the variant's own absolute figures — a "large bottle" is
  // its own sellable item, not an add-on to a parent price. Required: a
  // product with variants has no customer-facing price of its own (LOCKED
  // RULE), so every variant must carry a valid price.
  id?: string; name: string; sku: string; barcode: string; price: string;
  cost: string; stockQty: string; lowStockThreshold: string; isAvailable: boolean;
}

const emptyVariant: VariantForm = { name: "", sku: "", barcode: "", price: "", cost: "", stockQty: "0", lowStockThreshold: "", isAvailable: true };

const emptyForm = {
  id: "", departmentId: "", categoryId: "", brand: "", sku: "", barcode: "", imageUrl: "",
  sellingPrice: "", costPrice: "", memberPriceType: "none" as "none" | "fixed" | "percent",
  memberPrice: "", memberDiscountPercent: "", trackInventory: false, stockQty: "0",
  lowStockThreshold: "", unit: "", description: "", isActive: true, showOnPos: true,
  isAvailable: true, financialOwnerOverride: "" as "" | "levelup" | "healthbox",
  name: "", modifierGroupIds: [] as string[],
};

export default function PosProductsPage() {
  useRoleGuard(["owner", "manager", "healthbox_staff"]);
  const currentUser = useCurrentUser();
  const seeCost = canSeeCostAndMargin(currentUser?.role);
  const isOwner = currentUser?.role === "owner";

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroupLite[]>([]);
  const [loading, setLoading] = useState(true);

  const searchParams = useSearchParams();
  const [filters, setFilters] = useState(() => ({
    department: searchParams.get("department_id") ?? "all",
    category: "all", owner: "all", active: "all", showOnPos: "all", available: "all", stock: "all", search: "",
  }));

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [variants, setVariants] = useState<VariantForm[]>([]);
  const [useVariants, setUseVariants] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const loadRefData = useCallback(async () => {
    const [dRes, cRes, mRes] = await Promise.all([
      fetch("/api/pos/admin/departments"),
      fetch("/api/pos/admin/categories"),
      fetch("/api/pos/admin/modifier-groups"),
    ]);
    const dJson = await dRes.json();
    const cJson = await cRes.json();
    const mJson = await mRes.json();
    setDepartments((dJson.departments ?? []).map((d: { id: string; name: string; financial_owner: string }) => ({ id: d.id, name: d.name, financialOwner: d.financial_owner })));
    setCategories((cJson.categories ?? []).map((c: { id: string; department_id: string; name: string }) => ({ id: c.id, departmentId: c.department_id, name: c.name })));
    setModifierGroups((mJson.groups ?? []).map((g: { id: string; department_id: string | null; name: string }) => ({ id: g.id, departmentId: g.department_id, name: g.name })));
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.department !== "all") params.set("department_id", filters.department);
      if (filters.category !== "all") params.set("category_id", filters.category);
      if (filters.owner !== "all") params.set("financial_owner", filters.owner);
      if (filters.active !== "all") params.set("active", filters.active);
      if (filters.showOnPos !== "all") params.set("show_on_pos", filters.showOnPos);
      if (filters.available !== "all") params.set("available", filters.available);
      if (filters.stock !== "all") params.set("stock_status", filters.stock);
      if (filters.search.trim()) params.set("search", filters.search.trim());
      const res = await fetch(`/api/pos/admin/products?${params.toString()}`);
      const json = await res.json();
      setProducts(json.products ?? []);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { void loadRefData(); }, [loadRefData]);
  useEffect(() => { void loadProducts(); }, [loadProducts]);

  const categoriesForForm = useMemo(() => categories.filter((c) => c.departmentId === form.departmentId), [categories, form.departmentId]);
  const modifierGroupsForForm = useMemo(
    () => modifierGroups.filter((g) => g.departmentId === form.departmentId || g.departmentId === null),
    [modifierGroups, form.departmentId]
  );

  function openAdd() {
    setForm({ ...emptyForm, departmentId: departments[0]?.id ?? "" });
    setVariants([]);
    setUseVariants(false);
    setModalOpen(true);
  }

  async function openEdit(id: string) {
    const res = await fetch(`/api/pos/admin/products/${id}`);
    const json = await res.json();
    if (!res.ok) { toast.error(json.error ?? "Could not load product"); return; }
    const p = json.product;
    setForm({
      id: p.id, departmentId: p.department_id, categoryId: p.category_id ?? "",
      brand: p.brand ?? "", sku: p.sku ?? "", barcode: p.barcode ?? "", imageUrl: p.image_url ?? "",
      sellingPrice: String(p.selling_price), costPrice: p.cost_price != null ? String(p.cost_price) : "",
      memberPriceType: p.member_price_type, memberPrice: p.member_price != null ? String(p.member_price) : "",
      memberDiscountPercent: p.member_discount_percent != null ? String(p.member_discount_percent) : "",
      trackInventory: p.track_inventory, stockQty: String(p.stock_qty ?? 0),
      lowStockThreshold: p.low_stock_threshold != null ? String(p.low_stock_threshold) : "",
      unit: p.unit ?? "", description: p.description ?? "", isActive: p.is_active,
      showOnPos: p.show_on_pos, isAvailable: p.is_available,
      financialOwnerOverride: p.financial_owner_override ?? "", name: p.name,
      modifierGroupIds: json.modifierGroupIds ?? [],
    });
    setVariants((json.variants ?? []).map((v: { id: string; name: string; sku: string | null; barcode: string | null; price: number | null; cost: number | null; stock_qty: number; low_stock_threshold: number | null; is_available: boolean }) => ({
      id: v.id, name: v.name, sku: v.sku ?? "", barcode: v.barcode ?? "",
      price: v.price != null ? String(v.price) : "", cost: v.cost != null ? String(v.cost) : "",
      stockQty: String(v.stock_qty), lowStockThreshold: v.low_stock_threshold != null ? String(v.low_stock_threshold) : "",
      isAvailable: v.is_available,
    })));
    setUseVariants((json.variants ?? []).length > 0);
    setModalOpen(true);
  }

  async function handleImageUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/pos/upload/product-image", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setForm((f) => ({ ...f, imageUrl: json.url }));
      toast.success("Image uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!form.name.trim() || !form.departmentId) {
      toast.error("Name and department are required");
      return;
    }
    // A product with variants is a catalogue container — it has no
    // customer-facing price of its own, so the parent Selling Price isn't
    // required. Each sellable variant must have its own valid price instead.
    if (!useVariants && !form.sellingPrice) {
      toast.error("Selling price is required");
      return;
    }
    if (useVariants) {
      if (variants.length === 0) {
        toast.error("Add at least one variant, or turn variants off");
        return;
      }
      const bad = variants.find((v) => !v.name.trim() || v.price === "" || !Number.isFinite(Number(v.price)) || Number(v.price) < 0);
      if (bad) {
        toast.error("Every variant needs a name and a valid selling price");
        return;
      }
    }
    setSaving(true);
    try {
      const payload = {
        departmentId: form.departmentId, categoryId: form.categoryId || null,
        name: form.name.trim(), description: form.description || null, brand: form.brand || null,
        sku: form.sku || null, barcode: form.barcode || null, imageUrl: form.imageUrl || null,
        unit: form.unit || null,
        // Not a sellable price once variants exist — stored as 0 rather than
        // whatever stale figure the field last held (see LOCKED RULE).
        sellingPrice: useVariants ? 0 : Number(form.sellingPrice),
        costPrice: seeCost && form.costPrice ? Number(form.costPrice) : null,
        memberPriceType: form.memberPriceType,
        memberPrice: form.memberPriceType === "fixed" && form.memberPrice ? Number(form.memberPrice) : null,
        memberDiscountPercent: form.memberPriceType === "percent" && form.memberDiscountPercent ? Number(form.memberDiscountPercent) : null,
        financialOwnerOverride: isOwner ? (form.financialOwnerOverride || null) : undefined,
        trackInventory: form.trackInventory,
        stockQty: useVariants ? 0 : Number(form.stockQty) || 0,
        lowStockThreshold: form.lowStockThreshold ? Number(form.lowStockThreshold) : null,
        isActive: form.isActive, showOnPos: form.showOnPos, isAvailable: form.isAvailable,
        modifierGroupIds: form.modifierGroupIds,
        variants: useVariants ? variants.map((v) => ({
          id: v.id, name: v.name.trim(), sku: v.sku || null, barcode: v.barcode || null,
          price: v.price ? Number(v.price) : null, cost: seeCost && v.cost ? Number(v.cost) : null,
          stockQty: Number(v.stockQty) || 0, lowStockThreshold: v.lowStockThreshold ? Number(v.lowStockThreshold) : null,
          isAvailable: v.isAvailable,
        })) : [],
      };

      const url = form.id ? `/api/pos/admin/products/${form.id}` : "/api/pos/admin/products";
      const res = await fetch(url, {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save the product");

      toast.success(form.id ? "Product updated" : "Product created");
      setModalOpen(false);
      void loadProducts();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the product");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(p: ProductRow) {
    if (!confirm(`Archive "${p.name}"? It will disappear from the catalogue everywhere, including the terminal.`)) return;
    const res = await fetch(`/api/pos/admin/products/${p.id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) { toast.error(json.error ?? "Could not archive"); return; }
    toast.success(`${p.name} archived`);
    void loadProducts();
  }

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Product Catalog"
        subtitle="Search, filter and manage everything sellable at the terminal"
        action={<Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" /> Add Product</Button>}
      />

      <div className="flex-1 overflow-y-auto p-6">
        <Card padding={false}>
          <div className="p-4 border-b border-[#E4E4DE] flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#7A7A72]" />
              <input
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                placeholder="Search name, SKU or barcode..."
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#E4E4DE] focus:outline-none focus:ring-2 focus:ring-[#F06418]"
              />
            </div>
            <Select value={filters.department} onChange={(e) => setFilters((f) => ({ ...f, department: e.target.value, category: "all" }))} className="w-40">
              <option value="all">All departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
            <Select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} className="w-40">
              <option value="all">All categories</option>
              {categories.filter((c) => filters.department === "all" || c.departmentId === filters.department).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select value={filters.owner} onChange={(e) => setFilters((f) => ({ ...f, owner: e.target.value }))} className="w-36">
              <option value="all">Any owner</option>
              <option value="levelup">Level Up</option>
              <option value="healthbox">HealthBox</option>
            </Select>
            <Select value={filters.active} onChange={(e) => setFilters((f) => ({ ...f, active: e.target.value }))} className="w-32">
              <option value="all">Any state</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </Select>
            <Select value={filters.showOnPos} onChange={(e) => setFilters((f) => ({ ...f, showOnPos: e.target.value }))} className="w-36">
              <option value="all">Show/Hidden</option>
              <option value="true">On POS</option>
              <option value="false">Hidden</option>
            </Select>
            <Select value={filters.available} onChange={(e) => setFilters((f) => ({ ...f, available: e.target.value }))} className="w-36">
              <option value="all">Any availability</option>
              <option value="true">Available</option>
              <option value="false">Sold out</option>
            </Select>
            <Select value={filters.stock} onChange={(e) => setFilters((f) => ({ ...f, stock: e.target.value }))} className="w-36">
              <option value="all">Any stock</option>
              <option value="ok">In stock</option>
              <option value="low">Low stock</option>
              <option value="out">Out of stock</option>
            </Select>
            <Button variant="secondary" size="sm" onClick={() => void loadProducts()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E4E4DE] text-left text-xs font-semibold text-[#7A7A72] uppercase tracking-wide">
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3">Stock</th>
                  <th className="px-4 py-3">States</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-[#7A7A72]">Loading…</td></tr>
                ) : products.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-14 text-center text-[#7A7A72]"><Package className="w-8 h-8 mx-auto text-[#CFCEC6] mb-2" />No products match this filter.</td></tr>
                ) : (
                  products.map((p) => (
                    <tr key={p.id} className="border-b border-[#E4E4DE] last:border-0 hover:bg-[#F7F6F3]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="relative w-9 h-9 rounded-lg bg-[#F7F6F3] border border-[#E4E4DE] flex-shrink-0 overflow-hidden flex items-center justify-center">
                            {p.image_url ? <Image src={p.image_url} alt="" fill sizes="36px" className="object-cover" /> : <Package className="w-4 h-4 text-[#CFCEC6]" />}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-[#1A1A16] truncate">{p.name}</p>
                            <p className="text-xs text-[#7A7A72]">{p.sku || "—"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[#4A4A44]">{p.departmentName}</td>
                      <td className="px-4 py-3"><Badge variant={p.effectiveFinancialOwner === "healthbox" ? "expiring" : "default"}>{p.effectiveFinancialOwner === "healthbox" ? "HealthBox" : "Level Up"}</Badge></td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">
                        {p.hasVariants
                          ? (p.priceMin != null && p.priceMax != null
                              ? (p.priceMin === p.priceMax ? formatPKR(p.priceMin) : `${formatPKR(p.priceMin)} – ${formatPKR(p.priceMax)}`)
                              : "—")
                          : formatPKR(p.selling_price)}
                      </td>
                      <td className="px-4 py-3">
                        {!p.track_inventory ? <span className="text-xs text-[#7A7A72]">Not tracked</span> : (
                          <Badge variant={p.stockStatus === "out" ? "overdue" : p.stockStatus === "low" ? "partial" : "active"}>
                            {p.stock_qty} {p.stockStatus === "low" ? "· Low" : p.stockStatus === "out" ? "· Out" : ""}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {!p.is_active && <Badge variant="inactive">Inactive</Badge>}
                          {p.is_active && !p.show_on_pos && <Badge variant="pending">Hidden</Badge>}
                          {p.is_active && p.show_on_pos && !p.is_available && <Badge variant="overdue">Sold out</Badge>}
                          {p.is_active && p.show_on_pos && p.is_available && <Badge variant="active">Live</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => openEdit(p.id)} className="p-2 rounded-lg text-[#7A7A72] hover:bg-white hover:text-[#F06418] transition-colors cursor-pointer"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => handleArchive(p)} className="p-2 rounded-lg text-[#7A7A72] hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer"><Archive className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? "Edit Product" : "Add Product"} size="xl">
        <div className="max-h-[72vh] overflow-y-auto pr-1 space-y-6">
          {/* Basic info */}
          <section className="grid grid-cols-2 gap-4">
            <Input label="Product Name" required className="col-span-2" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <Select label="Department" required value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value, categoryId: "" }))}>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
            <Select label="Category" value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}>
              <option value="">No category</option>
              {categoriesForForm.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Input label="Brand" value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} />
            <Input label="Unit" placeholder="e.g. piece, bottle" value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} />
            <Input label="SKU" value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} />
            <Input label="Barcode" value={form.barcode} onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))} />
          </section>

          {/* Image */}
          <section>
            <p className="text-sm font-medium text-[#1A1A16] mb-2">Product Image</p>
            <div className="flex items-center gap-4">
              <div className="relative w-20 h-20 rounded-xl bg-[#F7F6F3] border border-[#E4E4DE] flex items-center justify-center overflow-hidden flex-shrink-0">
                {form.imageUrl ? <Image src={form.imageUrl} alt="" fill sizes="80px" className="object-cover" /> : <ImagePlus className="w-6 h-6 text-[#CFCEC6]" />}
              </div>
              <label className="cursor-pointer">
                <span className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E4E4DE] text-sm font-semibold hover:border-[#F06418] transition-colors", uploading && "opacity-50 cursor-not-allowed")}>
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                  {form.imageUrl ? "Replace image" : "Upload image"}
                </span>
                <input type="file" accept="image/*" className="hidden" disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImageUpload(f); }} />
              </label>
              {form.imageUrl && (
                <button type="button" onClick={() => setForm((f) => ({ ...f, imageUrl: "" }))} className="text-xs text-red-600 hover:underline">Remove</button>
              )}
            </div>
          </section>

          {/* Financial */}
          <section className="grid grid-cols-2 gap-4">
            {useVariants ? (
              <div className="rounded-lg border border-dashed border-[#E4E4DE] bg-[#F7F6F3] px-4 py-3 flex flex-col justify-center">
                <p className="text-sm font-medium text-[#1A1A16]">Pricing is controlled by variants</p>
                <p className="text-xs text-[#7A7A72] mt-0.5">This product is a catalogue container — set each variant&apos;s own Selling Price below.</p>
              </div>
            ) : (
              <Input label="Selling Price (Rs)" type="number" required value={form.sellingPrice} onChange={(e) => setForm((f) => ({ ...f, sellingPrice: e.target.value }))} />
            )}
            {seeCost && <Input label="Cost Price (Rs)" type="number" value={form.costPrice} onChange={(e) => setForm((f) => ({ ...f, costPrice: e.target.value }))} hint="Owner/manager only" />}
            {isOwner && (
              <Select label="Financial Owner Override" className="col-span-2" value={form.financialOwnerOverride} onChange={(e) => setForm((f) => ({ ...f, financialOwnerOverride: e.target.value as "" | "levelup" | "healthbox" }))} hint="Leave blank to inherit from the department. Owner only.">
                <option value="">Inherit from department</option>
                <option value="levelup">Level Up</option>
                <option value="healthbox">HealthBox</option>
              </Select>
            )}
          </section>

          {/* Member pricing */}
          <section>
            <p className="text-sm font-medium text-[#1A1A16] mb-2">Member Pricing</p>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {(["none", "fixed", "percent"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setForm((f) => ({ ...f, memberPriceType: t }))}
                  className={cn("py-2 rounded-lg border text-sm font-semibold transition-colors cursor-pointer",
                    form.memberPriceType === t ? "bg-[#FEF0E8] border-[#F06418] text-[#C04E10]" : "bg-white border-[#E4E4DE] text-[#1A1A16] hover:border-[#F06418]")}>
                  {t === "none" ? "None" : t === "fixed" ? "Fixed Price" : "Percentage"}
                </button>
              ))}
            </div>
            {form.memberPriceType === "fixed" && (
              <Input label="Member Price (Rs)" type="number" value={form.memberPrice} onChange={(e) => setForm((f) => ({ ...f, memberPrice: e.target.value }))} hint="Never more than the regular selling price" />
            )}
            {form.memberPriceType === "percent" && (
              <Input label="Member Discount %" type="number" value={form.memberDiscountPercent} onChange={(e) => setForm((f) => ({ ...f, memberDiscountPercent: e.target.value }))} />
            )}
          </section>

          {/* Inventory */}
          <section>
            <Switch checked={form.trackInventory} onChange={(c) => setForm((f) => ({ ...f, trackInventory: c }))} label="Track Stock" />
            {form.trackInventory && !useVariants && (
              <div className="grid grid-cols-2 gap-4 mt-3">
                <Input label="Current Stock" type="number" value={form.stockQty} onChange={(e) => setForm((f) => ({ ...f, stockQty: e.target.value }))} />
                <Input label="Low Stock Threshold" type="number" value={form.lowStockThreshold} onChange={(e) => setForm((f) => ({ ...f, lowStockThreshold: e.target.value }))} />
              </div>
            )}
            {form.trackInventory && useVariants && (
              <p className="mt-2 text-xs text-[#7A7A72]">Stock is tracked per variant below — the lowest sellable SKU, per the inventory rule.</p>
            )}
          </section>

          {/* States — three separate switches, never collapsed into one */}
          <section className="grid grid-cols-3 gap-4 bg-[#F7F6F3] rounded-lg p-4">
            <Switch checked={form.isActive} onChange={(c) => setForm((f) => ({ ...f, isActive: c }))} label="Active" hint="Retired if off" />
            <Switch checked={form.showOnPos} onChange={(c) => setForm((f) => ({ ...f, showOnPos: c }))} label="Show on POS" hint="Hidden if off" />
            <Switch checked={form.isAvailable} onChange={(c) => setForm((f) => ({ ...f, isAvailable: c }))} label="Available" hint="Sold out if off" />
          </section>

          {/* Variants */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-[#1A1A16]">Variants</p>
              <Switch checked={useVariants} onChange={(c) => { setUseVariants(c); if (c && variants.length === 0) setVariants([{ ...emptyVariant }]); }} label="This product has variants" />
            </div>
            {useVariants && (
              <div className="space-y-3">
                <p className="text-xs text-[#7A7A72]">
                  Each variant is its own sellable item with its own price — e.g. Small Rs 6,500, Large Rs 11,500. Every variant needs a valid selling price.
                </p>
                {variants.map((v, i) => (
                  <div key={i} className={cn("border border-[#E4E4DE] rounded-lg p-3 grid gap-2 items-end", seeCost ? "grid-cols-2 sm:grid-cols-4 lg:grid-cols-8" : "grid-cols-2 sm:grid-cols-4 lg:grid-cols-7")}>
                    <Input label={i === 0 ? "Name" : undefined} placeholder="e.g. Large" value={v.name} onChange={(e) => setVariants((vs) => vs.map((x, xi) => xi === i ? { ...x, name: e.target.value } : x))} />
                    <Input label={i === 0 ? "SKU" : undefined} value={v.sku} onChange={(e) => setVariants((vs) => vs.map((x, xi) => xi === i ? { ...x, sku: e.target.value } : x))} />
                    <Input label={i === 0 ? "Barcode" : undefined} value={v.barcode} onChange={(e) => setVariants((vs) => vs.map((x, xi) => xi === i ? { ...x, barcode: e.target.value } : x))} />
                    <Input label={i === 0 ? "Selling Price (Rs)" : undefined} type="number" required value={v.price} onChange={(e) => setVariants((vs) => vs.map((x, xi) => xi === i ? { ...x, price: e.target.value } : x))} />
                    {seeCost && <Input label={i === 0 ? "Cost Price (Rs)" : undefined} type="number" value={v.cost} onChange={(e) => setVariants((vs) => vs.map((x, xi) => xi === i ? { ...x, cost: e.target.value } : x))} />}
                    <Input label={i === 0 ? "Stock" : undefined} type="number" value={v.stockQty} onChange={(e) => setVariants((vs) => vs.map((x, xi) => xi === i ? { ...x, stockQty: e.target.value } : x))} />
                    <Input label={i === 0 ? "Low Stock At" : undefined} type="number" value={v.lowStockThreshold} onChange={(e) => setVariants((vs) => vs.map((x, xi) => xi === i ? { ...x, lowStockThreshold: e.target.value } : x))} />
                    <button type="button" onClick={() => setVariants((vs) => vs.filter((_, xi) => xi !== i))} className="p-2.5 rounded-lg text-red-600 hover:bg-red-50 flex-shrink-0"><X className="w-4 h-4" /></button>
                  </div>
                ))}
                <Button variant="secondary" size="sm" type="button" onClick={() => setVariants((vs) => [...vs, { ...emptyVariant }])}><Plus className="w-4 h-4" /> Add Variant</Button>
              </div>
            )}
          </section>

          {/* Modifier groups */}
          {modifierGroupsForForm.length > 0 && (
            <section>
              <p className="text-sm font-medium text-[#1A1A16] mb-2">Modifier Groups</p>
              <div className="flex flex-wrap gap-2">
                {modifierGroupsForForm.map((g) => {
                  const on = form.modifierGroupIds.includes(g.id);
                  return (
                    <button key={g.id} type="button"
                      onClick={() => setForm((f) => ({ ...f, modifierGroupIds: on ? f.modifierGroupIds.filter((id) => id !== g.id) : [...f.modifierGroupIds, g.id] }))}
                      className={cn("px-3 py-1.5 rounded-full border text-sm font-semibold transition-colors cursor-pointer",
                        on ? "bg-[#F06418] text-white border-[#F06418]" : "bg-white text-[#1A1A16] border-[#E4E4DE] hover:border-[#F06418]")}>
                      {g.name}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section>
            <label className="text-sm font-medium text-[#1A1A16] block mb-1">Notes</label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
          </section>
        </div>

        <div className="flex items-center gap-2 pt-4 mt-4 border-t border-[#E4E4DE]">
          <Button variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">Cancel</Button>
          <Button onClick={handleSave} loading={saving} className="flex-1">Save Product</Button>
        </div>
      </Modal>
    </div>
  );
}
