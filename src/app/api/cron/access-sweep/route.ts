import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { format, subDays } from "date-fns";
import { shouldHaveDeviceAccess, isPaymentDelinquent, type LatestPaymentMap } from "@/lib/utils";
import { pushAccessToAllDevices } from "@/lib/server/devicePush";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET /api/cron/access-sweep[?dryRun=true]
// Vercel Cron hits this daily (see vercel.json). Scans every active member,
// blocks device access for anyone newly delinquent (expired or unpaid
// since cycle start, and not access_exempt), restores it for anyone newly
// current. Inert (computes + reports, pushes/writes nothing) unless
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
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const thirtyDaysAgoStr = format(subDays(new Date(), 30), "yyyy-MM-dd");

    const { data: members } = await admin
      .from("members")
      .select("id, full_name, expiry_date, membership_start_date, access_exempt, access_blocked_at")
      .eq("status", "active")
      .is("deleted_at", null);

    const activeMembers = members ?? [];

    const boundaries = activeMembers.map((m) => m.membership_start_date ?? thirtyDaysAgoStr);
    const earliestNeeded = boundaries.length
      ? boundaries.reduce((min, b) => (b < min ? b : min))
      : thirtyDaysAgoStr;

    const { data: recentPayments } = await admin
      .from("fee_payments")
      .select("member_id, payment_date")
      .gte("payment_date", earliestNeeded)
      .is("deleted_at", null);

    const latestPaymentByMember: LatestPaymentMap = new Map();
    for (const p of recentPayments ?? []) {
      const cur = latestPaymentByMember.get(p.member_id);
      if (!cur || p.payment_date > cur) latestPaymentByMember.set(p.member_id, p.payment_date);
    }

    const needsBlock: typeof activeMembers = [];
    const needsUnblock: typeof activeMembers = [];

    for (const m of activeMembers) {
      const shouldHaveAccess = shouldHaveDeviceAccess(m, latestPaymentByMember, todayStr, thirtyDaysAgoStr);
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
          const reason = isPaymentDelinquent(m, latestPaymentByMember, todayStr, thirtyDaysAgoStr) && m.expiry_date && m.expiry_date < todayStr
            ? "expired" : "unpaid";
          await admin.from("members").update({
            access_blocked_at: new Date().toISOString(),
            access_blocked_reason: reason,
          }).eq("id", m.id);
          await admin.from("activity_logs").insert({
            user_id: null, action: "auto_blocked_access", entity_type: "member", entity_id: m.id,
            description: `${m.full_name}'s device access was automatically blocked (${reason})`,
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
