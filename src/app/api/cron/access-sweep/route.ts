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
// Member-level device pushes also moved from sequential (one member's
// worth of ack-waiting, one at a time — the real reason batches had to be
// kept tiny) to parallel (Promise.all, same pattern already used for a
// single member's multiple devices), so a much larger batch still
// completes within one function invocation.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "true" || process.env.ACCESS_SWEEP_LIVE !== "true";
  // Max NEW BLOCKS to apply in this one run — never an abort threshold.
  // Unblocks are never capped (see header comment).
  const maxBlocksPerRun = Number(process.env.ACCESS_SWEEP_MAX_CHANGES ?? 40);

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

    if (!dryRun) {
      // Members processed in parallel (each member's own devices were
      // already parallel) — bounds this run's wall-clock time to roughly
      // one ack-timeout regardless of batch size, instead of scaling
      // linearly with member count.
      await Promise.all(needsBlock.map(async (m) => {
        const results = await pushAccessToAllDevices(admin, m, "block", null);
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
      }));

      await Promise.all(needsUnblock.map(async (m) => {
        const results = await pushAccessToAllDevices(admin, m, "allow", null);
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
      }));
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
    });
  } catch (err) {
    console.error("[AccessSweep Error]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
