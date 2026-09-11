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

/** Lightweight supplier management. Owner/manager only — HealthBox staff
 *  pick a supplier by name when receiving stock (via /inventory/skus and
 *  the receive form) but don't manage the supplier list itself. */
export async function GET() {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const admin = getServiceClient();
  const { data: suppliers, error } = await admin
    .from("pos_suppliers")
    .select("id, name, contact_person, phone, email, address, notes, status, lead_time_days, created_at")
    .is("deleted_at", null)
    .order("name");

  if (error) {
    console.error("[POS admin suppliers list]", error);
    return NextResponse.json({ error: "Could not load suppliers" }, { status: 500 });
  }

  const supplierIds = (suppliers ?? []).map((s) => s.id);
  const { data: receipts } = supplierIds.length
    ? await admin.from("pos_stock_receipts").select("supplier_id, received_date").in("supplier_id", supplierIds).is("deleted_at", null)
    : { data: [] };
  const lastReceivedBySupplier = new Map<string, string>();
  for (const r of receipts ?? []) {
    const cur = lastReceivedBySupplier.get(r.supplier_id);
    if (!cur || r.received_date > cur) lastReceivedBySupplier.set(r.supplier_id, r.received_date);
  }

  const rows = (suppliers ?? []).map((s) => ({ ...s, lastReceivedDate: lastReceivedBySupplier.get(s.id) ?? null }));

  return NextResponse.json({ suppliers: rows });
}

export async function POST(req: NextRequest) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const body = await req.json().catch(() => null);
  if (!body?.name?.trim()) {
    return NextResponse.json({ error: "Supplier name is required" }, { status: 400 });
  }

  const admin = getServiceClient();
  const { data: supplier, error } = await admin
    .from("pos_suppliers")
    .insert({
      name: body.name.trim(),
      contact_person: body.contactPerson || null,
      phone: body.phone || null,
      email: body.email || null,
      address: body.address || null,
      notes: body.notes || null,
      status: body.status === "inactive" ? "inactive" : "active",
      lead_time_days: body.leadTimeDays != null && body.leadTimeDays !== "" ? Number(body.leadTimeDays) : null,
    })
    .select("id, name")
    .single();

  if (error || !supplier) {
    console.error("[POS admin suppliers create]", error);
    return NextResponse.json({ error: "Could not create the supplier" }, { status: 500 });
  }

  await logPosActivity({
    userId: caller.id, action: "created_pos_supplier", entityType: "pos_supplier", entityId: supplier.id,
    description: `${caller.fullName} added supplier "${supplier.name}"`,
  });

  return NextResponse.json({ id: supplier.id });
}
