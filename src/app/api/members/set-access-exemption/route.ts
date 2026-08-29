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

// POST /api/members/set-access-exemption
// Body: { member_id, exempt, reason? }
// Owner/manager only. Turning exemption ON immediately force-unlocks the
// member (pushes full access to every enrolled device) if they're
// currently blocked — the whole point of the "personal member, give me
// liberty to unlock" ask. Turning it OFF does not instantly re-block;
// it just returns them to being subject to the next access-sweep run.
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
      return NextResponse.json({ error: "Only owner/manager can change access exemption" }, { status: 403 });
    }

    const body = await req.json();
    const { member_id, exempt, reason } = body as { member_id?: string; exempt?: boolean; reason?: string };
    if (!member_id || typeof exempt !== "boolean") {
      return NextResponse.json({ error: "member_id and exempt (boolean) are required" }, { status: 400 });
    }

    const admin = getServiceClient();

    const { data: member } = await admin
      .from("members")
      .select("id, full_name, access_blocked_at")
      .eq("id", member_id)
      .single();

    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    const { error: updateError } = await admin.from("members").update({
      access_exempt: exempt,
      access_exempt_reason: reason?.trim() || null,
      access_exempt_by: caller.id,
      access_exempt_at: new Date().toISOString(),
    }).eq("id", member_id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    let forceUnlocked = false;
    let pushResults: { device_serial: string; ok: boolean; error?: string }[] = [];

    if (exempt && member.access_blocked_at) {
      pushResults = await pushAccessToAllDevices(admin, member, "allow", caller.id);
      const allOk = pushResults.length === 0 || pushResults.every((r) => r.ok);
      if (allOk) {
        await admin.from("members").update({
          access_blocked_at: null,
          access_blocked_reason: null,
        }).eq("id", member_id);
        forceUnlocked = true;
      }
    }

    await supabase.from("activity_logs").insert({
      user_id: caller.id,
      action: exempt ? "exempted_from_auto_block" : "removed_access_exemption",
      entity_type: "member",
      entity_id: member_id,
      description: exempt
        ? `${user.email} exempted ${member.full_name} from automatic access blocking${reason ? ` (${reason})` : ""}${forceUnlocked ? " and force-unlocked their device access" : ""}`
        : `${user.email} removed ${member.full_name}'s access-blocking exemption`,
    });

    return NextResponse.json({ success: true, forceUnlocked, pushResults });
  } catch (err) {
    console.error("[SetAccessExemption Error]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
