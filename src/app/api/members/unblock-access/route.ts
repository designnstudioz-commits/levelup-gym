import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { pushAccessToAllDevices } from "@/lib/server/devicePush";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST /api/members/unblock-access
// Body: { member_id }
// Owner/manager only. A one-time, temporary override — restores device
// access right now without exempting the member from future auto-blocking
// (unlike /api/members/set-access-exemption). If they're still genuinely
// unpaid/expired, the next daily sweep will block them again.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: caller } = await supabase
      .from("system_users")
      .select("id, role")
      .eq("email", user.email!.toLowerCase())
      .eq("status", "active")
      .is("deleted_at", null)
      .maybeSingle();

    if (!caller || (caller.role !== "owner" && caller.role !== "manager")) {
      return NextResponse.json({ error: "Only owner/manager can unblock access" }, { status: 403 });
    }

    const { member_id } = (await req.json()) as { member_id?: string };
    if (!member_id) {
      return NextResponse.json({ error: "member_id is required" }, { status: 400 });
    }

    const admin = getServiceClient();

    const { data: member } = await admin
      .from("members")
      .select("id, full_name, access_blocked_at")
      .eq("id", member_id)
      .single();

    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    if (!member.access_blocked_at) return NextResponse.json({ success: true, alreadyUnblocked: true });

    const pushResults = await pushAccessToAllDevices(admin, member, "allow", caller.id);
    const allOk = pushResults.length === 0 || pushResults.every((r) => r.ok);

    if (!allOk) {
      return NextResponse.json({ error: "Failed to push unlock to one or more devices", pushResults }, { status: 500 });
    }

    await admin.from("members").update({
      access_blocked_at: null,
      access_blocked_reason: null,
    }).eq("id", member_id);

    await supabase.from("activity_logs").insert({
      user_id: caller.id,
      action: "manually_unblocked_access",
      entity_type: "member",
      entity_id: member_id,
      description: `${user.email} manually unblocked ${member.full_name}'s device access`,
    });

    return NextResponse.json({ success: true, pushResults });
  } catch (err) {
    console.error("[UnblockAccess Error]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
