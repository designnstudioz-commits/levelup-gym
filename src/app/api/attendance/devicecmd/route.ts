import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ZKTeco sends command acknowledgment here after executing a command from getrequest.
// Can arrive as GET (?SN=X&ID=Y&Return=0&CMD=ACK_DATA) or POST with same fields in body.
async function handleAck(sn: string, rawId: string | null, ret: string | null) {
  const commandId = rawId ? parseInt(rawId, 10) : null;
  const returnCode = ret ? parseInt(ret, 10) : null;

  console.log(`[ADMS DeviceCmd] SN=${sn} ID=${commandId} Return=${returnCode}`);

  if (!commandId) return;

  const supabase = getServiceClient();
  const now = new Date().toISOString();

  await supabase
    .from("device_commands")
    .update({
      status: returnCode === 0 ? "acked" : "failed",
      acked_at: now,
      return_code: returnCode,
      error: returnCode !== 0 ? `Device returned error code ${returnCode}` : null,
    })
    .eq("device_serial", sn)
    .eq("command_id", commandId)
    .in("status", ["sent", "pending"]);
}

export async function GET(req: NextRequest) {
  const sn = req.nextUrl.searchParams.get("SN") ?? req.nextUrl.searchParams.get("sn") ?? "UNKNOWN";
  const id = req.nextUrl.searchParams.get("ID") ?? req.nextUrl.searchParams.get("id");
  const ret = req.nextUrl.searchParams.get("Return") ?? req.nextUrl.searchParams.get("return");
  await handleAck(sn, id, ret);
  return new NextResponse("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(req: NextRequest) {
  const sn = req.nextUrl.searchParams.get("SN") ?? req.nextUrl.searchParams.get("sn") ?? "UNKNOWN";
  const body = await req.text();
  console.log(`[ADMS DeviceCmd POST] SN=${sn} body=${body}`);
  const p = new URLSearchParams(body);
  const id = p.get("ID") ?? p.get("id");
  const ret = p.get("Return") ?? p.get("return");
  await handleAck(sn, id, ret);
  return new NextResponse("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
}
