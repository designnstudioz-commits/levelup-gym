import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireStaff } from "@/lib/server/requireStaff";
import { EXPENSE_CREATE_ROLES, EXPENSE_CATEGORY_VALUES } from "@/lib/expenses";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const PAYMENT_METHODS = ["Cash", "Bank", "Card", "EasyPaisa", "JazzCash"];

// POST /api/expenses — record a gym operating expense.
//
// Writes run service-side rather than from the browser: the expenses table
// has a SELECT policy only, so INSERT is denied by default for every
// authenticated client (see the migration). That keeps this route the single
// place where "who may add an expense" is decided.
export async function POST(req: NextRequest) {
  try {
    const auth = await requireStaff(EXPENSE_CREATE_ROLES);
    if (!auth.ok) return auth.response;

    const body = await req.json();
    const { expense_date, title, expense_head, amount, payment_method, paid_to, note, receipt_path } = body ?? {};

    if (!expense_date || !title?.trim() || !expense_head || amount == null || !payment_method) {
      return NextResponse.json(
        { error: "expense_date, title, expense_head, amount and payment_method are required" },
        { status: 400 }
      );
    }
    if (!EXPENSE_CATEGORY_VALUES.includes(expense_head)) {
      return NextResponse.json({ error: "Unknown category" }, { status: 400 });
    }
    if (!PAYMENT_METHODS.includes(payment_method)) {
      return NextResponse.json({ error: "Unknown payment method" }, { status: 400 });
    }
    const value = Number(amount);
    // Guard here as well as in the DB: the NOT VALID constraint catches this
    // too, but a 400 with a real message beats a raw Postgres error.
    if (!Number.isFinite(value) || value <= 0) {
      return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
    }

    const admin = getServiceClient();
    const { data, error } = await admin
      .from("expenses")
      .insert({
        expense_date,
        title: String(title).trim(),
        expense_head,
        amount: value,
        payment_method,
        paid_to: paid_to?.trim() || null,
        note: note?.trim() || null,
        receipt_path: receipt_path || null,
        added_by: auth.caller.id,
      })
      .select("id, title, amount")
      .single();

    if (error) {
      console.error("[Expenses] insert failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await admin.from("activity_logs").insert({
      user_id: auth.caller.id,
      action: "added_expense",
      entity_type: "expense",
      entity_id: data.id,
      description: `${auth.caller.email} recorded expense "${data.title}" (Rs ${value.toLocaleString("en-PK")})`,
      metadata: { category: expense_head, payment_method, expense_date },
    });

    return NextResponse.json({ success: true, expense: data });
  } catch (err) {
    console.error("[Expenses POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
