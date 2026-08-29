import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { shouldHaveDeviceAccess } from "@/lib/utils";
import { pushAccessToAllDevices } from "@/lib/server/devicePush";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET /api/cron/access-sweep[?dryRun=true]
// Vercel Cron hits this daily (see vercel.json). Scans every active member,
// blocks device access for anyone with a genuinely lapsed expiry_date (and
// not access_exempt), restores it for anyone whose expiry_date is current
// again. Inert (computes + reports, pushes/writes nothing) unless
// ACCESS_SWEEP_LIVE=true is set AND dryRun isn't explicitly requested —
// this lets the route ship and deploy safely, armed later via a one-line
// env var flip in Vercel's dashboard, no redeploy needed.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "true" || process.env.ACCESS_SWEEP_LIVE !== "true";
  const maxChanges = Number(process.env.ACCESS_SWEEP_MAX_CHANGES ?? 25);

  try {
    const admin = getServiceClient();

    const { data: members } = await admin
      .from("members")
      .select("id, full_name, expiry_date, access_exempt, access_blocked_at")
      .eq("status", "active")
      .is("deleted_at", null);

    const activeMembers = members ?? [];

    const needsBlock: typeof activeMembers = [];
    const needsUnblock: typeof activeMembers = [];

    for (const m of activeMembers) {
      const shouldHaveAccess = shouldHaveDeviceAccess(m);
      if (shouldHaveAccess && m.access_blocked_at) {
        needsUnblock.push(m);
      } else if (!shouldHaveAccess && !m.access_blocked_at) {
        needsBlock.push(m);
      }
    }

    const totalChanges = needsBlock.length + needsUnblock.length;
    if (totalChanges > maxChanges) {
      return NextResponse.json({
        dryRun, aborted: true,
        reason: `${totalChanges} members would change state, exceeding the safety ceiling of ${maxChanges}`,
        wouldBlock: needsBlock.length, wouldUnblock: needsUnblock.length,
      });
    }

    const blocked: { id: string; full_name: string }[] = [];
    const unblocked: { id: string; full_name: string }[] = [];
    const failures: { id: string; full_name: string; error: string }[] = [];

    if (!dryRun) {
      for (const m of needsBlock) {
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
        } else {
          failures.push({ id: m.id, full_name: m.full_name, error: results.find((r) => !r.ok)?.error ?? "push failed" });
        }
      }

      for (const m of needsUnblock) {
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
        } else {
          failures.push({ id: m.id, full_name: m.full_name, error: results.find((r) => !r.ok)?.error ?? "push failed" });
        }
      }
    }

    return NextResponse.json({
      dryRun,
      scanned: activeMembers.length,
      blocked: dryRun ? needsBlock.map((m) => ({ id: m.id, full_name: m.full_name })) : blocked,
      unblocked: dryRun ? needsUnblock.map((m) => ({ id: m.id, full_name: m.full_name })) : unblocked,
      failures,
    });
  } catch (err) {
    console.error("[AccessSweep Error]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
