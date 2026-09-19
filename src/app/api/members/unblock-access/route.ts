import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { pushAccessToAllDevices } from "@/lib/server/devicePush";

// The ack wait below can take ~35s; the platform default would cut the
// request off mid-wait and report a failure for an unblock that succeeded.
export const maxDuration = 60;

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST /api/members/unblock-access
// Body: { member_id }
// Owner/manager/receptionist — receptionist is the role that actually
// collects fees at the counter, so they need a reliable way to restore a
// member's access right there rather than waiting on a manager or the next
// day's cron sweep. A one-time, temporary override — restores device
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

    const allowedRoles = ["owner", "manager", "receptionist"];
    if (!caller || !allowedRoles.includes(caller.role)) {
      return NextResponse.json({ error: "Only owner/manager/receptionist can unblock access" }, { status: 403 });
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

    // 35s covers two full device poll cycles (~20s each). The old 15s was
    // shorter than ONE cycle, so a device that simply hadn't polled yet came
    // back "not acknowledged" and was treated as an outright failure. Seen
    // live 2026-09-19: a receptionist's unblock reported failure, the member
    // record was left flagged as blocked, and the devices then applied the
    // unblock moments later — leaving the member walking in while the system
    // still believed they were locked out.
    const pushResults = await pushAccessToAllDevices(admin, member, "allow", caller.id, { ackTimeoutMs: 35000 });
    const hardFailure = pushResults.some((r) => !r.ok && !r.pending);
    const stillPending = pushResults.some((r) => r.pending);

    if (hardFailure) {
      return NextResponse.json({ error: "Failed to push unlock to one or more devices", pushResults }, { status: 500 });
    }

    // Queued but not yet confirmed by every door. Deliberately does NOT clear
    // the block flag: claiming success here would leave the record saying
    // "has access" while a door still denies them, which nothing downstream
    // would ever notice or correct. Reported as its own state so the counter
    // can retry rather than being shown a misleading error.
    if (stillPending) {
      return NextResponse.json({
        success: false,
        pending: true,
        message: "Sent to the doors but not confirmed yet — try again in a minute.",
        pushResults,
      }, { status: 202 });
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
