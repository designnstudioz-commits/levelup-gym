import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST /api/devices/delete-user
// Body: { member_id, device_serial, device_user_id }
// Queues a DATA DELETE USERINFO command for the ZKTeco device — removes the
// user (and their enrolled fingerprint) from that machine. The device picks
// it up on its next /iclock/getrequest poll (~30s).
//
// device_user_id is passed in directly (the caller already has it, e.g. the
// device_enrollments row being removed) rather than looked up here, since
// the enrollment row is typically soft-deleted in the same action that
// triggers this — looking it up after that point would find nothing.
export async function POST(req: NextRequest) {
  try {
    const { member_id, device_serial, device_user_id } = await req.json();

    if (!member_id || !device_serial || !device_user_id) {
      return NextResponse.json(
        { error: "member_id, device_serial, and device_user_id required" },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    const command = ["DATA DELETE USERINFO", `PIN=${device_user_id}`].join("\t");

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
        command_type: "delete_user",
        member_id,
        status: "pending",
      });

      if (!error) { insertError = null; break; }
      insertError = error;
      if (error.code !== "23505") break; // not a unique-violation — don't retry
      console.warn(`[DeleteUser] command_id ${commandId} collided for ${device_serial}, retrying (attempt ${attempt + 1})`);
    }

    if (insertError) {
      console.error("[DeleteUser] Insert error:", insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    console.log(`[DeleteUser] Queued command ${commandId} for member ${member_id} → ${device_serial} (UserID=${device_user_id})`);
    return NextResponse.json({ success: true, commandId, userId: device_user_id });
  } catch (e) {
    console.error("[DeleteUser] Error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
