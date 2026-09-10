import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_ADMIN_ROLES } from "@/lib/pos/permissions";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Business-wide order list for /dashboard/pos/orders. Owner/manager only —
 *  cost and margin never come through this route's select list either,
 *  same discipline as the terminal's own catalogue read. */
export async function GET(req: NextRequest) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const admin = getServiceClient();
  const params = req.nextUrl.searchParams;
  const status = params.get("status");
  const search = params.get("search")?.trim();
  const from = params.get("from");
  const to = params.get("to");
  const limit = Math.min(Number(params.get("limit")) || 100, 500);

  let query = admin
    .from("pos_orders")
    .select(
      "id, order_no, hold_ref, status, customer_type, member_id, net_amount, levelup_net_amount, healthbox_net_amount, item_count, served_by, completed_at, voided_at, refund_of_order_id, created_at"
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);
  if (search) query = query.ilike("order_no", `%${search}%`);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  const { data, error } = await query;
  if (error) {
    console.error("[POS orders list]", error);
    return NextResponse.json({ error: "Could not load orders" }, { status: 500 });
  }

  const staffIds = [...new Set((data ?? []).map((o) => o.served_by).filter(Boolean))];
  const memberIds = [...new Set((data ?? []).map((o) => o.member_id).filter(Boolean))];

  const [{ data: staff }, { data: members }] = await Promise.all([
    staffIds.length ? admin.from("system_users").select("id, full_name").in("id", staffIds) : Promise.resolve({ data: [] }),
    memberIds.length ? admin.from("members").select("id, full_name").in("id", memberIds) : Promise.resolve({ data: [] }),
  ]);
  const staffNameById = new Map((staff ?? []).map((s) => [s.id, s.full_name]));
  const memberNameById = new Map((members ?? []).map((m) => [m.id, m.full_name]));

  return NextResponse.json({
    orders: (data ?? []).map((o) => ({
      id: o.id,
      orderNo: o.order_no,
      holdRef: o.hold_ref,
      status: o.status,
      customerLabel: o.member_id ? memberNameById.get(o.member_id) ?? "Member" : "Walk-in",
      netAmount: o.net_amount,
      levelupNet: o.levelup_net_amount,
      healthboxNet: o.healthbox_net_amount,
      itemCount: o.item_count,
      servedByName: o.served_by ? staffNameById.get(o.served_by) ?? "—" : "—",
      completedAt: o.completed_at,
      isRefund: o.refund_of_order_id !== null,
      createdAt: o.created_at,
    })),
  });
}
