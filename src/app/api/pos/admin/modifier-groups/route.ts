import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser, logPosActivity } from "@/lib/pos/auth";
import { POS_HEALTHBOX_ROLES, POS_ADMIN_ROLES } from "@/lib/pos/permissions";
import { callerCanUseDepartment, callerDepartmentFilter } from "@/lib/pos/catalogAdmin";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** List, with each group's options nested. A group with department_id=NULL
 *  is usable by any department (e.g. a shared "Extra sauce" group) — those
 *  stay visible to a scoped healthbox_staff caller too, since they are not
 *  another department's private data. */
export async function GET() {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const admin = getServiceClient();
  const deptFilter = callerDepartmentFilter(caller);

  let query = admin
    .from("pos_modifier_groups")
    .select("id, department_id, name, selection_type, is_required, min_select, max_select, sort_order, status")
    .is("deleted_at", null)
    .order("sort_order");

  if (deptFilter !== null) {
    query = deptFilter.length > 0
      ? query.or(`department_id.is.null,department_id.in.(${deptFilter.join(",")})`)
      : query.is("department_id", null);
  }

  const { data: groups, error } = await query;
  if (error) {
    console.error("[POS admin modifier-groups list]", error);
    return NextResponse.json({ error: "Could not load modifier groups" }, { status: 500 });
  }

  const groupIds = (groups ?? []).map((g) => g.id);
  const { data: options } = groupIds.length
    ? await admin
        .from("pos_modifiers")
        .select("id, group_id, name, price_delta, is_default, is_available, sort_order")
        .in("group_id", groupIds)
        .is("deleted_at", null)
        .order("sort_order")
    : { data: [] };

  const optionsByGroup = new Map<string, typeof options>();
  for (const o of options ?? []) {
    const list = optionsByGroup.get(o.group_id) ?? [];
    list.push(o);
    optionsByGroup.set(o.group_id, list);
  }

  return NextResponse.json({
    groups: (groups ?? []).map((g) => ({ ...g, options: optionsByGroup.get(g.id) ?? [] })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Group name is required" }, { status: 400 });

  // healthbox_staff must scope every group they create to their own
  // department — a global (NULL) group would be visible everywhere.
  const departmentId: string | null = body?.departmentId || null;
  if (departmentId) {
    if (!callerCanUseDepartment(caller, departmentId)) {
      return NextResponse.json({ error: "You cannot create a group for that department" }, { status: 403 });
    }
  } else if (!POS_ADMIN_ROLES.includes(caller.role)) {
    // No department given (a "global" group usable everywhere) — only
    // owner/manager may create one. healthbox_staff must always scope.
    return NextResponse.json({ error: "A HealthBox account must scope a group to HealthBox" }, { status: 403 });
  }

  const admin = getServiceClient();
  const { data: group, error } = await admin
    .from("pos_modifier_groups")
    .insert({
      department_id: departmentId,
      name,
      selection_type: body.selectionType === "multiple" ? "multiple" : "single",
      is_required: Boolean(body.isRequired),
      min_select: Number(body.minSelect) || 0,
      max_select: body.maxSelect != null ? Number(body.maxSelect) : null,
      sort_order: Number(body.sortOrder) || 0,
    })
    .select("id")
    .single();

  if (error || !group) {
    console.error("[POS admin modifier-groups create]", error);
    return NextResponse.json({ error: "Could not create the group" }, { status: 500 });
  }

  const options = Array.isArray(body.options) ? body.options : [];
  if (options.length > 0) {
    await admin.from("pos_modifiers").insert(
      options.map((o: Record<string, unknown>, i: number) => ({
        group_id: group.id,
        name: String(o.name ?? "").trim(),
        price_delta: Number(o.priceDelta) || 0,
        is_default: Boolean(o.isDefault),
        is_available: o.isAvailable !== false,
        sort_order: i,
      }))
    );
  }

  await logPosActivity({
    userId: caller.id,
    action: "created_pos_modifier_group",
    entityType: "pos_modifier_group",
    entityId: group.id,
    description: `${caller.fullName} created modifier group "${name}"`,
  });

  return NextResponse.json({ id: group.id });
}
