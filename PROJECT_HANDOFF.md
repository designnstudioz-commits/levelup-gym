# Level Up Fitness Club — Gym Management Software
## AI Agent Handoff Document

This document is a complete, self-contained snapshot of a production gym management web application, written for another AI coding assistant to read and immediately understand the system — what it does, how it's built, its data model, its business rules, and its known rough edges. It reflects the **actual current state of the codebase**, not an aspirational spec.

---

## 1. What this is

A custom gym management system for **Level Up Fitness Club**, a gym at 3rd Floor, High Street Mall, Paragon City, Lahore, Pakistan. It replaces a legacy desktop product ("GymAutomate v8.3.5"). It handles the full lifecycle of running the gym's front desk and back office: member registration and approval, fee/payment collection (including split payments, discounts, partial payments, and multi-month advance payments), membership expiry tracking, biometric attendance via ZKTeco fingerprint devices, staff and trainer commission management, package/pricing catalog, reporting, and role-based staff accounts.

**Client:** Khalid Saeed (CEO). **Built by:** Faisal Munir (DesignnStudio), with Claude Code as the primary development tool.

**Status:** Live in production. Real staff use it daily to register members, collect fees, and track attendance. Real ZKTeco hardware is deployed and integrated.

---

## 2. Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Web framework | Next.js 16 (App Router, Turbopack) | TypeScript throughout |
| Database | Supabase (PostgreSQL) | No RLS policies configured anywhere — access control is entirely application-level |
| Styling | Tailwind CSS v4 | Utility classes only, no CSS modules |
| Forms | React Hook Form + Zod | Used in the registration flow; most other forms use plain `useState` |
| Charts | Recharts | Reports page |
| Hosting (main app) | Vercel | |
| Hosting (device relay) | A separate always-on Linux VM (currently GCP Compute Engine) | See §5 — this is NOT on Vercel, deliberately |
| Auth | Supabase Auth (email/password) | |
| Deployment | GitHub → Vercel auto-deploy on push to `main` | No staging environment currently; migrations are run manually by the developer in the Supabase SQL editor (not an automated CI migration runner) |

Planned-but-not-built stack items (see §9): Flutter mobile app, Telenor CCSMS for SMS, WATI/Meta API for WhatsApp, SendGrid for email, Firebase FCM for push, JazzCash/EasyPaisa payment gateways, Claude API for AI features.

---

## 3. Brand

```
Primary orange:   #F06418      Orange dark:   #C04E10
Orange light bg:  #FEF0E8      Orange mid:    #FDDCC8
Dark/black:       #111111      Dark sidebar:  #1A1A1A
Border:           #E4E4DE
Text primary:     #1A1A16      Text secondary: #4A4A44      Text muted: #7A7A72
```
Typography: Barlow Condensed 800 for headings, Barlow 400/500/600 for body (Google Fonts). Design language: white background, dark sidebar, orange accents, flat design (no gradients/shadows beyond subtle borders). Professional, not playful.

---

## 4. Architecture

### 4.1 Two separate runtimes

The system is **not** a single deployable unit. There are two independent pieces talking to the same Postgres database:

1. **The Next.js app** (this repo, deployed to Vercel) — everything staff and members interact with: the dashboard, registration, fees, reports, etc. Also exposes the ZKTeco-device-facing API routes (`src/app/api/attendance/*`, mirrored at `src/app/iclock/*` for firmware-default paths).
2. **`relay-service/`** — a **standalone Express app**, deployed separately on a plain Linux VM, *not* on Vercel. It re-implements the same four ZKTeco device endpoints (`/iclock/cdata`, `/iclock/getrequest`, `/iclock/devicecmd`, `/iclock/fdata`) as a parallel, independently-maintained copy, talking directly to Supabase with the service-role key.

**Why the relay exists:** Vercel's bot/DDoS protection presents a JavaScript-challenge page to requests coming from a cloud-datacenter IP — which is exactly what a ZKTeco biometric device's traffic looks like. The device can't solve a JS challenge, so its traffic must never touch Vercel. The relay VM sits outside that protection and talks to Supabase directly.

**Known drift risk:** the relay's `server.js` and the Next.js API routes under `src/app/api/attendance/` implement the *same* protocol logic independently. They are not shared code — a fix applied to one is not automatically applied to the other. This has been a real source of bugs (see §8). Any future ZKTeco/attendance logic change must be checked against both.

