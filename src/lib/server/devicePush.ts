import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AccessLevel = "allow" | "block"; // TZ1=0 vs TZ1=2

// ADMS DATA UPDATE USERINFO command — TZ1 is the field this firmware
// actually reads for per-user access-schedule assignment (confirmed on
// hardware 2026-08-29; the generic bare TZ= field acks but is ignored).
// Time Schedule 2 is pre-configured deny-all on every device; Time
// Schedule 1 (the default, TZ1=0) is full 24/7 access.
export function buildUserInfoCommand(uid: string, name: string, access: AccessLevel): string {
  const truncatedName = name.substring(0, 24); // device name field limit
  return [
    "DATA UPDATE USERINFO",
    `PIN=${uid}`,
    `Name=${truncatedName}`,
    `Pri=0`,
    `Passwd=`,
    `Card=`,
    `Grp=1`,
    `TZ=0`,
    `TZ1=${access === "block" ? 2 : 0}`,
    `TZ2=0`,
    `TZ3=0`,
    `Verify=0`,
    `ViceCard=`,
  ].join("\t");
}

// Queues one device_commands row, retrying on command_id collision exactly
// like /api/devices/push-user — command_id is count(*)+1 scoped to
// device_serial, so this retry loop runs once PER DEVICE.
export async function pushAccessCommand(
  supabase: SupabaseClient,
  params: {
    device_serial: string;
    uid: string;
    name: string;
    access: AccessLevel;
    member_id?: string | null;
    created_by?: string | null;
  }
): Promise<{ ok: true; commandId: number } | { ok: false; error: string }> {
  const command = buildUserInfoCommand(params.uid, params.name, params.access);
  let commandId: number | null = null;
  let lastError: { code?: string; message: string } | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const { count } = await supabase
      .from("device_commands")
      .select("*", { count: "exact", head: true })
      .eq("device_serial", params.device_serial);

    commandId = (count ?? 0) + 1;

    const { error } = await supabase.from("device_commands").insert({
      device_serial: params.device_serial,
      command_id: commandId,
      command,
      // Distinct from "push_user" so these don't show up in
      // DeviceEnrollmentsField's enrollment-push-status UI, which filters
      // specifically on command_type: "push_user".
      command_type: params.access === "block" ? "block_user" : "unblock_user",
      member_id: params.member_id ?? null,
      created_by: params.created_by ?? null,
      status: "pending",
    });

    if (!error) { lastError = null; break; }
    lastError = error;
    if (error.code !== "23505") break; // not a unique-violation — don't retry
  }

  if (lastError) return { ok: false, error: lastError.message };
  return { ok: true, commandId: commandId! };
}

// Pushes an access-level command to every device the member is currently
// enrolled on.
export async function pushAccessToAllDevices(
  supabase: SupabaseClient,
  member: { id: string; full_name: string },
  access: AccessLevel,
  createdBy?: string | null
): Promise<{ device_serial: string; ok: boolean; error?: string }[]> {
  const { data: enrollments } = await supabase
    .from("device_enrollments")
    .select("device_serial, device_user_id")
    .eq("member_id", member.id)
    .is("deleted_at", null);

  const results: { device_serial: string; ok: boolean; error?: string }[] = [];
  for (const e of enrollments ?? []) {
    const res = await pushAccessCommand(supabase, {
      device_serial: e.device_serial,
      uid: e.device_user_id,
      name: member.full_name,
      access,
      member_id: member.id,
      created_by: createdBy ?? null,
    });
    results.push({ device_serial: e.device_serial, ok: res.ok, error: res.ok ? undefined : res.error });
  }
  return results;
}
