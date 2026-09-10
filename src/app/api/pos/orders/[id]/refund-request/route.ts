import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser, logPosActivity } from "@/lib/pos/auth";
import { POS_TERMINAL_ROLES } from "@/lib/pos/permissions";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Queues a refund request for later dashboard approval. The payout
 *  method is decided at resolve time, not here — it's a same-moment
 *  decision for whoever actually processes the money going back out. */
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
  if (!reason) {
    return NextResponse.json({ error: "A reason is required" }, { status: 400 });
  }

  const admin = getServiceClient();
  const { data, error } = await admin
    .from("pos_approvals")
    .insert({ type: "refund", order_id: orderId, reason, status: "pending", requested_by: caller.id })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[POS refund-request]", error);
    return NextResponse.json({ error: "Could not submit the refund request" }, { status: 500 });
  }

  await logPosActivity({
    userId: caller.id,
    action: "requested_pos_refund",
    entityType: "pos_approval",
    entityId: data.id,
    description: `${caller.fullName} requested a refund — awaiting manager approval`,
  });

  return NextResponse.json({ approvalId: data.id, status: "pending" });
}
