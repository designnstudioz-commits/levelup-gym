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

/** Marks a finalised settlement Paid. Owner-only, same convention as
 *  finalize (spec §11: "Do not allow HealthBox staff to finalize or mark
 *  settlements as paid" — and this codebase's own pre-existing
 *  POS_OWNER_ROLES boundary for settlement actions). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_OWNER_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));

  const admin = getServiceClient();
  const { data, error } = await admin.rpc("pos_mark_settlement_paid", {
    payload: {
      caller_id: caller.id,
      settlement_id: id,
      payment_method: body?.paymentMethod || null,
      payment_reference: body?.paymentReference || null,
    },
  });

  if (error) {
    console.error("[Settlement mark paid]", error);
    return NextResponse.json({ error: error.message || "Could not mark the settlement paid" }, { status: 400 });
  }

  return NextResponse.json(data);
}
