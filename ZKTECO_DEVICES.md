# ZKTeco Device System — Machines, API, Attendance

> Everything related to the physical biometric devices, the relay that talks to them, the
> Next.js API routes that manage them, attendance ingestion, and the automatic fee-based
> access-blocking feature. Last updated: 2026-09-19.

---

## 1. Architecture overview

```
[ZKTeco device] <--ADMS protocol (HTTP)--> [relay-service/server.js on a relay VM]
                                                          |
                                                          v
                                                   [Supabase Postgres]
                                                          ^
                                                          |
                                            [Next.js app on Vercel] (API routes only —
                                             the app never talks to a device directly)
```

- Devices **never** talk to the Next.js app on Vercel directly — Vercel's bot/DDoS
  protection challenges cloud-datacenter IPs with a JS page the devices can't solve.
  Traffic flow is always **device → relay VM → Supabase**, and separately **Next.js
  app → Supabase → (relay polls Supabase) → device**.
- `relay-service/server.js` is a small custom-built ADMS server this project wrote — it
  is **not** ZKTeco's own BioTime software. Routes it exposes to the devices:
  - `/iclock/cdata` — GET heartbeat, POST attendance upload (ATTLOG)
  - `/iclock/getrequest` — device polls this (~every 30s) for pending commands
  - `/iclock/devicecmd` — device posts back an ack/return_code for a command
  - `/iclock/fdata` — face-photo ack, no-op (a missing version of this route once
    caused a silent 404 retry loop that blocked all command delivery)
- **No live per-scan server verification.** These are standard ADMS terminals — each
  device makes its own **local** access decision (fingerprint template + locally stored
  fields like its Time Zone assignment), then only *reports* the result afterward via
  ATTLOG. There is no synchronous "ask the server" round-trip per scan.
- The device's own poll cycle (~20-30s) is the real-world latency floor for anything
  pushed to it. Once it does pick a command up it confirms in **~1.1s at the median**
  (measured over 1,305 acks) — the terminals are not slow and do not fall behind
  under load.
- **NEVER hand a terminal more than one command in a single `/iclock/getrequest`
  response.** It acknowledges only the first — no error, no return code and no
  re-request for the others — and because the handler has already flipped the whole
  batch to `sent`, the unacknowledged ones are never offered again.
  **Critically, "not acknowledged" does NOT mean "not applied."** Confirmed live
  2026-09-19: 7 paid-up members were being denied entry at Male Door by block commands
  that were never acked, so no record of the block existed anywhere. Treat an unacked
  command as having an **unknown** outcome, never as a no-op.
  Measured over every command sent 2026-07-04 to 2026-09-19: single-command responses
  were answered 1066/1067; multi-command responses left 400 commands unanswered across
  231 batches, and in every batch the one answered was the lowest-numbered. This went
  unnoticed for 11 weeks because from the server's side an unanswered command looks the
  same whether the terminal ignored it or applied it. Both `relay-service/server.js` and
  the Next.js copy now use `.limit(1)`, and the access sweep processes one member at a
  time so it can never put two pending commands on one device.
- Corollary: there is **no retry** for a command that reaches `sent` and is never
  acked. Anything that stalls there is dead until something re-issues it. An earlier
  theory that Male Door was "overloaded by bursts" was wrong — it was this batching
  bug the whole time.

## 2. Physical devices

| Name | Serial | Location | Door type |
|---|---|---|---|
| Female Reception | `SYZ8252300065` | Door 1 | Entrance |
| Female Zumba | `SYZ8252300047` | Door 2 | Entrance |
| Male Door | `SYZ8252300043` | Door 3 | Entrance |

A device counts "online" if `last_seen` is within the last 2 minutes
(`isDeviceOnline()` in `src/lib/utils.ts`) — matches the device's own ~30s heartbeat
with headroom for a missed beat.

## 3. Database tables

- **`devices`** — `id, serial_no, name, location, status, last_seen, color, door_type, ip_address`
- **`device_enrollments`** — `id, member_id, device_serial, device_user_id, enrolled_at, deleted_at`.
  One row per (member, device) pair. `device_user_id` is the PIN — **per-device local**,
  not a global identifier (see §4). Unique index on `(device_serial, device_user_id)
  WHERE deleted_at IS NULL` (allows re-enrollment after a soft-delete).
