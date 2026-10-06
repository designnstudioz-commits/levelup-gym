import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireStaff } from "@/lib/server/requireStaff";
import { EXPENSE_VIEW_ROLES, EXPENSE_CREATE_ROLES } from "@/lib/expenses";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Starting balances — the first tracked month and the funds on hand at the
 * start of it.
 *
 * Nothing is assumed. Until an owner sets this, every month reports opening
 * funds of zero and the page says it is unconfigured, rather than inventing
 * a number that would quietly make every balance wrong.
 *
 * Pre-existing unpaid bills are NOT entered here. They are entered as
 * ordinary bills with their real (past) bill date and the opening flag, via
 * POST /api/expenses. That matters: a bill never deducts funds on its own,
 * so an imported opening bill cannot double-deduct. Only its later payments
 * reduce funds, once.
 */

export async function GET() {
  try {
    const auth = await requireStaff(EXPENSE_VIEW_ROLES);
    if (!auth.ok) return auth.response;

    const admin = getServiceClient();
    const { data, error } = await admin
      .from("expense_settings")
      .select("start_month, opening_funds, configured_by, configured_at, updated_at")
      .eq("id", true)
      .maybeSingle();

    if (error) {
      console.error("[Expense settings GET]", error);
      return NextResponse.json({ error: "Could not load settings" }, { status: 500 });
    }

    return NextResponse.json({ settings: data ?? null });
  } catch (err) {
    console.error("[Expense settings GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await requireStaff(EXPENSE_CREATE_ROLES);
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => null);
    const startMonth = body?.start_month;
    const openingFunds = Number(body?.opening_funds);

    if (!startMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(startMonth))) {
      return NextResponse.json({ error: "start_month must be YYYY-MM" }, { status: 400 });
    }
    // Opening funds may legitimately be negative — a gym can start a tracked
    // period overdrawn, and clamping that to zero would overstate every
    // closing balance from then on.
    if (!Number.isFinite(openingFunds)) {
      return NextResponse.json({ error: "opening_funds must be a number" }, { status: 400 });
    }

    const admin = getServiceClient();
    const { error } = await admin
      .from("expense_settings")
      .upsert({
        id: true,
        start_month: `${startMonth}-01`,
        opening_funds: openingFunds,
        configured_by: auth.caller.id,
        configured_at: new Date().toISOString(),
      }, { onConflict: "id" });

    if (error) {
      console.error("[Expense settings PUT]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await admin.from("activity_logs").insert({
      user_id: auth.caller.id,
      action: "set_expense_starting_balance",
      entity_type: "expense_settings",
      entity_id: null,
      description:
        `${auth.caller.email} set expense tracking to start ${startMonth} ` +
        `with opening funds Rs ${openingFunds.toLocaleString("en-PK")}`,
      metadata: { start_month: startMonth, opening_funds: openingFunds },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Expense settings PUT]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
