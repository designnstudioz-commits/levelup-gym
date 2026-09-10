import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser, logPosActivity } from "@/lib/pos/auth";
import { POS_HEALTHBOX_ROLES, canSeeCostAndMargin, canSetFinancialOwner } from "@/lib/pos/permissions";
import { callerCanUseDepartment, callerDepartmentFilter, validateProductMoney, validateVariantPrices } from "@/lib/pos/catalogAdmin";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// One fixed select — always the full admin column set. Cost is stripped
// from the RESULT in JS below for anyone who must not see it
// (healthbox_staff), rather than varied at the query level: a ternary
// between two different .select() string literals makes Supabase infer a
// union of two row types, which blows up into "too complex to represent"
// once chained through several .eq()/.in()/.or()/.order() calls. One
// literal keeps the type simple; the security boundary is the same either
// way — the field just never leaves this function for the wrong caller.
const PRODUCT_COLUMNS =
  "id, department_id, category_id, supplier_id, name, description, brand, sku, barcode, image_url, unit, cost_price, selling_price, member_price_type, member_price, member_discount_percent, financial_owner_override, track_inventory, stock_qty, low_stock_threshold, is_active, show_on_pos, is_available, sort_order, created_at, updated_at";

/** List with filters, scoped by department for healthbox_staff and with
 *  cost/margin stripped for anyone but owner/manager. */