### 4.2 The relay VM in practice

Currently a GCP Compute Engine instance (`zkteco-relay`, project `project-5816d42b-d300-4225-a67`, zone `us-central1-a`), reached via a public IP + Let's Encrypt TLS behind nginx (reverse-proxying to the Node process on `127.0.0.1:3001`), and separately reachable for administration via SSH (either through GCP's IAP tunnel or a direct public-IP SSH connection, both currently viable). The relay process runs under systemd (`zkteco-relay.service`) with `Restart=on-failure`-style supervision. There is no CI/CD for the relay — deployment is manual (copy `server.js` to the VM, restart the service).

This VM is **not tied to Google Cloud** conceptually — it's a generic Node/Express app and could be moved to any VPS provider, a simpler PaaS (Railway/Render/Fly.io), or even a machine physically at the gym, if desired. See §8.4 for the operational incidents that have happened on it.

### 4.3 Auth & session model

Supabase Auth handles login (email/password). A separate `system_users` table holds the actual application-level user profile (name, role, status) — the app looks up the `system_users` row matching the authenticated user's email on every dashboard page load (`src/app/dashboard/layout.tsx`, a server component) and provides it to the client tree via `CurrentUserContext`. There is no Supabase RLS — every table is fully open at the database level, and all access control is enforced in application code (see §7).

---

## 5. Data model

Postgres via Supabase. **Hard rule for schema evolution** (enforced by convention, not by the database): never hard-delete rows (soft-delete via a `deleted_at` timestamp column, present on every table except three explicitly-immutable ones), never drop or rename columns (only add), always add new columns via a timestamped file in `supabase/migrations/`. These migrations are **not auto-applied** — they're written to the repo and then run manually by the developer in the Supabase SQL editor.

### Tables (13)

**`packages`** — the pricing/service catalog. `type` (Individual/Family/Couple/Daily), `duration_months`, `admission_fee`, `monthly_fee` (**nullable** — NULL specifically for Personal Training tiers, which use per-member negotiated pricing instead, stored on `members.training_fee`), `services_included TEXT[]`, `max_members`, `is_featured`, `color`, `status`.

**`staff_members`** — employee directory. `role` CHECK constraint: `Trainer | Receptionist | Manager | Nutritionist | Other | Software Developer | Designer | Freelancer`. `device_user_id` links a staff member to a ZKTeco device PIN for attendance.

**`system_users`** — login accounts, separate from staff profiles (an owner might not be a "staff member" in the payroll sense). `role`: `owner | manager | receptionist | trainer | viewer`.

**`submissions`** — the pending-approval queue for new member applications (from the public self-registration form or staff-entered pending records). Mirrors most of `members`' shape plus workflow fields (`status`: pending/approved/rejected, `rejection_reason`, `reviewed_by`, `reviewed_at`). `package_ids UUID[]` supports multiple packages per application.

