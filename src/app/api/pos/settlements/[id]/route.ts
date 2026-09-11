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

/** Detail view. For a finalised/paid settlement, the drill-down reads the
 *  LINKED rows (settlement_id = this id) — the actual claimed orders and
 *  expenses, frozen in place — never a fresh live recomputation (spec
 *  §12). For a draft/ready settlement, nothing is linked yet, so the
 *  drill-down instead shows what WOULD be claimed if finalised now. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const admin = getServiceClient();
  const { data: settlement, error } = await admin.from("pos_settlements").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error || !settlement) return NextResponse.json({ error: "Settlement not found" }, { status: 404 });

  const isFinal = settlement.status === "finalised" || settlement.status === "paid";

  const { data: linkedOrders } = isFinal
    ? await admin.from("pos_orders").select("id, order_no, healthbox_net_amount, completed_at").eq("settlement_id", id).limit(500)
    : { data: [] };

  const { data: linkedExpenses } = isFinal
    ? await admin.from("pos_healthbox_expenses").select("id, expense_date, category, title, amount, approved_by").eq("settlement_id", id).limit(500)
    : { data: [] };

  let preview = null;
  if (!isFinal) {
    preview = await calculateHealthboxSettlement(admin, settlement.period_start, settlement.period_end, id);
  }

  const finalisedByName = settlement.finalised_by
    ? (await admin.from("system_users").select("full_name").eq("id", settlement.finalised_by).maybeSingle()).data?.full_name
    : null;

  return NextResponse.json({
    settlement,
    finalisedByName: finalisedByName ?? null,
    linkedOrders: linkedOrders ?? [],
    linkedExpenses: linkedExpenses ?? [],
    preview,
  });
}

/** Recalculates a draft/ready settlement's stored snapshot from live data
 *  (spec §19's "settlement recalculated if draft"), or updates its
 *  management note, or moves draft -> ready. Never touches a finalised or
 *  paid settlement — those are frozen (spec §12). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id } = await params;

  const admin = getServiceClient();
  const { data: existing } = await admin.from("pos_settlements").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Settlement not found" }, { status: 404 });
  if (existing.status !== "draft" && existing.status !== "ready") {
    return NextResponse.json({ error: `A ${existing.status} settlement can no longer be changed` }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let didRecalculate = false;

  if (body.recalculate) {
    const calc = await calculateHealthboxSettlement(admin, existing.period_start, existing.period_end, id);
    Object.assign(patch, {
      gross_sales: calc.grossSales, total_discounts: calc.discounts, net_sales: calc.netSales,
      approved_cogs: calc.approvedCogs, approved_operating: calc.approvedOperating, approved_expenses: calc.approvedExpensesTotal,
      net_profit: calc.netProfit, levelup_share: calc.levelupShare, healthbox_share: calc.healthboxShare,
      is_loss: calc.isLoss, loss_amount: calc.lossAmount,
    });
    didRecalculate = true;
  }
  if (body.status === "ready" && existing.status === "draft") patch.status = "ready";
  if (body.status === "draft" && existing.status === "ready") patch.status = "draft";
  if (body.note !== undefined) patch.note = body.note || null;

  const { error } = await admin.from("pos_settlements").update(patch).eq("id", id);
  if (error) {
    console.error("[Settlement patch]", error);
    return NextResponse.json({ error: "Could not update the settlement" }, { status: 500 });
  }

  if (didRecalculate) {
    await logPosActivity({
      userId: caller.id, action: "recalculated_healthbox_settlement", entityType: "pos_settlement", entityId: id,
      description: `${caller.fullName} recalculated the draft HealthBox settlement for ${existing.period_start} to ${existing.period_end}`,
    });
  }

  return NextResponse.json({ ok: true });
}
