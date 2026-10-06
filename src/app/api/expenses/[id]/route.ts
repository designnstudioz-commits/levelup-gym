import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireStaff } from "@/lib/server/requireStaff";
import { EXPENSE_CREATE_ROLES, EXPENSE_CATEGORY_VALUES, canEditExpense, isBackdated } from "@/lib/expenses";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const PAYMENT_METHODS = ["Cash", "Bank", "Card", "EasyPaisa", "JazzCash"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// PATCH /api/expenses/[id] — edit a bill.
//
// The write itself is update_expense_bill() in Postgres, not here. Editing a
// bill touches three things that must agree: the bill, its effective-dated
// amount history, and the audit entry. Doing that as three HTTP round trips
// meant a failure part-way needed a compensating delete to tidy up, which is
// an argument rather than a guarantee — a crash between steps, or two edits
// interleaving, could still leave them disagreeing.
//
// The function takes the bill's row lock first, so a payment racing this edit
// cannot land between the validation and the update and leave the bill
// overpaid. Any failure inside it rolls back everything, including the audit
// row.
//
// What stays here is what the database should not be deciding: who is allowed
// to edit, and whether the request itself is well-formed.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireStaff(EXPENSE_CREATE_ROLES);
    if (!auth.ok) return auth.response;

    const { id } = await ctx.params;
    const admin = getServiceClient();

    // Read for validation and messages only. The authoritative check happens
    // again inside the function, under the row lock — this copy may be stale
    // by the time the write runs, which is exactly why it is not trusted.
    const { data: existing } = await admin
      .from("expenses")
      .select("id, title, amount, expense_date, added_by, deleted_at")
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
    const fields: Record<string, unknown> = {};
    const changed: string[] = [];

    if (body.expense_date !== undefined) {
      if (!ISO_DATE.test(String(body.expense_date))) {
        return NextResponse.json({ error: "Bill date must be a valid date" }, { status: 400 });
      }
      // The bill date may move into the past. created_at and added_by are
      // never touched, so the real entry trail survives the back-dating.
      fields.expense_date = body.expense_date; changed.push("bill date");
    }
    if (body.due_date !== undefined) {
      if (body.due_date && !ISO_DATE.test(String(body.due_date))) {
        return NextResponse.json({ error: "Due date must be a valid date" }, { status: 400 });
      }
      fields.due_date = body.due_date || null; changed.push("due date");
    }
    if (body.title !== undefined) {
      if (!String(body.title).trim()) {
        return NextResponse.json({ error: "Expense name is required" }, { status: 400 });
      }
      fields.title = String(body.title).trim(); changed.push("name");
    }
    if (body.expense_head !== undefined) {
      if (!EXPENSE_CATEGORY_VALUES.includes(body.expense_head)) {
        return NextResponse.json({ error: "Unknown category" }, { status: 400 });
      }
      fields.expense_head = body.expense_head; changed.push("category");
    }
    if (body.amount !== undefined) {
      const v = Number(body.amount);
      if (!Number.isFinite(v) || v <= 0) {
        return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
      }
      fields.amount = v; changed.push("amount");
    }
    if (body.payment_method !== undefined) {
      if (!PAYMENT_METHODS.includes(body.payment_method)) {
        return NextResponse.json({ error: "Unknown payment method" }, { status: 400 });
      }
      fields.payment_method = body.payment_method; changed.push("payment method");
    }
    if (body.paid_to !== undefined) { fields.paid_to = body.paid_to?.trim() || null; changed.push("paid to"); }
    if (body.note !== undefined) { fields.note = body.note?.trim() || null; changed.push("notes"); }
    if (body.receipt_path !== undefined) { fields.receipt_path = body.receipt_path || null; changed.push("receipt"); }
    if (body.is_opening_bill !== undefined) { fields.is_opening_bill = body.is_opening_bill === true; }

    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    // Any edit that moves money between months, or changes how much is owed,
    // needs a stated reason. Both rewrite history that has already been seen.
    const reasonText = typeof body.reason === "string" ? body.reason.trim() : "";
    const touchesAmount = body.amount !== undefined && Number(body.amount) !== Number(existing.amount);
    const touchesDate = body.expense_date !== undefined && body.expense_date !== existing.expense_date;
    const rewritesHistory =
      touchesAmount ||
      (touchesDate && (isBackdated(body.expense_date) || isBackdated(existing.expense_date)));
    if (rewritesHistory && !reasonText) {
      return NextResponse.json(
        { error: "A reason is required when changing a bill's amount or moving it into a previous month" },
        { status: 400 }
      );
    }

    // A correction restates every past period; a revision applies only from a
    // stated date. The caller says which — guessing would silently pick one.
    const amountKind = body.amount_change_kind === "revision" ? "revision" : "correction";
    if (touchesAmount && amountKind === "revision") {
      const from = body.amount_effective_from;
      if (!from || !ISO_DATE.test(String(from))) {
        return NextResponse.json(
          { error: "A revision needs the date it takes effect from" },
          { status: 400 }
        );
      }
    }

    const { data, error } = await admin.rpc("update_expense_bill", {
      payload: {
        expense_id: id,
        actor_id: auth.caller.id,
        reason: reasonText || null,
        fields,
        amount_change_kind: amountKind,
        amount_effective_from: body.amount_effective_from ?? null,
        changed: changed.join(", "),
      },
    });

    if (error) {
      // The function raises for a voided bill, a missing bill, an overpaid
      // total and a missing reason. Those are the caller's problem, so they
      // come back as 409 with the database's own wording rather than a 500.
      console.error("[Expenses PATCH]", error);
      const status = /not found/i.test(error.message ?? "") ? 404 : 409;
      return NextResponse.json({ error: error.message || "Could not save the change" }, { status });
    }

    return NextResponse.json({ success: true, ...(data ?? {}) });
  } catch (err) {
    console.error("[Expenses PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
