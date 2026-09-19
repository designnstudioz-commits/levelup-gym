// Health check for the ZKTeco door-access system. READ-ONLY — never writes.
//
//   node scripts/check-door-access.mjs
//
// Exits non-zero if anything is wrong, so it can gate a deploy or run on a
// schedule. Run it after any change to the sweep, the relay, or devicePush,
// and whenever a member reports being wrongly let in or kept out.
//
// Background: this subsystem has failed silently three separate ways, each
// invisible from the app (see ZKTECO_DEVICES.md §10). Every check below
// exists because that exact failure actually happened and nothing caught it.
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim();
const H = { apikey: key, Authorization: `Bearer ${key}` };

async function getAll(path) {
  const out = [];
  const n = 1000;
  for (let off = 0; ; off += n) {
    const sep = path.includes("?") ? "&" : "?";
    const r = await fetch(`${url}/rest/v1/${path}${sep}limit=${n}&offset=${off}`, { headers: H });
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error(`query failed: ${JSON.stringify(rows)}`);
    out.push(...rows);
    if (rows.length < n) break;
  }
  return out;
}

const today = new Date().toISOString().slice(0, 10);
const now = Date.now();
let failures = 0;
const pass = (n, d) => console.log(`  PASS   ${n}${d ? ` — ${d}` : ""}`);
const fail = (n, d) => { console.log(`  FAIL   ${n}${d ? ` — ${d}` : ""}`); failures++; };
const info = (n, d) => console.log(`  note   ${n}${d ? ` — ${d}` : ""}`);

const members = await getAll("members?status=eq.active&deleted_at=is.null&select=id,full_name,membership_no,expiry_date,access_exempt,access_blocked_at");
const enrollments = await getAll("device_enrollments?deleted_at=is.null&select=member_id,device_serial");
// Ordered by `id`, NOT command_id: command_id is unique only PER DEVICE, and
// paginating on a non-unique column silently reorders rows across page
// boundaries — which produced false positives the first time this was run.
const commands = await getAll("device_commands?select=id,command_id,device_serial,member_id,command_type,status,return_code,created_at,sent_at&order=id.asc");
const devices = await getAll("devices?select=serial_no,name,last_seen");
const deviceName = Object.fromEntries(devices.map((d) => [d.serial_no, d.name]));

const doorsOf = new Map();
for (const e of enrollments) {
  if (!doorsOf.has(e.member_id)) doorsOf.set(e.member_id, new Set());
  doorsOf.get(e.member_id).add(e.device_serial);
}

// Per (member, door) history, sorted within the door so command_id is valid.
const history = new Map();
for (const c of commands) {
  if (!c.member_id || !["block_user", "unblock_user"].includes(c.command_type)) continue;
  const k = `${c.member_id}|${c.device_serial}`;
  if (!history.has(k)) history.set(k, []);
  history.get(k).push(c);
}
for (const list of history.values()) list.sort((a, b) => a.command_id - b.command_id);

const lastTold = (mid, door) => history.get(`${mid}|${door}`)?.at(-1) ?? null;
const lastConfirmed = (mid, door) => history.get(`${mid}|${door}`)?.filter((c) => c.status === "acked" && c.return_code === 0).at(-1) ?? null;
const shouldHaveAccess = (m) => m.access_exempt || !m.expiry_date || m.expiry_date >= today;

console.log(`\nDoor access health check — ${new Date().toISOString()}`);
console.log("=".repeat(68));

// 1. A paying member must never be blocked. Counts what the door was last
// TOLD, not just what it confirmed: an unacknowledged command may still have
// been applied, which is exactly how 7 members were locked out unnoticed.
console.log("\n1. Is any member with valid access blocked at a door?");
const wronglyBlocked = [];
for (const m of members) {
  if (!shouldHaveAccess(m)) continue;
  for (const door of doorsOf.get(m.id) ?? []) {
    const told = lastTold(m.id, door);
    if (told?.command_type === "block_user") {
      wronglyBlocked.push(`${m.membership_no} ${m.full_name} @ ${deviceName[door] ?? door} (${told.status}, ${told.created_at.slice(0, 10)})`);
    }
  }
}
wronglyBlocked.length === 0
  ? pass("no paying member is blocked anywhere")
  : fail(`${wronglyBlocked.length} paying member(s) locked out`, "\n         " + wronglyBlocked.join("\n         "));

