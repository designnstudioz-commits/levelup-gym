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

// Owner/manager only — not POS_HEALTHBOX_ROLES. This matches the PAGE-level
// restriction already established in Phase A's POS_ROUTE_ROLES
// (/dashboard/pos/catalog/categories: POS_ADMIN_ROLES): category STRUCTURE
// across all departments is an admin decision, distinct from HealthBox
// staff managing their own PRODUCTS within existing categories. Keeping
// the API and the page consistent rather than introducing a second,
// wider rule here.

export async function GET(req: NextRequest) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const admin = getServiceClient();
  const requestedDept = req.nextUrl.searchParams.get("department_id");

  let query = admin
    .from("pos_categories")
    .select("id, department_id, name, sort_order, status")
    .is("deleted_at", null)
    .order("sort_order");

  if (requestedDept) query = query.eq("department_id", requestedDept);

  const { data, error } = await query;
  if (error) {
    console.error("[POS admin categories list]", error);
    return NextResponse.json({ error: "Could not load categories" }, { status: 500 });
  }

  return NextResponse.json({ categories: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const body = await req.json().catch(() => null);
  const departmentId = body?.departmentId as string | undefined;
  const name = String(body?.name ?? "").trim();

  if (!departmentId || !name) {
    return NextResponse.json({ error: "departmentId and name are required" }, { status: 400 });
  }

  const admin = getServiceClient();
  const { data, error } = await admin
    .from("pos_categories")
    .insert({ department_id: departmentId, name, sort_order: Number(body?.sortOrder) || 0 })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[POS admin categories create]", error);
    return NextResponse.json({ error: "Could not create the category" }, { status: 500 });
  }

  await logPosActivity({
    userId: caller.id,
    action: "created_pos_category",
    entityType: "pos_category",
    entityId: data.id,
    description: `${caller.fullName} added category "${name}"`,
  });

  return NextResponse.json({ id: data.id });
}
