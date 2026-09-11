import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser, logPosActivity } from "@/lib/pos/auth";
import { POS_ADMIN_ROLES } from "@/lib/pos/permissions";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const admin = getServiceClient();
  const { data: existing } = await admin.from("pos_suppliers").select("id, name").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.contactPerson !== undefined) patch.contact_person = body.contactPerson || null;
  if (body.phone !== undefined) patch.phone = body.phone || null;
  if (body.email !== undefined) patch.email = body.email || null;
  if (body.address !== undefined) patch.address = body.address || null;
  if (body.notes !== undefined) patch.notes = body.notes || null;
  if (body.status !== undefined) patch.status = body.status === "inactive" ? "inactive" : "active";
  if (body.leadTimeDays !== undefined) patch.lead_time_days = body.leadTimeDays != null && body.leadTimeDays !== "" ? Number(body.leadTimeDays) : null;

  const { error } = await admin.from("pos_suppliers").update(patch).eq("id", id);
  if (error) {
    console.error("[POS admin suppliers patch]", error);
    return NextResponse.json({ error: "Could not update the supplier" }, { status: 500 });
  }

  await logPosActivity({
    userId: caller.id, action: "edited_pos_supplier", entityType: "pos_supplier", entityId: id,
    description: `${caller.fullName} updated supplier "${existing.name}"`,
  });

  return NextResponse.json({ ok: true });
}

/** Archive — soft delete. Suppliers are referenced by pos_stock_receipts
 *  (via supplier_id) and possibly pos_products.supplier_id, so this is
 *  never a hard delete. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id } = await params;

  const admin = getServiceClient();
  const { data: existing } = await admin.from("pos_suppliers").select("id, name").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });

  const { error } = await admin.from("pos_suppliers").update({ deleted_at: new Date().toISOString(), status: "inactive" }).eq("id", id);
  if (error) {
    console.error("[POS admin suppliers archive]", error);
    return NextResponse.json({ error: "Could not archive the supplier" }, { status: 500 });
  }

  await logPosActivity({
    userId: caller.id, action: "archived_pos_supplier", entityType: "pos_supplier", entityId: id,
    description: `${caller.fullName} archived supplier "${existing.name}"`,
  });

  return NextResponse.json({ ok: true });
}
