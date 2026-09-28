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

// POST /api/expenses/[id]/void — void (soft-delete) an expense.
//
// Never a hard delete. This is a financial record: CLAUDE.md rule 1 forbids
// removing rows, and the figure needs to stay auditable after it stops
// counting. Sets deleted_at (so every total, which filters
// `deleted_at IS NULL`, drops it immediately) plus deleted_by and an optional
// reason, so the record says who voided it and why — not just that it
// vanished.
//
// Owner/manager only. A receptionist can add and correct their own entries
// but cannot make one disappear from the books.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireStaff(EXPENSE_VOID_ROLES);
    if (!auth.ok) return auth.response;

    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

    const admin = getServiceClient();
    const { data: existing } = await admin
      .from("expenses")
      .select("id, title, amount, deleted_at")
      .eq("id", id)
      .maybeSingle();

    if (!existing) return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    if (existing.deleted_at) {
      return NextResponse.json({ success: true, alreadyVoided: true });
    }

    const { error } = await admin
      .from("expenses")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: auth.caller.id,
        void_reason: reason || null,
      })
      .eq("id", id);

    if (error) {
      console.error("[Expenses] void failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await admin.from("activity_logs").insert({
      user_id: auth.caller.id,
      action: "voided_expense",
      entity_type: "expense",
      entity_id: id,
      description:
        `${auth.caller.email} voided expense "${existing.title}" ` +
        `(Rs ${Number(existing.amount).toLocaleString("en-PK")})` +
        (reason ? ` — ${reason}` : ""),
      metadata: { amount: existing.amount, reason: reason || null },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Expenses VOID]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
