import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireStaff } from "@/lib/server/requireStaff";
import { EXPENSE_CREATE_ROLES, EXPENSE_CATEGORY_VALUES, isBackdated } from "@/lib/expenses";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const PAYMENT_METHODS = ["Cash", "Bank", "Card", "EasyPaisa", "JazzCash"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// POST /api/expenses — record a BILL, and optionally its first payment.
//
// A bill is a cost that exists; it does not move money. Nothing here reduces
// funds. Funds only move when a row lands in expense_payments, which is why
// the optional `initial_payment` below goes through the same
// record_expense_payment function the Record Payment action uses, rather
// than writing a payment row inline. One path, one set of rules.
//
// `expense_date` is the BILL date and may be in the past. The real entry
// trail — who created it and when — is preserved separately in added_by and
// created_at, which back-dating never touches.
//
// Writes run service-side because the expenses table has a SELECT policy
// only, so INSERT is denied by default for every authenticated client.
export async function POST(req: NextRequest) {
  try {
    const auth = await requireStaff(EXPENSE_CREATE_ROLES);
    if (!auth.ok) return auth.response;

    const body = await req.json();
    const {
      expense_date, due_date, title, expense_head, amount, payment_method,
      paid_to, note, receipt_path, is_opening_bill, initial_payment, reason,
    } = body ?? {};

    if (!expense_date || !title?.trim() || !expense_head || amount == null || !payment_method) {
      return NextResponse.json(
        { error: "expense_date, title, expense_head, amount and payment_method are required" },
        { status: 400 }
      );
    }
    if (!ISO_DATE.test(String(expense_date))) {
      return NextResponse.json({ error: "Bill date must be a valid date" }, { status: 400 });
    }
    if (due_date && !ISO_DATE.test(String(due_date))) {
      return NextResponse.json({ error: "Due date must be a valid date" }, { status: 400 });
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

    // Back-dating rewrites a month that may already have been reported on, so
    // it is allowed but never silent: the reason is required and goes into
    // activity_logs, which is append-only.
    const backdated = isBackdated(expense_date) ||
      (initial_payment?.paid_on ? isBackdated(initial_payment.paid_on) : false);
    const reasonText = typeof reason === "string" ? reason.trim() : "";
    if (backdated && !reasonText) {
      return NextResponse.json(
        { error: "A reason is required when back-dating into a previous month" },
        { status: 400 }
      );
    }

    // Validate the optional first payment BEFORE inserting the bill, so a bad
    // payment cannot leave a stray bill behind.
    let payNow: { amount: number; paid_on: string; method: string; token: string | null } | null = null;
    if (initial_payment) {
      const payAmount = Number(initial_payment.amount ?? value);
      const paidOn = initial_payment.paid_on;
      if (!Number.isFinite(payAmount) || payAmount <= 0) {
        return NextResponse.json({ error: "Payment amount must be greater than 0" }, { status: 400 });
      }
      if (payAmount > value) {
        return NextResponse.json({ error: "Payment cannot exceed the bill total" }, { status: 400 });
      }
      if (!paidOn || !ISO_DATE.test(String(paidOn))) {
        return NextResponse.json({ error: "A valid payment date is required" }, { status: 400 });
      }
      const payMethod = initial_payment.payment_method ?? payment_method;
      if (!PAYMENT_METHODS.includes(payMethod)) {
        return NextResponse.json({ error: "Unknown payment method" }, { status: 400 });
      }
      payNow = {
        amount: payAmount,
        paid_on: paidOn,
        method: payMethod,
        token: initial_payment.client_token ?? null,
      };
    }

    const admin = getServiceClient();
    const { data, error } = await admin
      .from("expenses")
      .insert({
        expense_date,
        due_date: due_date || null,
        title: String(title).trim(),
        expense_head,
        amount: value,
        payment_method,
        paid_to: paid_to?.trim() || null,
        note: note?.trim() || null,
        receipt_path: receipt_path || null,
        is_opening_bill: is_opening_bill === true,
        // This route creates its own expense_payments rows, so the
        // legacy-compatibility trigger must not also create one.
        payments_managed: true,
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
      description:
        `${auth.caller.email} recorded bill "${data.title}" (Rs ${value.toLocaleString("en-PK")}) dated ${expense_date}` +
        (backdated ? ` — BACK-DATED: ${reasonText}` : ""),
      metadata: {
        category: expense_head, payment_method, expense_date, due_date: due_date || null,
        is_opening_bill: is_opening_bill === true,
        backdated, reason: reasonText || null,
      },
    });

    // The bill exists either way. If this payment fails the bill is still
    // correct — it is simply unpaid — so the caller is told rather than
    // having the whole entry rolled back.
    let paymentError: string | null = null;
    if (payNow) {
      const { error: payErr } = await admin.rpc("record_expense_payment", {
        payload: {
          expense_id: data.id,
          amount: payNow.amount,
          paid_on: payNow.paid_on,
          payment_method: payNow.method,
          added_by: auth.caller.id,
          client_token: payNow.token,
          note: "Recorded with the bill",
        },
      });
      if (payErr) {
        console.error("[Expenses] initial payment failed:", payErr);
        paymentError = payErr.message || "The bill was saved but the payment could not be recorded";
      }
    }

    return NextResponse.json({ success: true, expense: data, paymentError });
  } catch (err) {
    console.error("[Expenses POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
