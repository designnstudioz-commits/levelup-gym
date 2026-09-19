import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { shouldHaveDeviceAccess } from "@/lib/utils";
import { pushAccessToAllDevices } from "@/lib/server/devicePush";
import { requireStaff, DEVICE_OPERATOR_ROLES } from "@/lib/server/requireStaff";

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST /api/devices/sync-access
// Body: { member_id }
// Called (fire-and-forget, not awaited) right after a recurring fee
// payment is recorded, to restore device access immediately if the member
// was previously auto-blocked. Requires an authenticated front-desk session
// (see the note in the handler) — the callers are browser fetches from the
// Fees and member-profile pages, which carry the session cookie already.
export async function POST(req: NextRequest) {
  try {
    // Was unauthenticated until 2026-09-19. The original reasoning — "grants
    // no new privilege, only runs after an action already gated by the
    // caller's permission to collect fees" — was defensible when this only
    // cleared a database flag. It now drives physical door hardware, and it
    // was confirmed reachable in production by an anonymous caller.
    //
    // shouldHaveDeviceAccess() below is untouched and still the sole
    // authority: this route can only ever RESTORE access to a member who
    // already qualifies for it, never grant access to an expired one.
    const auth = await requireStaff(DEVICE_OPERATOR_ROLES);
    if (!auth.ok) return auth.response;

    const { member_id } = (await req.json()) as { member_id?: string };
    if (!member_id) {
      return NextResponse.json({ error: "member_id is required" }, { status: 400 });
    }

    const admin = getServiceClient();

    const { data: member } = await admin
      .from("members")
      .select("id, full_name, expiry_date, access_exempt, access_blocked_at")
      .eq("id", member_id)
      .single();

    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    if (!shouldHaveDeviceAccess(member)) {
      return NextResponse.json({ changed: false });
    }

    // access_blocked_at is not a reliable witness to what the doors actually
    // hold. A block command can reach a terminal and be applied WITHOUT ever
    // being acknowledged, in which case the flag was never set — confirmed
    // live 2026-09-19, when 7 paid-up members were being denied at Male Door
    // while every record said they had access. This route previously
    // short-circuited on the null flag, so paying was the one moment that
    // could have corrected them and it did nothing.
    //
    // So fall back to what each door was last TOLD, regardless of whether it
    // answered. Deliberately counts unacked and retired commands: a command
    // whose fate is unknown may well have been applied, and for someone who
    // has just paid, wrongly re-asserting access is harmless while wrongly
    // assuming it is a member turned away at the door.
    let needsRestore = !!member.access_blocked_at;

    if (!needsRestore) {
      const { data: history } = await admin
        .from("device_commands")
        .select("device_serial, command_id, command_type")
        .eq("member_id", member_id)
        .in("command_type", ["block_user", "unblock_user"])
        .order("command_id", { ascending: true });

      const lastToldPerDevice = new Map<string, string>();
      for (const c of history ?? []) lastToldPerDevice.set(c.device_serial, c.command_type);
      needsRestore = [...lastToldPerDevice.values()].includes("block_user");
    }

    if (!needsRestore) {
      return NextResponse.json({ changed: false });
    }

    const pushResults = await pushAccessToAllDevices(admin, member, "allow", null);
    const allOk = pushResults.length === 0 || pushResults.every((r) => r.ok);

    if (allOk) {
      await admin.from("members").update({
        access_blocked_at: null,
        access_blocked_reason: null,
      }).eq("id", member_id);

      await admin.from("activity_logs").insert({
        user_id: null,
        action: "auto_unblocked_access",
        entity_type: "member",
        entity_id: member_id,
        description: `${member.full_name}'s device access was automatically restored after a qualifying payment`,
      });
    }

    return NextResponse.json({ changed: allOk, pushResults });
  } catch (err) {
    console.error("[SyncAccess Error]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
