import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS, safe here because this is a server-only API route
function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ZKTeco ADMS push endpoint
// The SpeedFace V5L sends HTTP POST to this URL with URL-encoded body
// Format: sn=SERIAL&table=ATTLOG&Stamp=...&UserID=...&AttTime=...&AttState=...&VerifyMethod=...
export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const params = new URLSearchParams(body);

    const serialNo   = params.get("sn") ?? "UNKNOWN";
    const table      = params.get("table");
    const rawRecords = params.get("Stamp");   // Sometimes used as record separator
    const userId     = params.get("UserID");
    const attTime    = params.get("AttTime");
    const attState   = params.get("AttState");  // 0=Check-in, 1=Check-out, 4=OT-in, 5=OT-out
    const verifyMethod = params.get("VerifyMethod"); // 1=FP,2=Face,3=Card,4=PW

    const supabase = getServiceClient();

    // Update device last_seen — upsert so unknown devices are auto-registered
    await supabase.from("devices").upsert(
      { serial_no: serialNo, last_seen: new Date().toISOString(), name: `Device ${serialNo}` },
      { onConflict: "serial_no", ignoreDuplicates: false }
    );

    // Only process attendance logs
    if (table !== "ATTLOG") {
      return NextResponse.json({ ret: "OK" }, { status: 200 });
    }

    // The device may send multiple records separated by newlines in the body
    // or a single record — handle both
    const rawBody = body;
    const lines = rawBody.split("\n").filter((l) => l.trim());

    for (const line of lines) {
      const p = new URLSearchParams(line);
      const uid   = p.get("UserID") || userId;
      const time  = p.get("AttTime") || attTime;
      const state = p.get("AttState") || attState;
      const verify = p.get("VerifyMethod") || verifyMethod;

      if (!uid || !time) continue;

      // Parse punch time (device sends local time — PKT UTC+5)
      // Convert to UTC for storage
      const localDate = new Date(time.replace(" ", "T") + "+05:00");
      const punchTimeUTC = localDate.toISOString();

      // Map state to punch type
      const punchType =
        state === "0" || state === "4" ? "in" :
        state === "1" || state === "5" ? "out" : "unknown";

      // Map verify method
      const verifyLabel =
        verify === "1" ? "fingerprint" :
        verify === "2" ? "face" :
        verify === "3" ? "card" :
        verify === "4" ? "password" : "unknown";

      // Look up member by device_user_id
      const { data: member } = await supabase
        .from("members")
        .select("id, full_name, status")
        .eq("device_user_id", uid)
        .is("deleted_at", null)
        .single();

      if (member) {
        // Check for duplicate (same member + same minute — device sometimes sends twice)
        const minuteStart = new Date(localDate);
        minuteStart.setSeconds(0, 0);
        const minuteEnd = new Date(localDate);
        minuteEnd.setSeconds(59, 999);

        const { count } = await supabase
          .from("attendances")
          .select("*", { count: "exact", head: true })
          .eq("member_id", member.id)
          .gte("punch_time", minuteStart.toISOString())
          .lte("punch_time", minuteEnd.toISOString());

        if ((count ?? 0) === 0) {
          await supabase.from("attendances").insert({
            member_id: member.id,
            device_id: serialNo,
            punch_time: punchTimeUTC,
            punch_type: punchType,
            verified: true,
          });
        }
      } else {
        // Check staff
        const { data: staff } = await supabase
          .from("staff_members")
          .select("id")
          .eq("device_user_id", uid)
          .is("deleted_at", null)
          .single();

        if (staff) {
          await supabase.from("attendances").insert({
            staff_id: staff.id,
            device_id: serialNo,
            punch_time: punchTimeUTC,
            punch_type: punchType,
            verified: true,
          });
        } else {
          // Unknown user — store for manual resolution
          await supabase.from("unverified_attendances").insert({
            device_id: serialNo,
            raw_id: uid,
            punch_time: punchTimeUTC,
          });
        }
      }
    }

    // ZKTeco expects this exact response to confirm receipt
    return new NextResponse("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
  } catch (err) {
    console.error("[ADMS Push Error]", err);
    // Still return OK so device doesn't keep retrying the same record
    return new NextResponse("OK", { status: 200 });
  }
}

// Device heartbeat — ZKTeco devices ping GET to check server is alive
export async function GET(req: NextRequest) {
  const sn = req.nextUrl.searchParams.get("sn");
  if (sn) {
    const supabase = getServiceClient();
    await supabase.from("devices")
      .upsert({ serial_no: sn, last_seen: new Date().toISOString(), name: `Device ${sn}` },
               { onConflict: "serial_no", ignoreDuplicates: false });
  }
  return new NextResponse("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
}
