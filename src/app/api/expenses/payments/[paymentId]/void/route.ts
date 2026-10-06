import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireStaff } from "@/lib/server/requireStaff";
import { EXPENSE_VOID_ROLES } from "@/lib/expenses";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/expenses/payments/[paymentId]/void
 *
 * Reverses a payment that should not have been recorded — wrong amount,
 * wrong bill, entered twice. Soft delete with who and why, never a row
 * removal (CLAUDE.md rule 1).
 *
 * No balance is rewritten here, because no balance is stored. The money
 * returns to that month's funds and the bill goes back to Partially Paid or
 * Unpaid the moment this lands, since every figure is derived from the live
 * payment rows each time it is asked for.
 *
 * Sits under /payments/ rather than /[id]/ so the static segment cannot be
 * confused with a bill id.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ paymentId: string }> }) {
  try {
    const auth = await requireStaff(EXPENSE_VOID_ROLES);
    if (!auth.ok) return auth.response;

    const { paymentId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

    const admin = getServiceClient();
    const { data, error } = await admin.rpc("void_expense_payment", {
      payload: { payment_id: paymentId, voided_by: auth.caller.id, reason: reason || null },
    });

    if (error) {
      console.error("[Expense payment void]", error);
      return NextResponse.json({ error: error.message || "Could not void the payment" }, { status: 409 });
    }

    return NextResponse.json({ success: true, ...(data ?? {}) });
  } catch (err) {
    console.error("[Expense payment void]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
