import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_HEALTHBOX_ROLES } from "@/lib/pos/permissions";
import { callerDepartmentFilter } from "@/lib/pos/catalogAdmin";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** healthbox_staff see only their own department(s) here — spec §11:
 *  "must ONLY see and manage HealthBox catalogue data." */
export async function GET() {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const admin = getServiceClient();
  const deptFilter = callerDepartmentFilter(caller);

  let query = admin
    .from("pos_departments")
    .select("id, name, slug, financial_owner, description, sort_order, status")
    .is("deleted_at", null)
    .order("sort_order");

  if (deptFilter !== null) {
    query = deptFilter.length > 0 ? query.in("id", deptFilter) : query.eq("id", "00000000-0000-0000-0000-000000000000");
  }

  const { data, error } = await query;
  if (error) {
    console.error("[POS admin departments]", error);
    return NextResponse.json({ error: "Could not load departments" }, { status: 500 });
  }

  return NextResponse.json({ departments: data ?? [] });
}
