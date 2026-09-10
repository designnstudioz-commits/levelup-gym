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

/**
 * Owner/manager only. Departments are locked business identities (spec
 * §9) — this route accepts ONLY sort_order and status. name, slug and
 * financial_owner are never read from the request body at all, so there
 * is no path — not a missing check, an absent field — through which a
 * request could rename a department or move it between Level Up and
 * HealthBox ownership.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const patch: Record<string, unknown> = {};
  if (typeof body?.sortOrder === "number") patch.sort_order = body.sortOrder;
  if (body?.status === "active" || body?.status === "inactive") patch.status = body.status;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const admin = getServiceClient();
  const { data: dept, error } = await admin
    .from("pos_departments")
    .update(patch)
    .eq("id", id)
    .select("id, name")
    .single();

  if (error || !dept) {
    console.error("[POS admin department patch]", error);
    return NextResponse.json({ error: "Could not update the department" }, { status: 500 });
  }

  await logPosActivity({
    userId: caller.id,
    action: "edited_pos_department",
    entityType: "pos_department",
    entityId: id,
    description: `${caller.fullName} updated ${dept.name}'s ${Object.keys(patch).join(", ")}`,
  });

  return NextResponse.json({ ok: true });
}