- **`device_commands`** — `id, device_serial, command_id, command, command_type, status,
  member_id, staff_id, created_by, sent_at, acked_at, return_code, error, created_at`.
  Append-only, no `deleted_at` (documented exception to the project's soft-delete rule,
  same as `attendances`/`activity_logs`). `command_type` values in use: `push_user`,
  `delete_user`, `block_user`, `unblock_user`, `set_time`, `reboot`. `status` is
  `pending → sent → acked` (or `failed`). **Unique constraint on `(device_serial,
  command_id)`** — see §8.2, this was defined in migration `20260707000000` but never
  actually applied to production until `20260829010000`.
- **`attendances`** — `id, member_id, staff_id, device_id, punch_time, punch_type
  (in/out/unknown), verified, created_at`. Immutable, no `deleted_at`.
- **`unverified_attendances`** — `id, device_id, raw_id, punch_time, resolved,
  resolved_by, resolved_at, created_at`. Created when a device reports a punch whose
  `raw_id` doesn't match any `device_enrollments` row (member) or
  `staff_members.device_user_id` (staff) **for that specific device**.

## 4. PIN / enrollment model — the single most important thing to understand

**A PIN (`device_user_id`) is meaningful only on the device that issued it.** The same
number on two different machines can be — and regularly is — two completely different
physical people. There is no global PIN namespace across the 3 devices.

- Convention: a member's PIN is normally their membership-number suffix (e.g.
  `LUM-2026-0056` → PIN `56`), set via `DeviceEnrollmentsField` on the member profile
  page. Staff use a separate `device_user_id` column directly on `staff_members`
  (reserved range 5000+, never collides with member PINs).
