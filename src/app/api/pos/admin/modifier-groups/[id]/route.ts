import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser, logPosActivity } from "@/lib/pos/auth";
import { POS_HEALTHBOX_ROLES } from "@/lib/pos/permissions";
import { callerCanUseDepartment } from "@/lib/pos/catalogAdmin";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function canTouchGroup(caller: { role: string; departmentScope: string[] | null }, departmentId: string | null): boolean {
  if (departmentId === null) return caller.role === "owner" || caller.role === "manager";
  return callerCanUseDepartment(caller as Parameters<typeof callerCanUseDepartment>[0], departmentId);
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
  const { data: existing } = await admin
    .from("pos_modifier_groups")
    .select("id, department_id, name")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: "Modifier group not found" }, { status: 404 });
  if (!canTouchGroup(caller, existing.department_id)) {
    return NextResponse.json({ error: "You cannot edit this modifier group" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const patch: Record<string, unknown> = {};
  if (typeof body?.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (body?.selectionType === "single" || body?.selectionType === "multiple") patch.selection_type = body.selectionType;
  if (typeof body?.isRequired === "boolean") patch.is_required = body.isRequired;
  if (body?.minSelect != null) patch.min_select = Number(body.minSelect);
  if (body?.maxSelect !== undefined) patch.max_select = body.maxSelect != null ? Number(body.maxSelect) : null;
  if (body?.sortOrder != null) patch.sort_order = Number(body.sortOrder);
  if (body?.status === "active" || body?.status === "inactive") patch.status = body.status;

  if (Object.keys(patch).length > 0) {
    await admin.from("pos_modifier_groups").update(patch).eq("id", id);
  }

  // Options: same upsert-and-soft-delete pattern as product variants — a
  // sold option's selection is already snapshotted on the order line, so
  // removing it from the group going forward never touches history.
  if (Array.isArray(body?.options)) {
    const incoming = body.options as Array<Record<string, unknown>>;
    const { data: current } = await admin.from("pos_modifiers").select("id").eq("group_id", id).is("deleted_at", null);
    const currentIds = new Set((current ?? []).map((o) => o.id));
    const keptIds = new Set(incoming.filter((o) => o.id).map((o) => o.id));
    const toRemove = [...currentIds].filter((cid) => !keptIds.has(cid));

    if (toRemove.length > 0) {
      await admin.from("pos_modifiers").update({ deleted_at: new Date().toISOString() }).in("id", toRemove);
    }
    for (const [i, o] of incoming.entries()) {
      const row = {
        group_id: id,
        name: String(o.name ?? "").trim(),
        price_delta: Number(o.priceDelta) || 0,
        is_default: Boolean(o.isDefault),
        is_available: o.isAvailable !== false,
        sort_order: i,
      };
      if (o.id) await admin.from("pos_modifiers").update(row).eq("id", o.id as string);
      else await admin.from("pos_modifiers").insert(row);
    }
  }

  await logPosActivity({
    userId: caller.id,
    action: "edited_pos_modifier_group",
    entityType: "pos_modifier_group",
    entityId: id,
    description: `${caller.fullName} updated modifier group "${existing.name}"`,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id } = await params;

  const admin = getServiceClient();
  const { data: existing } = await admin.from("pos_modifier_groups").select("id, department_id, name").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Modifier group not found" }, { status: 404 });
  if (!canTouchGroup(caller, existing.department_id)) {
    return NextResponse.json({ error: "You cannot remove this modifier group" }, { status: 403 });
  }

  await admin.from("pos_modifier_groups").update({ deleted_at: new Date().toISOString() }).eq("id", id);

  await logPosActivity({
    userId: caller.id,
    action: "removed_pos_modifier_group",
    entityType: "pos_modifier_group",
    entityId: id,
    description: `${caller.fullName} removed modifier group "${existing.name}"`,
  });

  return NextResponse.json({ ok: true });
}
