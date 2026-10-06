# Level Up Fitness Club — Gym Management Software
## AI Agent Handoff Document

This document is a complete, self-contained snapshot of a production gym management web application, written for another AI coding assistant to read and immediately understand the system — what it does, how it's built, its data model, its business rules, and its known rough edges. It reflects the **actual current state of the codebase**, not an aspirational spec.

**Scale (as of 6 October 2026):** ~43,600 lines of TypeScript across 223 files, 86 API routes, 50 pages, 43 public database tables (21 of them `pos_*`), 105 migrations.

**Last revised 6 October 2026.** Changes since 19 September are in §8.10–§8.16 and §12. Where this document and the code disagree, the code wins.

---

## 1. What this is

A custom gym management system for **Level Up Fitness Club**, a gym at 3rd Floor, High Street Mall, Paragon City, Lahore, Pakistan. It replaces a legacy desktop product ("GymAutomate v8.3.5"). It handles the full lifecycle of running the gym's front desk and back office: member registration and approval, fee/payment collection (including split payments, discounts, partial payments, and multi-month advance payments), membership expiry tracking, biometric attendance and **automatic fee-based door access control** via ZKTeco fingerprint devices, staff and trainer commission management, package/pricing catalog, reporting, role-based staff accounts, and a full **cafe POS with inventory and vendor settlement**.

**Client:** Khalid Saeed (CEO). **Built by:** Faisal Munir (DesignnStudio), with Claude Code as the primary development tool.

**Status:** Live in production. Real staff use it daily. ~464 active members. Real ZKTeco hardware is deployed and controls physical door access.

---

## 2. Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Web framework | Next.js 16 (App Router, Turbopack) | TypeScript throughout |
| Database | Supabase (PostgreSQL) | RLS enabled on core tables; POS tables locked to service-role only — see §4.3 |
| Styling | Tailwind CSS v4 | Utility classes only, no CSS modules |
| Forms | React Hook Form + Zod | Registration flow; most other forms use plain `useState` |
| Charts | Recharts | Reports pages |
| Images | `sharp` | Server-side compression on every upload path |
| Toasts | `sonner` | |
| Hosting (main app) | Vercel | |
| Hosting (device relay) | A separate always-on Linux VM (GCP Compute Engine) | See §4.2 — NOT on Vercel, deliberately |
| Auth | Supabase Auth (email/password) | Identity keys on **email**, not `auth.uid()` — see §4.3 |
| Deployment | GitHub → Vercel auto-deploy on push to `main` | No staging. Migrations run **manually** in the Supabase SQL editor. **The relay VM is a separate manual deploy — pushing to `main` does not update it.** |

Planned-but-not-built (see §9): Flutter mobile app, Telenor CCSMS SMS, WATI/Meta WhatsApp, SendGrid email, Firebase FCM, JazzCash/EasyPaisa gateways, Claude API AI features.

---

## 3. Brand

```
Primary orange:   #F06418      Orange dark:   #C04E10
Orange light bg:  #FEF0E8      Orange mid:    #FDDCC8
Dark sidebar:     #1A1A1A      Border:        #E4E4DE
Text primary:     #1A1A16      Text secondary: #4A4A44      Text muted: #7A7A72
```
Typography: Barlow Condensed 800 for headings, Barlow 400/500/600 for body (Google Fonts). Design language: white background, dark sidebar, orange accents, flat design (no gradients/shadows beyond subtle borders). Professional, not playful.

---

## 4. Architecture

### 4.1 Two separate runtimes

The system is **not** a single deployable unit. Two independent pieces talk to the same Postgres database:

1. **The Next.js app** (this repo, Vercel) — everything staff and members interact with. Also exposes ZKTeco-device-facing API routes (`src/app/api/attendance/*`, rewritten from `/iclock/*` in `next.config.ts`). **In practice real devices never reach these** — they're a vestigial parallel copy.
2. **`relay-service/`** — a **standalone Express app** on a plain Linux VM, *not* on Vercel. It re-implements the same four ZKTeco device endpoints, talking directly to Supabase with the service-role key. **This is the path real devices actually use.**

**Why the relay exists:** Vercel's bot/DDoS protection presents a JavaScript challenge to requests from cloud-datacenter IPs — which is what ZKTeco device traffic looks like. The device can't solve it, so its traffic must never touch Vercel.

**Known drift risk:** the relay's `server.js` and `src/app/api/attendance/*` implement the same protocol independently. Not shared code — a fix to one is not applied to the other. This has caused real bugs (§8). Any ZKTeco change must be checked against both.

### 4.2 The relay VM in practice

