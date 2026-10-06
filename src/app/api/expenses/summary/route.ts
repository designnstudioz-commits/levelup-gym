import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireStaff } from "@/lib/server/requireStaff";
import { EXPENSE_VIEW_ROLES } from "@/lib/expenses";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * GET /api/expenses/summary?month=YYYY-MM
 *
 * The five balance figures for one month, plus outstanding bills.
 *
 * Computed server-side in one SQL function rather than in the browser for
 * two reasons. First, carry-forward needs every fee payment and expense
 * payment since the first tracked month, which is far too much to ship to a
 * client just to add it up. Second — and this is the behaviour the brief
 * asks for — the cards must not move when someone types in the table's
 * search box or switches category. Because they come from here and the table
 * filters locally, a filter physically cannot change a balance.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireStaff(EXPENSE_VIEW_ROLES);
    if (!auth.ok) return auth.response;

    const month = req.nextUrl.searchParams.get("month");
    // YYYY-MM only. Anything else is rejected rather than coerced, so a bad
    // value can never silently report a different month's money.
    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
    }

    const admin = getServiceClient();
    const { data, error } = await admin.rpc("expense_month_summary", { p_month: `${month}-01` });

    if (error) {
      console.error("[Expenses summary]", error);
      return NextResponse.json({ error: "Could not load the monthly summary" }, { status: 500 });
    }

    return NextResponse.json({ summary: data });
  } catch (err) {
    console.error("[Expenses summary GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