export async function GET(req: NextRequest) {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const admin = getServiceClient();
  const params = req.nextUrl.searchParams;
  const seeCost = canSeeCostAndMargin(caller.role);

  let query = admin
    .from("pos_products")
    .select(PRODUCT_COLUMNS)
    .is("deleted_at", null)
    .order("sort_order")
    .order("name");

  const deptFilter = callerDepartmentFilter(caller);
  const requestedDept = params.get("department_id");
  if (deptFilter !== null) {
    query = deptFilter.length > 0 ? query.in("department_id", deptFilter) : query.eq("department_id", "00000000-0000-0000-0000-000000000000");
  } else if (requestedDept) {
    query = query.eq("department_id", requestedDept);
  }

  const categoryId = params.get("category_id");
  if (categoryId) query = query.eq("category_id", categoryId);

  const active = params.get("active");
  if (active === "true") query = query.eq("is_active", true);
  if (active === "false") query = query.eq("is_active", false);

  const showOnPos = params.get("show_on_pos");
  if (showOnPos === "true") query = query.eq("show_on_pos", true);
  if (showOnPos === "false") query = query.eq("show_on_pos", false);

  const available = params.get("available");
  if (available === "true") query = query.eq("is_available", true);
  if (available === "false") query = query.eq("is_available", false);

  const search = params.get("search")?.trim();
  if (search) query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%,barcode.ilike.%${search}%`);

  const { data: products, error } = await query;
  if (error) {
    console.error("[POS admin products list]", error);
    return NextResponse.json({ error: "Could not load products" }, { status: 500 });
  }

  // financial_owner filter and stock-status filter are computed rather than
  // pushed into the SQL: financial owner needs the department join, and
  // stock status is a derived comparison (qty vs threshold), not a column.
  const deptIds = [...new Set((products ?? []).map((p) => p.department_id))];
  const { data: depts } = deptIds.length
    ? await admin.from("pos_departments").select("id, name, financial_owner").in("id", deptIds)
    : { data: [] };
  const deptById = new Map((depts ?? []).map((d) => [d.id, d]));

  // Per the locked inventory rule, stock lives on the variant row (not the
  // product row) once a product has variants — the product's own stock_qty
  // is never populated in that case. So the list's stock badge must reflect
  // variant stock, not the product column, for any product that has any.
  const productIds = (products ?? []).map((p) => p.id);
  const { data: allVariants } = productIds.length
    ? await admin.from("pos_product_variants").select("product_id, price, stock_qty, low_stock_threshold").in("product_id", productIds).is("deleted_at", null)
    : { data: [] };
  const variantsByProduct = new Map<string, { price: number | null; stock_qty: number; low_stock_threshold: number | null }[]>();
  for (const v of allVariants ?? []) {
    const list = variantsByProduct.get(v.product_id) ?? [];
    list.push({ price: v.price, stock_qty: v.stock_qty, low_stock_threshold: v.low_stock_threshold });
    variantsByProduct.set(v.product_id, list);
  }

  let rows = (products ?? []).map((p) => {
    const dept = deptById.get(p.department_id);
    const effectiveOwner = p.financial_owner_override ?? dept?.financial_owner ?? "levelup";
    const variants = variantsByProduct.get(p.id) ?? [];

    let stockStatus: "not_tracked" | "ok" | "low" | "out" = "not_tracked";
    let displayStockQty = p.stock_qty;
    if (p.track_inventory) {
      if (variants.length > 0) {
        displayStockQty = variants.reduce((sum, v) => sum + Number(v.stock_qty), 0);
        const anyLow = variants.some((v) => v.low_stock_threshold != null && v.stock_qty > 0 && v.stock_qty <= v.low_stock_threshold);
        if (displayStockQty <= 0) stockStatus = "out";
        else if (anyLow) stockStatus = "low";
        else stockStatus = "ok";
      } else if (p.stock_qty <= 0) stockStatus = "out";
      else if (p.low_stock_threshold != null && p.stock_qty <= p.low_stock_threshold) stockStatus = "low";
      else stockStatus = "ok";
    }

    // A product with variants is a catalogue container — it has no
    // customer-facing price of its own (LOCKED RULE), so the list shows the
    // variant price range instead of the (now-unused) product selling_price.
    const variantPrices = variants.map((v) => Number(v.price ?? 0));
    const priceMin = variantPrices.length > 0 ? Math.min(...variantPrices) : null;
    const priceMax = variantPrices.length > 0 ? Math.max(...variantPrices) : null;

    const row = { ...p, stock_qty: displayStockQty, departmentName: dept?.name ?? "—", effectiveFinancialOwner: effectiveOwner, stockStatus, hasVariants: variants.length > 0, priceMin, priceMax };
    if (!seeCost) delete (row as { cost_price?: number }).cost_price;
    return row;
  });

  const ownerFilter = params.get("financial_owner");
  if (ownerFilter === "levelup" || ownerFilter === "healthbox") {
    rows = rows.filter((r) => r.effectiveFinancialOwner === ownerFilter);
  }
  const stockFilter = params.get("stock_status");
  if (stockFilter) rows = rows.filter((r) => r.stockStatus === stockFilter);

  return NextResponse.json({ products: rows });
}

/** Create. financial_owner_override is silently dropped for anyone but
 *  owner — not rejected with an error, just never applied, so a manager or
 *  healthbox_staff submitting a form that happens to include it (e.g. a
 *  stale client) can't move a product's ownership by accident. */
export async function POST(req: NextRequest) {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const body = await req.json().catch(() => null);
  if (!body?.departmentId || !body?.name) {
    return NextResponse.json({ error: "departmentId and name are required" }, { status: 400 });
  }
  if (!callerCanUseDepartment(caller, body.departmentId)) {
    return NextResponse.json({ error: "You cannot add a product to that department" }, { status: 403 });
  }

  const seeCost = canSeeCostAndMargin(caller.role);
  const variants = Array.isArray(body.variants) ? body.variants : [];
  const hasVariants = variants.length > 0;

  if (hasVariants) {
    const variantError = validateVariantPrices(variants);
    if (variantError) return NextResponse.json({ error: variantError }, { status: 400 });
  }

  const moneyFields = {
    // A product with variants is a catalogue container — it has no
    // customer-facing price of its own (LOCKED RULE), regardless of what
    // the client sent for sellingPrice.
    selling_price: hasVariants ? 0 : Number(body.sellingPrice) || 0,
    cost_price: seeCost && body.costPrice != null ? Number(body.costPrice) : null,
    member_price_type: (body.memberPriceType as "none" | "fixed" | "percent") ?? "none",
    member_price: body.memberPrice != null ? Number(body.memberPrice) : null,
    member_discount_percent: body.memberDiscountPercent != null ? Number(body.memberDiscountPercent) : null,
  };
  const moneyError = validateProductMoney(moneyFields, hasVariants);
  if (moneyError) return NextResponse.json({ error: moneyError }, { status: 400 });

  const admin = getServiceClient();

  const insertRow = {
    department_id: body.departmentId,
    category_id: body.categoryId || null,
    supplier_id: body.supplierId || null,
    name: String(body.name).trim(),
    description: body.description || null,
    brand: body.brand || null,
    sku: body.sku || null,
    barcode: body.barcode || null,
    image_url: body.imageUrl || null,
    unit: body.unit || null,
    ...moneyFields,
    financial_owner_override: canSetFinancialOwner(caller.role) ? (body.financialOwnerOverride || null) : null,
    track_inventory: Boolean(body.trackInventory),
    stock_qty: body.trackInventory ? Number(body.stockQty) || 0 : 0,
    low_stock_threshold: body.trackInventory && body.lowStockThreshold != null ? Number(body.lowStockThreshold) : null,
    is_active: body.isActive !== false,
    show_on_pos: body.showOnPos !== false,
    is_available: body.isAvailable !== false,
    sort_order: Number(body.sortOrder) || 0,
  };

  const { data: product, error } = await admin.from("pos_products").insert(insertRow).select("id, name").single();
  if (error || !product) {
    console.error("[POS admin products create]", error);
    return NextResponse.json({ error: "Could not create the product" }, { status: 500 });
  }

  // Variants — created directly under the new product.
  if (hasVariants) {
    const rows = variants.map((v: Record<string, unknown>, i: number) => ({
      product_id: product.id,
      name: String(v.name ?? "").trim(),
      sku: v.sku || null,
      barcode: v.barcode || null,
      // Absolute price for this variant. Null (blank in the form) means
      // "same as the product's own selling price" — a variant is never
      // forced to restate it.
      price: v.price != null && v.price !== "" ? Number(v.price) : null,
      cost: seeCost && v.cost != null && v.cost !== "" ? Number(v.cost) : null,
      stock_qty: Number(v.stockQty) || 0,
      low_stock_threshold: v.lowStockThreshold != null ? Number(v.lowStockThreshold) : null,
      is_available: v.isAvailable !== false,
      sort_order: i,
    }));
    const { error: vErr } = await admin.from("pos_product_variants").insert(rows);
    if (vErr) console.error("[POS admin products create] variant insert failed", vErr);
  }

  // Modifier group links.
  const groupIds: string[] = Array.isArray(body.modifierGroupIds) ? body.modifierGroupIds : [];
  if (groupIds.length > 0) {
    const rows = groupIds.map((groupId, i) => ({ product_id: product.id, group_id: groupId, sort_order: i }));
    const { error: mErr } = await admin.from("pos_product_modifier_groups").insert(rows);
    if (mErr) console.error("[POS admin products create] modifier link failed", mErr);
  }

  await logPosActivity({
    userId: caller.id,
    action: "created_pos_product",
    entityType: "pos_product",
    entityId: product.id,
    description: `${caller.fullName} created product "${product.name}"`,
  });

  return NextResponse.json({ id: product.id });
}
