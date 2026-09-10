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

/** Full order detail for the admin order screen — items, payments, and
 *  any linked approval, plus the refund order if this order has one. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const admin = getServiceClient();

  const { data: order, error } = await admin
    .from("pos_orders")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const [{ data: items }, { data: payments }, { data: approvals }, { data: refundOrder }] = await Promise.all([
    admin.from("pos_order_items").select("*").eq("order_id", id),
    admin.from("pos_payments").select("*").eq("order_id", id),
    admin.from("pos_approvals").select("*").eq("order_id", id).is("deleted_at", null).order("requested_at", { ascending: false }),
    admin.from("pos_orders").select("id, order_no").eq("refund_of_order_id", id).maybeSingle(),
  ]);

  let servedByName = "—";
  if (order.served_by) {
    const { data: staff } = await admin.from("system_users").select("full_name").eq("id", order.served_by).maybeSingle();
    servedByName = staff?.full_name ?? "—";
  }

  let memberName: string | null = null;
  if (order.member_id) {
    const { data: member } = await admin.from("members").select("full_name").eq("id", order.member_id).maybeSingle();
    memberName = member?.full_name ?? null;
  }

  return NextResponse.json({
    order: { ...order, servedByName, memberName },
    items: items ?? [],
    payments: payments ?? [],
    approvals: approvals ?? [],
    refundOrder: refundOrder ?? null,
  });
}
