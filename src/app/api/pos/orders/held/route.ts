import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_TERMINAL_ROLES } from "@/lib/pos/permissions";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Lists currently-held orders for the Held Orders drawer. Deliberately not
 *  scoped to "my own holds only" — any cashier on shift should be able to
 *  resume a basket a colleague parked before a break. */
export async function GET() {
  const auth = await requirePosUser(POS_TERMINAL_ROLES);
  if (!auth.ok) return auth.response;

  const admin = getServiceClient();
  const { data, error } = await admin
    .from("pos_orders")
    .select("id, hold_ref, held_at, held_label, item_count, net_amount")
    .eq("status", "held")
    .is("deleted_at", null)
    .order("held_at", { ascending: false });

  if (error) {
    console.error("[POS held list]", error);
    return NextResponse.json({ error: "Could not load held orders" }, { status: 500 });
  }

  return NextResponse.json({
    orders: (data ?? []).map((o) => ({
      id: o.id,
      holdRef: o.hold_ref,
      heldAt: o.held_at,
      heldLabel: o.held_label,
      itemCount: o.item_count,
      netAmount: o.net_amount,
    })),
  });
}
