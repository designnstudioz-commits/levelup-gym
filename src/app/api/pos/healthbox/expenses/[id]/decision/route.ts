import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser, logPosActivity } from "@/lib/pos/auth";
import { POS_ADMIN_ROLES } from "@/lib/pos/permissions";
import { DECIDABLE_STATUSES } from "@/lib/pos/healthboxExpenses";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Approve / reject / send-back-for-correction. Owner/manager only (spec
 * §3) — healthbox_staff never reaches this route at all, let alone their
 * own expense (requirePosUser rejects them before any row is touched, so
 * "cannot self-approve" isn't a business-logic check here, it's a role
 * check that makes the scenario impossible).
 *
 * Only a pending or needs_correction expense can receive a decision —
 * approved/rejected are final (spec §9), so this can't silently flip an
 * already-decided expense.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const action = body?.action as "approve" | "reject" | "needs_correction" | undefined;
  if (!action || !["approve", "reject", "needs_correction"].includes(action)) {
    return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
  }

  const admin = getServiceClient();
  const { data: existing } = await admin.from("pos_healthbox_expenses").select("id, title, status").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  if (!DECIDABLE_STATUSES.includes(existing.status)) {
    return NextResponse.json({ error: `This expense is already ${existing.status} and cannot be decided again` }, { status: 400 });
  }

  if (action === "reject" && !String(body?.rejectionReason ?? "").trim()) {
    return NextResponse.json({ error: "A reason is required to reject an expense" }, { status: 400 });
  }
  if (action === "needs_correction" && !String(body?.managementNote ?? "").trim()) {
    return NextResponse.json({ error: "A note is required so the submitter knows what to fix" }, { status: 400 });
  }

  const statusByAction = { approve: "approved", reject: "rejected", needs_correction: "needs_correction" } as const;

  const patch = {
    status: statusByAction[action],
    approved_by: caller.id,
    approved_at: new Date().toISOString(),
    rejection_reason: action === "reject" ? String(body.rejectionReason).trim() : null,
    management_note: body?.managementNote ? String(body.managementNote).trim() : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from("pos_healthbox_expenses").update(patch).eq("id", id);
  if (error) {
    console.error("[HealthBox expenses decision]", error);
    return NextResponse.json({ error: "Could not record the decision" }, { status: 500 });
  }

  const actionLog = { approve: "approved_healthbox_expense", reject: "rejected_healthbox_expense", needs_correction: "requested_correction_healthbox_expense" }[action];
  const verb = { approve: "approved", reject: "rejected", needs_correction: "requested a correction on" }[action];
  await logPosActivity({
    userId: caller.id,
    action: actionLog,
    entityType: "pos_healthbox_expense",
    entityId: id,
    description: `${caller.fullName} ${verb} HealthBox expense "${existing.title}"`,
  });

  return NextResponse.json({ ok: true, status: patch.status });
}