// 2. Records must match hardware, or nothing downstream can be trusted.
console.log("\n2. Does every member record match what its doors enforce?");
const drifted = [];
for (const m of members) {
  const doors = [...(doorsOf.get(m.id) ?? [])];
  if (!doors.length) continue;
  const enforced = doors.every((d) => lastConfirmed(m.id, d)?.command_type === "block_user");
  if (!!m.access_blocked_at !== enforced) {
    drifted.push(`${m.membership_no} ${m.full_name} (record: ${m.access_blocked_at ? "blocked" : "allowed"}, doors: ${enforced ? "blocked" : "allowed"})`);
  }
}
drifted.length === 0
  ? pass("records and doors agree for all members")
  : fail(`${drifted.length} record(s) disagree with the doors`, "\n         " + drifted.slice(0, 10).join("\n         "));

// 3. Batching is the root cause of the 11-week outage. Never allow it back.
// Anchored to when the relay fix went live: everything before that is the
// historical damage, not a regression, and flagging it forever would train
// whoever runs this to ignore the one check that matters most.
const BATCHING_FIXED_AT = "2026-09-19T15:22:37Z";
console.log("\n3. Has any door been handed more than one command at once?");
const since = new Date(Math.max(now - 7 * 864e5, new Date(BATCHING_FIXED_AT).getTime()));
const batches = new Map();
for (const c of commands) {
  if (!c.sent_at || new Date(c.sent_at) <= since) continue;
  const k = `${c.device_serial}|${c.sent_at.slice(0, 19)}`;
  batches.set(k, (batches.get(k) ?? 0) + 1);
}
const offenders = [...batches.entries()].filter(([, n]) => n > 1);
offenders.length === 0
  ? pass(`every delivery since ${since.toISOString().slice(0, 16)} carried exactly 1 command`, `${batches.size} deliveries`)
  : fail("BATCHING HAS RETURNED — check relay-service limit(1)", offenders.slice(0, 3).map(([k, n]) => `${k} = ${n}`).join(", "));

// 4. A command stuck in 'sent' is dead — nothing retries it, and it may or
// may not have been applied.
console.log("\n4. Are any commands stranded without a reply?");
const stranded = commands.filter((c) => c.status === "sent");
const stalePending = commands.filter((c) => c.status === "pending" && now - new Date(c.created_at) > 10 * 60000);
stranded.length === 0
  ? pass("no stranded commands")
  : fail(`${stranded.length} command(s) stranded`, stranded.slice(0, 5).map((c) => `${deviceName[c.device_serial]} #${c.command_id} ${c.command_type}`).join(", "));
stalePending.length === 0
  ? pass("nothing queued longer than 10 minutes")
  : fail(`${stalePending.length} command(s) queued >10 min`, "door may be offline");

// 5. Doors go quiet legitimately (low traffic, closed for the night), so
// this reports rather than fails — but a door silent for hours during
// opening hours means the devices cannot reach the relay at all.
console.log("\n5. Are the doors reporting in?");
for (const d of devices) {
  const mins = d.last_seen ? (now - new Date(d.last_seen)) / 60000 : Infinity;
  if (mins < 5) pass(`${d.name}`, `last seen ${mins.toFixed(1)} min ago`);
  else info(`${d.name} quiet`, `last seen ${mins === Infinity ? "never" : mins.toFixed(0) + " min ago"} — normal outside opening hours, investigate if the gym is open`);
}

// 6. Legitimate (a one-time counter override), so reported, not failed —
// the next sweep re-evaluates them.
console.log("\n6. Expired members currently holding access");
const expiredWithAccess = members.filter((m) => !shouldHaveAccess(m) && !m.access_blocked_at);
expiredWithAccess.length === 0
  ? pass("none")
  : info(`${expiredWithAccess.length} expired member(s) can still enter`, "expected only after a manual unblock; the next 08:00 PKT sweep re-blocks them\n         " + expiredWithAccess.slice(0, 10).map((m) => `${m.membership_no} ${m.full_name} (expired ${m.expiry_date})`).join("\n         "));

console.log("\n" + "=".repeat(68));
console.log(`${members.length} active · ${members.filter((m) => m.access_blocked_at).length} blocked · ${members.filter((m) => !shouldHaveAccess(m)).length} expired · ${members.filter((m) => m.access_exempt).length} exempt`);
console.log(failures === 0 ? "RESULT: healthy\n" : `RESULT: ${failures} problem(s) need attention\n`);
process.exit(failures === 0 ? 0 : 1);
