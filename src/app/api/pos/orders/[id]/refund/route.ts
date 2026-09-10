import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_TERMINAL_ROLES, POS_ADMIN_ROLES } from "@/lib/pos/permissions";
import { resolveManagerByPin } from "@/lib/pos/managerAuth";
import type { PosPaymentMethod } from "@/types/pos";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const VALID_METHODS: PosPaymentMethod[] = ["Cash", "Card", "Bank Transfer", "EasyPaisa", "JazzCash"];

/**
 * Instant-PIN refund — same shape as void. Full-order only (see
 * pos_refund_order's header for that scope cut). The payout method is
 * chosen here, at the moment of refund, by whoever is processing it — it
 * does not have to match how the original sale was paid.
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
  const payoutMethod = body?.payoutMethod as PosPaymentMethod | undefined;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : null;

  if (!reason) {
    return NextResponse.json({ error: "A reason is required" }, { status: 400 });
  }
  if (!payoutMethod || !VALID_METHODS.includes(payoutMethod)) {
    return NextResponse.json({ error: "A valid payout method is required" }, { status: 400 });
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
      type: "refund",
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
    console.error("[POS refund] approval insert failed", approvalErr);
    return NextResponse.json({ error: "Could not record the approval" }, { status: 500 });
  }

  const { data, error } = await admin.rpc("pos_refund_order", {
    payload: {
      order_id: orderId,
      approved_by: approvedById,
      approval_id: approval.id,
      reason,
      payout_method: payoutMethod,
      session_id: sessionId,
    },
  });

  if (error) {
    console.error("[POS refund]", error);
    return NextResponse.json({ error: error.message || "Could not refund this order" }, { status: 409 });
  }

  return NextResponse.json({ ...data, approvedByName });
}
