import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function getSN(req: NextRequest): string {
  // Device sends either ?SN= or ?sn= depending on firmware
  return (
    req.nextUrl.searchParams.get("SN") ??
    req.nextUrl.searchParams.get("sn") ??
    "UNKNOWN"
  );
}

// ZKTeco ADMS heartbeat — device pings this every ~30s
// CRITICAL: respond with "GET ATTLOG STAMP=0" to instruct device to push logs
export async function GET(req: NextRequest) {
  const sn = getSN(req);
  console.log(`[ADMS Heartbeat] SN=${sn} options=${req.nextUrl.searchParams.get("options")}`);

  try {
    const supabase = getServiceClient();
    const now = new Date().toISOString();
    // Try insert first; if device already exists just update last_seen (preserve custom name)
    const { error } = await supabase.from("devices").insert({ serial_no: sn, last_seen: now, name: `Device ${sn}` });
    if (error) {
      await supabase.from("devices").update({ last_seen: now }).eq("serial_no", sn);
    }
  } catch (e) {
    console.error("[ADMS Heartbeat DB Error]", e);
  }

  // Tell the device to push all attendance logs and user info
  return new NextResponse(
    "GET ATTLOG STAMP=9999999999\nGET OPERLOG STAMP=9999999999\n",
    { status: 200, headers: { "Content-Type": "text/plain" } }
  );
}

// ZKTeco ADMS attendance push
// Body format varies by firmware — handle both URL-encoded and tab-separated
export async function POST(req: NextRequest) {
  let body = "";
  try {
    body = await req.text();
    console.log(`[ADMS POST] Raw body:\n${body}`);

    const supabase = getServiceClient();

    // table and SN come from the URL query string, not the body
    const serialNo = req.nextUrl.searchParams.get("SN") ?? req.nextUrl.searchParams.get("sn") ?? getSN(req);
    const table = req.nextUrl.searchParams.get("table") ?? req.nextUrl.searchParams.get("Table");

    console.log(`[ADMS POST] SN=${serialNo} table=${table}`);

    // Update device last_seen only (preserve custom name)
    await supabase.from("devices").update({ last_seen: new Date().toISOString() }).eq("serial_no", serialNo);

    if (table !== "ATTLOG") {
      console.log(`[ADMS POST] Ignoring table=${table}`);
      return new NextResponse("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
    }

    // Collect all attendance records — lines can be:
    //   Tab-separated:  "1\t2025-06-06 09:30:00\t0\t1\t0\t0"
    //   URL-encoded:    "UserID=1&AttTime=2025-06-06+09:30:00&AttState=0&VerifyMethod=1"
    const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
      let uid: string | null = null;
      let time: string | null = null;
      let state: string | null = null;
      let verify: string | null = null;

      if (line.includes("\t")) {
        // Tab-separated format: UserID AttTime AttState VerifyType WorkCode Reserved
        const parts = line.split("\t");
        uid    = parts[0] ?? null;
        time   = parts[1] ?? null;
        state  = parts[2] ?? null;
        verify = parts[3] ?? null;
      } else if (line.includes("UserID=") || line.includes("userid=")) {
        // URL-encoded format
        const p = new URLSearchParams(line);
        uid    = p.get("UserID") ?? p.get("userid");
        time   = p.get("AttTime") ?? p.get("atttime");
        state  = p.get("AttState") ?? p.get("attstate");
        verify = p.get("VerifyMethod") ?? p.get("verifymethod");
      } else {
        // First line is the table/stamp header — skip
        continue;
      }

      if (!uid || !time) {
        console.log(`[ADMS POST] Skipping line (no uid/time): ${line}`);
        continue;
      }

      console.log(`[ADMS POST] Record: uid=${uid} time=${time} state=${state} verify=${verify}`);

      // Device sends PKT (UTC+5) local time — convert to UTC
      const localDate = new Date(time.replace(" ", "T") + "+05:00");
      if (isNaN(localDate.getTime())) {
        console.error(`[ADMS POST] Invalid date: ${time}`);
        continue;
      }
      const punchTimeUTC = localDate.toISOString();

      // Look up member via device_enrollments (device-specific user ID)
      const { data: enrollment } = await supabase
        .from("device_enrollments")
        .select("member_id, members(id, full_name, status)")
        .eq("device_serial", serialNo)
        .eq("device_user_id", uid)
        .is("deleted_at", null)
        .single();
      const member = enrollment ? (enrollment.members as any) : null;

      if (member) {
          // Toggle logic: check last punch to determine in/out
          const { data: lastPunch } = await supabase
            .from("attendances")
            .select("punch_type, punch_time")
            .eq("member_id", member.id)
            .order("punch_time", { ascending: false })
            .limit(1)
            .single();

          // Determine punch type first
          let punchType: string;
          if (state === "1" || state === "5") {
            punchType = "out";
          } else if (state === "0" || state === "4") {
            punchType = lastPunch?.punch_type === "in" ? "out" : "in";
          } else {
            punchType = lastPunch?.punch_type === "in" ? "out" : "in";
          }

          // Dedup: skip only if same member punched the same type within last 30 seconds
          const thirtySecAgo = new Date(localDate.getTime() - 30 * 1000).toISOString();
          const { count: recentCount } = await supabase
            .from("attendances")
            .select("*", { count: "exact", head: true })
            .eq("member_id", member.id)
            .eq("punch_type", punchType)
            .gte("punch_time", thirtySecAgo)
            .lte("punch_time", punchTimeUTC);

          if ((recentCount ?? 0) > 0) {
            console.log(`[ADMS POST] Duplicate ${punchType.toUpperCase()} within 30s — skipped for ${member.full_name}`);
          } else {

          const { error } = await supabase.from("attendances").insert({
            member_id: member.id,
            device_id: serialNo,
            punch_time: punchTimeUTC,
            punch_type: punchType,
            verified: true,
          });
          if (error) console.error("[ADMS POST] Insert error:", error);
          else console.log(`[ADMS POST] ✓ ${member.full_name} → ${punchType.toUpperCase()}`);
        }
      } else {
        // Check staff
        const { data: staff } = await supabase
          .from("staff_members")
          .select("id, full_name")
          .eq("device_user_id", uid)
          .is("deleted_at", null)
          .single();

        if (staff) {
          await supabase.from("attendances").insert({
            staff_id: staff.id,
            device_id: serialNo,
            punch_time: punchTimeUTC,
            punch_type: "in",
            verified: true,
          });
          console.log(`[ADMS POST] ✓ Saved attendance for staff: ${staff.full_name}`);
        } else {
          await supabase.from("unverified_attendances").insert({
            device_id: serialNo,
            raw_id: uid,
            punch_time: punchTimeUTC,
          });
          console.log(`[ADMS POST] ⚠ Unverified punch: uid=${uid}`);
        }
      }
    }

    return new NextResponse("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
  } catch (err) {
    console.error("[ADMS POST Error]", err, "\nBody was:", body);
    return new NextResponse("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
}
