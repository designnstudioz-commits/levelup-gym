import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { ORDER_STATUSES_FOR_SALES } from "@/lib/pos/reports";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * A member's POS purchase history — Phase H Member Profile integration
 * (spec §5). Deliberately a SEPARATE query from fee_payments: this never
 * touches membership finance, and the two are never merged into one
 * ledger (spec §5/§6). HealthBox purchases are ordinary completed POS
 * purchases here — never a pay-later balance on the member.
 *
 * Gated the same as the other front-desk-adjacent financial reads audited
 * in Phase H (fee_payments, daily_members): owner/manager/receptionist.
 * Not trainer/viewer — POS purchase history is commercial data unrelated
 * to a trainer's PT relationship, unlike attendance/commission.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: caller } = await supabase
    .from("system_users")
    .select("role")
    .eq("email", user.email.toLowerCase())
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (!caller || !["owner", "manager", "receptionist"].includes(caller.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: memberId } = await params;
  const admin = getServiceClient();

  const { data: orders, error } = await admin
    .from("pos_orders")
    .select("id, order_no, status, gross_amount, discount_amount, net_amount, refund_of_order_id, completed_at, voided_at, void_reason")
    .eq("member_id", memberId)
    .not("status", "in", "(open,held)")
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(100);

  if (error) {
    console.error("[Member POS purchases]", error);
    return NextResponse.json({ error: "Could not load purchase history" }, { status: 500 });
  }

  const orderIds = (orders ?? []).map((o) => o.id);
  const [{ data: items }, { data: payments }] = await Promise.all([
    orderIds.length
      ? admin.from("pos_order_items").select("order_id, product_name, department_name, qty").in("order_id", orderIds)
      : Promise.resolve({ data: [] as { order_id: string; product_name: string; department_name: string; qty: number }[] }),
    orderIds.length
      ? admin.from("pos_payments").select("order_id, method, amount").in("order_id", orderIds)
      : Promise.resolve({ data: [] as { order_id: string; method: string; amount: number }[] }),
  ]);

  const itemsByOrder = new Map<string, { product_name: string; department_name: string; qty: number }[]>();
  for (const i of items ?? []) {
    const list = itemsByOrder.get(i.order_id) ?? [];
    list.push(i);
    itemsByOrder.set(i.order_id, list);
  }
  const paymentsByOrder = new Map<string, { method: string; amount: number }[]>();
  for (const p of payments ?? []) {
    const list = paymentsByOrder.get(p.order_id) ?? [];
    list.push(p);
    paymentsByOrder.set(p.order_id, list);
  }

  const rows = (orders ?? []).map((o) => {
    const orderItems = itemsByOrder.get(o.id) ?? [];
    const departments = [...new Set(orderItems.map((i) => i.department_name))];
    const isRefundMirror = Boolean(o.refund_of_order_id);
    const isSaleRow = (ORDER_STATUSES_FOR_SALES as readonly string[]).includes(o.status);
    return {
      id: o.id,
      orderNo: o.order_no,
      dateTime: o.completed_at ?? o.voided_at,
      items: orderItems.map((i) => ({ name: i.product_name, qty: i.qty })),
      departments,
      amount: o.net_amount,
      grossAmount: o.gross_amount,
      discount: o.discount_amount,
      paymentMethods: paymentsByOrder.get(o.id) ?? [],
      status: o.status,
      isRefund: isRefundMirror,
      isVoid: o.status === "voided",
      countsTowardSales: isSaleRow,
    };
  });

  return NextResponse.json({ purchases: rows });
}
