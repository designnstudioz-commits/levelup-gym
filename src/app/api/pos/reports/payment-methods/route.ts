import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser } from "@/lib/pos/auth";
import { POS_ADMIN_ROLES } from "@/lib/pos/permissions";
import { pktDayBounds } from "@/lib/pos/reports";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Payment Method Report.
 *
 * Deliberately sums pos_payments directly with NO join back to order
 * status: a split payment already contributes only its own leg per method
 * by construction (one row per method per order), and both void reversal
 * rows and refund-mirror rows are already negative payment rows tied to
 * their own order_id — summing every payment row in the window nets both
 * automatically, with no special-casing needed here.
 *
 * Dated by the payment's OWN created_at, not the original sale's date —
 * a refund/void's cash impact belongs to the day it actually happened.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const admin = getServiceClient();
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");

  let query = admin.from("pos_payments").select("method, amount, created_at");
  if (from) query = query.gte("created_at", pktDayBounds(from).start);
  if (to) query = query.lte("created_at", pktDayBounds(to).end);

  const { data: payments, error } = await query;
  if (error) {
    console.error("[POS payment methods report]", error);
    return NextResponse.json({ error: "Could not load the payment method report" }, { status: 500 });
  }

  const byMethod = new Map<string, { total: number; count: number }>();
  for (const p of payments ?? []) {
    const cur = byMethod.get(p.method) ?? { total: 0, count: 0 };
    cur.total += Number(p.amount);
    cur.count += 1;
    byMethod.set(p.method, cur);
  }

  const methods = [...byMethod.entries()].map(([method, v]) => ({ method, total: v.total, count: v.count }));
  const grandTotal = methods.reduce((s, m) => s + m.total, 0);

  return NextResponse.json({ methods, grandTotal });
}
