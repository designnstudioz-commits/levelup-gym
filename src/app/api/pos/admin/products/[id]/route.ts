import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser, logPosActivity } from "@/lib/pos/auth";
import { POS_HEALTHBOX_ROLES, canSeeCostAndMargin, canSetFinancialOwner } from "@/lib/pos/permissions";
import { callerCanUseDepartment, validateProductMoney, validateVariantPrices, describeProductChanges } from "@/lib/pos/catalogAdmin";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id } = await params;

  const admin = getServiceClient();
  const seeCost = canSeeCostAndMargin(caller.role);

  const { data: product, error } = await admin
    .from("pos_products")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  if (!callerCanUseDepartment(caller, product.department_id)) {
    return NextResponse.json({ error: "You cannot view this product" }, { status: 403 });
  }
  if (!seeCost) delete (product as Record<string, unknown>).cost_price;

  const [{ data: variants }, { data: links }] = await Promise.all([
    admin.from("pos_product_variants").select("*").eq("product_id", id).is("deleted_at", null).order("sort_order"),
    admin.from("pos_product_modifier_groups").select("group_id").eq("product_id", id).is("deleted_at", null),
  ]);

  const cleanVariants = seeCost
    ? (variants ?? [])
    : (variants ?? []).map((v) => { const { cost: _cost, ...rest } = v; return rest; });

  return NextResponse.json({
    product,
    variants: cleanVariants,
    modifierGroupIds: (links ?? []).map((l) => l.group_id),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id } = await params;

  const admin = getServiceClient();
  const { data: existing } = await admin.from("pos_products").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  if (!callerCanUseDepartment(caller, existing.department_id)) {
    return NextResponse.json({ error: "You cannot edit this product" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  // A product cannot be moved to a department outside the caller's own
  // scope either — checked on both the old AND the (possible) new value.
  const newDepartmentId = body.departmentId ?? existing.department_id;
  if (!callerCanUseDepartment(caller, newDepartmentId)) {
    return NextResponse.json({ error: "You cannot move a product to that department" }, { status: 403 });
  }

  const seeCost = canSeeCostAndMargin(caller.role);

  // A product with variants is a catalogue container — it has no
  // customer-facing price of its own (LOCKED RULE). Whether that's true
  // AFTER this edit depends on the incoming variants list if one was sent;
  // otherwise fall back to whatever variants already exist on the product.
  let hasVariants: boolean;
  if (Array.isArray(body.variants)) {
    hasVariants = body.variants.length > 0;
  } else {
    const { count } = await admin.from("pos_product_variants").select("id", { count: "exact", head: true }).eq("product_id", id).is("deleted_at", null);
    hasVariants = (count ?? 0) > 0;
  }
  if (hasVariants && Array.isArray(body.variants)) {
    const variantError = validateVariantPrices(body.variants);
    if (variantError) return NextResponse.json({ error: variantError }, { status: 400 });
  }

  const moneyFields = {
    selling_price: hasVariants ? 0 : (body.sellingPrice != null ? Number(body.sellingPrice) : Number(existing.selling_price)),
    cost_price: seeCost ? (body.costPrice != null ? Number(body.costPrice) : existing.cost_price) : existing.cost_price,
    member_price_type: (body.memberPriceType as "none" | "fixed" | "percent") ?? existing.member_price_type,
    member_price: body.memberPrice !== undefined ? (body.memberPrice != null ? Number(body.memberPrice) : null) : existing.member_price,
    member_discount_percent:
      body.memberDiscountPercent !== undefined
        ? (body.memberDiscountPercent != null ? Number(body.memberDiscountPercent) : null)
        : existing.member_discount_percent,
  };
  const moneyError = validateProductMoney(moneyFields, hasVariants);
  if (moneyError) return NextResponse.json({ error: moneyError }, { status: 400 });

  const trackInventory = body.trackInventory !== undefined ? Boolean(body.trackInventory) : existing.track_inventory;

  const patch: Record<string, unknown> = {
    department_id: newDepartmentId,
    category_id: body.categoryId !== undefined ? body.categoryId || null : existing.category_id,
    supplier_id: body.supplierId !== undefined ? body.supplierId || null : existing.supplier_id,
    name: body.name !== undefined ? String(body.name).trim() : existing.name,
    description: body.description !== undefined ? body.description || null : existing.description,
    brand: body.brand !== undefined ? body.brand || null : existing.brand,
    sku: body.sku !== undefined ? body.sku || null : existing.sku,
    barcode: body.barcode !== undefined ? body.barcode || null : existing.barcode,
    image_url: body.imageUrl !== undefined ? body.imageUrl || null : existing.image_url,
    unit: body.unit !== undefined ? body.unit || null : existing.unit,
    ...moneyFields,
    track_inventory: trackInventory,
    stock_qty: trackInventory ? (body.stockQty != null ? Number(body.stockQty) : existing.stock_qty) : existing.stock_qty,
    low_stock_threshold:
      trackInventory && body.lowStockThreshold !== undefined
        ? (body.lowStockThreshold != null ? Number(body.lowStockThreshold) : null)
        : existing.low_stock_threshold,
    is_active: body.isActive !== undefined ? Boolean(body.isActive) : existing.is_active,
    show_on_pos: body.showOnPos !== undefined ? Boolean(body.showOnPos) : existing.show_on_pos,
    is_available: body.isAvailable !== undefined ? Boolean(body.isAvailable) : existing.is_available,
    sort_order: body.sortOrder !== undefined ? Number(body.sortOrder) : existing.sort_order,
    updated_at: new Date().toISOString(),
  };

  // Financial owner override: owner-only, and only actually changed if the
  // request came from an owner. A non-owner's payload can carry whatever
  // stale value the form had loaded — it is never applied.
  if (canSetFinancialOwner(caller.role) && body.financialOwnerOverride !== undefined) {
    patch.financial_owner_override = body.financialOwnerOverride || null;
  }

  const { error: updateErr } = await admin.from("pos_products").update(patch).eq("id", id);
  if (updateErr) {
    console.error("[POS admin products patch]", updateErr);
    return NextResponse.json({ error: "Could not update the product" }, { status: 500 });
  }

  // ── Variants: upsert by id, soft-delete anything missing from the payload
  if (Array.isArray(body.variants)) {
    const incoming = body.variants as Array<Record<string, unknown>>;
    const { data: current } = await admin.from("pos_product_variants").select("id").eq("product_id", id).is("deleted_at", null);
    const currentIds = new Set((current ?? []).map((v) => v.id));
    const keptIds = new Set(incoming.filter((v) => v.id).map((v) => v.id));

    const toRemove = [...currentIds].filter((cid) => !keptIds.has(cid));
    if (toRemove.length > 0) {
      // Soft-delete only — a variant may be referenced by historical
      // pos_order_items.variant_id, and that snapshot must keep resolving.
      await admin.from("pos_product_variants").update({ deleted_at: new Date().toISOString() }).in("id", toRemove);
    }

    for (const [i, v] of incoming.entries()) {
      const row = {
        product_id: id,
        name: String(v.name ?? "").trim(),
        sku: (v.sku as string) || null,
        barcode: (v.barcode as string) || null,
        price: v.price != null && v.price !== "" ? Number(v.price) : null,
        cost: seeCost && v.cost != null && v.cost !== "" ? Number(v.cost) : null,
        stock_qty: Number(v.stockQty) || 0,
        low_stock_threshold: v.lowStockThreshold != null ? Number(v.lowStockThreshold) : null,
        is_available: v.isAvailable !== false,
        sort_order: i,
      };
      if (v.id) {
        await admin.from("pos_product_variants").update(row).eq("id", v.id as string);
      } else {
        await admin.from("pos_product_variants").insert(row);
      }
    }
  }

  // ── Modifier group links: plain replace — these are links, not
  // historical data (a sale's actual modifier choices are already
  // snapshotted independently on pos_order_items.modifiers).
  if (Array.isArray(body.modifierGroupIds)) {
    await admin.from("pos_product_modifier_groups").delete().eq("product_id", id);
    const groupIds = body.modifierGroupIds as string[];
    if (groupIds.length > 0) {
      await admin.from("pos_product_modifier_groups").insert(
        groupIds.map((groupId, i) => ({ product_id: id, group_id: groupId, sort_order: i }))
      );
    }
  }

  const changes = describeProductChanges(existing as Record<string, unknown>, patch);
  if (changes.length > 0) {
    await logPosActivity({
      userId: caller.id,
      action: "edited_pos_product",
      entityType: "pos_product",
      entityId: id,
      description: `${caller.fullName} updated "${existing.name}" — ${changes.join(", ")}`,
    });
  }

  return NextResponse.json({ ok: true });
}

/** Archive — soft delete. Never a hard delete: historical order_items
 *  keep their own product_name/sku/price snapshot regardless (spec §13),
 *  so archiving never affects a past receipt, but the row itself stays
 *  for that FK and for the possibility of un-archiving later. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id } = await params;

  const admin = getServiceClient();
  const { data: existing } = await admin.from("pos_products").select("id, name, department_id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  if (!callerCanUseDepartment(caller, existing.department_id)) {
    return NextResponse.json({ error: "You cannot archive this product" }, { status: 403 });
  }

  const { error } = await admin.from("pos_products").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) {
    console.error("[POS admin products delete]", error);
    return NextResponse.json({ error: "Could not archive the product" }, { status: 500 });
  }

  await logPosActivity({
    userId: caller.id,
    action: "archived_pos_product",
    entityType: "pos_product",
    entityId: id,
    description: `${caller.fullName} archived "${existing.name}"`,
  });

  return NextResponse.json({ ok: true });
}
