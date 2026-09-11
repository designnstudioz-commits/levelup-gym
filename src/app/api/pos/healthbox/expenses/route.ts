import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser, logPosActivity } from "@/lib/pos/auth";
import { POS_HEALTHBOX_ROLES, POS_ADMIN_ROLES } from "@/lib/pos/permissions";
import { validateExpenseMoney } from "@/lib/pos/healthboxExpenses";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Every column EXCEPT settlement_id and anything sales/profit-related —
// this table only ever holds expense rows, never a net-sales or margin
// figure, so there is nothing to strip for healthbox_staff here the way
// cost_price is stripped elsewhere. The real scope boundary is which ROWS
// come back (see the submitted_by filter below), not which columns.
const EXPENSE_COLUMNS =
  "id, expense_date, category, title, description, amount, attachment_urls, status, submitted_by, approved_by, approved_at, rejection_reason, management_note, created_at, updated_at";

/**
 * List HealthBox expenses.
 *
 * owner/manager see everything (spec §3: "view pending HealthBox
 * expenses" implies the full list, not just pending — filters narrow it
 * client-side). healthbox_staff see only their OWN submissions — spec §2
 * says "view HealthBox expense records relevant to their scope", and
 * nothing grants them visibility into a co-worker's submitted amounts, so
 * the conservative reading is applied here, enforced server-side.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const admin = getServiceClient();
  const params = req.nextUrl.searchParams;

  let query = admin
    .from("pos_healthbox_expenses")
    .select(EXPENSE_COLUMNS)
    .is("deleted_at", null)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (!POS_ADMIN_ROLES.includes(caller.role)) {
    query = query.eq("submitted_by", caller.id);
  }

  const status = params.get("status");
  if (status) query = query.eq("status", status);
  const category = params.get("category");
  if (category) query = query.eq("category", category);
  const from = params.get("from");
  if (from) query = query.gte("expense_date", from);
  const to = params.get("to");
  if (to) query = query.lte("expense_date", to);

  const { data: expenses, error } = await query;
  if (error) {
    console.error("[HealthBox expenses list]", error);
    return NextResponse.json({ error: "Could not load expenses" }, { status: 500 });
  }

  const userIds = [...new Set([
    ...(expenses ?? []).map((e) => e.submitted_by),
    ...(expenses ?? []).map((e) => e.approved_by),
  ].filter(Boolean))];
  const { data: users } = userIds.length
    ? await admin.from("system_users").select("id, full_name").in("id", userIds)
    : { data: [] };
  const userById = new Map((users ?? []).map((u) => [u.id, u.full_name]));

  const rows = (expenses ?? []).map((e) => ({
    ...e,
    submittedByName: e.submitted_by ? userById.get(e.submitted_by) ?? "—" : "—",
    approvedByName: e.approved_by ? userById.get(e.approved_by) ?? "—" : null,
  }));

  return NextResponse.json({ expenses: rows });
}

/** Creates a new expense, always starting Pending — the only way an
 *  expense reaches "approved" is through the decision endpoint, so there
 *  is no path that skips review. */
export async function POST(req: NextRequest) {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const body = await req.json().catch(() => null);
  if (!body?.expenseDate || !body?.category || !body?.title?.trim()) {
    return NextResponse.json({ error: "Date, category and title are required" }, { status: 400 });
  }

  const moneyError = validateExpenseMoney({ amount: Number(body.amount) });
  if (moneyError) return NextResponse.json({ error: moneyError }, { status: 400 });

  const admin = getServiceClient();
  const { data: expense, error } = await admin
    .from("pos_healthbox_expenses")
    .insert({
      expense_date: body.expenseDate,
      category: body.category,
      title: String(body.title).trim(),
      description: body.description || null,
      amount: Number(body.amount),
      attachment_urls: Array.isArray(body.attachmentPaths) && body.attachmentPaths.length > 0 ? body.attachmentPaths : null,
      status: "pending",
      submitted_by: caller.id,
    })
    .select("id, title, amount")
    .single();

  if (error || !expense) {
    console.error("[HealthBox expenses create]", error);
    return NextResponse.json({ error: "Could not create the expense" }, { status: 500 });
  }

  await logPosActivity({
    userId: caller.id,
    action: "created_healthbox_expense",
    entityType: "pos_healthbox_expense",
    entityId: expense.id,
    description: `${caller.fullName} submitted a HealthBox expense — "${expense.title}" (Rs ${expense.amount})`,
  });

  return NextResponse.json({ id: expense.id });
}
