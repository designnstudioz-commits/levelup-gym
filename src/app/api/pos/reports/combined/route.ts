import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_ADMIN_ROLES } from "@/lib/pos/permissions";
import { ORDER_STATUSES_FOR_SALES, pktDayBounds } from "@/lib/pos/reports";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Combined Business Report — spec §16's core distinction:
 *
 *   A. Cash physically received by Level Up (membership + ALL POS net,
 *      including the HealthBox portion — because every HealthBox sale is
 *      collected through the Level Up till, spec §14).
 *   B. Revenue economically belonging to Level Up (membership + Level-Up-
 *      OWNED POS net + Level Up's EARNED HealthBox share). The HealthBox
 *      share only exists once a settlement has actually been finalised for
 *      that money — an un-settled HealthBox sale sits in Level Up's
 *      till but is NOT Level Up's revenue yet, so it is deliberately
 *      excluded from (B) until a finalised/paid settlement says otherwise.
 *
 * These are never collapsed into one number. Owner/manager only.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const admin = getServiceClient();
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");

  let feeQuery = admin.from("fee_payments").select("amount").is("deleted_at", null);
  if (from) feeQuery = feeQuery.gte("payment_date", from);
  if (to) feeQuery = feeQuery.lte("payment_date", to);
  const { data: fees } = await feeQuery;
  const membershipTotal = (fees ?? []).reduce((s, f) => s + Number(f.amount), 0);

  let orderQuery = admin
    .from("pos_orders")
    .select("levelup_net_amount, healthbox_net_amount")
    .in("status", ORDER_STATUSES_FOR_SALES as unknown as string[]);
  if (from) orderQuery = orderQuery.gte("completed_at", pktDayBounds(from).start);
  if (to) orderQuery = orderQuery.lte("completed_at", pktDayBounds(to).end);
  const { data: orders } = await orderQuery;

  const levelupPosNet = (orders ?? []).reduce((s, o) => s + Number(o.levelup_net_amount), 0);
  const healthboxPosNet = (orders ?? []).reduce((s, o) => s + Number(o.healthbox_net_amount), 0);

  // Level Up's EARNED share — only from settlements actually finalised or
  // paid, whose period overlaps the requested range. A draft/ready
  // settlement's numbers are a preview, not yet real revenue.
  let settlementQuery = admin
    .from("pos_settlements")
    .select("levelup_share, healthbox_share, period_start, period_end, status")
    .eq("financial_owner", "healthbox")
    .in("status", ["finalised", "paid"])
    .is("deleted_at", null);
  if (from) settlementQuery = settlementQuery.gte("period_end", from);
  if (to) settlementQuery = settlementQuery.lte("period_start", to);
  const { data: settlements } = await settlementQuery;
  const levelupEarnedHealthboxShare = (settlements ?? []).reduce((s, x) => s + Number(x.levelup_share), 0);

  const cashPhysicallyReceived = membershipTotal + levelupPosNet + healthboxPosNet;
  const revenueEconomicallyOwned = membershipTotal + levelupPosNet + levelupEarnedHealthboxShare;

  return NextResponse.json({
    membershipTotal, levelupPosNet, healthboxPosNet, levelupEarnedHealthboxShare,
    cashPhysicallyReceived, revenueEconomicallyOwned,
    settlementsInRange: (settlements ?? []).length,
  });
}
