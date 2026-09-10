import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_TERMINAL_ROLES, POS_ADMIN_ROLES } from "@/lib/pos/permissions";
import { resolveManagerByPin } from "@/lib/pos/managerAuth";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Instant-PIN void — the common counter case: cashier asks a manager over,
 * the manager types their PIN once, the void posts immediately.
 *
 * A cashier CAN reach this route (the approved Recent Orders frame shows
 * the Refund/Void buttons in the cashier's own UI) but cannot complete it
 * without a valid manager PIN. An owner/manager acting on their own
 * terminal session self-authorises — no PIN needed from themselves.
 *
 * The approval row is written here, already resolved to 'approved',
 * BEFORE calling pos_void_order() — giving a full audit trail even for
 * the instant path, not just the async dashboard one.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_TERMINAL_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id: orderId } = await params;

  const body = await req.json().catch(() => null);
  const reason = String(body?.reason ?? "").trim();
  const pin = typeof body?.pin === "string" ? body.pin : null;

  if (!reason) {
    return NextResponse.json({ error: "A reason is required" }, { status: 400 });
  }

  let approvedById = caller.id;
  let approvedByName = caller.fullName;

  if (!POS_ADMIN_ROLES.includes(caller.role)) {
    if (!pin) {
      return NextResponse.json({ error: "Manager PIN required" }, { status: 401 });
    }
    const manager = await resolveManagerByPin(pin);
    if (!manager) {
      return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
    }
    approvedById = manager.id;
    approvedByName = manager.fullName;
  }

  const admin = getServiceClient();

  const { data: approval, error: approvalErr } = await admin
    .from("pos_approvals")
    .insert({
      type: "void",
      order_id: orderId,
      reason,
      status: "approved",
      requested_by: caller.id,
      resolved_by: approvedById,
      resolved_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (approvalErr || !approval) {
    console.error("[POS void] approval insert failed", approvalErr);
    return NextResponse.json({ error: "Could not record the approval" }, { status: 500 });
  }

  const { data, error } = await admin.rpc("pos_void_order", {
    payload: { order_id: orderId, approved_by: approvedById, approval_id: approval.id, reason },
  });

  if (error) {
    console.error("[POS void]", error);
    return NextResponse.json({ error: error.message || "Could not void this order" }, { status: 409 });
  }

  return NextResponse.json({ ...data, approvedByName });
}
