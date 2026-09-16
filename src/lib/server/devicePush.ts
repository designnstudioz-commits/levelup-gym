import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AccessLevel = "allow" | "block"; // TZ1=0 vs TZ1=2

// ADMS DATA UPDATE USERINFO command. TZ1 alone (confirmed 2026-08-29) is
// NOT sufficient to block a real member — found live on hardware
// 2026-09-03: real members had "Apply Group Time Period" enabled on-device,
// which makes the device follow the user's Access Group schedule instead of
// (or in addition to) their personal Time Zone fields. Group 1 (the default
// every normal push assigns via Grp=1) has an open, 24/7 Time Period, so
// TZ1=2 alone silently did nothing for anyone in that state — this is why
// the original rollout appeared to leak for a subset of real members
// despite a fully device-acknowledged push. Fix: blocking now ALSO
// reassigns the user to Access Group 2 (Grp=2), which has been configured
// on-device to use the same deny-all Time Schedule 2. Verified on hardware,
// both directions (Grp=2+TZ1=2 denies, Grp=1+TZ1=0 restores).
export function buildUserInfoCommand(uid: string, name: string, access: AccessLevel): string {
  const truncatedName = name.substring(0, 24); // device name field limit
  return [
    "DATA UPDATE USERINFO",
    `PIN=${uid}`,
    `Name=${truncatedName}`,
    `Pri=0`,
    `Passwd=`,
    `Card=`,
    `Grp=${access === "block" ? 2 : 1}`,
    `TZ=0`,
    `TZ1=${access === "block" ? 2 : 0}`,
    `TZ2=0`,
    `TZ3=0`,
    `Verify=0`,
    `ViceCard=`,
  ].join("\t");
}

// Blocks until device_commands shows this command acked (or fails/times
// out) — polls rather than trusting the insert alone, because "queued
// successfully" and "the device actually applied it" turned out to be two
// different things in production (2026-08-29: some access-sweep pushes
// sat in "sent" forever and were never retried, since the old code treated
// a successful INSERT as proof of a real block).
async function waitForAck(
  supabase: SupabaseClient,
  deviceSerial: string,
  commandId: number,
  timeoutMs: number,
  pollIntervalMs: number
): Promise<{ ok: boolean; pending: boolean; error?: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await supabase
      .from("device_commands")
      .select("status, return_code, error")
      .eq("device_serial", deviceSerial)
      .eq("command_id", commandId)
      .maybeSingle();

    if (data?.status === "acked") {
      const success = data.return_code === 0;
      return { ok: success, pending: false, error: success ? undefined : (data.error ?? `device returned code ${data.return_code}`) };
    }
    if (data?.status === "failed") {
      return { ok: false, pending: false, error: data.error ?? "command failed" };
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  // Not an error — the device just hasn't polled/processed it yet (its own
  // cycle is ~30s, and it can fall behind under load). Not confirmed, so
  // the caller must not treat this as a successful block/unblock — but it's
  // still queued, and a later sweep run will find it still unconfirmed and
  // naturally issue a fresh attempt.
  return { ok: false, pending: true, error: "device has not acknowledged the command yet" };
}

// Per-device-serial mutex guarding the read-max/insert critical section
// below. Only 3 physical devices exist, shared by every member — the
// access-sweep cron processes many members concurrently (see its own
// header comment), so without this, two members enrolled on the same
// device racing to read the same "current max command_id" both compute
// the same next id and only one insert wins, the other fails outright.
// Confirmed live 2026-09-16: a 40-member sweep batch lost 36 of 40 to
// this exact race. Module-level state is fine here — it only needs to
// hold for the lifetime of one function invocation processing one batch,
// never needs to survive across invocations/instances.
const deviceMutexes = new Map<string, Promise<void>>();

async function withDeviceLock<T>(deviceSerial: string, fn: () => Promise<T>): Promise<T> {
  const previous = deviceMutexes.get(deviceSerial) ?? Promise.resolve();
  let release: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  deviceMutexes.set(deviceSerial, previous.then(() => gate));
  await previous;
  try {
    return await fn();
  } finally {
    release!();
  }
}

// Queues one device_commands row (retrying on command_id collision exactly
// like /api/devices/push-user — command_id is count(*)+1 scoped to
// device_serial), then waits for the device to actually confirm it before
// reporting success.
export async function pushAccessCommand(
  supabase: SupabaseClient,
  params: {
    device_serial: string;
    uid: string;
    name: string;
    access: AccessLevel;
    member_id?: string | null;
    created_by?: string | null;
  },
  opts?: { ackTimeoutMs?: number; pollIntervalMs?: number }
): Promise<{ ok: true; commandId: number } | { ok: false; pending: boolean; error: string }> {
  const command = buildUserInfoCommand(params.uid, params.name, params.access);

  // Only the allocate+insert step needs the lock — the (much longer) ack
  // wait below stays outside it, so other members' pushes to this same
  // device can queue their own insert the instant this one lands, rather
  // than blocking behind a 15s ack wait. The callback returns its result
  // rather than assigning outer variables — TS can't reliably narrow a
  // closure-mutated outer `let` across the await boundary here.
  const { commandId, lastError } = await withDeviceLock(params.device_serial, async () => {
    let commandId: number | null = null;
    let lastError: { code?: string; message: string } | null = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      // MAX(command_id)+1, not count(*)+1 — a row count silently breaks the
      // moment any gap exists in the sequence (a deleted duplicate, a failed
      // insert that still consumed an id elsewhere), permanently colliding on
      // the same number every retry. Confirmed live 2026-08-29: Male Door had
      // drifted to a 100,000+ gap between its row count and real max id.
      const { data: maxRow } = await supabase
        .from("device_commands")
        .select("command_id")
        .eq("device_serial", params.device_serial)
        .order("command_id", { ascending: false })
        .limit(1)
        .maybeSingle();

      commandId = (maxRow?.command_id ?? 0) + 1;

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

    return { commandId, lastError };
  });

  if (lastError) return { ok: false, pending: false, error: lastError.message };

  const ack = await waitForAck(
    supabase,
    params.device_serial,
    commandId!,
    opts?.ackTimeoutMs ?? 15000,
    opts?.pollIntervalMs ?? 2000
  );
  if (!ack.ok) return { ok: false, pending: ack.pending, error: ack.error ?? "not acknowledged" };
  return { ok: true, commandId: commandId! };
}

// Pushes an access-level command to every device the member is currently
// enrolled on, in parallel (bounds the wait to one ack timeout regardless
// of device count — members are still processed one at a time by the
// caller, so this never creates a burst across different members' devices).
export async function pushAccessToAllDevices(
  supabase: SupabaseClient,
  member: { id: string; full_name: string },
  access: AccessLevel,
  createdBy?: string | null
): Promise<{ device_serial: string; ok: boolean; pending?: boolean; error?: string }[]> {
  const { data: enrollments } = await supabase
    .from("device_enrollments")
    .select("device_serial, device_user_id")
    .eq("member_id", member.id)
    .is("deleted_at", null);

  return Promise.all(
    (enrollments ?? []).map(async (e) => {
      const res = await pushAccessCommand(supabase, {
        device_serial: e.device_serial,
        uid: e.device_user_id,
        name: member.full_name,
        access,
        member_id: member.id,
        created_by: createdBy ?? null,
      });
      return {
        device_serial: e.device_serial,
        ok: res.ok,
        pending: res.ok ? undefined : res.pending,
        error: res.ok ? undefined : res.error,
      };
    })
  );
}
