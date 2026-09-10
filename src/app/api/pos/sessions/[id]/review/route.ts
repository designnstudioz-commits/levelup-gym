import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_ADMIN_ROLES } from "@/lib/pos/permissions";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Manager review — locks a closed shift. Per the approved frame's own
 *  wording: "keeps the session immutable after manager review." Once
 *  reviewed, correcting it is a deliberate separate action, not an edit. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id } = await params;

  const admin = getServiceClient();
  const { data, error } = await admin.rpc("pos_review_session", {
    payload: { session_id: id, reviewed_by: caller.id },
  });

  if (error) {
    console.error("[POS session review]", error);
    return NextResponse.json({ error: error.message || "Could not review this session" }, { status: 409 });
  }

  // No separate logPosActivity() call — pos_review_session() already wrote
  // the audit entry atomically as part of the same transaction.
  return NextResponse.json(data);
}
