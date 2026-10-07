import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { shouldHaveDeviceAccess } from "@/lib/utils";
import { pushAccessToAllDevices } from "@/lib/server/devicePush";

export const maxDuration = 60;

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type SweepMember = { id: string; full_name: string; expiry_date: string | null; access_exempt: boolean; access_blocked_at: string | null };

// GET /api/cron/access-sweep[?dryRun=true]
// Vercel Cron hits this daily (see vercel.json). Scans every active member,
// blocks device access for anyone with a genuinely lapsed expiry_date (and
// not access_exempt), restores it for anyone whose expiry_date is current
// again. Inert (computes + reports, pushes/writes nothing) unless
// ACCESS_SWEEP_LIVE=true is set AND dryRun isn't explicitly requested —
// this lets the route ship and deploy safely, armed later via a one-line
// env var flip in Vercel's dashboard, no redeploy needed.
//
// Real incident (2026-09-04 to 2026-09-16): the previous version aborted
// the ENTIRE run — writing nothing at all — whenever total changes needed
// exceeded a ceiling (originally meant as a sanity check against a logic
// bug misclassifying hundreds of members at once). Because an aborted run
// fixes nothing, the backlog only grows day over day, which guarantees
// every future run also exceeds the ceiling — a permanent, self-sustaining
// lockout the sweep could never recover from on its own. It went
// unnoticed for 12 days (54 members left unblocked past their expiry, 10
// left wrongly blocked after paying) because an aborted run still returns
// HTTP 200 with no error. Fixed two ways:
//   1. Unblocks are ALWAYS applied in full, uncapped — restoring a paying
//      member's access is safe and should never be throttled or delayed.
//   2. New blocks are capped at maxChanges PER RUN (not an abort
//      threshold) — the oldest-overdue members are processed first, and
//      whatever's left over rolls into tomorrow's run instead of being
//      silently dropped. A backlog now shrinks toward zero across a few
//      days instead of growing forever.
// Member-level device pushes are chunked (CHUNK_SIZE at a time, chunks run
// sequentially) rather than either fully sequential (too slow to fit a
// real backlog in one function invocation) or fully parallel (found live
// 2026-09-16: pushing 40 members at once — most sharing this gym's 3
// physical devices — delivered a burst of dozens of commands to each
// device within seconds. The relay and command_id allocation both handled
// that fine, but the devices themselves are small embedded ADMS terminals
// that appear to choke processing a large burst: only a handful acked
// before falling silent for many minutes despite staying online. A
// same-day manual test confirmed small batches (5 at a time, with a real
// gap for the device to actually catch up) succeeded reliably where one
// big burst did not. That gap used to come from each push's own ack-wait
// (up to 15s per command). It no longer does, and must not — see the
// 2026-10-08 entry below.
// ONE member at a time. Not for pacing — the terminals are fast (~1.1s to
// confirm) and were never overloaded. It's because a member's push puts at
// most one pending command on any given device, so processing members
// strictly serially guarantees a device never has two pending commands to
// hand over in the same response. That matters because a terminal given
// several commands at once executes only the first and silently discards
// the rest (see relay-service/server.js). The relay now sends one per poll
// regardless, so this is redundant belt-and-braces — but it is what makes
// this route correct on its own terms rather than dependent on the relay's
// behaviour, and the cost is negligible at a realistic daily delta.
//
// 2026-10-08 — THE ACK-WAIT IS GONE, AND THAT IS THE POINT.
// It used to say here that running out of maxDuration mid-run is harmless.
// It is harmless per run; it was never harmless in aggregate. Waiting up to
// 15s for each terminal to confirm, one member at a time, inside a 60s
// function, meant a run got through about FOUR members before Vercel killed
// it. Measured over three consecutive nights: 5 blocks in 37s, 5 in 47s,
// 6 in 42s — every run hit the wall. Members below the cut-off were never
// reached at all, so no command was even queued for them. Found when an
// expired member still had working door access three days on, with eight
// others in the same state behind him.
//
// Worse, it was invisible: deferredBlockCount only reports a backlog that
// exceeds maxBlocksPerRun, and the backlog (9) was under the cap (20), so
// the run reported "0 deferred" while silently skipping half the queue.
//
// The fix is to stop waiting. An unacked command is not a failed one — it
// sits in device_commands and the relay hands it to the terminal on its next
// poll. The wait bought nothing but latency.
//
// Pacing is NOT lost by removing it. The September 2026 burst incident
// (above) is prevented at the relay now: COMMANDS_PER_POLL = 1 means a
// terminal is handed exactly one command per poll however many are queued.
// Serial processing here stays as belt-and-braces, but the relay is what
// guarantees it.
//
// What replaces the ack as a safety signal: the run stops cleanly against
// its own time budget instead of being killed mid-push, reports exactly who
// it did not reach, and reports commands still undelivered after a while —
// so "queued but never actually applied" surfaces instead of hiding.
const CHUNK_SIZE = 1;

