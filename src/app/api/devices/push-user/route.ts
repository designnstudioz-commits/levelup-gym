import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST /api/devices/push-user
// Body: { member_id, device_serial } OR { staff_id, device_serial }
// Queues a DATA UPDATE USERINFO command for the ZKTeco device.
// The device picks it up on the next /iclock/getrequest poll (~30s).
export async function POST(req: NextRequest) {
  try {
    const { member_id, staff_id, device_serial } = await req.json();

    if ((!member_id && !staff_id) || !device_serial) {
      return NextResponse.json({ error: "member_id or staff_id, plus device_serial, required" }, { status: 400 });
    }

    const supabase = getServiceClient();
    let uid: string;
    let name: string;

    if (staff_id) {
      // Staff use a single device_user_id column directly on staff_members —
      // reserved range 5000+ so it never collides with member PINs, which
      // are derived from membership numbers starting at 1.
      const { data: staff } = await supabase
        .from("staff_members")
        .select("full_name, device_user_id")
        .eq("id", staff_id)
        .single();

      if (!staff) {
        return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
      }
      if (!staff.device_user_id) {
        return NextResponse.json({ error: "Staff member has no device ID assigned" }, { status: 404 });
      }
      uid = staff.device_user_id;
      name = staff.full_name;
    } else {
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

      const { data: member } = await supabase
        .from("members")
        .select("full_name")
        .eq("id", member_id)
        .single();

      if (!member) {
        return NextResponse.json({ error: "Member not found" }, { status: 404 });
      }
      uid = enrollment.device_user_id;
      name = member.full_name;
    }

    // ZKTeco ADMS user push command (tab-separated fields)
    // PIN = user ID on device, Pri = privilege (0=normal), Grp = group (1=default)
    const truncatedName = name.substring(0, 24); // device name field limit
    const command = [
      "DATA UPDATE USERINFO",
      `PIN=${uid}`,
      `Name=${truncatedName}`,
      `Pri=0`,
      `Passwd=`,
      `Card=`,
      `Grp=1`,
      `TZ=0`,
      `Verify=0`,
      `ViceCard=`,
    ].join("\t");

    // command_id is sequential per device (count()+1) with no way to reserve
    // it atomically — a unique constraint on (device_serial, command_id)
    // catches a collision from a concurrent push instead of silently
    // corrupting command/ack tracking, and we just retry with a fresh count.
    let commandId: number | null = null;
    let insertError: { code?: string; message: string } | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const { count } = await supabase
        .from("device_commands")
        .select("*", { count: "exact", head: true })
        .eq("device_serial", device_serial);

      commandId = (count ?? 0) + 1;

      const { error } = await supabase.from("device_commands").insert({
        device_serial,
        command_id: commandId,
        command,
        command_type: "push_user",
        member_id: member_id ?? null,
        staff_id: staff_id ?? null,
        status: "pending",
      });

      if (!error) { insertError = null; break; }
      insertError = error;
      if (error.code !== "23505") break; // not a unique-violation — don't retry
      console.warn(`[PushUser] command_id ${commandId} collided for ${device_serial}, retrying (attempt ${attempt + 1})`);
    }

    if (insertError) {
      console.error("[PushUser] Insert error:", insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    console.log(`[PushUser] Queued command ${commandId} for ${name} → ${device_serial} (UserID=${uid})`);
    return NextResponse.json({ success: true, commandId, userId: uid, name });
  } catch (e) {
    console.error("[PushUser] Error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
