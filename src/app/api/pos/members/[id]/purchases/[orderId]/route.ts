import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { canSeeCostAndMargin } from "@/lib/pos/permissions";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Drill-down into one POS order from a member's profile — owner/manager
 *  only (spec §5: "if the user's role permits it"), matching the same
 *  cost/margin visibility rule used for order detail everywhere else in
 *  the app. Reads the ORDER'S OWN immutable snapshot columns
 *  (product_name, unit_price, etc.) — never joins back to the live
 *  catalogue, so a later price/catalogue change never rewrites history. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; orderId: string }> }
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

  if (!caller || !["owner", "manager"].includes(caller.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: memberId, orderId } = await params;
  const admin = getServiceClient();
  const seeCost = canSeeCostAndMargin(caller.role);

  const { data: order, error } = await admin
    .from("pos_orders")
    .select("id, order_no, status, gross_amount, discount_amount, net_amount, member_id, completed_at, voided_at, void_reason, note")
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order || order.member_id !== memberId) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const { data: items } = await admin
    .from("pos_order_items")
    .select("product_name, variant_name, department_name, sku, unit_price, cost_price, qty, line_gross, line_discount, line_net, modifiers")
    .eq("order_id", orderId);

  const { data: payments } = await admin.from("pos_payments").select("method, amount, reference").eq("order_id", orderId);

  const cleanItems = (items ?? []).map((i) => {
    const row = { ...i };
    if (!seeCost) delete (row as { cost_price?: number }).cost_price;
    return row;
  });

  return NextResponse.json({ order, items: cleanItems, payments: payments ?? [] });
}
