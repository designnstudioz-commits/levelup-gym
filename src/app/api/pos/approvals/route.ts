import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_TERMINAL_ROLES, POS_ADMIN_ROLES } from "@/lib/pos/permissions";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Exceptions & approvals list. Owner/manager see everything (the
 *  dashboard Exceptions panel); a cashier/receptionist sees only their own
 *  requests — enough to know whether their void/refund went through
 *  without exposing the whole business's exception history to the
 *  counter. */
export async function GET(req: NextRequest) {
  const auth = await requirePosUser(POS_TERMINAL_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const status = req.nextUrl.searchParams.get("status"); // 'pending' | null (=all)
  const admin = getServiceClient();

  let query = admin
    .from("pos_approvals")
    .select(
      "id, type, order_id, session_id, value_amount, value_percent, reason, status, requested_by, requested_at, resolved_by, resolved_at, resolution_note, resulting_order_id"
    )
    .is("deleted_at", null)
    .order("requested_at", { ascending: false })
    .limit(200);

  if (status) query = query.eq("status", status);
  if (!POS_ADMIN_ROLES.includes(caller.role)) query = query.eq("requested_by", caller.id);

  const { data, error } = await query;
  if (error) {
    console.error("[POS approvals list]", error);
    return NextResponse.json({ error: "Could not load approvals" }, { status: 500 });
  }

  const userIds = [...new Set((data ?? []).flatMap((a) => [a.requested_by, a.resolved_by].filter(Boolean)))];
  const orderIds = [...new Set((data ?? []).map((a) => a.order_id).filter(Boolean))];

  const [{ data: users }, { data: orders }] = await Promise.all([
    userIds.length ? admin.from("system_users").select("id, full_name").in("id", userIds) : Promise.resolve({ data: [] }),
    orderIds.length ? admin.from("pos_orders").select("id, order_no, net_amount").in("id", orderIds) : Promise.resolve({ data: [] }),
  ]);
  const nameById = new Map((users ?? []).map((u) => [u.id, u.full_name]));
  const orderById = new Map((orders ?? []).map((o) => [o.id, o]));

  return NextResponse.json({
    approvals: (data ?? []).map((a) => ({
      id: a.id,
      type: a.type,
      orderId: a.order_id,
      orderNo: a.order_id ? orderById.get(a.order_id)?.order_no ?? null : null,
      orderAmount: a.order_id ? orderById.get(a.order_id)?.net_amount ?? null : null,
      valueAmount: a.value_amount,
      valuePercent: a.value_percent,
      reason: a.reason,
      status: a.status,
      requestedBy: a.requested_by,
      requestedByName: nameById.get(a.requested_by) ?? "—",
      requestedAt: a.requested_at,
      resolvedBy: a.resolved_by,
      resolvedByName: a.resolved_by ? nameById.get(a.resolved_by) ?? "—" : null,
      resolvedAt: a.resolved_at,
      resolutionNote: a.resolution_note,
    })),
  });
}
