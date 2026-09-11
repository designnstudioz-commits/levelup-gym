import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_ADMIN_ROLES } from "@/lib/pos/permissions";
import { calculateHealthboxSettlement } from "@/lib/pos/settlementCalc";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Read-only settlement calculation preview for an arbitrary period (spec
 * §15) — never persists anything, never claims a single order or expense.
 * Shares its math with settlement create/recalculate (see
 * src/lib/pos/settlementCalc.ts) and with the finalize RPC's SQL, so what
 * a manager previews here is what finalizing actually posts.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const periodStart = req.nextUrl.searchParams.get("period_start");
  const periodEnd = req.nextUrl.searchParams.get("period_end");
  const excludeSettlementId = req.nextUrl.searchParams.get("exclude_settlement_id");
  if (!periodStart || !periodEnd) {
    return NextResponse.json({ error: "period_start and period_end are required" }, { status: 400 });
  }

  const admin = getServiceClient();
  const calc = await calculateHealthboxSettlement(admin, periodStart, periodEnd, excludeSettlementId);

  return NextResponse.json({ periodStart, periodEnd, ...calc, hasConflict: calc.conflictingOrders > 0 || calc.conflictingExpenses > 0 });
}
