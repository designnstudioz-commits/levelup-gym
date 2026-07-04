import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Face-recognition ZKTeco devices push captured punch photos (ATTPHOTO) here.
// We don't store these — just acknowledge so the device stops retrying and
// moves on to its other polling cycles (getrequest/cdata).
async function ack(req: NextRequest) {
  const sn = req.nextUrl.searchParams.get("SN") ?? req.nextUrl.searchParams.get("sn") ?? "UNKNOWN";
  try {
    const supabase = getServiceClient();
    await supabase.from("devices").update({ last_seen: new Date().toISOString() }).eq("serial_no", sn);
  } catch (e) {
    console.error("[ADMS FData] Error updating last_seen:", e);
  }
  return new NextResponse("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function GET(req: NextRequest) {
  return ack(req);
}

export async function POST(req: NextRequest) {
  // Drain the body (binary photo data) without parsing it — we just need to
  // consume the request so the connection closes cleanly.
  await req.arrayBuffer().catch(() => null);
  return ack(req);
}
