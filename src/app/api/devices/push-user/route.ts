import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST /api/devices/push-user
// Body: { member_id, device_serial }
// Queues a DATA UPDATE USERINFO command for the ZKTeco device.
// The device picks it up on the next /iclock/getrequest poll (~30s).
export async function POST(req: NextRequest) {
  try {
    const { member_id, device_serial } = await req.json();

    if (!member_id || !device_serial) {
      return NextResponse.json({ error: "member_id and device_serial required" }, { status: 400 });
    }

    const supabase = getServiceClient();

    // Fetch the enrollment to get the device-specific user ID
    const { data: enrollment } = await supabase
      .from("device_enrollments")
      .select("device_user_id")
      .eq("member_id", member_id)
      .eq("device_serial", device_serial)
      .is("deleted_at", null)
      .single();

    if (!enrollment) {
      return NextResponse.json({ error: "No enrollment found for this member on this device" }, { status: 404 });
    }

    // Fetch member name
    const { data: member } = await supabase
      .from("members")
      .select("full_name")
      .eq("id", member_id)
      .single();

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    // Get next command_id for this device (sequential per device)
    const { count } = await supabase
      .from("device_commands")
      .select("*", { count: "exact", head: true })
      .eq("device_serial", device_serial);

    const commandId = (count ?? 0) + 1;

    // ZKTeco ADMS user push command (tab-separated fields)
    // PIN = user ID on device, Pri = privilege (0=normal), Grp = group (1=default)
    const uid = enrollment.device_user_id;
    const name = member.full_name.substring(0, 24); // device name field limit
    const command = [
      "DATA UPDATE USERINFO",
      `PIN=${uid}`,
      `Name=${name}`,
      `Pri=0`,
      `Passwd=`,
      `Card=`,
      `Grp=1`,
      `TZ=0`,
      `Verify=0`,
      `ViceCard=`,
    ].join("\t");

    const { error } = await supabase.from("device_commands").insert({
      device_serial,
      command_id: commandId,
      command,
      command_type: "push_user",
      member_id,
      status: "pending",
    });

    if (error) {
      console.error("[PushUser] Insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[PushUser] Queued command ${commandId} for ${member.full_name} → ${device_serial} (UserID=${uid})`);
    return NextResponse.json({ success: true, commandId, userId: uid, name: member.full_name });
  } catch (e) {
    console.error("[PushUser] Error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
