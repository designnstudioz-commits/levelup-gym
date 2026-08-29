import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { shouldHaveDeviceAccess } from "@/lib/utils";
import { pushAccessToAllDevices } from "@/lib/server/devicePush";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST /api/devices/sync-access
// Body: { member_id }
// Called (fire-and-forget, not awaited) right after a recurring fee
// payment is recorded, to restore device access immediately if the member
// was previously auto-blocked. No role check — grants no new privilege,
// only runs after an action already gated by the caller's existing
// permission to collect fees.
export async function POST(req: NextRequest) {
  try {
    const { member_id } = (await req.json()) as { member_id?: string };
    if (!member_id) {
      return NextResponse.json({ error: "member_id is required" }, { status: 400 });
    }

    const admin = getServiceClient();

    const { data: member } = await admin
      .from("members")
      .select("id, full_name, expiry_date, access_exempt, access_blocked_at")
      .eq("id", member_id)
      .single();

    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    // Cheap no-op for the common case: nothing to restore.
    if (!member.access_blocked_at) {
      return NextResponse.json({ changed: false });
    }

    if (!shouldHaveDeviceAccess(member)) {
      return NextResponse.json({ changed: false });
    }

    const pushResults = await pushAccessToAllDevices(admin, member, "allow", null);
    const allOk = pushResults.length === 0 || pushResults.every((r) => r.ok);

    if (allOk) {
      await admin.from("members").update({
        access_blocked_at: null,
        access_blocked_reason: null,
      }).eq("id", member_id);

      await admin.from("activity_logs").insert({
        user_id: null,
        action: "auto_unblocked_access",
        entity_type: "member",
        entity_id: member_id,
        description: `${member.full_name}'s device access was automatically restored after a qualifying payment`,
      });
    }

    return NextResponse.json({ changed: allOk, pushResults });
  } catch (err) {
    console.error("[SyncAccess Error]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
