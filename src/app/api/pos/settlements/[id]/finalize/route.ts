import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_OWNER_ROLES } from "@/lib/pos/permissions";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Finalizes a settlement — the atomic financial posting operation (spec
 * §20), via pos_finalize_healthbox_settlement() (see the Phase G
 * migration): locks and claims every included order/expense, verifies
 * none are already claimed by a different settlement, persists the final
 * snapshot, and marks the settlement finalised — all in one transaction,
 * or it fails completely and nothing is claimed.
 *
 * Owner-only — matches this codebase's own pre-existing documented
 * convention (POS_OWNER_ROLES: "vendor terms, settlement finalisation,
 * financial ownership") from before Phase G started, not a new
 * restriction invented here. Manager can create/review/recalculate a
 * draft (spec §18: "including HealthBox review/settlement where
 * approved") but the actual posting stays owner-only.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_OWNER_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id } = await params;

  const admin = getServiceClient();
  const { data, error } = await admin.rpc("pos_finalize_healthbox_settlement", {
    payload: { caller_id: caller.id, settlement_id: id },
  });

  if (error) {
    console.error("[Settlement finalize]", error);
    return NextResponse.json({ error: error.message || "Could not finalize the settlement" }, { status: 400 });
  }

  return NextResponse.json(data);
}
