import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser, logPosActivity } from "@/lib/pos/auth";
import { POS_HEALTHBOX_ROLES, POS_ADMIN_ROLES } from "@/lib/pos/permissions";
import { validateExpenseMoney, EDITABLE_STATUSES } from "@/lib/pos/healthboxExpenses";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id } = await params;

  const admin = getServiceClient();
  const { data: expense, error } = await admin
    .from("pos_healthbox_expenses")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !expense) return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  if (!POS_ADMIN_ROLES.includes(caller.role) && expense.submitted_by !== caller.id) {
    return NextResponse.json({ error: "You cannot view this expense" }, { status: 403 });
  }

  return NextResponse.json({ expense });
}

/** Edits an expense's own fields (date/category/title/description/amount/
 *  attachments) — never its status/approval fields, which only the
 *  decision endpoint touches. Blocked once approved or rejected (spec §9:
 *  no destructive editing of decided expenses). Saving while
 *  needs_correction flips it back to pending — the fix has been made, it
 *  needs another look, matching the spec's correction workflow. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_HEALTHBOX_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id } = await params;

  const admin = getServiceClient();
  const { data: existing } = await admin.from("pos_healthbox_expenses").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Expense not found" }, { status: 404 });

  const isManager = POS_ADMIN_ROLES.includes(caller.role);
  if (!isManager && existing.submitted_by !== caller.id) {
    return NextResponse.json({ error: "You can only edit your own expenses" }, { status: 403 });
  }
  if (!EDITABLE_STATUSES.includes(existing.status)) {
    return NextResponse.json({ error: `An expense that is ${existing.status} can no longer be edited` }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const amount = body.amount !== undefined ? Number(body.amount) : Number(existing.amount);
  const moneyError = validateExpenseMoney({ amount });
  if (moneyError) return NextResponse.json({ error: moneyError }, { status: 400 });

  const patch: Record<string, unknown> = {
    expense_date: body.expenseDate ?? existing.expense_date,
    category: body.category ?? existing.category,
    title: body.title !== undefined ? String(body.title).trim() : existing.title,
    description: body.description !== undefined ? body.description || null : existing.description,
    amount,
    attachment_urls: body.attachmentPaths !== undefined
      ? (Array.isArray(body.attachmentPaths) && body.attachmentPaths.length > 0 ? body.attachmentPaths : null)
      : existing.attachment_urls,
    // A correction was just made — it needs review again, not a silent
    // re-approval of whatever the previous state implied.
    status: "pending",
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from("pos_healthbox_expenses").update(patch).eq("id", id);
  if (error) {
    console.error("[HealthBox expenses edit]", error);
    return NextResponse.json({ error: "Could not update the expense" }, { status: 500 });
  }

  await logPosActivity({
    userId: caller.id,
    action: "edited_healthbox_expense",
    entityType: "pos_healthbox_expense",
    entityId: id,
    description: `${caller.fullName} edited HealthBox expense "${patch.title}"${existing.status === "needs_correction" ? " (correction submitted)" : ""}`,
  });

  return NextResponse.json({ ok: true });
}
