import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ZKTeco polls this every ~30s for pending commands.
// Respond with "OK" when idle, or "C:id:command\n" lines when commands are queued.
export async function GET(req: NextRequest) {
  const sn =
    req.nextUrl.searchParams.get("SN") ??
    req.nextUrl.searchParams.get("sn") ??
    "UNKNOWN";

  console.log(`[ADMS GetRequest] SN=${sn}`);

  try {
    const supabase = getServiceClient();

    // Fetch pending commands for this device (oldest first)
    const { data: commands } = await supabase
      .from("device_commands")
      .select("id, command_id, command")
      .eq("device_serial", sn)
      .eq("status", "pending")
      .order("created_at")
      .limit(5);

    if (!commands?.length) {
      return new NextResponse("OK", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Mark as sent
    await supabase
      .from("device_commands")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .in("id", commands.map((c) => c.id));

    // Format: C:commandId:payload\n  (fields are tab-separated inside payload)
    const body = commands.map((c) => `C:${c.command_id}:${c.command}`).join("\n") + "\n";
    console.log(`[ADMS GetRequest] Sending ${commands.length} command(s) to SN=${sn}`);

    return new NextResponse(body, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  } catch (e) {
    console.error("[ADMS GetRequest Error]", e);
    return new NextResponse("OK", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
