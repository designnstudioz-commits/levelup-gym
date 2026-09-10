import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_ADMIN_ROLES } from "@/lib/pos/permissions";
import type { PosPaymentMethod } from "@/types/pos";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const VALID_METHODS: PosPaymentMethod[] = ["Cash", "Card", "Bank Transfer", "EasyPaisa", "JazzCash"];

/**
 * Dashboard approve/reject for a pending request — the async path for
 * when no manager was at the counter to PIN-approve on the spot. The
 * caller's own authenticated owner/manager session IS the authorisation
 * here; no PIN is asked for a second time.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id: approvalId } = await params;

  const body = await req.json().catch(() => null);
  const decision = body?.decision as "approve" | "reject" | undefined;
  const note = typeof body?.note === "string" ? body.note : null;
  const payoutMethod = body?.payoutMethod as PosPaymentMethod | undefined;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : null;

  if (decision !== "approve" && decision !== "reject") {
    return NextResponse.json({ error: "decision must be 'approve' or 'reject'" }, { status: 400 });
  }

  const admin = getServiceClient();
  const { data: approval } = await admin
    .from("pos_approvals")
    .select("id, type, order_id, reason, status")
    .eq("id", approvalId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!approval) {
    return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  }
  if (approval.status !== "pending") {
    return NextResponse.json({ error: `This request is already ${approval.status}` }, { status: 409 });
  }

  if (decision === "reject") {
    const { error } = await admin
      .from("pos_approvals")
      .update({ status: "rejected", resolved_by: caller.id, resolved_at: new Date().toISOString(), resolution_note: note })
      .eq("id", approvalId);
    if (error) {
      console.error("[POS approval reject]", error);
      return NextResponse.json({ error: "Could not reject this request" }, { status: 500 });
    }
    return NextResponse.json({ status: "rejected" });
  }

  // Approve. discount_over_limit has no async path (there is no UI that
  // creates one pending — see the Phase C report) — reject the attempt
  // clearly rather than silently doing nothing.
  if (approval.type === "void") {
    const { data, error } = await admin.rpc("pos_void_order", {
      payload: { order_id: approval.order_id, approved_by: caller.id, approval_id: approvalId, reason: approval.reason },
    });
    if (error) {
      console.error("[POS approval approve void]", error);
      return NextResponse.json({ error: error.message || "Could not void this order" }, { status: 409 });
    }
    return NextResponse.json(data);
  }

  if (approval.type === "refund") {
    if (!payoutMethod || !VALID_METHODS.includes(payoutMethod)) {
      return NextResponse.json({ error: "A valid payoutMethod is required to approve a refund" }, { status: 400 });
    }
    const { data, error } = await admin.rpc("pos_refund_order", {
      payload: {
        order_id: approval.order_id, approved_by: caller.id, approval_id: approvalId,
        reason: approval.reason, payout_method: payoutMethod, session_id: sessionId,
      },
    });
    if (error) {
      console.error("[POS approval approve refund]", error);
      return NextResponse.json({ error: error.message || "Could not refund this order" }, { status: 409 });
    }
    return NextResponse.json(data);
  }

  return NextResponse.json({ error: `Cannot approve a ${approval.type} request from this endpoint` }, { status: 400 });
}
