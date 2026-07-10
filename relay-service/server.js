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

  sendText(res, "GET ATTLOG STAMP=9999999999\nGET OPERLOG STAMP=9999999999\n");
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

    const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
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

      console.log(`[ADMS POST] Record: uid=${uid} time=${time} state=${state} verify=${verify}`);

      // Device sends PKT (UTC+5) local time — convert to UTC
      const localDate = new Date(time.replace(" ", "T") + "+05:00");
      if (isNaN(localDate.getTime())) {
        console.error(`[ADMS POST] Invalid date: ${time}`);
        continue;
      }
      const punchTimeUTC = localDate.toISOString();

      const { data: enrollment } = await supabase
        .from("device_enrollments")
        .select("member_id, members(id, full_name, status)")
        .eq("device_serial", serialNo)
        .eq("device_user_id", uid)
        .is("deleted_at", null)
        .single();
      const member = enrollment ? enrollment.members : null;

      if (member) {
        const { data: lastPunch } = await supabase
          .from("attendances")
          .select("punch_type, punch_time")
          .eq("member_id", member.id)
          .order("punch_time", { ascending: false })
          .limit(1)
          .single();

        let punchType;
        if (state === "1" || state === "5") {
          punchType = "out";
        } else if (state === "0" || state === "4") {
          punchType = lastPunch?.punch_type === "in" ? "out" : "in";
        } else {
          punchType = lastPunch?.punch_type === "in" ? "out" : "in";
        }

        const thirtySecAgo = new Date(localDate.getTime() - 30 * 1000).toISOString();
        const { count: recentCount } = await supabase
          .from("attendances")
          .select("*", { count: "exact", head: true })
          .eq("member_id", member.id)
          .eq("punch_type", punchType)
          .gte("punch_time", thirtySecAgo)
          .lte("punch_time", punchTimeUTC);

        if ((recentCount || 0) > 0) {
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
