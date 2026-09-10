import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requirePosUser, logPosActivity } from "@/lib/pos/auth";
import { POS_ADMIN_ROLES } from "@/lib/pos/permissions";
import { hashManagerPin } from "@/lib/pos/managerPin";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Self-service: an owner or manager sets THEIR OWN override PIN. There is
 * no admin screen here for setting someone else's PIN — deliberately
 * minimal, flagged in the Phase C report. A manager who needs one sets it
 * themselves from this same action.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePosUser(POS_ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const { caller } = auth;

  const body = await req.json().catch(() => null);
  const pin = String(body?.pin ?? "");

  if (!/^\d{4,6}$/.test(pin)) {
    return NextResponse.json({ error: "PIN must be 4 to 6 digits" }, { status: 400 });
  }

  const hash = await hashManagerPin(pin);
  const admin = getServiceClient();

  const { error } = await admin
    .from("system_users")
    .update({ manager_pin_hash: hash })
    .eq("id", caller.id);

  if (error) {
    console.error("[POS set-pin]", error);
    return NextResponse.json({ error: "Could not set your PIN" }, { status: 500 });
  }

  await logPosActivity({
    userId: caller.id,
    action: "set_manager_pin",
    entityType: "system_user",
    entityId: caller.id,
    description: `${caller.fullName} set their manager override PIN`,
  });

  return NextResponse.json({ ok: true });
}
