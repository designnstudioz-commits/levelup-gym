import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireStaff } from "@/lib/server/requireStaff";
import { EXPENSE_CREATE_ROLES, EXPENSE_VIEW_ROLES } from "@/lib/expenses";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const PAYMENT_METHODS = ["Cash", "Bank", "Card", "EasyPaisa", "JazzCash"];

/** GET — payment history for one bill, newest first. Voided payments are
 *  included so the history shows what was reversed and why, but they carry
 *  deleted_at and count toward nothing. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireStaff(EXPENSE_VIEW_ROLES);
    if (!auth.ok) return auth.response;

    const { id } = await ctx.params;
    const admin = getServiceClient();
    const { data, error } = await admin
      .from("expense_payments")
      .select("id, expense_id, amount, paid_on, payment_method, reference, note, receipt_path, added_by, created_at, deleted_at, deleted_by, void_reason")
      .eq("expense_id", id)
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Expense payments GET]", error);
      return NextResponse.json({ error: "Could not load payments" }, { status: 500 });
    }
    return NextResponse.json({ payments: data ?? [] });
  } catch (err) {
    console.error("[Expense payments GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST — record a payment against a bill.
 *
 * The write itself is `record_expense_payment` in Postgres, not here. Two
 * concurrent payments against the same bill must not both pass an
 * "is there enough outstanding?" check and together overpay it; the function
 * takes SELECT ... FOR UPDATE on the bill so they serialise. Doing that
 * check in this route would leave exactly that race open.
 *
 * `client_token` makes the call idempotent: a double-clicked button or a
 * retried request carries the same token and gets the first payment back
 * instead of creating a second one.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireStaff(EXPENSE_CREATE_ROLES);
    if (!auth.ok) return auth.response;

    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const { amount, paid_on, payment_method, reference, note, receipt_path, client_token } = body ?? {};

    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      return NextResponse.json({ error: "Payment amount must be greater than 0" }, { status: 400 });
    }
    if (!paid_on || !/^\d{4}-\d{2}-\d{2}$/.test(String(paid_on))) {
      return NextResponse.json({ error: "A valid payment date is required" }, { status: 400 });
    }
    if (payment_method && !PAYMENT_METHODS.includes(payment_method)) {
      return NextResponse.json({ error: "Unknown payment method" }, { status: 400 });
    }

    const admin = getServiceClient();
    const { data, error } = await admin.rpc("record_expense_payment", {
      payload: {
        expense_id: id,
        amount: value,
        paid_on,
        payment_method: payment_method ?? null,
        reference: reference ?? null,
        note: note ?? null,
        receipt_path: receipt_path ?? null,
        added_by: auth.caller.id,
        client_token: client_token ?? null,
      },
    });

    if (error) {
      // The function raises for a voided bill, a missing bill and an
      // overpayment. Those are the caller's problem, not a server fault, so
      // they come back as 409 with the database's own wording.
      console.error("[Expense payments POST]", error);
      return NextResponse.json({ error: error.message || "Could not record the payment" }, { status: 409 });
    }

    return NextResponse.json({ success: true, ...(data ?? {}) });
  } catch (err) {
    console.error("[Expense payments POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
