import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireStaff } from "@/lib/server/requireStaff";
import { EXPENSE_CREATE_ROLES, EXPENSE_CATEGORY_VALUES, canEditExpense } from "@/lib/expenses";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const PAYMENT_METHODS = ["Cash", "Bank", "Card", "EasyPaisa", "JazzCash"];

// PATCH /api/expenses/[id] — edit an expense.
//
// Ownership is the reason this is an API route and not an RLS policy: a
// receptionist may edit only an entry they added themselves, and a row-level
// policy cannot tell "correcting the amount" apart from "setting deleted_at".
// Voiding lives in its own route and excludes receptionist entirely.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireStaff(EXPENSE_CREATE_ROLES);
    if (!auth.ok) return auth.response;

    const { id } = await ctx.params;
    const admin = getServiceClient();

    const { data: existing } = await admin
      .from("expenses")
      .select("id, title, amount, added_by, deleted_at")
      .eq("id", id)
      .maybeSingle();

    if (!existing) return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    if (existing.deleted_at) {
      return NextResponse.json({ error: "This expense is voided and can no longer be edited" }, { status: 409 });
    }
    if (!canEditExpense(auth.caller.role, auth.caller.id, existing.added_by)) {
      return NextResponse.json(
        { error: "You can only edit expenses you entered yourself" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const patch: Record<string, unknown> = {};
    const changed: string[] = [];

    if (body.expense_date !== undefined) { patch.expense_date = body.expense_date; changed.push("date"); }
    if (body.title !== undefined) {
      if (!String(body.title).trim()) return NextResponse.json({ error: "Expense name is required" }, { status: 400 });
      patch.title = String(body.title).trim(); changed.push("name");
    }
    if (body.expense_head !== undefined) {
      if (!EXPENSE_CATEGORY_VALUES.includes(body.expense_head)) {
        return NextResponse.json({ error: "Unknown category" }, { status: 400 });
      }
      patch.expense_head = body.expense_head; changed.push("category");
    }
    if (body.amount !== undefined) {
      const v = Number(body.amount);
      if (!Number.isFinite(v) || v <= 0) {
        return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
      }
      patch.amount = v; changed.push("amount");
    }
    if (body.payment_method !== undefined) {
      if (!PAYMENT_METHODS.includes(body.payment_method)) {
        return NextResponse.json({ error: "Unknown payment method" }, { status: 400 });
      }
      patch.payment_method = body.payment_method; changed.push("payment method");
    }
    if (body.paid_to !== undefined) { patch.paid_to = body.paid_to?.trim() || null; changed.push("paid to"); }
    if (body.note !== undefined) { patch.note = body.note?.trim() || null; changed.push("notes"); }
    if (body.receipt_path !== undefined) { patch.receipt_path = body.receipt_path || null; changed.push("receipt"); }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const { error } = await admin.from("expenses").update(patch).eq("id", id);
    if (error) {
      console.error("[Expenses] update failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await admin.from("activity_logs").insert({
      user_id: auth.caller.id,
      action: "updated_expense",
      entity_type: "expense",
      entity_id: id,
      description: `${auth.caller.email} edited expense "${existing.title}" (${changed.join(", ")})`,
      metadata: { changed, previous: { title: existing.title, amount: existing.amount } },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Expenses PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
