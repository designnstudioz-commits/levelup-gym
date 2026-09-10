import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_TERMINAL_ROLES } from "@/lib/pos/permissions";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Recent Orders drawer on the terminal — the CURRENT open session's own
 *  completed/refunded/voided sales, matching the approved frame's scope
 *  ("Completed sales from the current shift"). Not a business-wide list —
 *  that's the admin /dashboard/pos/orders screen. */
export async function GET() {
  const auth = await requirePosUser(POS_TERMINAL_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const admin = getServiceClient();

  const { data: session } = await admin
    .from("pos_register_sessions")
    .select("id")
    .eq("cashier_id", caller.id)
    .eq("status", "open")
    .is("deleted_at", null)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ orders: [] });
  }

  const { data: orders, error } = await admin
    .from("pos_orders")
    .select("id, order_no, status, customer_type, member_id, net_amount, completed_at, refund_of_order_id")
    .eq("session_id", session.id)
    .in("status", ["completed", "refunded", "voided"])
    .is("deleted_at", null)
    .order("completed_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[POS orders recent]", error);
    return NextResponse.json({ error: "Could not load recent orders" }, { status: 500 });
  }

  const orderIds = (orders ?? []).map((o) => o.id);
  const memberIds = [...new Set((orders ?? []).map((o) => o.member_id).filter(Boolean))];

  const [{ data: payments }, { data: members }, { data: approvals }] = await Promise.all([
    orderIds.length
      ? admin.from("pos_payments").select("order_id, method").in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
    memberIds.length
      ? admin.from("members").select("id, full_name").in("id", memberIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? admin.from("pos_approvals").select("order_id, type, status").in("order_id", orderIds).eq("status", "pending")
      : Promise.resolve({ data: [] }),
  ]);

  const methodsByOrder = new Map<string, string[]>();
  for (const p of payments ?? []) {
    const list = methodsByOrder.get(p.order_id) ?? [];
    list.push(p.method);
    methodsByOrder.set(p.order_id, list);
  }
  const memberNameById = new Map((members ?? []).map((m) => [m.id, m.full_name]));
  const pendingByOrder = new Set((approvals ?? []).map((a) => `${a.order_id}:${a.type}`));

  return NextResponse.json({
    orders: (orders ?? []).map((o) => ({
      id: o.id,
      orderNo: o.order_no,
      status: o.status,
      customerLabel: o.member_id ? memberNameById.get(o.member_id) ?? "Member" : "Walk-in",
      netAmount: o.net_amount,
      completedAt: o.completed_at,
      methods: methodsByOrder.get(o.id) ?? [],
      isRefund: o.refund_of_order_id !== null,
      hasPendingVoid: pendingByOrder.has(`${o.id}:void`),
      hasPendingRefund: pendingByOrder.has(`${o.id}:refund`),
    })),
  });
}