- A member/staff person can be — and often is — enrolled on some devices but not
  others. There's no automatic "enroll everywhere" step; each device enrollment is a
  distinct, deliberate action (`push-user` route + a physical fingerprint scan at that
  specific unit's console).
- **A genuine, costly mistake was made and reverted this session** (2026-09-01): a bulk
  "resolve unidentified punches" script assumed that if PIN `X` belonged to Person A on
  one device, then PIN `X` showing up unidentified on a *different* device must also be
  Person A. That assumption is false. It misattributed real strangers' attendance to
  11 real members, and — more seriously — would have exposed those wrongly-attributed
  members to being auto-blocked on a device they were never actually enrolled on, while
  the real PIN-holder on that device (who might be a legitimate, currently-paid member)
  remained completely unaffected. Fully reverted (117 punches restored to unresolved,
  10 bad `device_enrollments` rows deleted). **Do not build cross-device PIN-matching
  automation again.** Resolving an unidentified punch requires a human to actually
  confirm who the person is — the single-punch "Resolve" UI (staff types a name/
  membership number) is fine; an automated "same number elsewhere = same person"
  heuristic is not.

## 5. API routes (Next.js app, all under `src/app/api/`)

All of these use the **service-role Supabase client** for the actual device_commands
writes (RLS never applies to them), matching the standing rule that
`device_commands` grants zero client-side write access — only the service role can
write it.

| Route | Method | Purpose |
|---|---|---|
| `devices/push-user` | POST | Pushes `DATA UPDATE USERINFO` (full access, `TZ1=0`) for a member or staff to one device. Body: `{member_id \| staff_id, device_serial}`. |
| `devices/delete-user` | POST | Pushes a delete command for a member/staff on one device. |
| `attendance/push` | — | Server-side attendance ingestion path (separate from the relay's direct-to-Supabase writes — see relay-service for the primary ATTLOG path). |
| `cron/access-sweep` | GET | Daily auto-block/unblock sweep. See §7. |
| `members/set-access-exemption` | POST | Owner/manager only — permanent exemption toggle. See §7. |
| `members/unblock-access` | POST | Owner/manager only — one-time temporary unlock. See §7. |
| `devices/sync-access` | POST | Fire-and-forget, called right after a recurring fee payment. See §7. |

## 6. `src/lib/server/devicePush.ts` — the shared push helper

Server-only module (`import "server-only"` guards against accidental client bundling).

- `buildUserInfoCommand(uid, name, access)` — builds the tab-separated ADMS command.
  Blocking sets **both** `TZ1=2` and `Grp=2`; allowing sets `TZ1=0` and `Grp=1`. Two
  fields, found in two separate rounds of live hardware testing:
  - **`TZ1=`** (not the generic bare `TZ=`, which acks but is silently ignored) is the
    per-user personal Time Zone field — confirmed 2026-08-29.
  - **`Grp=`** is the user's **Access Group**. Confirmed 2026-09-03: real members had
    "Apply Group Time Period" enabled on-device, which makes the device follow the
    Access Group's own schedule *instead of* the personal Time Zone field. Every normal
    push had always hardcoded `Grp=1`, and Group 1's Time Period is wide open — so
    `TZ1=2` alone silently did nothing for anyone in that state, which is exactly why
    the original rollout leaked for a subset of real members despite a fully
    device-acknowledged push. Group 2 has been configured on-device (on Female
    Reception, confirmed working both directions) to use the same deny-all Time
    Schedule 2 that Group 1 never referenced.
  - `TZ1=0`/`Grp=1` = Time Schedule 1, full 24/7 access (the default every member ships
    with). `TZ1=2`/`Grp=2` = Time Schedule 2, deny-all (a one-time on-device setup per
    device: Access Control → Time Schedule → slot `02/50` → every day `00:00–00:00`,
    **plus** Access Control → Access Groups → Group 2 → Time Period 1 set to reference
    Time Schedule 2 — confirmed done on Female Reception; **not yet confirmed on Male
    Door or Female Zumba**, see §9.
- `pushAccessCommand()` — inserts the `device_commands` row (retrying up to 3x on a
  `command_id` collision), then **polls for a real device ack** (`status='acked'` +
  `return_code=0`) for up to 15s before reporting success. This is deliberate — see
  §8.3, treating "queued" as "done" was a real production bug.
- `command_id` is computed as `MAX(command_id)+1` for that device — **not**
  `count(*)+1`. See §8.2 for why this matters.
- `pushAccessToAllDevices()` — pushes to every device a member is enrolled on, in
  parallel (bounds the wait to one ack timeout regardless of device count; the outer
  caller still processes members one at a time, so this never bursts multiple members'
  commands at once).

## 7. Automatic fee-based access blocking

Built 2026-08-29–09-01. Goal: block a member's device access when their fee lapses,
restore it automatically when they pay, with a manual owner/manager override for
"personal" members who should never be blocked.

### Schema (`members` table, migration `20260829000000`)
- `access_exempt`, `access_exempt_reason`, `access_exempt_by`, `access_exempt_at` —
  the persistent manual override.
- `access_blocked_at`, `access_blocked_reason` (`'expired'` or `'unpaid'`, though in
  practice only `'expired'` is ever written now — see below) — current block state,
  written **only** by server-side/service-role code. A `BEFORE UPDATE` trigger
  (`enforce_access_control_columns`) blocks any `authenticated`-role client from
  writing these columns directly, and requires owner/manager to change the exemption
  fields — self-contained, doesn't depend on the (separately pending) RLS rollout.

### The blocking decision — `shouldHaveDeviceAccess()` in `src/lib/utils.ts`
Deliberately **narrower** than the Dashboard/Fees "Unpaid" warning tiles
(`isPaymentDelinquent()`): blocking fires **only** on a genuinely lapsed
`expiry_date`, never on the fuzzier "no recent payment" signal those tiles use. Found
and fixed on 2026-08-29: the broader check produced 57 false positives out of 201 (28%)
— real members who'd simply paid early or in a lump sum for multiple months, whose
`expiry_date` already correctly reflected paid-through coverage. Blocking someone whose
own record says they're covered is worse than a wrong dashboard label, so the two
checks were intentionally split.

### `GET /api/cron/access-sweep`
Vercel Cron hits this daily (`vercel.json`, `0 3 * * *` UTC = 08:00 PKT). Scans every
`status='active'`, non-deleted member, computes `shouldHaveDeviceAccess()` vs current
`access_blocked_at`, pushes block/unblock via `pushAccessToAllDevices()`.
- **Inert by default** — `dryRun = ?dryRun=true \|\| ACCESS_SWEEP_LIVE !== "true"`. Ships
  safely, armed later via env var with no redeploy needed. It **is** armed in production.
- **New blocks are capped, never aborted** — `ACCESS_SWEEP_MAX_CHANGES` (default **20**)
  limits how many blocks one run applies, oldest-expiry first; the remainder rolls into
  the next run. **Unblocks are uncapped** — restoring a paying member is always safe.
- This replaced a circuit breaker that aborted the *entire* run whenever the backlog
  exceeded a ceiling. Because an aborted run fixed nothing, the backlog only grew, which
  guaranteed every later run also tripped the ceiling — a self-sustaining lockout that
  ran unnoticed 2026-09-04 → 09-16 because an aborted run still returns HTTP 200.
- **One member at a time** (`CHUNK_SIZE = 1`). Not pacing — the terminals are fast. It
  guarantees a member's push puts at most one pending command on any device, so a device
  can never be handed two at once (see §1). Running out of `maxDuration` mid-run is
  harmless: confirmed members are recorded and the next run resumes with the rest.
- Response distinguishes `pending` (no ack yet — will retry next run), `failures` (a
  genuine error), and `deferredBlockCount` (over the per-run cap, not a failure).

### `POST /api/devices/sync-access`
Called **fire-and-forget** (not awaited) from `handleCollect()`
(`dashboard/fees/page.tsx`) and `recordFee()` (`dashboard/members/[id]/page.tsx`)
right after a recurring fee payment. Restores access immediately if the payment brings
a blocked member back into good standing — no waiting for the next day's sweep.
- **Does not trust `access_blocked_at` alone.** When the flag is null it falls back to
  what each door was last *told* (`device_commands`, newest per device, **including
  unacked and retired rows**) and still restores access if that was a block. Added
  2026-09-19 after 7 paid-up members were found being denied at Male Door by blocks that
  were applied but never acknowledged — so the flag was never set, and paying, the one
  moment that could have corrected them, short-circuited on the null flag and did
  nothing. For someone who has just paid, re-asserting access they already have costs
  nothing; assuming a block never landed costs them entry.
- **Known open gap (unchanged)**: because it's fire-and-forget, the request can fail to
  reach the server with zero trace (confirmed live 2026-09-01 — two members who'd paid
  days earlier had zero `device_commands` rows, so the call never fired). The daily sweep
  self-heals this within 24h since it re-evaluates *every* member, but there is still no
  instant, guaranteed path.

### `POST /api/members/set-access-exemption` (owner/manager only)
Body `{member_id, exempt, reason?}`. Turning exemption **on** also immediately
force-unlocks the member if currently blocked. Turning it **off** does *not* instantly
re-block — deliberate, avoids an abrupt lockout from a single checkbox flip; they're
just subject to the next sweep again.

### `POST /api/members/unblock-access` (owner / manager / **receptionist**)
Body `{member_id}`. A **temporary, one-time** override — restores access now without
exempting them from future auto-blocking (unlike the exemption route). For "let them
in today, still chasing payment" situations. Receptionist is deliberately included:
they are the role actually collecting fees at the counter, so they need to restore
access on the spot rather than wait for a manager or the next sweep.
- Waits **35s** for every enrolled door to confirm — two full ~20s poll cycles. The
  original 15s was shorter than a *single* cycle, so a door that simply had not polled
  yet was indistinguishable from one that refused, and the route returned an error
  while skipping the `access_blocked_at` clear. The queued commands then landed anyway,
  leaving the member walking in while the record said "blocked" (seen live 2026-09-19).
- A genuine refusal is a **500**. An unconfirmed push returns **202** and deliberately
  does **not** clear the flag — claiming success there would leave the record saying the
  member has access while a door still denies them, which is the worse direction to be
  wrong in. Both callers surface this as "not confirmed yet, try again in a minute"
  rather than a success toast.
- Needs `export const maxDuration = 60` so the longer wait is not cut off by the
  platform default, which would reintroduce the same false failure.

### UI
- Member profile (`dashboard/members/[id]/page.tsx`): "Access Control" section showing
  a blocked/exempt badge, plus **Unblock (One-Time)** and **Exempt from Auto-Blocking**
  buttons (owner/manager only, buttons gated client-side but backed by real server-side
  role checks and the DB trigger).
- Members list (`dashboard/members/page.tsx`): new **"Unpaid"** tab (active members
  past `expiry_date` — the same population the sweep blocks), plus red **Blocked** /
  green **Exempt** badges on every row in every view.

## 8. Bugs found and fixed this session (2026-08-29 → 09-01)

### 8.1 The `TZ=` vs `TZ1=` field, and later `Grp=` (root cause of blocking never working) — two rounds
**Round 1 (2026-08-29)**: every push had hardcoded `TZ=0` — acked successfully every
time, did nothing. Found via a direct on-device A/B test: manually setting the
per-user "Time Zone 1" field to `2` on-device denied access; a *remote* push of
`TZ1=0` (a field our code had never sent) restored it. Fixed in `push-user/route.ts`
and `devicePush.ts` to send `TZ1=`/`TZ2=`/`TZ3=`.

**Round 2 (2026-09-03)**: `TZ1=` alone still wasn't enough for real members — see the
now-resolved §9 below. Fix required also sending `Grp=2` (block) / `Grp=1` (allow).

### 8.2 `command_id` generation — `count(*)+1` is fundamentally unsafe
Used everywhere a device command was queued. Breaks permanently the moment any gap
exists between a device's row count and its real highest `command_id` (a deleted
duplicate, a failed insert that still consumed an id elsewhere) — collides on the same
already-used number every retry, since the count doesn't change on a failed insert.
Confirmed live: Male Door had drifted to a **100,128-row gap**, likely from a runaway
retry loop before the unique constraint existed. Fixed everywhere to `MAX(command_id)+1`.

### 8.3 Ack-verification gap
`access_blocked_at` was set as soon as the `device_commands` INSERT succeeded — proof
the command was *queued*, not that the device *applied* it. Commands that got stuck in
`sent` status were never retried, since the app had already (wrongly) declared success.
Fixed: `pushAccessCommand()` now polls for a real `acked` + `return_code=0` before
reporting success.

### 8.4 Missing unique constraint on `device_commands`
Migration `20260707000000` defined `UNIQUE (device_serial, command_id)` but was never
actually applied to production. Real duplicate rows existed from concurrent pushes
(confirmed: 21 duplicate groups, all from one incident — two overlapping access-sweep
runs racing after a client-side timeout outlived the still-running server request).
Fixed via migration `20260829010000` (dedup existing rows, then re-apply the constraint).

### 8.5 Cross-device PIN misattribution (see §4)
The most serious one — reverted in full.

## 9. RESOLVED (2026-09-03): the "Access Group" mystery

Some real members showed a **fully device-acknowledged** `TZ1=2` block yet still got
physical entry — including on Female Reception, the one device scan-tested end-to-end
with the original test rig. Root cause found on-device: real members (e.g. PIN 92,
Javeria Liaqat) had **"Apply Group Time Period"** enabled (Access Control Role screen),
which makes the device follow the user's **Access Group** schedule instead of their
personal Time Zone fields. Every push had always hardcoded `Grp=1`, and Access Group
1's Time Period is wide open (references Time Schedule 1) — so `TZ1=2` alone was
silently overridden for anyone in that state. Ruled out along the way: duplicate/
orphaned PIN enrollments (clean), the group-time-period toggle itself (found ON for
*both* the working test dummy and a leaking real member — not the differentiator by
itself, since a fresh test PIN with the toggle also ON still leaked until `Grp=2` was
added), verification method (fingerprint vs face — never actually confirmed as a
factor once the Access Group cause was found).

**Fix, verified live on Female Reception**: blocking now also sends `Grp=2`, not just
`TZ1=2`. Access Group 2 was configured on-device (Access Control → Access Groups →
Group 2 → Time Period 1 → Time Schedule 2) to point at the same deny-all schedule.
Tested and confirmed both directions with a fresh test PIN (999): `Grp=2`+`TZ1=2` →
denied; `Grp=1`+`TZ1=0` → granted again. Code fix in `devicePush.ts` (§6).

**Still open**: Access Group 2 has only been configured this way on **Female
Reception**. Male Door and Female Zumba need the identical one-time on-device setup
(Access Control → Access Groups → Group 2 → Time Period 1 → Time Schedule 2) before
this fix takes effect there — until then, blocking on those two devices may still
leak the same way it did before. Also still needed: re-push the corrected command to
every member currently shown as `access_blocked_at` in the database, since their
existing on-device record was pushed with the old (incomplete) `Grp=1` — confirmed
still leaking as of 2026-09-01: **Razi (LUM-2026-0214)** and **Muhammad Qasim
(LUM-2026-0072)**, both on Male Door.

## 10. RESOLVED (2026-09-19): command batching — the cause of every "the block didn't work" symptom

The single largest defect in this subsystem. Ran undetected for 11 weeks.

**Symptom as reported:** unpaid members kept getting in. The daily sweep correctly
identified expired members and reported success, yet only ~4–5 blocks actually landed
per run, so the backlog never cleared. 44 expired members had full door access when the
audit was run.

**Root cause:** `/iclock/getrequest` handed the terminal up to 5 pending commands in one
response (`.limit(5)`). A terminal acknowledges only the first. Since the handler flips
the whole batch to `sent` before responding, the rest were never offered again.

**The measurement that settled it** — every command ever sent, grouped by batch size:

| Commands per response | Answered |
|---|---|
| **1** | **1066 / 1067 (100%)** |
| 2 | 95 / 166 (57%) |
| 3 | 29 / 75 (39%) |
| 4 | 17 / 64 (27%) |
| 5 | 302 / 530 (57%) |

In command_id order, every multi-command batch resolved identically: first answered,
rest silent. It degraded over time — 63/95 multi-batches fully succeeded in July, 3/65
in August, **0/71 in September**.

**Two earlier theories this disproved.** Neither was true, and both cost real debugging
time:
1. *"The terminals are overloaded by bursts."* They confirm in ~1.1s at the median,
   never dropped offline, and single commands succeed ~100% of the time regardless of
   queue depth. Batch size was the only variable that ever mattered. Pacing work more
   gently (the earlier `CHUNK_SIZE = 5` fix) treated a symptom that did not exist.
2. *"An unacknowledged command was simply discarded."* **False, and the dangerous one.**
   Unacknowledged commands can still be applied. This surfaced when a member
   (Haisam Mehmood, LUM-2026-0158) was reported being denied entry while fully paid: a
   block from 16 Sep had been applied by Male Door but never acked, so nothing recorded
   it, and his payment that same day could not reverse a block the system did not know
   about. **6 more members were in the identical state.** Always treat an unacked
   command's outcome as *unknown*.

**Fixes (all live):**
- `relay-service/server.js` and the Next.js copy → `.limit(1)`.
- Access sweep → `CHUNK_SIZE = 1`, so it can never queue two commands on one device.
- `sync-access` → falls back to what each door was last *told* when `access_blocked_at`
  is null (§7).
- `unblock-access` → 35s ack wait, and 202-not-500 for unconfirmed pushes (§7).

**Verified on hardware after the fix:** two commands queued simultaneously for Male
Door were handed over 2s apart on separate polls and **both** acknowledged.

**Cleanup performed:** 401 commands stuck in `sent` were retired (`failed` with an
explanatory `error`), then 64 corrective commands were issued one-at-a-time — 64/64
succeeded in ~2 minutes. Final state: 0 expired-with-access, 0 partially blocked, 0
records disagreeing with their doors.

> **⚠ The relay fix is not reproducible from the repo.** `/home/sitedes/relay-service/`
> on the relay VM is a **copied file, not a git checkout** — `git pull` does not work
> there and `pm2` is not installed. The fix was applied by hand (`sed`, then
> `sudo systemctl restart zkteco-relay`). **If that VM is ever rebuilt, reimaged or
> restored from a snapshot, `.limit(1)` is lost and this entire class of failure
> returns silently.** See §13 for the procedure.

## 11. Test rig

Original dummy **"Test Dummy" (`LUM-2026-0297`)** was deleted from Female Reception
on-device during the 2026-09-03 troubleshooting session. Current test PIN there is
**`999`** ("Test Dummy 2"), same member record, freshly enrolled — verified working
end-to-end (deny at `Grp=2`+`TZ1=2`, restore at `Grp=1`+`TZ1=0`) on **Female
Reception**. Not yet set up on Male Door or Female Zumba.

## 12. Environment variables

| Variable | Purpose |
|---|---|
| `CRON_SECRET` | Bearer-token auth for `/api/cron/access-sweep`, also required for manual test calls. |
| `ACCESS_SWEEP_LIVE` | Must be `"true"` for the sweep to actually push anything; otherwise always dry-run regardless of the query param. |
| `ACCESS_SWEEP_MAX_CHANGES` | Circuit breaker ceiling (default 25). Was temporarily raised to clear the one-time 135-member initial backlog, then lowered back. |

## 13. Manual operations reference

```bash
# Dry-run the sweep (safe, no live effect)
curl "https://<app-url>/api/cron/access-sweep?dryRun=true" -H "Authorization: Bearer $CRON_SECRET"

# Live run
curl "https://<app-url>/api/cron/access-sweep" -H "Authorization: Bearer $CRON_SECRET"
```

Checking a specific device_commands row's ack status, or pushing a raw command
directly, is normally done via a throwaway Node script in the repo root (parsing
`.env.local`, using the service-role key) — see any of the session's `*_tmp.mjs`
scripts for the pattern; always delete the script after use.

### Rebuilding the relay VM from scratch

Use **`relay-service/provision-relay-vm.sh`** (in the repo). Copy the `relay-service/`
directory to the box and run it with sudo from inside that copy.

> **⚠ `~/setup-zkteco-relay.sh` on the VM is STALE AND HARMFUL — do not run it.**
> It predates the relay (written 2026-07-08; the relay landed 07-10) and configures
> nginx to proxy device traffic to **`levelup-gym-liard.vercel.app`**. That is the one
> configuration guaranteed not to work — Vercel's bot protection answers the terminals
> with a JS challenge they cannot solve, which is the whole reason this VM exists. It
> installs no Node, no `server.js` and no systemd unit. Rebuilding from it leaves the
> gym with no working access control and no obvious cause.

`provision-relay-vm.sh` installs Node, the relay files, npm deps, the systemd unit and
an nginx vhost pointing at `127.0.0.1:3001`. It is idempotent, backs up any existing
`server.js`, never touches an existing `.env`, and **refuses to install a `server.js`
that does not set `COMMANDS_PER_POLL = 1`** — so a rebuild cannot silently reinstate
command batching (§10). Secrets are not in git: a fresh box gets a `.env` template and
the script stops until it is filled in.

### Deploying a change to the relay VM

**Pushing to `main` does NOT update the relay.** Only Vercel auto-deploys. A relay fix
sitting in `main` is not live until someone does this by hand.

- Host `zkteco-relay` (GCE, reached via IAP), user `sitedes`.
- Code at `/home/sitedes/relay-service/server.js` — a **copied file, not a checkout**.
  `git pull` fails there. `pm2` is not installed; it runs under systemd.

```bash
cd ~/relay-service
cp server.js server.js.bak-$(date +%F-%H%M)   # always back up first
# ...apply the edit (sed, or replace the file wholesale)...
node --check server.js                        # MUST pass before restarting
sudo systemctl restart zkteco-relay
systemctl status zkteco-relay --no-pager | head -12
```

The running process is untouched until the restart, so a failed `node --check` is
safely recoverable — restore the `.bak` and nothing was ever interrupted.

**Verifying command delivery** (nothing appears unless commands are queued):
```bash
sudo journalctl -u zkteco-relay -n 30 --no-pager | grep Sending
```
Must always read `Sending 1 command(s) to SN=...`. **Any number above 1 means the
batching regression is back** — see §10.

## 14. Relevant migrations (chronological)

- `20260604000005_attendance_device.sql` — `device_user_id` on `members`
- `20260625000001_device_commands.sql` — base table
- `20260707000000_device_commands_unique_constraint.sql` — defined but never applied (§8.4)
- `20260707000001_backfill_device_enrollments.sql`
- `20260725160000_*` — partial unique index allowing re-enrollment after soft-delete
- `20260804040000_device_commands_staff_id.sql`
- `20260829000000_member_access_control.sql` — `access_exempt*`/`access_blocked_*` + trigger
- `20260829010000_device_commands_dedup_and_reconstrain.sql` — actually applies the §8.4 constraint

Also relevant but **not yet applied** (see the separate, paused RLS security rollout):
`20260825100700_rls_attendances.sql`, `20260825100800_rls_unverified_attendances.sql`,
`20260825100900_rls_devices.sql`, `20260825101000_rls_device_commands.sql`,
`20260825101100_rls_device_enrollments.sql`.
