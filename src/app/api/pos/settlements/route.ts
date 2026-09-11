import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser, logPosActivity } from "@/lib/pos/auth";
import { POS_ADMIN_ROLES } from "@/lib/pos/permissions";
import { calculateHealthboxSettlement } from "@/lib/pos/settlementCalc";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const admin = getServiceClient();
  const { data: settlements, error } = await admin
    .from("pos_settlements")
    .select("id, period_type, period_start, period_end, gross_sales, net_sales, approved_expenses, net_profit, levelup_share, healthbox_share, is_loss, status, finalised_by, finalised_at, paid_at, created_at")
    .eq("financial_owner", "healthbox")
    .is("deleted_at", null)
    .order("period_start", { ascending: false });

  if (error) {
    console.error("[Settlements list]", error);
    return NextResponse.json({ error: "Could not load settlements" }, { status: 500 });
  }

  return NextResponse.json({ settlements: settlements ?? [] });
}

/** Creates a new DRAFT settlement, computed fresh right now — never
 *  claims any order or expense (only finalize does that). Rejects a
 *  period that already overlaps an existing non-cancelled settlement, so
 *  two drafts can't quietly describe the same money. */
export async function POST(req: NextRequest) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const body = await req.json().catch(() => null);
  if (!body?.periodType || !body?.periodStart || !body?.periodEnd) {
    return NextResponse.json({ error: "periodType, periodStart and periodEnd are required" }, { status: 400 });
  }
  if (!["weekly", "monthly"].includes(body.periodType)) {
    return NextResponse.json({ error: "Invalid period type" }, { status: 400 });
  }
  if (body.periodStart > body.periodEnd) {
    return NextResponse.json({ error: "Period start must be before period end" }, { status: 400 });
  }

  const admin = getServiceClient();

  const { data: overlap } = await admin
    .from("pos_settlements")
    .select("id")
    .eq("financial_owner", "healthbox")
    .is("deleted_at", null)
    .lte("period_start", body.periodEnd)
    .gte("period_end", body.periodStart)
    .limit(1);
  if (overlap && overlap.length > 0) {
    return NextResponse.json({ error: "A settlement already exists for an overlapping period" }, { status: 400 });
  }

  const calc = await calculateHealthboxSettlement(admin, body.periodStart, body.periodEnd);

  const { data: settlement, error } = await admin
    .from("pos_settlements")
    .insert({
      financial_owner: "healthbox",
      period_type: body.periodType,
      period_start: body.periodStart,
      period_end: body.periodEnd,
      gross_sales: calc.grossSales,
      total_discounts: calc.discounts,
      net_sales: calc.netSales,
      approved_cogs: calc.approvedCogs,
      approved_operating: calc.approvedOperating,
      approved_expenses: calc.approvedExpensesTotal,
      net_profit: calc.netProfit,
      levelup_share: calc.levelupShare,
      healthbox_share: calc.healthboxShare,
      is_loss: calc.isLoss,
      loss_amount: calc.lossAmount,
      status: "draft",
      note: body.note || null,
    })
    .select("id")
    .single();

  if (error || !settlement) {
    console.error("[Settlement create]", error);
    return NextResponse.json({ error: "Could not create the settlement" }, { status: 500 });
  }

  await logPosActivity({
    userId: caller.id,
    action: "created_healthbox_settlement",
    entityType: "pos_settlement",
    entityId: settlement.id,
    description: `${caller.fullName} started a HealthBox settlement for ${body.periodStart} to ${body.periodEnd}`,
  });

  return NextResponse.json({ id: settlement.id });
}
