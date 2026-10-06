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

    // A bill with money already paid against it cannot be voided. Voiding it
    // would strip the bill from the books while its payments stayed in the
    // month they were paid, so funds and outstanding would disagree. The
    // payments must be voided first, each with its own reason, which also
    // leaves a clearer audit trail than one blanket void.
    const { data: livePayments } = await admin
      .from("expense_payments")
      .select("id, amount")
      .eq("expense_id", id)
      .is("deleted_at", null);
    if ((livePayments ?? []).length > 0) {
      const total = (livePayments ?? []).reduce((t, r) => t + Number(r.amount ?? 0), 0);
      return NextResponse.json(
        {
          // Deliberately does NOT tell the owner to void the payments. Voiding
          // a payment asserts the money never moved, so it is only ever right
          // for an entry made in error — not a way to clear a bill that was
          // genuinely paid.
          error:
            "This bill has recorded payments (" +
            (livePayments ?? []).length + " totalling Rs " + total.toLocaleString("en-PK") +
            ") and cannot be voided. Only void payments entered by mistake.",
        },
        { status: 409 }
      );
    }

    const { error } = await admin
      .from("expenses")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: auth.caller.id,
        void_reason: reason || null,
        // Identifies this as a current-build write; the database rejects
        // updates without it (expense_legacy_write_guard).
        write_marker: "v2",
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