// Stop before Vercel's maxDuration rather than being killed part-way through
// a member. Leaves room for the final writes and the response.
const RUN_BUDGET_MS = 45_000;

// A block/unblock still pending after this long means the terminal has not
// polled — usually the gym is closed and the device is asleep. Reported, not
// retried: the command is already queued and goes out on the next poll. It is
// here so a device that is genuinely dead cannot keep looking healthy.
const STALE_COMMAND_MINUTES = 180;

// Returns whoever was left unprocessed when the budget ran out, so the
// caller can report them rather than letting them vanish.
async function processInChunks(
  members: SweepMember[],
  handle: (m: SweepMember) => Promise<void>,
  deadline: number
): Promise<SweepMember[]> {
  for (let i = 0; i < members.length; i += CHUNK_SIZE) {
    if (Date.now() > deadline) return members.slice(i);
    await Promise.all(members.slice(i, i + CHUNK_SIZE).map(handle));
  }
  return [];
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "true" || process.env.ACCESS_SWEEP_LIVE !== "true";
  // Max NEW BLOCKS to apply in this one run — never an abort threshold.
  // Unblocks are never capped (see header comment). Lowered from 40 to 20
  // alongside the chunking above — 20 at CHUNK_SIZE=5 is 4 sequential
  // rounds, each bounded by one ack-timeout (~15s worst case), comfortably
  // inside maxDuration while still clearing several days worth of a
  // normal backlog in a single run.
  const maxBlocksPerRun = Number(process.env.ACCESS_SWEEP_MAX_CHANGES ?? 20);

  const deadline = Date.now() + RUN_BUDGET_MS;

  try {
    const admin = getServiceClient();

    const { data: members } = await admin
      .from("members")
      .select("id, full_name, expiry_date, access_exempt, access_blocked_at")
      .eq("status", "active")
      .is("deleted_at", null);

    const activeMembers: SweepMember[] = members ?? [];

    const needsBlockAll: SweepMember[] = [];
    const needsUnblock: SweepMember[] = [];

    for (const m of activeMembers) {
      const shouldHaveAccess = shouldHaveDeviceAccess(m);
      if (shouldHaveAccess && m.access_blocked_at) {
        needsUnblock.push(m);
      } else if (!shouldHaveAccess && !m.access_blocked_at) {
        needsBlockAll.push(m);
      }
    }

    // Oldest-overdue first, so a capped batch always makes progress on the
    // members who have been unblocked-but-shouldn't-be the longest, rather
    // than an arbitrary/query-order subset.
    needsBlockAll.sort((a, b) => (a.expiry_date ?? "").localeCompare(b.expiry_date ?? ""));
    const needsBlock = needsBlockAll.slice(0, maxBlocksPerRun);
    const deferredBlockCount = needsBlockAll.length - needsBlock.length;

    const blocked: { id: string; full_name: string }[] = [];
    const unblocked: { id: string; full_name: string }[] = [];
    // "pending" = the device hasn't confirmed yet (its own poll cycle is
    // ~30s, longer under load) — not an error, just unconfirmed. Left
    // alone, so the next sweep run naturally retries with a fresh command
    // instead of assuming success like the old code did.
    const pending: { id: string; full_name: string }[] = [];
    const failures: { id: string; full_name: string; error: string }[] = [];

    let notProcessed: SweepMember[] = [];

    if (!dryRun) {
      notProcessed = await processInChunks(needsBlock, async (m) => {
        // waitForAck: false — queue it and move on. See the 2026-10-08 note.
        const results = await pushAccessToAllDevices(admin, m, "block", null, { waitForAck: false });
        const allOk = results.length === 0 || results.every((r) => r.ok);
        if (allOk) {
          // shouldHaveDeviceAccess() only ever returns false here for a
          // genuinely lapsed expiry_date (exemption is checked inside it
          // separately) — always "expired", never the noisier "unpaid".
          await admin.from("members").update({
            access_blocked_at: new Date().toISOString(),
            access_blocked_reason: "expired",
          }).eq("id", m.id);
          await admin.from("activity_logs").insert({
            user_id: null, action: "auto_blocked_access", entity_type: "member", entity_id: m.id,
            description: `${m.full_name}'s device access was automatically blocked (expired)`,
          });
          blocked.push({ id: m.id, full_name: m.full_name });
        } else if (results.some((r) => r.pending) && !results.some((r) => !r.ok && !r.pending)) {
          pending.push({ id: m.id, full_name: m.full_name });
        } else {
          failures.push({ id: m.id, full_name: m.full_name, error: results.find((r) => !r.ok)?.error ?? "push failed" });
        }
      }, deadline);

      // Unblocks are never capped and are queued the same way. Restoring a
      // paying member's access must never wait behind a terminal's poll.
      const unblockLeft = await processInChunks(needsUnblock, async (m) => {
        const results = await pushAccessToAllDevices(admin, m, "allow", null, { waitForAck: false });
        const allOk = results.length === 0 || results.every((r) => r.ok);
        if (allOk) {
          await admin.from("members").update({
            access_blocked_at: null,
            access_blocked_reason: null,
          }).eq("id", m.id);
          await admin.from("activity_logs").insert({
            user_id: null, action: "auto_unblocked_access", entity_type: "member", entity_id: m.id,
            description: `${m.full_name}'s device access was automatically restored`,
          });
          unblocked.push({ id: m.id, full_name: m.full_name });
        } else if (results.some((r) => r.pending) && !results.some((r) => !r.ok && !r.pending)) {
          pending.push({ id: m.id, full_name: m.full_name });
        } else {
          failures.push({ id: m.id, full_name: m.full_name, error: results.find((r) => !r.ok)?.error ?? "push failed" });
        }
      }, deadline);
      notProcessed = notProcessed.concat(unblockLeft);
    }

    // Commands queued but still undelivered. Not a failure of this run — the
    // relay delivers on the device's next poll — but if this keeps growing, a
    // terminal has stopped polling and somebody needs to know.
    const staleCutoff = new Date(Date.now() - STALE_COMMAND_MINUTES * 60_000).toISOString();
    const { data: staleRows } = await admin
      .from("device_commands")
      .select("device_serial")
      .eq("status", "pending")
      .in("command_type", ["block_user", "unblock_user"])
      .lt("created_at", staleCutoff);
    const stalePendingByDevice: Record<string, number> = {};
    for (const r of staleRows ?? []) {
      stalePendingByDevice[r.device_serial] = (stalePendingByDevice[r.device_serial] ?? 0) + 1;
    }

    return NextResponse.json({
      dryRun,
      scanned: activeMembers.length,
      blocked: dryRun ? needsBlock.map((m) => ({ id: m.id, full_name: m.full_name })) : blocked,
      unblocked: dryRun ? needsUnblock.map((m) => ({ id: m.id, full_name: m.full_name })) : unblocked,
      pending,
      failures,
      // Non-zero here means the backlog exceeded this run's per-run block
      // cap — never a reason anything failed, just how many are queued for
      // tomorrow's run (or sooner, if re-triggered manually).
      deferredBlockCount,
      // Members this run selected but ran out of time to reach. Distinct from
      // deferredBlockCount, which only counts those over the cap — before
      // 2026-10-08 this was the silent failure mode, the run reporting zero
      // deferred while never reaching half the queue.
      notProcessedCount: notProcessed.length,
      notProcessed: notProcessed.map((m) => ({ id: m.id, full_name: m.full_name })),
      // Queued but undelivered for over STALE_COMMAND_MINUTES.
      stalePendingByDevice,
    });
  } catch (err) {
    console.error("[AccessSweep Error]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