GCP Compute Engine instance `zkteco-relay`, user `sitedes`, reached via IAP. nginx terminates TLS (Let's Encrypt) and reverse-proxies to the Node process on `127.0.0.1:3001`. Runs under systemd (`zkteco-relay.service`).

Three things about this box that are easy to get wrong and expensive to discover late:

- **It is not a git checkout.** Code lives at `/home/sitedes/relay-service/` as **copied files**. `git pull` fails there; `pm2` is not installed. Deploying a relay change means editing in place (back up, `node --check`, `sudo systemctl restart zkteco-relay`).
- **The device server address is derived from the VM's public IP.** `136.115.7.81` → `136-115-7-81.sslip.io`, which each terminal has typed into its Cloud Server Setting. There is no DNS record — the name *is* the IP. **Losing that IP silently takes all three doors offline** and requires physically retyping the address at each console.
- **`~/setup-zkteco-relay.sh` on the VM is obsolete and harmful** (renamed `.OBSOLETE-DO-NOT-RUN`). It predates the relay and configures nginx to proxy device traffic to Vercel. Use **`relay-service/provision-relay-vm.sh`** (in the repo) instead. That script has never been executed end-to-end — it is reasoned from the live config, not validated.

### 4.3 Auth, session & the database security model

Supabase Auth handles login. A separate `system_users` table holds the application-level profile (name, role, status). The app looks up the `system_users` row matching the authenticated user's **email** on every dashboard page load (`src/app/dashboard/layout.tsx`, a server component) and provides it via `CurrentUserContext`.

**Identity keys on email, not `auth.uid()` — deliberately.** One live account has a `system_users.id` that doesn't match its `auth.users.id`, and correcting it would cascade FK updates across ~10 tables. Anything switching to `auth.uid()` will silently fail for that account.

Database access control is **three-layered**, and the layers differ by table family:

1. **Core tables have RLS with policies** (19 tables: `members`, `fee_payments`, `attendances`, `devices`, `device_commands`, `staff_members`, `system_users`, `submissions`, `packages`, `expenses`, `daily_members`, `sms_log`, `activity_logs`, `staff_tasks`, `device_enrollments`, `unverified_attendances`, `pt_commission_rates`, `trainer_commission_ledger`, `trainer_member_commissions`). Policies call SQL helpers `current_role()`, `current_role_in(ARRAY[...])`, `current_system_user_id()`, `current_staff_id()`.
2. **All 22 `pos_*` tables have RLS enabled with NO policies**, plus all privileges revoked from `anon`/`authenticated`. They are reachable **only** via the service-role key from Next.js API routes. See §8.7 — this closed a severe live vulnerability.
3. **Application-level checks** in API routes — `requirePosUser()` (`src/lib/pos/auth.ts`) is the authoritative boundary for `/api/pos/*`; the middleware gate and UI helpers are convenience layers in front of it.

A `BEFORE UPDATE` trigger (`enforce_access_control_columns`) additionally blocks any `authenticated`-role client from writing `members.access_blocked_at` / `access_exempt*` directly.

---

## 5. Data model

Postgres via Supabase. **Hard rules** (convention, not DB-enforced): never hard-delete (soft-delete via `deleted_at`), never drop or rename columns (only add), every change is a timestamped file in `supabase/migrations/`. Migrations are **not auto-applied** — run manually in the Supabase SQL editor.

40 public tables across four domains.

### 5.1 Membership & finance (core)

**`packages`** — pricing/service catalog. `type` (Individual/Family/Couple/Daily), `duration_months`, `admission_fee`, `monthly_fee` (**nullable** — NULL for Personal Training tiers, which use per-member negotiated pricing on `members.training_fee`), `services_included TEXT[]`, `max_members`, `is_featured`, `color`, `status`.

**`staff_members`** — employee directory. `role` CHECK: `Trainer | Receptionist | Manager | Nutritionist | Other | Software Developer | Designer | Freelancer`. `device_user_id` links to a ZKTeco PIN (reserved range 5000+, never collides with member PINs).

**`system_users`** — login accounts, separate from staff profiles. `role`: `owner | manager | receptionist | trainer | viewer`.

**`submissions`** — pending-approval queue for new applications. Mirrors most of `members` plus workflow fields. `package_ids UUID[]`.

**`members`** — the approved roster; the most heavily-extended table.
- `package_id` (legacy single FK) **and** `package_ids UUID[]` (current multi-package model — always check both)
- `joining_date` (original signup, immutable in UI) vs `membership_start_date` (current billing cycle start, editable) vs `expiry_date` (current cycle end)
- `training_fee` — per-member negotiated PT price
- `status`: `active | inactive | archived | frozen | pending_family_approval`
- `frozen_until`, `freeze_reason` — **freezing does not adjust `expiry_date`** (known, unaddressed: a frozen member's paid-through date keeps counting down)
- `services TEXT[]`, family-membership fields, `device_user_id` (superseded by `device_enrollments`)
- `access_blocked_at`, `access_blocked_reason`, `access_exempt`, `access_exempt_reason/by/at` — door access control (§6.5)

**`fee_payments`** — every financial transaction. `amount`, `payment_type` (membership/trainer/admission/other — note `nutritionist`/`physiotherapy` appear in UI/logic but are **not** in the DB CHECK constraint; a live schema/code gap), `payment_method`, `payment_date`, `month_covered`, `months_covered` (NULL≈1), `receipt_no` (shared across a split payment's rows — **not unique**, by design), `collected_by`, `commission_staff_id/rate/amount`, `balance_due`/`balance_due_date`, `package_breakdown JSONB`.

> **Critical convention.** One logical payment split across methods produces **multiple rows sharing one `receipt_no`**. Only the *first* row carries `balance_due`, `commission_*`, `package_breakdown`, `months_covered` — all others null/zero, so `SUM()` never double-counts. `countLogicalPayments()` in `src/lib/utils.ts` counts distinct transactions as `new Set(rows.map(r => r.receipt_no ?? r.id)).size`. **Any new aggregate touching `fee_payments` must respect this.**

**`daily_members`** — walk-in/day-pass visitors. `converted_to_member_id` FK for the upgrade flow.

**`expenses`** — gym operating expenses (distinct from `pos_healthbox_expenses`).

**`activity_logs`** — audit trail. **Immutable, no `deleted_at`.** Every meaningful action should insert here.

**`staff_tasks`** — task assignment (`title`, `member_id`, `assigned_to`, `due_date`, `priority`).

### 5.2 Trainer commission

**`pt_commission_rates`** — **deprecated.** Superseded; unused. Don't build against it.

**`trainer_member_commissions`** — current model: a trainer's rate *for a specific member*, `commission_type: 'percent' | 'fixed'`.

**`trainer_commission_ledger`** — generated commission entries, **frozen at generation time** and never recalculated when a rate later changes.

### 5.3 ZKTeco devices

**`devices`** — registered hardware (`serial_no` unique, `name`, `location`, `door_type`, `last_seen`, `color`, `ip_address`). Three physical units: Female Reception `SYZ8252300065`, Female Zumba `SYZ8252300047`, Male Door `SYZ8252300043`.

**`device_enrollments`** — "which member/staff is PIN X on device Y". Supports different PINs per device. Has `deleted_at`.

> **The single most important thing to understand about this subsystem:** a PIN (`device_user_id`) is meaningful **only on the device that issued it**. The same number on two machines is regularly two different people. There is no global PIN namespace. A bulk script that assumed otherwise misattributed 11 real members' attendance and had to be fully reverted. **Never build cross-device PIN-matching automation.**

**`device_commands`** — outbound command queue. `status`: `pending → sent → acked` (or `failed`). **No `deleted_at`.** Two non-obvious properties:
- `command_id` is unique **per device only** — never order or paginate a cross-device query by it.
- A row stuck in `sent` is **dead** (nothing retries it) and its outcome is **unknown**, not "didn't happen" — a terminal can apply a command it never acknowledges. See §8.6.

**`attendances`** — biometric punches. **Immutable, no `deleted_at`.** `punch_type` in/out/unknown, toggled from the member's last punch.

**`unverified_attendances`** — a punch whose PIN matches no enrollment on that device.

### 5.4 POS / cafe / inventory (21 tables)

Built Sept 2026 (Phase 3). The gym has an on-site cafe with **two sellers in one basket**: the house (supplements, shakes, merch — 100% gym revenue) and a vendor ("HealthBox" — cafe food, commission-split). The POS splits a mixed basket at the **line level**, which drives most of the data model.

Constraints it was built to: touch monitor, **no physical keyboard** (on-screen keyboard + numeric keypad components), **no barcode scanner** (tap-to-select visual grid), **no printer** (digital receipts only).

- **Catalog:** `pos_departments`, `pos_categories`, `pos_products`, `pos_product_variants`, `pos_modifier_groups`, `pos_modifiers`, `pos_product_modifier_groups`
- **Sales:** `pos_orders`, `pos_order_items`, `pos_payments`, `pos_register_sessions`, `pos_approvals`
- **Inventory:** `pos_stock_movements`, `pos_stock_receipts`, `pos_stock_receipt_items`, `pos_stock_counts`, `pos_stock_count_items`, `pos_suppliers`
- **Vendor settlement:** `pos_healthbox_expenses`, `pos_settlements`
- **Config:** `pos_settings`

**Access (added 2026-09-29):** `system_users.pos_access` (boolean) and `system_users.pos_department_scope` (uuid[]). POS access is granted per user, never by role. See §7.

**Soft-delete rule for POS money (added 2026-10-05):** every money report and order read must filter `pos_orders.deleted_at IS NULL`. Before that date twelve POS reads did not, so a soft-deleted order stayed in every revenue total. `pos_payments` and `pos_order_items` have no `deleted_at` of their own and inherit it through their parent order. `pos_stock_movements` is deliberately immutable (no `deleted_at`) and is scoped by its product instead.

Money-moving operations are **Postgres functions, not application logic** — `pos_complete_order`, `pos_void_order`, `pos_refund_order`, `pos_open/close/review_session`, `pos_receive_stock`, `pos_adjust_stock`, `pos_apply_stock_count`, `pos_finalize_healthbox_settlement`, `pos_mark_settlement_paid`, `pos_next_order_no`, `pos_next_hold_ref`. This keeps atomicity in the database rather than across HTTP calls.

### 5.5 Typing gap

`src/types/database.ts`'s typed Supabase client map does not cover every table — device, commission and POS tables use the untyped path. Not a functional bug, but TypeScript won't catch column typos there. `src/types/pos.ts` covers POS separately.

---

## 6. Core features & flows

### 6.1 Registration
One 4-step wizard component (`src/components/forms/registration/`: Personal → Health → Services/Packages/Payment → Review), two entry points:
- **Public** (`/register`) — writes to `submissions` (pending), restricted fields.
- **Staff** (`/dashboard/register`) — full field access, **collects first payment and creates the `members` row directly**, bypassing the queue. Must *not* call the renewal expiry-extension logic — `joining_date`/`expiry_date` are already correct from the form.

Approval (`/dashboard/submissions`) creates the member and generates a membership number. Registration is idempotent via `register_member_with_payment` + `find_idempotent_registration_result`.

### 6.2 Member management
`/dashboard/members` (search/filter/sort, grid/list/compact) → `/dashboard/members/[id]` (largest page in the app): edit info, manage packages, collect fees, freeze/unfreeze, archive, enroll on devices, upload photo, print receipt.

### 6.3 Fee collection — the core financial flow
Three entry points share `PaymentSplitRows` but have separate submit logic: member profile modal, Fees "Quick Collect", and registration. All support:
- **Split payment methods** → multiple rows, one `receipt_no` (§5.1)
- **Discounts** — none / percent / flat
- **Partial payments** — `balance_due` + `balance_due_date`, settled later without re-triggering expiry extension
- **Multi-month advance** — 1/2/3/6/12 or custom, extends `expiry_date` by `duration_months × N`

**Expiry math** (`extendExpiryDate()` in `src/lib/utils.ts`, single source of truth): if the current `expiry_date` hasn't lapsed, the new cycle extends *from that date* (paying early never costs days). If lapsed, it starts from the payment date. A member's first recurring payment is special-cased not to double-grant the cycle implied by registration.

**Fee status** (`src/lib/feeStatus.ts`) is a separate concern from door blocking. It reports current-cycle dues and historical arrears independently, exempts GymAutomate legacy imports from false admission-fee debt, and uses `max(monthly_fee, training_fee)` since `monthly_fee` already includes training fee.

### 6.4 Attendance
`/dashboard/attendance` — live punches, device online/offline (online = heartbeat within 2 min), and resolving `unverified_attendances`. Resolving also creates the missing `device_enrollments` row, or the same punch recurs forever.

Protocol notes (ADMS, reverse-engineered, no official spec):
- Heartbeat `GET /iclock/cdata` → respond plain `"OK"` (a fabricated resync string here caused a real outage, §8.1)
- Attendance via `POST /iclock/cdata?table=ATTLOG`, plain text, one line per punch
- In/out inferred by toggling the last punch type
- Commands delivered via `GET /iclock/getrequest`, acked via `POST /iclock/devicecmd`
- Device timestamps are PKT (UTC+5); converted to UTC on ingest

### 6.5 Automatic fee-based door access control
Blocking is driven **only by `expiry_date`** (`shouldHaveDeviceAccess()` in `src/lib/utils.ts`) — never by "unpaid" signals, which produced 57 false positives out of 201 on real data. A member behind on fees whose membership hasn't lapsed is **not** blocked, deliberately.

- **Daily sweep** `GET /api/cron/access-sweep` at `0 3 * * *` UTC = **08:00 PKT**. Up to 20 new blocks per run, oldest-expiry first, remainder rolls over; **unblocks uncapped**. Processes **one member at a time** so a device never receives two commands at once (§8.6).
- **On payment** `POST /api/devices/sync-access` (fire-and-forget) restores access immediately. Falls back to what each door was last *told* when `access_blocked_at` is null.
- **Counter override** `POST /api/members/unblock-access` (owner/manager/**receptionist**) — one-time, does not exempt. Waits 35s; returns 202 (not 500) if unconfirmed, and deliberately does not clear the flag in that case.
- **Exemption** `POST /api/members/set-access-exemption` (owner/manager only) — permanent.

Mechanism: `DATA UPDATE USERINFO` with `Grp=2 TZ1=2` to block, `Grp=1 TZ1=0` to allow. Both fields are required — `TZ1` alone is silently ignored for users with "Apply Group Time Period" enabled.

**Health check: `npm run check:doors`** (`scripts/check-door-access.mjs`, read-only, exits non-zero on failure). Run it after any change here and whenever a member reports being wrongly let in or kept out. Every failure this subsystem has had was invisible from the app.

### 6.6 POS / cafe
`/pos` is the touch terminal (`PosTerminal.tsx` + ~18 components): department rail, product grid, modifier sheets, cart, split payments, held orders, member lookup, manager PIN pad for discounts/voids/refunds, session open/close with cash counting.

`/dashboard/pos/*` is the back office: orders, catalog (products/categories/departments/modifiers), inventory (receive, adjustments, counts, movements, alerts), suppliers, cash sessions, and reports (sales, daily, cashiers, payment methods, combined).

**HealthBox** (`/dashboard/pos/healthbox/*`) is the vendor side: expenses with an approval workflow, a vendor report, and settlement (preview → finalize → mark paid).

### 6.6a Expenses — bills, payments and carry-forward (owner only)
Added 2026-09-29, rebuilt as a bill/payment model on 2026-10-06 (`aa1f205`).

Owner only, enforced at four layers: sidebar `NAV_ROLES`, a server
`layout.tsx` guard, `requireStaff(EXPENSE_*_ROLES)` on every
`/api/expenses` route, and RLS admitting `owner` alone on all four tables.
Receipts live in a private `expense-receipts` bucket.

**An `expenses` row is a BILL, not a payment.** `expense_payments` holds each
dated payment against it. The invariant everything rests on:

> **Only payments move funds.** "Expenses paid" sums
> `expense_payments.amount` by `paid_on` — **never** `expenses.amount`.
> Summing both double-counts. A bill on its own reduces nothing.

The owner dashboard and the Revenue report were changed to read payments for
exactly this reason; left as they were they would have counted bills the gym
has not actually paid.

**Balances are derived, never stored.** Opening = previous month's closing;
closing = opening + income − paid. A back-dated entry, a correction or a void
therefore recalculates every later month with nothing to reconcile.
Carry-forward enters only through the opening balance, so it is never
mistaken for income. Income scope is unchanged from `src/lib/finance.ts` —
gym fees plus walk-ins, never POS.

**History is effective-dated**, because deriving balances alone does not
preserve it (`expense_amount_history` + `expense_amount_as_of()`):
* a **correction** restates every past month (effective from the bill date);
* a **revision** applies only from a stated date;
* a **void** counts from the day it happened, so voiding a bill in November
  does not erase it from September where it was genuinely owed.

Payment voids are the deliberate exception: they are **not** effective-dated,
because voiding a payment asserts the money never moved. It is a correction
of a mistaken entry, not a refund, and the UI says so.

**Writes are atomic Postgres functions, not application logic** — the same
principle the POS already follows:
* `update_expense_bill` — locks the bill, validates against payments, writes
  history, updates, audits. Any failure rolls back everything. The lock is
  taken first so a payment racing an edit cannot leave the bill overpaid.
* `record_expense_payment` — same lock; rejects overpayment; a
  `client_token` makes a retried or double-clicked submit idempotent.
* `void_expense_payment`, `expense_month_summary`, `expense_amount_as_of`.

All five are `SECURITY DEFINER` with EXECUTE revoked from `anon` and
`authenticated` — they are reachable only through the API routes.

**Back-dating is allowed and never silent.** Moving a bill or payment into a
previous month, or changing a bill's total, requires a reason, which is
recorded in `activity_logs`. There is no approval workflow and no month
locking — a deliberate choice, revisit it if the books ever need signing off.

**Starting balances are never assumed.** Until an owner sets `expense_settings`
the module reports "Not configured" rather than presenting zero as real cash.
As at deployment it is deliberately unset.

### 6.7 Staff & commission
`/dashboard/staff` → `/dashboard/staff/[id]` (details, assigned members, per-member commission, device enrollment, attendance) → `/salary-slip` (printable monthly slip: base salary + computed commissions). PT pricing is fully custom per member.

### 6.8 Other flows
- **Packages** `/dashboard/packages` — CRUD, including the PT custom-pricing flag.
- **Family membership** — register as family of a primary member; payment collected in full; status `pending_family_approval` until `/dashboard/family-approvals` (owner/manager) records free/discounted/full. A manual note, not an automated refund system.
- **Daily members** `/dashboard/daily-members` — walk-ins with convert-to-member.
- **Reports** `/dashboard/reports` (owner/manager) — Overview, Revenue, Membership, Attendance, Leads, Trainers, Daily Summary. **All revenue reporting is cash-basis** (grouped by `payment_date`) — an advance payment shows fully on the day collected, not spread across months covered.
- **Settings** `/dashboard/settings` (owner only) — user accounts, roles, activity log.
- **SMS** `/dashboard/sms` — a `ComingSoon` placeholder. Not built.

---

## 7. Roles & permissions — how it actually works

Roles: `owner`, `manager`, `receptionist`, `cashier`, `healthbox_staff`, `trainer`, `viewer`. (`cashier` and `healthbox_staff` were added for POS.)

**POS access is not a role grant.** A user can use the POS only if they are `owner`, or if `pos_access = true` AND they have at least one department in `pos_department_scope`. A role lists which POS screens exist for that role; it does not grant POS. Managers, receptionists and cashiers without an explicit grant see no POS at all. Non-owners are department-scoped inside the POS.

**Expenses are owner only** (§6.6a). Nothing else grants it.

Enforcement is **layered and uneven in strength**:

1. **Database (RLS)** — core tables have policies keyed on `current_role_in(...)`. POS tables are service-role-only. A trigger guards the access-control columns.
2. **Real server-side checks** — `requirePosUser()` for all `/api/pos/*`; `api/admin/create-user`/`delete-user` check `role === "owner"`; `/dashboard/settings` server-redirects non-owners; the access-control routes check roles server-side.
3. **Client-side hard guard** (`useRoleGuard`, redirects after mount) — only on `packages`, `family-approvals`, `staff`, `staff/[id]/salary-slip`, `reports`.
4. **Sidebar visibility only** (a direct URL bypasses it) — most other pages.
5. **Inline cosmetic gating** — some pages hide revenue *figures* from receptionists without hiding the page.

**Known discrepancies vs. the intended matrix** — worth fixing or at least knowing:
- **Submission approval has no code-level role check.** Any role that can reach `/dashboard/submissions` can approve/reject a member, though the intent was owner/manager only. RLS on `submissions` may or may not close this — **verify before relying on it either way**.
- **Trainer commission editing** on the member profile is not distinctly gated from the rest of that page, which is nav-visible to receptionists.

---

## 8. Notable engineering history

Not changelog trivia — these explain non-obvious code that would otherwise look like over-engineering.

**8.1 — ZKTeco duplicate-attendance flood.** A relay bug made one device resend its entire local cache on every heartbeat (the relay sent a fabricated "resync" trigger instead of plain `OK`), compounded by a dedup check scoped to `punch_type`, which toggled with every duplicate and let every other one through. One device's `attendances` grew to 339,429 rows, ~337,000 junk. Fixed by making dedup type-agnostic and replying `OK`.

**8.2 — Commission double-counting.** A percent-of-training-fee formula counted every qualifying payment row in a period, double-charging when a member had two rows in one month (split payment or correction). Capped at 1 qualifying payment per period per member. Preserve that invariant.

**8.3 — Advance-payment expiry math.** The "first-ever payment" branch of `extendExpiryDate()` returned expiry unchanged — correct for a normal first payment, but it silently lost a month when the first payment was itself a multi-month advance. Don't revert to the old 3-argument version.

**8.4 — Relay VM disk filled to 100%.** The §8.1 flood generated enough log volume to fill the 8.7GB root disk, which silently broke *new* SSH connections while the one open session kept working, masking it for days. Fixed with log truncation, tighter rotation, and a cron that frees space at 80% usage. **Risk pattern to watch: a chatty service + no rotation + a monitoring blind spot.**

**8.5 — Attendance upload timeouts.** The original `POST /iclock/cdata` did several sequential Supabase round-trips *per line*. A few hundred lines blew past nginx's 60s proxy timeout, so the device never got its OK and retried the same batch forever. Now the handler parses the whole body up front and batches queries. **Preserve the batching.**

**8.6 — Command batching: the cause of every "the block didn't work" symptom (2026-09-19).** The largest defect in the system; ran undetected 11 weeks.

`/iclock/getrequest` handed terminals up to 5 pending commands per response. **A terminal acknowledges only the first.** Since the handler marked the whole batch `sent` before responding, the rest were never re-offered. Measured across every command ever sent: single-command responses answered **1066/1067**; multi-command responses left **400 commands unanswered across 231 batches**, and in every batch the survivor was the lowest-numbered.

Two earlier theories this disproved, both of which cost real debugging time:
1. *"The terminals are overloaded by bursts."* False — they confirm in ~1.1s median and never dropped offline. Batch size was the only variable that mattered.
2. *"An unacknowledged command was discarded."* **False, and the dangerous one.** Unacked commands can still be applied. Seven paid-up members were being denied entry by blocks that were never acked, so nothing recorded them — and their payments couldn't reverse a block the system didn't know about. One (Ghulam Mustafa) was locked out 11 days while every screen showed him paid.

Fixes: `.limit(1)` in both relay and Next.js copies; `CHUNK_SIZE = 1` in the sweep; `sync-access` falls back to what a door was last *told*; `unblock-access` waits 35s and returns 202 not 500. Verified on hardware: two commands queued simultaneously were delivered 2s apart on separate polls and **both** acked.

**The durable lesson is the health check, not the fix.** Three variants of this failure were each reasoned about individually and each missed, because the reasoning kept encoding the failure already known. Asserting the *property* — "no paying member is blocked at any door" — catches the variant nobody has thought of yet. That's what `npm run check:doors` does, and it found two locked-out members on its first run.

**8.7 — POS tables were world-writable.** RLS was never enabled on any `pos_` table, and every one carried Supabase's default full grants to `anon` **and** `authenticated`. With RLS off, those grants were live: anyone with the public anon key (embedded in the client bundle) could read, write or DELETE every row of every POS table — orders, payments, expenses, settlements — with **no authentication whatsoever**, bypassing the app entirely. Fixed by revoking all privileges and enabling RLS with no policies as defense in depth. Nothing in the app queries `pos_` tables from the browser, so app behaviour was unchanged.

**8.8 — Cross-device PIN misattribution.** A bulk "resolve unidentified punches" script assumed PIN `X` on device A and device B were the same person. They regularly aren't. It misattributed 11 real members' attendance and would have exposed them to being blocked on devices they were never enrolled on. Fully reverted. **Do not rebuild this.**

**8.9 — Supabase Storage deletion incident.** An overly broad cleanup script deleted 45 real members' photos permanently by matching a filename/timestamp prefix. The bucket has no versioning or trash. **Every Storage deletion must target exact, individually-verified object paths** — never a prefix, timestamp, "most recent N" listing, or any heuristic match. See CLAUDE.md rule 11.

### 8.10 — Vercel image quota silently broke member photos (2026-10-05).
Vercel's Image Optimization allowance ran out. `next/image` returned HTTP 402 `OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED`, and `MemberAvatar` reports any image error as "photo file missing from storage" with a Re-upload button. The photos were fine; the message was false. Fixed by a custom loader (`src/lib/supabaseImageLoader.ts`) that serves resized images from Supabase Storage (`render/image`), so Next never proxies an image and there is no Vercel quota to exhaust. **Do not revert to the default loader.** The same fix requests a square `resize=cover`: a width-only request returned a 112×1024 strip and the browser's centre crop cut faces out. Each cached size fails separately, so one member can look fine in a list and broken on their profile.

### 8.11 — POS reports counted soft-deleted orders (2026-10-05).
Hiding a test order did not change any total, because twelve POS money reads never filtered `deleted_at`. The dashboard showed Rs −149,000 after test reversals. Fixed in `ec11509`. **Every new POS money query must filter `deleted_at IS NULL`.** Test data was removed by soft delete only, through the app's own refund/void mechanism, never by hard delete.

### 8.12 — Expenses and POS access (2026-09-29).
Owner-only expenses and per-user POS access shipped in `427a3db`. A live browser test found that `/dashboard/expenses` returned HTTP 200 with the full page to non-owners, because `useRoleGuard` is client-side and runs after the server has already rendered. The server layout guard is the real boundary. **Client-side guards are cosmetic.**

### 8.13 — Staff were using an old deployment link (2026-09-30).
Two owners reported missing tabs. Their accounts were correct; they were on an old `*.vercel.app` deployment. An old build still talks to the live production database, so it can show stale or wrong figures. **When someone reports "can't see X", ask which URL they opened before auditing roles or RLS.** Canonical URL: `https://app.levelupfitness.com.pk`. `levelup-gym-liard.vercel.app` remains allowed.

### 8.14 — Supabase Auth Site URL (2026-10-05).
Site URL moved to `https://app.levelupfitness.com.pk`, with the old Vercel URL still in the redirect allow-list. No password-reset flow exists yet, so this matters when one is added.

### 8.15 — Expense bills, payments and the legacy-write guard (2026-10-06).
The single-row model could not express a bill that is partly paid, or paid in
a later month than it was raised. Splitting it created two problems worth
remembering.

*Readers that summed the wrong thing.* Twelve POS money reads had already been
caught not filtering `deleted_at` (§8.11); the same class of bug appears here
in a different guise — any reader that sums `expenses.amount` now counts
money the gym has not paid. The owner dashboard and Revenue report were
migrated to `expense_payments` by `paid_on` in the same commit.

*The deploy window.* Migrations must land before the app, so for a period the
previous build is live against the new schema. Two guards close that:
`payments_managed` + an INSERT trigger gives any old-style insert a matching
full payment (reproducing what that row used to mean), and `write_marker` +
a BEFORE UPDATE trigger rejects any update that does not come from the current
build, with an instruction to refresh. Without the second, the old editor
could lower a total below what is already paid, move a bill away from its
payments, or void a bill that has them — the old void route never looked at
payments at all.

A third lesson: two migrations initially both defined `expense_month_summary`.
Re-running the earlier one silently reverted effective-dated history to "use
today's amount and today's deleted flag", quietly rewriting closed months.
Caught in staging. **One function, one definition, one file** — and migrations
in this set must be applied in filename order.

### 8.16 — pgsodium root key exposed and rotated (2026-10-06).
The project's pgsodium/Vault root encryption key was printed into a working
transcript while probing the Management API for the connection pooler
hostname. The `/v1/projects/{ref}/pgsodium` endpoint returns the key in
plaintext, which is easy to trip over when exploring that API.

Impact was assessed before acting, and was nil: `pgsodium` is **not
installed** (available, never created), `pgsodium.key` does not exist, there
are **zero** pgsodium security labels (so no encrypted columns),
`vault.secrets` is **empty**, and no application function or migration
references either. The only functions mentioning pgsodium are
`supabase_vault`'s own internals. Nothing in the database was protected by
that key, so there was no data to re-encrypt and no secret to lose.

**Rotated and verified the same day** via the documented method —
`PUT /v1/projects/{ref}/pgsodium` with a freshly generated 64-character hex
key. Verification compared the live value against the generated one in
memory and confirmed both that it matches the new key and that it differs
from the exposed one; neither value was printed or written to disk. Dependency
counts were re-checked before and after, and the app was health-checked
afterwards.

**The warning that makes this safe here and not in general:** after rotation,
anything encrypted under the previous key is permanently unrecoverable, and
Vault secrets must be re-encrypted *before* the old key goes away. That was
only acceptable because the dependent set was verified empty. Supabase is
deprecating pgsodium in favour of Vault, so this should stay a one-off.

---

## 9. Not yet built

- **Mobile app** (Flutter) — not started.
- **Member photos** — the 477 stored photos are not re-processed; the square crop is applied at display time.
- **SMS** (Telenor CCSMS) / **WhatsApp** (WATI/Meta) — `/dashboard/sms` is a placeholder.
- **Payment gateways** (JazzCash/EasyPaisa online collection) — not integrated; payments are recorded manually.
- **Multi-branch support, public marketing website** — not started.
- **AI features** (churn prediction, chatbot, smart reminders) — not started.
- **A staging environment** — a staging Supabase project (`tzlydyoltuiguufgbpgo`) exists and migrations were replayed there in September. Keep it separate from production and never copy real member data into it. ZKTeco devices can only talk to the one production relay regardless.
- **Automated tests** — none. Verification is manual plus `npm run check:doors` for the access subsystem.
- **A validated relay disaster-recovery run** — `provision-relay-vm.sh` exists and is reasoned from the live config, but has never been executed.

---

## 10. Conventions to preserve

- **Never hard-delete.** Set `deleted_at`. Intentional exceptions: `attendances`, `activity_logs`, `device_commands`.
- **Never drop or rename a column.** Add a new one; leave the old one and mark it deprecated (see `pt_commission_rates`).
- **Every schema change is a new timestamped file in `supabase/migrations/`**, applied manually. No migration runner in the deploy.
- **Money** is `NUMERIC(10,2)` PKR. **Timestamps** stored UTC, displayed PKT (UTC+5). **Membership numbers** are `LU[M|F]-YYYY-NNNN`, one shared sequence across genders.
- **Split-payment convention** (§5.1) — any new per-payment field follows first-row-only rather than inventing a new pattern.
- **ZKTeco changes must be applied to both** `relay-service/server.js` and `src/app/api/attendance/*`, and the relay needs a manual VM deploy.
- **Never hand a terminal more than one command per response.**
- **POS money operations belong in Postgres functions**, not application logic.
- **Every user action should insert an `activity_logs` row.**

---

## 11. Operational runbook

```bash
npm run dev                    # local
npm run build                  # verify before pushing
npx tsc --noEmit -p .          # typecheck
npm run check:doors            # door access health check (read-only)

# sweep, dry run (safe)
curl "https://levelup-gym-liard.vercel.app/api/cron/access-sweep?dryRun=true" \
  -H "Authorization: Bearer $CRON_SECRET"
```

**Relay VM** — `ssh` as `sitedes@zkteco-relay` (GCP IAP):
```bash
cd ~/relay-service
cp server.js server.js.bak-$(date +%F-%H%M)
# edit in place — it is NOT a git checkout
node --check server.js && sudo systemctl restart zkteco-relay
sudo journalctl -u zkteco-relay -n 30 --no-pager | grep -E "config|Sending"
```
Must read `commands per device poll: 1` and `Sending 1 command(s)`. **Any number above 1 means the §8.6 regression is back.**

### Backup and recovery posture (as at 6 October 2026)

**Automated backups and PITR are UNAVAILABLE.** The Supabase organisation is
on the **free plan**: point-in-time recovery is disabled and the API lists
zero restore points. There is no platform-side rollback for this database.
Treat every destructive operation accordingly, and read CLAUDE.md rule 11
before touching Storage.

**A manual encrypted backup was created and restore-tested on 2026-10-06**,
immediately before the expense migration:

* `pg_dump` / `pg_dumpall` 17.6 (matching the server exactly) producing
  roles, schema and data for the `public`, `auth` and `storage` schemas.
* Encrypted with AES-256-CBC (PBKDF2, 600k iterations), stored **outside the
  repository** in an access-restricted folder on the maintainer's machine,
  with its passphrase held separately. Never committed.
* **Restore-tested**, not merely written: loaded into a throwaway local
  PostgreSQL 17.6 cluster (loopback-only, non-standard port, no outbound
  integrations), which produced all 75 tables, 41 RLS policies and 14
  triggers with **zero data errors**, and reconciled against live production
  — the only differences were rows the gym created during the dump. The test
  cluster and its copy of the data were destroyed afterwards.

**Excluded from that backup — know these before relying on it:**

1. **Storage file contents.** The binaries live in S3, not Postgres. A
   `pg_dump` captures only the `storage.objects` metadata rows, so the
   ~477 member photos (~120 MB), expense receipts, POS product images and
   member documents are **not** in it.
2. **Project-level configuration** — API keys, JWT secret, Edge Functions,
   auth provider settings, scheduled jobs. None of it is in the database.
3. **Vault ciphertext**, which would not decrypt elsewhere.
4. **The relay VM**, which is a separate machine with its own deploy path.

It is a one-off snapshot, not a schedule. Repeat it before any risky change,
or move the project to a plan with automated backups.

**Accounts:** GitHub pushes require the `designnstudioz-commits` account. The active `gh` account drifts; check `gh auth status` before pushing. Vercel project `levelup-gym` under `designnstudioz-2623`. Production URL `https://app.levelupfitness.com.pk` (the `*.vercel.app` URL remains live). Supabase project ref `vravpfergmzparbqsgkk` (ap-southeast-1).

**Further reading in this repo:** `CLAUDE.md` (conventions, brand, schema rules), `ZKTECO_DEVICES.md` (the device subsystem in depth — 568 lines, the most detailed doc here), `docs/pos-plan.md` and `docs/phase3-*.md` (POS design and audits).

---

## 12. Changes since 19 September 2026

| Date | Commit | What |
|---|---|---|
| 29 Sep | `427a3db` | Owner-only Expense module; per-user POS access (`pos_access` + department scope) |
| 29 Sep | `3fe2450` | Sidebar: POS split out below Settings; reusable self-retiring NEW badge (Expenses until 6 Oct) |
| 5 Oct | `ec11509` | POS reports respect `deleted_at` |
| 5 Oct | `8a4cddb`, `9da1f18` | Member and product images served through Supabase render (square cover); Vercel image optimiser no longer used |
| 5 Oct | (database only) | POS test data soft-deleted: 10 test orders, 3 test register sessions, 4 test products. Nothing hard-deleted. |
| 6 Oct | `aa1f205` | **Expense bills/payments + carry-forward, deployed.** 4 migrations, 3 new tables (`expense_payments`, `expense_settings`, `expense_amount_history`), 5 new functions, 4 new API routes. Backfill: 20 eligible expenses → 20 payments, Rs 736,570.00, reconciled exactly. |

**Open items as of 6 October 2026:**
- Expense opening balances are deliberately **unconfigured** — awaiting the owner's starting month and figures.
- The old deployment link, if staff still use it, must be traced and retired.
- Vercel image quota: the app no longer uses it, but `/_next/image` still exists and returns 402.
- **No automated database backups or PITR** (free plan). A manual encrypted backup was created and restore-tested on 2026-10-06, but it is a one-off and excludes Storage file contents. See "Backup and recovery posture" in §11.
- ~~pgsodium root key exposure~~ — **resolved 2026-10-06**, see §8.16.

*Revised 5 October 2026 from the codebase at commit `9da1f18`. A snapshot, not a live-synced spec. Where this document says "verify before relying on it", that is a genuine open question.*