**`members`** — the approved member roster; the most heavily-extended table. Core identity/contact/health/emergency fields (copied from the submission at approval time), plus:
- `package_id` (legacy single-package FK) and `package_ids UUID[]` (current multi-package model — always check both when reading a member's packages)
- `trainer_id`, `nutritionist_id`
- `joining_date` (original signup date, **immutable in the UI** — shown read-only in Edit Profile) vs. `membership_start_date` (added later — the start of the member's *current* billing cycle, independently editable, used for renewal/advance-payment logic) vs. `expiry_date` (current cycle end)
- `training_fee` — per-member negotiated PT price (only meaningful when the member has a PT package)
- `status`: `active | inactive | archived | frozen | pending_family_approval`
- `frozen_until`, `freeze_reason` — freezing does **not** currently adjust `expiry_date` (a known, unaddressed limitation — a frozen member's paid-through date keeps counting down while frozen)
- `services TEXT[]` — the member's live services list (distinct from a submission's frozen `services_interested` snapshot)
- `family_primary_member_id`, `family_relationship`, `family_notes`, `family_pricing_decision` (free/discounted/full), `family_pricing_note`, `family_approved_by/at` — family-membership sub-flow (see §6.7)
- `device_user_id` — ZKTeco PIN link (superseded in practice by the `device_enrollments` table for multi-device support, but still present)

**`fee_payments`** — every financial transaction. `amount`, `payment_type` (membership/trainer/admission/other — note `nutritionist`/`physiotherapy` are used in UI/logic but are **not** in the DB CHECK constraint; this is a live schema/code gap, worth confirming before relying on it), `payment_method` (Cash/Bank/Card/EasyPaisa/JazzCash), `payment_date`, `month_covered`, `months_covered` (NULL≈1; supports multi-month advance payments, see §6.4), `receipt_no` (shared across a split payment's multiple rows — **not unique**, by design), `collected_by`, `commission_staff_id/rate/amount`, `balance_due`/`balance_due_date` (partial-payment tracking), `package_breakdown JSONB` (per-package discount detail for registration payments).

**Critical convention:** when one logical payment is split across multiple payment methods (e.g. half Cash, half Bank), it produces **multiple rows sharing one `receipt_no`**. Only the *first* row of that group carries `balance_due`, `commission_*`, `package_breakdown`, and `months_covered` — every other row has those fields null/zero, so `SUM()`-ing any of them per member never double-counts one transaction. `countLogicalPayments()` in `src/lib/utils.ts` implements "count distinct transactions" as `new Set(rows.map(r => r.receipt_no ?? r.id)).size`. **Any new aggregate/report touching `fee_payments` must respect this convention.**

**`attendances`** — biometric punch records from ZKTeco devices. **Immutable — no `deleted_at` column, by design.** `punch_type`: in/out/unknown, toggled automatically based on the member's last punch.

**`unverified_attendances`** — a punch from a device `device_user_id` that doesn't match any enrolled member/staff. `resolved` boolean for staff to dismiss/identify later.

**`activity_logs`** — an audit trail. **Immutable, no `deleted_at`.** Every meaningful user action is supposed to insert a row here (`action`, `entity_type`, `entity_id`, human-readable `description`, `metadata JSONB`).

**`expenses`** — exists in the schema; **no dashboard UI page found for it** — likely backend-only or unbuilt still.

**`daily_members`** — walk-in/day-pass visitors, a lightweight parallel table to `members` for people who pay for a single day rather than a membership. Has a `converted_to_member_id` FK for the "became a real member" flow.

**`sms_log`** — exists in schema; the `/dashboard/sms` page is a literal `ComingSoon` placeholder. Not built.

**`devices`** — registered ZKTeco hardware (`serial_no` unique, `name`, `location`, `door_type`, `last_seen` heartbeat timestamp, `status`).

**`device_commands`** — an outbound command queue for pushing enrollments/deletions to a device (the device polls for these via `/iclock/getrequest`). `status`: pending/sent/acked/failed. **No `deleted_at`** — lifecycle is tracked via `status`, not soft-delete.

**`device_enrollments`** — the current model for "which member/staff is PIN X on device Y" (supports one person being enrolled with different PINs on different devices). Has `deleted_at`.

**`pt_commission_rates`** — **deprecated.** Superseded by `trainer_member_commissions`; left in the schema but unused by the app. Don't build against this table.

**`trainer_member_commissions`** — the current commission model: a trainer's commission rate *for a specific member*, either `commission_type: 'percent'` (with `commission_percent`) or `'fixed'` (flat `commission_amount` per qualifying payment period).

### A real gap worth knowing

`src/types/database.ts`'s typed Supabase client map only covers 11 of the 13 tables — `devices`, `device_commands`, `device_enrollments`, `pt_commission_rates`, and `trainer_member_commissions` are missing from it. Code touching those tables uses the untyped client path. Not a functional bug, but TypeScript won't catch typos on those tables' column names.

---

## 6. Core features & flows

### 6.1 Registration

Two entry points share one component (`src/components/forms/registration/`, a 4-step wizard: Personal → Health → Services/Packages/Payment → Review):
- **Public** (`/register`, `mode="public"`) — a prospective member fills this out themselves; it writes to `submissions` (pending), with restricted fields (no staff-only fields like assigning a trainer or setting a price).
- **Staff** (`/dashboard/register`, `mode="staff"`) — front-desk staff register a walk-in directly; full field access, and — critically — **collects the first payment and creates the `members` row directly**, bypassing the submissions queue (the comment in the code is explicit: this must *not* call the same expiry-extension logic used for renewals, since the member's `joining_date`/`expiry_date` are already correctly set from the registration form itself).

**Approval flow** (`/dashboard/submissions`): staff review a public submission and approve (creates the `members` row, generates a membership number) or reject (with a reason). **Note the RBAC gap documented in §7** — this page currently has no code-level role guard.

### 6.2 Member management

`/dashboard/members` (list, search/filter/sort, grid/list/compact views) → `/dashboard/members/[id]` (the member's full profile — the single largest page in the app). From the profile, staff can: edit personal/health info, manage package assignment (including the PT custom-pricing flow, §6.5), collect fees, freeze/unfreeze, archive, enroll on ZKTeco devices, upload a photo, and print the registration receipt.

### 6.3 Fee collection — the core financial flow

Fees are collected from **three places**, which share the `PaymentSplitRows` component but each have their own submit logic: the member profile's "Record Fee Payment" modal, the Fees dashboard's "Quick Collect" modal, and registration's initial payment. All support:
- **Split payment methods** — one logical payment divided across Cash/Bank/Card/EasyPaisa/JazzCash, producing multiple `fee_payments` rows sharing one `receipt_no` (see §5's convention).
- **Discounts** — none / percent / flat amount.
- **Partial payments** — collect less than the full amount now, track the remainder as `balance_due` + `balance_due_date`, settled later via a separate "Pay Balance" flow that does **not** re-trigger expiry extension (that already happened at the original partial payment).
- **Multi-month advance payments** — collect payment for 2+ future billing cycles in a single transaction (a "Number of Months" preset picker: 1/2/3/6/12 or custom). This correctly extends `expiry_date` by `duration_months × N`, and correctly handles the edge case where a member's *very first* payment is itself a multi-month advance (a real bug that existed and was fixed — see §8.3).

**Expiry-date math** (`extendExpiryDate()` in `src/lib/utils.ts`, the single source of truth): if the member's current `expiry_date` hasn't lapsed yet, the new cycle extends *from that date* (so paying early never costs the member remaining days). If it has lapsed, the new cycle starts from the payment date. A member's very first recurring payment is special-cased to not double-grant the cycle already implied by registration.

**Trainer commission** on a payment is computed at collection time and stored per-row (`commission_staff_id/rate/amount`), with a hard cap of **one qualifying payment counted per commission period** for PT members with a negotiated `training_fee` — this prevents a member paying via a split-method or an admin correction from being double-counted as two separate commissionable events (a real bug that was found and fixed, §8.2).

### 6.4 Attendance & ZKTeco integration

`/dashboard/attendance` shows live punch data, device online/offline status (a device is "online" if it heartbeated within the last 2 minutes), and lets staff resolve `unverified_attendances` (an unrecognized device PIN) by identifying the actual member. Devices are enrolled per-member/staff from their profile page, which queues a `device_commands` row that the physical device picks up on its next `/iclock/getrequest` poll.

The protocol itself (ADMS, ZKTeco's push protocol) is proprietary/reverse-engineered — there is no official spec. Key learned behaviors, encoded in both the relay and the Next.js API routes:
- A device heartbeats via `GET /iclock/cdata`; the correct response is a plain `"OK"` (an earlier version of this code sent a fabricated resync-trigger string here, which caused real problems — see §8.1).
- Attendance data arrives via `POST /iclock/cdata?table=ATTLOG`, a plain-text body with one line per punch (tab- or querystring-delimited: uid, timestamp, state, verify-method).
- In/out is inferred by toggling off the member's last recorded punch type (not sent explicitly by all firmware states).
- Commands (enroll/delete) are delivered via the device polling `GET /iclock/getrequest`, and acknowledged via `POST /iclock/devicecmd`.
- Device timestamps are PKT (UTC+5) local time; the app converts to UTC on ingest.

### 6.5 Staff & trainer commission

`/dashboard/staff` (directory) → `/dashboard/staff/[id]` (profile: details, assigned members if a trainer, per-member commission settings, device enrollment, attendance) → `/dashboard/staff/[id]/salary-slip` (printable monthly slip combining base salary + computed commissions for the period).

Personal Training pricing is fully custom per member (no catalog price) — negotiated at registration or later on the member's profile, alongside the assigned trainer and their commission rate for that specific member.

### 6.6 Packages

`/dashboard/packages` — full CRUD on the pricing catalog, including the PT-tier custom-pricing flag (which makes `monthly_fee` optional in the form and null in the database).

### 6.7 Family membership

A member can register "as a family member" of an existing primary member. Payment is still collected in full at registration; the member enters `pending_family_approval` status. `/dashboard/family-approvals` (owner/manager only) is where the actual pricing decision (free / discounted / full) gets recorded — this is a manual note, not an automated refund/credit system.

### 6.8 Daily members (walk-ins)

`/dashboard/daily-members` — a lightweight separate flow for single-day visitors, with its own fee collection and an explicit "convert to full member" action.

### 6.9 Reports

`/dashboard/reports` (owner/manager only) — Overview, Revenue, Membership, Attendance, Leads, Trainers, and Daily Summary tabs, with period presets and custom date ranges, Recharts visualizations, and print support. **All revenue reporting is cash-basis** (grouped by `payment_date`, the day money was actually collected) — a deliberate choice: an advance payment's full amount shows on the day it was collected, not spread across the months it covers.

### 6.10 Settings & user management

`/dashboard/settings` (owner only, both a server-side redirect and implied by nav visibility) — manage `system_users` accounts, roles, and view the activity log.

---

## 7. Roles & permissions — how it actually works (not just the intended matrix)

Roles: `owner`, `manager`, `receptionist`, `trainer`, `viewer`.

Enforcement is **layered and inconsistent in strength** — worth understanding precisely rather than assuming every page is equally protected:

1. **Real server-side enforcement** (can't be bypassed by manipulating the client): `src/app/api/admin/create-user` and `.../delete-user` check `role === "owner"` server-side with the service-role key. `/dashboard/settings` does a server-component redirect for non-owners.
2. **Client-side hard guard** (`useRoleGuard(allowedRoles)`, redirects to `/dashboard` after mount): only 5 pages use this — `packages`, `family-approvals`, `staff`, `staff/[id]/salary-slip`, `reports`.
3. **Sidebar nav-link visibility only** (no actual page-level block — a direct URL visit or old bookmark bypasses this entirely): every other page, including `submissions`, `attendance`, `fees`, `members`, `members/[id]`, `daily-members`, `register`, `staff/[id]`.
4. **Inline cosmetic gating**: a few pages (`fees`, `daily-members`, dashboard home) hide revenue *figures* from receptionists via `currentUser?.role === "receptionist"` checks, without hiding the page itself.

**Two confirmed discrepancies vs. the originally-documented permissions intent**, worth fixing or at least being aware of before building on top of this:
- **Submission approval has no role check at all** — any role that can navigate to `/dashboard/submissions` (which per nav visibility includes receptionist) can approve or reject a pending member, even though the intended design was owner/manager only.
- **Trainer commission editing** (on both the staff profile and member profile) does not appear to be role-gated distinctly from the rest of those pages — since `/dashboard/members/[id]` is nav-visible to receptionists and viewers, there's likely no code-level block on a receptionist reaching the commission-rate UI. This should be verified directly before relying on it either way.

---

## 8. Notable engineering history (context for *why* the code looks the way it does)

These aren't just changelog trivia — several of them explain non-obvious code choices that would otherwise look like over-engineering.

**8.1 — The ZKTeco duplicate-attendance flood and heartbeat bug.** A relay bug caused one device to resend its *entire* local attendance cache on every heartbeat (because the relay was sending a fabricated, protocol-nonstandard "resync" trigger in its heartbeat response instead of a plain `OK`), compounded by a dedup check that was itself broken by the flood it was supposed to prevent (it was scoped to `punch_type`, which toggled with every duplicate, letting roughly every other duplicate through). Net effect: one device's `attendances` table grew to 339,429 rows, ~337,000 of them duplicates, at a rate of tens of thousands of junk rows per day. Fixed by making the dedup check type-agnostic and replying `OK` to heartbeats. This is why the current dedup logic and heartbeat handling look the way they do — they're hardened against a real, observed failure mode, not speculative.

**8.2 — Commission double-counting.** A percent-of-training-fee commission formula counted every qualifying payment row in a period, which double-charged when a member had two real payment rows in one month (e.g. a split payment or a correction). Fixed by capping qualifying payments at 1 per period per member — this is why `calculateTrainerCommission()` has that specific cap baked in, and why any future commission-model change needs to preserve that invariant or deliberately reconsider it.

**8.3 — Advance-payment expiry math.** Before the multi-month advance-payment feature existed, `extendExpiryDate()`'s "this is the member's first-ever payment" branch simply returned the current expiry unchanged (correct for a normal first payment settling the cycle already granted at registration). Adding multi-month support required this branch to instead extend by the *extra* cycles beyond the first — otherwise a first payment that was itself a 2-month advance would silently lose a month. This is encoded in the current function; don't revert to the old 3-argument-only version.

**8.4 — The relay VM's disk filled to 100%, breaking SSH and the relay itself.** The Aug 15 duplicate-flood incident (§8.1) generated so much log volume (both `journald` and `rsyslog`, since the relay's own request logging is verbose) that the VM's 8.7GB root disk filled completely — which silently broke *new* SSH connections (the guest agent couldn't write `authorized_keys`) and left the relay in a degraded, periodically-crashing state for days without anyone noticing, because the one already-open SSH session kept working (established sessions don't need to write anything to stay connected) while masking that new ones were failing. Root-caused and fixed by: freeing disk (safe log truncation + `journalctl --vacuum-size`), tightening log rotation (daily + size-triggered instead of weekly, and adding rotation for a Google Cloud ops-agent log stream that had *none* configured), and installing a self-healing cron job that proactively frees space at 80% usage every 15 minutes, regardless of root cause. **Lesson embedded in the current setup:** disk usage is now actively guarded against, but this class of failure (a chatty service + no rotation + a monitoring blind spot) is a real risk pattern to watch for if any other logging-heavy service gets added to that VM.

**8.5 — Why attendance uploads used to time out and retry forever.** Separately from §8.1's data-volume issue, the relay's original `POST /iclock/cdata` handler processed each attendance line with several *sequential* Supabase round-trips (an enrollment lookup, a dedup check, a last-punch lookup, an insert — repeated per line). When a device needed to upload hundreds of lines in one request, this could take 1–2+ minutes, blowing past nginx's default 60-second proxy timeout — the device would never receive its "OK" acknowledgment in time, conclude the upload failed, and retry the identical batch, forever. This is why the handler now parses the whole request body up front and batches all its database reads/writes (one query per *distinct* thing needed, not one per line) — a full resend now completes in about a second regardless of line count. If you're extending this handler, preserve the batching; reverting to per-line queries will reintroduce this exact failure mode.

---

## 9. Not yet built (documented roadmap, from the project's own planning)

- **Mobile app** (Flutter) — not started.
- **SMS** (Telenor CCSMS) and **WhatsApp** (WATI/Meta API) — `/dashboard/sms` is a placeholder; no integration exists.
- **Payment gateways** (JazzCash/EasyPaisa online payment, as opposed to recording a cash/bank transaction manually) — not integrated.
- **POS / inventory system** — not started.
- **Multi-branch support, public marketing website** — not started.
- **AI features** (churn prediction, chatbot, smart reminders) — not started; the project's own docs note Claude API (Haiku for chatbot, Sonnet for reports) as the intended stack for this phase.
- **A staging environment** — currently one production Supabase project and one production Vercel deployment; no separate staging database or branch-based preview workflow exists yet, though the procedure for setting one up (a second Supabase project + migration replay, a `staging` git branch, per-branch Vercel env vars) has been planned but not executed. Note also that ZKTeco physical devices can only talk to the one production relay VM regardless.

---

## 10. Conventions to preserve if you're extending this codebase

- **Never hard-delete.** Set `deleted_at`. The three exceptions (`attendances`, `activity_logs`, `device_commands`) are intentional and documented in-schema.
- **Never drop or rename a column.** Add a new one; if truly superseding an old one, leave the old one in place and note it's deprecated (see `pt_commission_rates` for the pattern).
- **Every schema change is a new timestamped file in `supabase/migrations/`**, applied manually — there is no migration runner wired into deployment.
- **Monetary values** are `NUMERIC(10,2)` in PKR. **Timestamps** stored UTC, displayed in PKT (UTC+5). **Membership numbers** follow `LU[M|F]-YYYY-NNNN` (one shared sequence across genders, as of the most recent renumbering).
- Split-payment convention (§5/§6.3): one row per payment method sharing a `receipt_no`, first-row-only for `balance_due`/`commission_*`/`package_breakdown`/`months_covered`. Any new per-payment field should follow this same pattern rather than inventing a new one.
- If you touch anything ZKTeco/attendance-related, **check both `relay-service/server.js` and `src/app/api/attendance/*`** — they're independent copies of the same logic (§4.1).

---

*This document was generated by reviewing the live codebase and the accumulated engineering history of the project as of August 2026. It is a snapshot, not a live-synced spec — re-verify against the actual code for anything load-bearing.*
