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

// Owner/manager only — see route.ts's header for why this stays narrower
// than the general HealthBox-may-manage-their-own-data rule.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id } = await params;

  const admin = getServiceClient();
  const { data: existing } = await admin
    .from("pos_categories")
    .select("id, name")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: "Category not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const patch: Record<string, unknown> = {};
  if (typeof body?.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body?.sortOrder === "number") patch.sort_order = body.sortOrder;
  if (body?.status === "active" || body?.status === "inactive") patch.status = body.status;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await admin.from("pos_categories").update(patch).eq("id", id);
  if (error) {
    console.error("[POS admin categories patch]", error);
    return NextResponse.json({ error: "Could not update the category" }, { status: 500 });
  }

  await logPosActivity({
    userId: caller.id,
    action: "edited_pos_category",
    entityType: "pos_category",
    entityId: id,
    description: `${caller.fullName} updated category "${existing.name}"`,
  });

  return NextResponse.json({ ok: true });
}
