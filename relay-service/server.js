// ZKTeco ADMS relay — runs directly on the relay VM, talking straight to the
// same Supabase database the main app (on Vercel) uses. This exists because
// Vercel's automatic bot/DDoS protection challenges requests coming from a
// cloud-datacenter IP (the relay VM) with a JS verification page a ZKTeco
// device can't solve — running the device-facing endpoints here instead
// means device traffic never touches Vercel at all.
//
// Each route below is a faithful port of its Next.js equivalent under
// src/app/api/attendance/*.route.ts — same table/field names, same
// toggle/dedup/timezone logic. Keep them in sync if either side changes.

const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 3001;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const app = express();
// ADMS sends plain-text/url-encoded bodies (or binary photo data for fdata),
// never JSON — buffer everything as a raw Buffer and decode to text only
// where needed, so binary payloads aren't corrupted by a premature text decode.
app.use(express.raw({ type: () => true, limit: "5mb" }));

function getSN(req) {
  return req.query.SN || req.query.sn || "UNKNOWN";
}

function sendText(res, body, status = 200) {
  res.status(status).type("text/plain").send(body);
}

// ── /iclock/cdata — heartbeat (GET) + attendance push (POST) ──────────────
app.get("/iclock/cdata", async (req, res) => {
  const sn = getSN(req);
  console.log(`[ADMS Heartbeat] SN=${sn} options=${req.query.options}`);

  try {
    const now = new Date().toISOString();
    // Try insert first; if device already exists just update last_seen (preserve custom name)
    const { error } = await supabase.from("devices").insert({ serial_no: sn, last_seen: now, name: `Device ${sn}` });
    if (error) {
      await supabase.from("devices").update({ last_seen: now }).eq("serial_no", sn);
    }
  } catch (e) {
    console.error("[ADMS Heartbeat DB Error]", e);
  }

  // A real, device-tested ADMS reference implementation (probed against a
  // SpeedFace device — same family as ours) replies plain OK to this
  // heartbeat; it never sends an ATTLOG/OPERLOG "resync" trigger here.
  // Devices push attendance logs immediately/proactively on their own, not
  // in response to this line. Sending "GET ATTLOG STAMP=9999999999" (an
  // impossible/nonsensical stamp) on every single heartbeat is the likely
  // cause of the device getting stuck perpetually re-announcing a full
  // resync of its local cache instead of ever pushing a fresh scan through
  // its normal immediate-push path.
  sendText(res, "OK");
});

