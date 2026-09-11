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

/** Posts the count: pos_apply_stock_count() atomically writes one
 *  count_correction movement per line that actually differs from live
 *  stock, updates stock_qty, and marks the count applied. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const { id } = await params;

  const admin = getServiceClient();
  const { data, error } = await admin.rpc("pos_apply_stock_count", {
    payload: { caller_id: caller.id, count_id: id },
  });

  if (error) {
    console.error("[POS admin inventory counts apply]", error);
    return NextResponse.json({ error: error.message || "Could not apply the stock count" }, { status: 400 });
  }

  return NextResponse.json(data);
}