app.post("/iclock/cdata", async (req, res) => {
  let body = "";
  try {
    body = req.body.toString("utf-8");
    console.log(`[ADMS POST] Raw body:\n${body}`);

    const serialNo = req.query.SN || req.query.sn || getSN(req);
    const table = req.query.table || req.query.Table;

    console.log(`[ADMS POST] SN=${serialNo} table=${table}`);

    await supabase.from("devices").update({ last_seen: new Date().toISOString() }).eq("serial_no", serialNo);

    if (table !== "ATTLOG") {
      console.log(`[ADMS POST] Ignoring table=${table}`);
      return sendText(res, "OK");
    }

    // Parsing is pure/no I/O — do it all up front so the rest of this
    // handler can batch its DB work instead of doing several sequential
    // round trips PER LINE. A device stuck re-sending its whole local
    // cache (hundreds of lines) on every heartbeat used to take 1-2+
    // minutes to process that way, blowing past nginx's default 60s
    // proxy_read_timeout — the device never got its "OK" in time, so it
    // just kept re-sending the same batch forever (confirmed via nginx
    // access logs: 499/504 on ~99% of one device's ATTLOG uploads). This
    // version processes a full resend in well under a second regardless
    // of line count.
    const rawLines = body.split("\n").map((l) => l.trim()).filter(Boolean);
    const parsed = [];
    for (const line of rawLines) {
      let uid = null, time = null, state = null, verify = null;

      if (line.includes("\t")) {
        const parts = line.split("\t");
        uid = parts[0] || null;
        time = parts[1] || null;
        state = parts[2] || null;
        verify = parts[3] || null;
      } else if (line.includes("UserID=") || line.includes("userid=")) {
        const p = new URLSearchParams(line);
        uid = p.get("UserID") || p.get("userid");
        time = p.get("AttTime") || p.get("atttime");
        state = p.get("AttState") || p.get("attstate");
        verify = p.get("VerifyMethod") || p.get("verifymethod");
      } else {
        continue;
      }

      if (!uid || !time) {
        console.log(`[ADMS POST] Skipping line (no uid/time): ${line}`);
        continue;
      }

      // Device sends PKT (UTC+5) local time — convert to UTC
      const localDate = new Date(time.replace(" ", "T") + "+05:00");
      if (isNaN(localDate.getTime())) {
        console.error(`[ADMS POST] Invalid date: ${time}`);
        continue;
      }
      parsed.push({ uid, state, verify, localDate, punchTimeUTC: localDate.toISOString() });
    }

    if (parsed.length === 0) {
      sendText(res, "OK");
      return;
    }

    const distinctUids = [...new Set(parsed.map((p) => p.uid))];
    const minTime = new Date(Math.min(...parsed.map((p) => p.localDate.getTime())) - 30 * 1000).toISOString();
    const maxTime = new Date(Math.max(...parsed.map((p) => p.localDate.getTime()))).toISOString();

    // Resolve every uid in this body to a member or staff record — one
    // query each, instead of one device_enrollments + one staff_members
    // query per line.
    const [{ data: enrollments }, { data: staffRows }] = await Promise.all([
      supabase
        .from("device_enrollments")
        .select("device_user_id, members(id, full_name, status)")
        .eq("device_serial", serialNo)
        .in("device_user_id", distinctUids)
        .is("deleted_at", null),
      supabase
        .from("staff_members")
        .select("id, full_name, device_user_id")
        .in("device_user_id", distinctUids)
        .is("deleted_at", null),
    ]);
    const memberByUid = new Map((enrollments ?? []).filter((e) => e.members).map((e) => [e.device_user_id, e.members]));
    const staffByUid = new Map((staffRows ?? []).map((s) => [s.device_user_id, s]));

    const memberIds = [...new Set(parsed.map((p) => memberByUid.get(p.uid)?.id).filter(Boolean))];
    const staffIds = [...new Set(parsed.map((p) => staffByUid.get(p.uid)?.id).filter(Boolean))];
    const unmatchedUids = distinctUids.filter((uid) => !memberByUid.has(uid) && !staffByUid.has(uid));

    // Dedup check is intentionally type-agnostic (member/staff, time
    // proximity only) — see the note on withinWindow() below. Batch-fetch
    // every existing row in this body's time range (+/- the dedup window)
    // once, instead of a live "any duplicate?" query per line, plus each
    // member's single most-recent row for the in/out toggle.
    const [{ data: existingMemberAtt }, { data: existingStaffAtt }, { data: existingUnverified }, { data: lastPunchRows }] = await Promise.all([
      memberIds.length
        ? supabase.from("attendances").select("member_id, punch_time").in("member_id", memberIds).gte("punch_time", minTime).lte("punch_time", maxTime)
        : Promise.resolve({ data: [] }),
      staffIds.length
        ? supabase.from("attendances").select("staff_id, punch_time").in("staff_id", staffIds).gte("punch_time", minTime).lte("punch_time", maxTime)
        : Promise.resolve({ data: [] }),
      unmatchedUids.length
        ? supabase.from("unverified_attendances").select("raw_id, punch_time").eq("device_id", serialNo).in("raw_id", unmatchedUids).gte("punch_time", minTime).lte("punch_time", maxTime)
        : Promise.resolve({ data: [] }),
      memberIds.length
        ? supabase.from("attendances").select("member_id, punch_type, punch_time").in("member_id", memberIds).order("punch_time", { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);

    // Same rule as before: an existing row counts as a duplicate if it's
    // at or up to 30s before the target time. Type-agnostic on purpose —
    // the device re-sends its whole local cache on every heartbeat if it
    // never sees its upload cursor advance, so the same line can arrive
    // hundreds of times, and scoping this to punch_type let the toggle
    // itself (which flips as duplicates land) mask roughly every other
    // repeat.
    function withinWindow(existingTimes, targetIso) {
      const target = new Date(targetIso).getTime();
      return existingTimes.some((t) => {
        const dt = target - new Date(t).getTime();
        return dt >= 0 && dt <= 30 * 1000;
      });
    }
    const memberTimesById = new Map();
    for (const row of existingMemberAtt ?? []) {
      if (!memberTimesById.has(row.member_id)) memberTimesById.set(row.member_id, []);
      memberTimesById.get(row.member_id).push(row.punch_time);
    }
    const staffTimesById = new Map();
    for (const row of existingStaffAtt ?? []) {
      if (!staffTimesById.has(row.staff_id)) staffTimesById.set(row.staff_id, []);
      staffTimesById.get(row.staff_id).push(row.punch_time);
    }
    const unverifiedTimesByUid = new Map();
    for (const row of existingUnverified ?? []) {
      if (!unverifiedTimesByUid.has(row.raw_id)) unverifiedTimesByUid.set(row.raw_id, []);
      unverifiedTimesByUid.get(row.raw_id).push(row.punch_time);
    }
    // Most-recent known punch_type per member, seeded from the DB. Updated
    // in-memory as this batch decides new inserts (below) so the in/out
    // toggle advances correctly across repeated members within one body,
    // matching how the old per-line version re-read this after every insert.
    const lastTypeByMember = new Map();
    for (const row of lastPunchRows ?? []) {
      if (!lastTypeByMember.has(row.member_id)) lastTypeByMember.set(row.member_id, row.punch_type);
    }

    const memberInserts = [];
    const staffInserts = [];
    const unverifiedInserts = [];
    let skippedDupes = 0;

    // Process oldest-first so the in/out toggle for a member appearing
    // more than once in this body advances in the same order the device
    // actually recorded the punches.
    const chronological = [...parsed].sort((a, b) => a.localDate - b.localDate);

    for (const p of chronological) {
      console.log(`[ADMS POST] Record: uid=${p.uid} time=${p.punchTimeUTC} state=${p.state} verify=${p.verify}`);
      const member = memberByUid.get(p.uid);
      const staff = staffByUid.get(p.uid);

      if (member) {
        const times = memberTimesById.get(member.id) ?? [];
        if (withinWindow(times, p.punchTimeUTC)) {
          skippedDupes++;
          console.log(`[ADMS POST] Duplicate within 30s — skipped for ${member.full_name}`);
          continue;
        }
        let punchType;
        if (p.state === "1" || p.state === "5") {
          punchType = "out";
        } else {
          punchType = lastTypeByMember.get(member.id) === "in" ? "out" : "in";
        }
        lastTypeByMember.set(member.id, punchType);
        times.push(p.punchTimeUTC);
        memberTimesById.set(member.id, times);
        memberInserts.push({ member_id: member.id, device_id: serialNo, punch_time: p.punchTimeUTC, punch_type: punchType, verified: true });
        console.log(`[ADMS POST] ✓ ${member.full_name} → ${punchType.toUpperCase()}`);
      } else if (staff) {
        const times = staffTimesById.get(staff.id) ?? [];
        if (withinWindow(times, p.punchTimeUTC)) {
          skippedDupes++;
          console.log(`[ADMS POST] Duplicate within 30s — skipped for staff ${staff.full_name}`);
          continue;
        }
        times.push(p.punchTimeUTC);
        staffTimesById.set(staff.id, times);
        staffInserts.push({ staff_id: staff.id, device_id: serialNo, punch_time: p.punchTimeUTC, punch_type: "in", verified: true });
        console.log(`[ADMS POST] ✓ Saved attendance for staff: ${staff.full_name}`);
      } else {
        const times = unverifiedTimesByUid.get(p.uid) ?? [];
        if (withinWindow(times, p.punchTimeUTC)) {
          skippedDupes++;
          console.log(`[ADMS POST] Duplicate unverified punch within 30s — skipped for uid=${p.uid}`);
          continue;
        }
        times.push(p.punchTimeUTC);
        unverifiedTimesByUid.set(p.uid, times);
        unverifiedInserts.push({ device_id: serialNo, raw_id: p.uid, punch_time: p.punchTimeUTC });
        console.log(`[ADMS POST] ⚠ Unverified punch: uid=${p.uid}`);
      }
    }

    console.log(`[ADMS POST] Batch summary: ${parsed.length} lines, ${skippedDupes} duplicates skipped, ${memberInserts.length} member + ${staffInserts.length} staff + ${unverifiedInserts.length} unverified new rows`);

    const [memberResult, staffResult, unverifiedResult] = await Promise.all([
      memberInserts.length ? supabase.from("attendances").insert(memberInserts) : Promise.resolve({ error: null }),
      staffInserts.length ? supabase.from("attendances").insert(staffInserts) : Promise.resolve({ error: null }),
      unverifiedInserts.length ? supabase.from("unverified_attendances").insert(unverifiedInserts) : Promise.resolve({ error: null }),
    ]);
    if (memberResult.error) console.error("[ADMS POST] Member insert error:", memberResult.error);
    if (staffResult.error) console.error("[ADMS POST] Staff insert error:", staffResult.error);
    if (unverifiedResult.error) console.error("[ADMS POST] Unverified insert error:", unverifiedResult.error);

    sendText(res, "OK");
  } catch (err) {
    console.error("[ADMS POST Error]", err, "\nBody was:", body);
    sendText(res, "OK");
  }
});

// ── /iclock/getrequest — command polling ───────────────────────────────
app.get("/iclock/getrequest", async (req, res) => {
  const sn = req.query.SN || req.query.sn || "UNKNOWN";
  console.log(`[ADMS GetRequest] SN=${sn}`);

  try {
    const { data: commands } = await supabase
      .from("device_commands")
      .select("id, command_id, command")
      .eq("device_serial", sn)
      .eq("status", "pending")
      .order("created_at")
      .limit(5);

    if (!commands?.length) {
      return sendText(res, "OK");
    }

    await supabase
      .from("device_commands")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .in("id", commands.map((c) => c.id));

    const body = commands.map((c) => `C:${c.command_id}:${c.command}`).join("\n") + "\n";
    console.log(`[ADMS GetRequest] Sending ${commands.length} command(s) to SN=${sn}`);
    sendText(res, body);
  } catch (e) {
    console.error("[ADMS GetRequest Error]", e);
    sendText(res, "OK");
  }
});

// ── /iclock/devicecmd — command ack ─────────────────────────────────────
async function handleAck(sn, rawId, ret) {
  const commandId = rawId ? parseInt(rawId, 10) : null;
  const returnCode = ret ? parseInt(ret, 10) : null;
  console.log(`[ADMS DeviceCmd] SN=${sn} ID=${commandId} Return=${returnCode}`);
  if (!commandId) return;

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

app.get("/iclock/devicecmd", async (req, res) => {
  const sn = req.query.SN || req.query.sn || "UNKNOWN";
  const id = req.query.ID || req.query.id;
  const ret = req.query.Return || req.query.return;
  await handleAck(sn, id, ret);
  sendText(res, "OK");
});

app.post("/iclock/devicecmd", async (req, res) => {
  const sn = req.query.SN || req.query.sn || "UNKNOWN";
  const body = req.body.toString("utf-8");
  console.log(`[ADMS DeviceCmd POST] SN=${sn} body=${body}`);
  const p = new URLSearchParams(body);
  const id = p.get("ID") || p.get("id");
  const ret = p.get("Return") || p.get("return");
  await handleAck(sn, id, ret);
  sendText(res, "OK");
});

// ── /iclock/fdata — face-photo push ack ─────────────────────────────────
// Face-recognition devices push captured punch photos here. We don't store
// them — just ack so the device stops retrying and moves on.
async function fdataAck(req, res) {
  const sn = req.query.SN || req.query.sn || "UNKNOWN";
  try {
    await supabase.from("devices").update({ last_seen: new Date().toISOString() }).eq("serial_no", sn);
  } catch (e) {
    console.error("[ADMS FData] Error updating last_seen:", e);
  }
  sendText(res, "OK");
}
app.get("/iclock/fdata", fdataAck);
app.post("/iclock/fdata", fdataAck);

app.listen(PORT, "127.0.0.1", () => {
  console.log(`ZKTeco relay service listening on 127.0.0.1:${PORT}`);
});
