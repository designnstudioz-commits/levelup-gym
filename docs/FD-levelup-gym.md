# Functional Document — Level Up Gym Management System

| Field | Value |
|-------|-------|
| **Document ID** | FD-LUF-GYM-001 |
| **Version** | 1.0 |
| **Date** | 8 September 2026 |
| **Prepared by** | Faisal Munir — DesignnStudio |
| **Client** | Khalid Saeed (CEO), Level Up Fitness Club, Paragon City, Lahore |
| **System status** | **Live in production.** Staff use it daily. |
| **Document type** | As-built functional specification |
| **Related documents** | `FD-LUF-POS-001` (Cafe POS), `CLAUDE.md`, `PROJECT_HANDOFF.md`, `ZKTECO_DEVICES.md` |

> **How to read this document.** This is an *as-built* FD: it describes what the system
> does **today**, not what was originally planned. Where a documented intention and the
> live behaviour differ, the live behaviour is recorded and the gap is flagged as
> **[GAP]**. Items never built are listed in §11, not silently omitted.

---

## 1. Purpose and scope

### 1.1 Purpose

Level Up Gym Management System is a custom web application that runs the front desk and
back office of Level Up Fitness Club. It replaces the legacy desktop product
**GymAutomate v8.3.5**.

### 1.2 In scope

Member lifecycle from enquiry to archive; fee collection and revenue tracking; package and
pricing catalogue; biometric attendance via ZKTeco fingerprint devices; automatic gym
access control based on payment status; staff records, trainer commissions and payroll
slips; walk-in day visitors; family memberships; reporting; and role-based staff accounts.

### 1.3 Out of scope (this document)

The cafe point-of-sale system, which is specified separately in **FD-LUF-POS-001**.

### 1.4 Operating context

| Item | Value |
|------|-------|
| Location | 3rd Floor, High Street Mall, Paragon City, Lahore |
| Currency | Pakistani Rupee (PKR), stored as `NUMERIC(10,2)` |
| Timezone | Stored UTC, displayed PKT (UTC+5) |
| Language | English |
| Concurrent staff users | Under 10 |
| Member base | Low hundreds, growing |
| Access | Desktop browser at the front desk; responsive, but desk-first |

---

## 2. Actors and roles

| Actor | Description |
|-------|-------------|
| **Owner** | Khalid Saeed. Full access including user management and settings. |
| **Manager** | Day-to-day operational authority. Everything except user management and system settings. |
| **Receptionist** | Front desk. Registers members, collects fees, views attendance. Revenue *figures* are hidden from this role in several places. |
| **Trainer** | Views attendance only. |
| **Viewer** | Read-only dashboard and member list. |
| **Prospective member** | Unauthenticated. Can complete the public registration form only. |
| **ZKTeco device** | Non-human actor. Pushes attendance punches and polls for enrolment commands over the ADMS protocol. |

Roles are stored on `system_users.role`. A `system_users` record is the *login account* and
is deliberately separate from `staff_members`, which is the *employment record* — the owner
has a login but is not on the payroll, and a trainer may be on the payroll with no login.

---

## 3. System context

### 3.1 Runtimes

The system is **two independently deployed pieces** sharing one PostgreSQL database.

| # | Component | Hosting | Responsibility |
|---|-----------|---------|----------------|
| 1 | **Next.js application** | Vercel | Everything staff and members interact with, plus a set of device-facing API routes |
| 2 | **`relay-service/`** | Standalone Linux VM (currently GCP Compute Engine), nginx + systemd | A parallel Express implementation of the four ZKTeco endpoints, talking to Supabase directly |

**Why the relay exists (FR-ARCH-01).** Vercel's bot protection serves a JavaScript
challenge to requests originating from datacentre IP ranges, which is what ZKTeco device
traffic resembles. A fingerprint terminal cannot solve a JS challenge. Device traffic must
therefore never reach Vercel, and the relay VM sits outside that protection.

> **[GAP] Duplicate protocol logic.** `relay-service/server.js` and
> `src/app/api/attendance/*` implement the same ADMS protocol independently and do **not**
> share code. A fix to one is not a fix to the other. This has caused real production
> incidents. Any change to attendance or device logic must be applied to both.

### 3.2 Technology

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16, App Router, TypeScript |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth, email/password |
| Styling | Tailwind CSS v4 |
| Forms | React Hook Form + Zod (registration); `useState` elsewhere |
| Charts | Recharts |
| Icons | Lucide |
| Notifications | Sonner (toasts) |
| Deployment | GitHub → Vercel on push to `main`. Migrations run **manually** in the Supabase SQL editor. |

---

## 4. Functional modules

### FR-AUTH — Authentication and session

| ID | Requirement |
|----|-------------|
| FR-AUTH-01 | Staff sign in at `/login` with email and password via Supabase Auth. |
| FR-AUTH-02 | On every dashboard page load, the server component looks up the `system_users` row matching the authenticated user's email (lowercased), where `status='active'` and `deleted_at IS NULL`. |
| FR-AUTH-03 | The resolved user (id, name, role, staff_id) is provided to the client tree via `CurrentUserContext`. |
| FR-AUTH-04 | A request with no authenticated user is redirected to `/login`. |
| FR-AUTH-05 | Sign-out clears the Supabase session and returns the user to `/login`. |

**Business rule BR-AUTH-01.** Identity is keyed on **email**, not `auth.uid()`. This is
deliberate: one live account has a `system_users.id` that does not match its `auth.users.id`,
and correcting it would cascade foreign-key updates across roughly ten tables. Every role
lookup in the application and in the RLS helper functions keys on email for this reason.

---

### FR-REG — Member registration

Two entry points share one four-step wizard component (Personal → Health →
Services/Packages/Payment → Review).

| ID | Requirement |
|----|-------------|
| FR-REG-01 | **Public registration** at `/register` is unauthenticated. A prospective member completes it themselves. |
| FR-REG-02 | A public registration writes a row to `submissions` with `status='pending'`. It does **not** create a member. |
| FR-REG-03 | Public mode hides all staff-only fields — trainer assignment, pricing, payment, joining/expiry dates. |
| FR-REG-04 | **Staff registration** at `/dashboard/register` gives full field access, collects the first payment, and creates the `members` row **directly**, bypassing the approval queue. |
| FR-REG-05 | Staff registration supports multiple packages per member (`package_ids UUID[]`). |
| FR-REG-06 | Personal Training packages have no catalogue price; staff enter a negotiated figure stored on `members.training_fee`. |
| FR-REG-07 | Registration supports "Register as Family Member", linking to an existing primary member (see FR-FAM). |
| FR-REG-08 | A member photo may be uploaded to the Supabase Storage bucket `member-photos`. |
| FR-REG-09 | On completion, a printable registration receipt is available at `/dashboard/register/receipt/[memberId]`. |

**Business rule BR-REG-01.** Staff registration must **not** invoke the expiry-extension
logic used for renewals. The member's `joining_date` and `expiry_date` are already set
correctly by the registration form itself; running the renewal maths would grant a second
cycle.

**Validation.** Full name and phone are mandatory. CNIC is validated as
`XXXXX-XXXXXXX-X` and stored as entered. Phone numbers are stored **as entered**, with no
normalisation.

---

### FR-SUB — Submission approval queue

| ID | Requirement |
|----|-------------|
| FR-SUB-01 | `/dashboard/submissions` lists pending public registrations. |
| FR-SUB-02 | The sidebar shows a live badge with the count of `status='pending'` submissions. |
| FR-SUB-03 | **Approve** creates a `members` row, copies the personal/health/contact fields, generates a membership number, and stamps `reviewed_by` and `reviewed_at`. |
| FR-SUB-04 | **Reject** sets `status='rejected'` and records a mandatory `rejection_reason`. |
| FR-SUB-05 | Staff may complete the official fields (package, trainer, dates, fees, payment method) before approving. |

> **[GAP] No role check on approval.** The intended permission is Owner/Manager only.
> In the live code this page has no server-side or client-side role guard, and the sidebar
> exposes it to receptionists. Any role that can reach the URL can approve or reject a
> membership application. **Recommended fix: add `useRoleGuard(["owner","manager"])` and a
> server-side check on the approve/reject API routes.**

---

### FR-MEM — Member management

| ID | Requirement |
|----|-------------|
| FR-MEM-01 | `/dashboard/members` lists members with three view modes: list, grid, compact. |
| FR-MEM-02 | Filters: status (all / active / inactive / frozen / archived / unpaid), gender, expiring-soon, newly-joined, and fee status (paid / pending). |
| FR-MEM-03 | Free-text search across name, membership number, and phone. Sortable columns. Paginated. |
| FR-MEM-04 | `/dashboard/members/[id]` is the full member profile and the largest screen in the system. |
| FR-MEM-05 | From the profile: edit personal and health details, manage package assignment, set PT pricing and trainer commission, collect fees, view payment history, freeze/unfreeze, archive, enrol on biometric devices, upload a photo, print receipts. |
| FR-MEM-06 | Membership number format is `LU[M\|F]-YYYY-NNNN` on a single shared sequence across genders. |
| FR-MEM-07 | Member status is one of `active`, `inactive`, `archived`, `frozen`, `pending_family_approval`. |
| FR-MEM-08 | `joining_date` (original signup) is read-only in the UI. `membership_start_date` (current billing cycle start) is separately editable. `expiry_date` is the current cycle end. |

**Business rule BR-MEM-01.** Packages are held in **two** columns: `package_id` (legacy,
single) and `package_ids UUID[]` (current, multiple). Any query reading a member's packages
must check both.

> **[GAP] Freezing does not adjust expiry.** A frozen member's `expiry_date` keeps counting
> down while they are frozen, so they lose paid days. Known and unaddressed.

> **[GAP] No page-level role guard.** The member list and profile are protected by sidebar
> visibility only. A direct URL or an old bookmark reaches them from any role, including
> `viewer` and `trainer` — which also exposes the trainer-commission controls on the profile.

---

### FR-PKG — Package catalogue

| ID | Requirement |
|----|-------------|
| FR-PKG-01 | `/dashboard/packages` provides full create / read / update / soft-delete on the pricing catalogue. Owner and Manager only, enforced by `useRoleGuard`. |
| FR-PKG-02 | A package carries name, type (Individual / Family / Couple / Daily), `duration_months`, `admission_fee`, `monthly_fee`, `services_included`, `max_members`, colour, featured flag and status. |
| FR-PKG-03 | Personal Training packages are flagged as custom-priced: `monthly_fee` becomes optional in the form and `NULL` in the database. |
| FR-PKG-04 | Every non-PT package requires a `monthly_fee`. Enforced in the UI, not by a database constraint. |

**Current catalogue.** Gym (Rs 7,500), Gym with Cardio (Rs 8,500), Hybrid Workout
(Rs 10,000), MMA (Rs 7,500), CrossFit (Rs 7,500), Table Tennis (Rs 3,500), Premium
(Rs 15,000). Admission fee Rs 15,000, flat across all packages.

---

### FR-FEE — Fee collection

The core financial flow. Fees are collected from **three** places that share the
`PaymentSplitRows` component but each carry their own submit logic: the member profile's
"Record Fee Payment" modal, the Fees dashboard's "Quick Collect" modal, and registration's
initial payment.

| ID | Requirement |
|----|-------------|
| FR-FEE-01 | `/dashboard/fees` presents five tabs: Overview, Transactions, Outstanding, Renewals, Analytics. |
| FR-FEE-02 | **Split payment.** One logical payment may be divided across Cash / Bank / Card / EasyPaisa / JazzCash. |
| FR-FEE-03 | **Discounts.** None, percentage, or flat amount. |
| FR-FEE-04 | **Partial payment.** Collect less than due now; the remainder is tracked as `balance_due` with a `balance_due_date`, settled later through a separate "Pay Balance" flow. |
| FR-FEE-05 | **Multi-month advance.** Collect 1 / 2 / 3 / 6 / 12 cycles (or custom) in one transaction, extending `expiry_date` by `duration_months × N`. |
| FR-FEE-06 | Payment types: `membership`, `trainer`, `admission`, `other`. |
| FR-FEE-07 | A printable receipt is available at `/dashboard/fees/receipt/[id]`. |
| FR-FEE-08 | Trainer commission is computed at collection time and stored on the payment row. |

**Business rule BR-FEE-01 — the split-payment convention.** A payment split across methods
produces **multiple `fee_payments` rows sharing one `receipt_no`**. Only the **first** row
of the group carries `balance_due`, `balance_due_date`, `commission_*`, `months_covered`
and `package_breakdown`; every other row has them null or zero. This means `SUM()` over any
of those columns never double-counts a transaction. `receipt_no` is deliberately **not**
unique. Counting distinct transactions is `new Set(rows.map(r => r.receipt_no ?? r.id)).size`.
**Any new aggregate or report touching `fee_payments` must respect this.**

**Business rule BR-FEE-02 — expiry maths.** `extendExpiryDate()` in `src/lib/utils.ts` is
the single source of truth. If the current `expiry_date` has not yet lapsed, the new cycle
extends *from that date*, so paying early never costs the member remaining days. If it has
lapsed, the new cycle starts from the payment date. A member's very first recurring payment
is special-cased so it does not double-grant the cycle already implied by registration —
except where that first payment is itself a multi-month advance, in which case only the
*extra* cycles are added.

**Business rule BR-FEE-03 — revenue is cash-basis.** All revenue reporting groups by
`payment_date`, the day money was actually collected. A twelve-month advance shows in full
on the day it was taken, not spread across the months it covers. This is deliberate.

> **[GAP] Payment-type constraint drift.** `nutritionist` and `physiotherapy` are used in
> application logic but are **not** in the `payment_type` CHECK constraint. Confirm before
> relying on them.

---

### FR-COM — Trainer commissions

| ID | Requirement |
|----|-------------|
| FR-COM-01 | Commission is configured **per trainer, per member** in `trainer_member_commissions`. |
| FR-COM-02 | Two models: `percent` (of the member's training fee) or `fixed` (a flat amount per qualifying period). |
| FR-COM-03 | `/dashboard/commissions` (Owner/Manager, guarded) shows the commission ledger by cycle, with trainer filter, cycle stepping, and a backfill action. |
| FR-COM-04 | Earned commission is written to `trainer_commission_ledger` and marked paid on payout. |
| FR-COM-05 | Commission-eligible payment types are `membership` and `trainer`. |

**Business rule BR-COM-01 — one qualifying payment per period.** For a PT member with a
negotiated `training_fee`, at most **one** payment per commission period counts. Without
this cap, a split payment or an administrative correction produces two `fee_payments` rows
in one month and the trainer is paid twice. This cap is load-bearing; any change to the
commission model must preserve it or deliberately reconsider it.

> **Deprecated.** `pt_commission_rates` is superseded by `trainer_member_commissions`. It
> remains in the schema per the never-drop rule but is unused. Do not build against it.

---

### FR-STF — Staff and payroll

| ID | Requirement |
|----|-------------|
| FR-STF-01 | `/dashboard/staff` is the employee directory. Owner/Manager, guarded. |
| FR-STF-02 | `/dashboard/staff/[id]` shows details, assigned members (for trainers), per-member commission settings, device enrolment and attendance. |
| FR-STF-03 | `/dashboard/staff/[id]/salary-slip` produces a printable monthly slip combining base salary and computed commissions for the period. Guarded. |
| FR-STF-04 | Staff roles: Trainer, Receptionist, Manager, Nutritionist, Other, Software Developer, Designer, Freelancer. |
| FR-STF-05 | `staff_members.device_user_id` links a staff member to a ZKTeco PIN for their own attendance. |
| FR-STF-06 | `staff_tasks` supports task assignment to staff. |

---

### FR-FAM — Family membership

| ID | Requirement |
|----|-------------|
| FR-FAM-01 | A member may be registered as a family member of an existing primary member, capturing relationship and notes. |
| FR-FAM-02 | Payment is collected **in full** at registration regardless of the eventual family pricing decision. |
| FR-FAM-03 | The new member enters `status='pending_family_approval'`. |
| FR-FAM-04 | `/dashboard/family-approvals` (Owner/Manager, guarded) is where the pricing decision — `free`, `discounted` or `full` — is recorded with a note, an approver and a timestamp. |

**Business rule BR-FAM-01.** The pricing decision is a **recorded note only**. There is no
refund, credit or ledger mechanism behind it. Any money owed back is handled outside the
system.

---

### FR-DAY — Daily members (walk-ins)

| ID | Requirement |
|----|-------------|
| FR-DAY-01 | `/dashboard/daily-members` records single-day visitors in a lightweight table separate from `members`. |
| FR-DAY-02 | Captures name, phone, gender, age, purpose (Day Pass / Trial / Guest of Member / Enquiry / Event / Other), fee paid, payment method and notes. |
| FR-DAY-03 | Date-range filters: today, yesterday, this week, this month, custom. |
| FR-DAY-04 | An explicit **Convert to Member** action creates a full `members` row and sets `converted_to_member_id`. |
| FR-DAY-05 | Revenue figures on this page are hidden from the `receptionist` role. |

---

### FR-ATT — Attendance and biometric devices

| ID | Requirement |
|----|-------------|
| FR-ATT-01 | `/dashboard/attendance` shows live punch records with date, member/staff, device and punch type, filterable by in/out. |
| FR-ATT-02 | Device online/offline status is shown; a device is **online** if it heartbeated within the last **2 minutes**. |
| FR-ATT-03 | An offline device raises a persistent banner across the dashboard. |
| FR-ATT-04 | A punch from an unrecognised PIN is written to `unverified_attendances`; staff resolve it by identifying the member. |
| FR-ATT-05 | Members and staff are enrolled on a device from their profile, which queues a `device_commands` row. |
| FR-ATT-06 | `device_enrollments` supports one person holding different PINs on different devices. |

**Protocol requirements (ADMS — proprietary, reverse-engineered; no official specification).**

| ID | Requirement |
|----|-------------|
| FR-ATT-07 | A device heartbeats via `GET /iclock/cdata`. The correct response is a plain `"OK"` and nothing else. |
| FR-ATT-08 | Attendance arrives via `POST /iclock/cdata?table=ATTLOG` as plain text, one line per punch (tab- or querystring-delimited: uid, timestamp, state, verify method). |
| FR-ATT-09 | In/out is **inferred** by toggling off the person's last recorded punch type, because not all firmware states send it explicitly. |
| FR-ATT-10 | Commands are collected by the device polling `GET /iclock/getrequest` and acknowledged via `POST /iclock/devicecmd`. |
| FR-ATT-11 | Device timestamps are PKT (UTC+5) local; the ingest converts to UTC. |
| FR-ATT-12 | The handler must parse the whole request body up front and **batch** its database reads and writes — one query per distinct thing needed, never one per line. |
| FR-ATT-13 | `command_id` generation must use `MAX+1`, never `count(*)+1`. |

**Business rule BR-ATT-01.** `attendances` is **immutable** — no `deleted_at`, no edits.
Deduplication is **type-agnostic**: it must not be scoped on `punch_type`, because that
field toggles with every duplicate and a type-scoped check lets roughly every other
duplicate through.

> **Historical context for FR-ATT-07 and FR-ATT-12.** A heartbeat that returned a
> fabricated resync trigger instead of `"OK"` caused one device to resend its entire local
> cache on every beat, growing `attendances` to 339,429 rows of which ~337,000 were
> duplicates. Separately, per-line database round-trips caused uploads to exceed nginx's
> 60-second proxy timeout, so the device never received its acknowledgement and retried the
> same batch forever. Both requirements are hardening against observed failures, not
> speculation.

---

### FR-ACC — Gym access control

| ID | Requirement |
|----|-------------|
| FR-ACC-01 | A member who is delinquent on fees is automatically **blocked** at the biometric door. |
| FR-ACC-02 | Blocking sets both the device Time Zone and the Access Group. Setting Time Zone 1 alone is insufficient. |
| FR-ACC-03 | A block or unblock is treated as successful **only** after the device acknowledges the command. |
| FR-ACC-04 | Individual members may be granted an access exemption (`/api/members/set-access-exemption`). |
| FR-ACC-05 | A one-time manual unblock is available (`/api/members/unblock-access`). |
| FR-ACC-06 | A scheduled sweep (`/api/cron/access-sweep`) reconciles payment status against device access. |
| FR-ACC-07 | The member list carries an **Unpaid** tab and blocked / exempt badges. |

---

### FR-RPT — Reporting

| ID | Requirement |
|----|-------------|
| FR-RPT-01 | `/dashboard/reports` is Owner/Manager only, enforced by `useRoleGuard`. |
| FR-RPT-02 | Seven report types: Overview, Revenue, Membership, Attendance, Submissions/Leads, Trainers, Daily Summary. |
| FR-RPT-03 | Period presets plus a custom date range. |
| FR-RPT-04 | Recharts visualisations with print support. |
| FR-RPT-05 | All revenue reporting is cash-basis per BR-FEE-03. |

---

### FR-SET — Settings, users and audit

| ID | Requirement |
|----|-------------|
| FR-SET-01 | `/dashboard/settings` is **Owner only**, enforced by a server-component redirect — the strongest guard in the system. |
| FR-SET-02 | Three tabs: Users, Permissions, Logs. |
| FR-SET-03 | Create, edit and deactivate `system_users` accounts, optionally linked to a `staff_members` record. |
| FR-SET-04 | User creation and deletion run through API routes that verify `role === 'owner'` server-side using the service-role key. |
| FR-SET-05 | The Logs tab displays `activity_logs`. |

**Business rule BR-SET-01.** Every meaningful user action should insert an `activity_logs`
row carrying `action`, `entity_type`, `entity_id`, a human-readable `description` and
optional `metadata`. `activity_logs` is **immutable** — no `deleted_at`.

---

### FR-SMS — Messaging

> **NOT BUILT.** `/dashboard/sms` is a 17-line `ComingSoon` placeholder. The `sms_log`
> table exists with statuses `prepared / queued / sent / failed`, but no gateway is
> integrated. Telenor CCSMS (SMS) and WATI / Meta (WhatsApp) are the intended providers.

---

## 5. Data entities

Nineteen tables. Monetary values are `NUMERIC(10,2)` PKR; timestamps are `TIMESTAMPTZ` UTC.

| Table | Purpose | Soft delete |
|-------|---------|-------------|
| `system_users` | Login accounts and roles | Yes |
| `staff_members` | Employment records | Yes |
| `staff_tasks` | Task assignment | Yes |
| `submissions` | Pending membership applications | Yes |
| `members` | Approved member roster — the most extended table | Yes |
| `packages` | Pricing and service catalogue | Yes |
| `fee_payments` | Every financial transaction | Yes |
| `trainer_member_commissions` | Commission rate per trainer per member | Yes |
| `trainer_commission_ledger` | Earned and paid commission by cycle | Yes |
| `pt_commission_rates` | **Deprecated** — superseded, unused | Yes |
| `daily_members` | Walk-in day visitors | Yes |
| `expenses` | Expense records | Yes |
| `sms_log` | Message log — table only, no integration | — |
| `devices` | Registered ZKTeco hardware | Yes |
| `device_enrollments` | Person ↔ PIN ↔ device mapping | Yes |
| `device_commands` | Outbound command queue | **No** — lifecycle via `status` |
| `attendances` | Biometric punches | **No** — immutable |
| `unverified_attendances` | Punches from unknown PINs | Yes |
| `activity_logs` | Audit trail | **No** — immutable |

### 5.1 Schema evolution rules (mandatory)

| ID | Rule |
|----|------|
| BR-DATA-01 | **Never hard-delete.** Set `deleted_at`. Three tables are deliberate exceptions, documented in-schema. |
| BR-DATA-02 | **Never drop a column.** Add a new one; mark the old deprecated. |
| BR-DATA-03 | **Never rename a column.** Add, migrate, deprecate. |
| BR-DATA-04 | **Never remove an enum or CHECK value.** Only add. |
| BR-DATA-05 | Every schema change is a new timestamped file in `supabase/migrations/`, applied **manually** in the Supabase SQL editor. There is no migration runner in the deployment pipeline. |
| BR-DATA-06 | Every query must filter `WHERE deleted_at IS NULL`. |

> **[GAP] Incomplete type coverage.** `src/types/database.ts` covers 11 of the 19 tables.
> `devices`, `device_commands`, `device_enrollments`, `pt_commission_rates` and
> `trainer_member_commissions` are missing, so code touching them uses the untyped client
> and TypeScript will not catch column-name typos.

> **[GAP] Supabase default row limit.** Queries returning more than 1,000 rows are silently
> truncated. `fetchAllRows<T>()` in `src/lib/utils.ts` exists for this; aggregate queries
> must use it.

---

## 6. Permissions

### 6.1 Intended matrix

| Permission | Owner | Manager | Receptionist | Trainer | Viewer |
|-----------|:-----:|:-------:|:------------:|:-------:|:------:|
| View dashboard | ✓ | ✓ | ✓ | ✗ | ✓ |
| Add members | ✓ | ✓ | ✓ | ✗ | ✗ |
| Approve submissions | ✓ | ✓ | ✗ | ✗ | ✗ |
| Approve family members | ✓ | ✓ | ✗ | ✗ | ✗ |
| Set trainer commission | ✓ | ✓ | ✗ | ✗ | ✗ |
| Collect fees | ✓ | ✓ | ✓ | ✗ | ✗ |
| View reports | ✓ | ✓ | ✗ | ✗ | ✗ |
| Edit packages | ✓ | ✓ | ✗ | ✗ | ✗ |
| Send SMS | ✓ | ✓ | ✓ | ✗ | ✗ |
| View attendance | ✓ | ✓ | ✓ | ✓ | ✗ |
| Manage users | ✓ | ✗ | ✗ | ✗ | ✗ |
| System settings | ✓ | ✗ | ✗ | ✗ | ✗ |
| Delete/archive members | ✓ | ✓ | ✗ | ✗ | ✗ |

### 6.2 Enforcement as built — four tiers of strength

| Tier | Mechanism | Where it is used |
|------|-----------|------------------|
| 1 — **Strong** | Server-side check, cannot be bypassed | `/api/admin/create-user`, `/api/admin/delete-user`, `/dashboard/settings` |
| 2 — **Client guard** | `useRoleGuard()`, redirects after mount | `packages`, `family-approvals`, `staff`, `staff/[id]/salary-slip`, `reports`, `commissions` |
| 3 — **Nav visibility only** | Sidebar hides the link; **a direct URL still works** | `submissions`, `attendance`, `fees`, `members`, `members/[id]`, `daily-members`, `register`, `staff/[id]` |
| 4 — **Cosmetic** | Figures hidden inline, page still reachable | Revenue on `fees`, `daily-members`, dashboard home for `receptionist` |

> **[GAP] Row Level Security is not enabled.** RLS is disabled on every table; the public
> anon key can read and write everything. Twenty migration files implementing full RLS were
> authored on 25 August 2026 (`supabase/migrations/20260825*`) and are **staged in the repo
> but not applied**. They build on three `SECURITY DEFINER` helper functions —
> `current_system_user_id()`, `current_role()`, `current_staff_id()` — plus the
> `current_role_in(text[])` wrapper. **This is the single largest security item outstanding.**

> **[GAP] `canAccess()` fails open.** In `src/components/layout/Sidebar.tsx`, a route not
> listed in `NAV_ROLES` returns `true` for every role. New routes must be added explicitly
> or they are visible to everyone.

---

## 7. Integrations

| Integration | Status | Notes |
|-------------|--------|-------|
| **ZKTeco biometric terminals** | **Live** | Three devices via the relay VM. ADMS protocol. See FR-ATT. |
| **Supabase Storage** | **Live** | `member-photos` bucket; document upload route exists. |
| Telenor CCSMS (SMS) | Not built | ~Rs 2/SMS |
| WATI / Meta (WhatsApp) | Not built | ~$49/month |
| SendGrid (email) | Not built | |
| Firebase FCM (push) | Not built | |
| JazzCash / EasyPaisa (online payment) | Not built | Recorded manually today; 1.5–2.5% per transaction when integrated |
| Claude API (AI features) | Not built | |

---

## 8. Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR-01 | Monetary values are `NUMERIC(10,2)` in PKR and displayed via `formatPKR()` as `Rs 1,500`. |
| NFR-02 | Timestamps are stored UTC and displayed PKT (UTC+5). |
| NFR-03 | Dates display as `dd MMM yyyy`. |
| NFR-04 | Brand: orange `#F06418`, dark `#1A1A1A`, border `#E4E4DE`, white ground. Barlow Condensed 800 headings, Barlow 400/500/600 body. Flat — no gradients, no shadows beyond subtle card borders. |
| NFR-05 | Every printable view (receipts, salary slips) must exclude the sidebar and banners via the global `.no-print` rule. |
| NFR-06 | Number inputs have spin arrows suppressed application-wide, and a wheel guard prevents scroll from silently changing a focused price field. |
| NFR-07 | The device-facing ingest must complete a full batch upload in roughly one second regardless of line count, to stay inside the 60-second nginx proxy timeout. |
| NFR-08 | The relay VM guards against disk exhaustion: daily plus size-triggered log rotation, and a cron job that frees space at 80% usage every 15 minutes. |

> **Historical context for NFR-08.** Log volume from the duplicate-attendance incident
> filled the VM's 8.7 GB root disk, which silently broke *new* SSH connections while one
> already-open session kept working and masked the failure for days.

---

## 9. Cross-cutting business rules — summary

| ID | Rule |
|----|------|
| BR-FEE-01 | Split payments: multiple rows, one `receipt_no`, first-row-only fields |
| BR-FEE-02 | Expiry extends from the unlapsed expiry date, not the payment date |
| BR-FEE-03 | Revenue is cash-basis, grouped by `payment_date` |
| BR-COM-01 | At most one qualifying payment per commission period per member |
| BR-ATT-01 | Attendance is immutable; deduplication is type-agnostic |
| BR-MEM-01 | Member packages live in both `package_id` and `package_ids` |
| BR-FAM-01 | Family pricing decisions are notes, not refunds |
| BR-DATA-01…06 | Soft delete, additive-only schema, manual migrations |
| BR-AUTH-01 | Identity keys on email, not `auth.uid()` |

---

## 10. Known gaps register

| # | Gap | Severity | Reference |
|---|-----|----------|-----------|
| G-01 | **RLS disabled**; anon key has full read/write. 20 migrations staged, not applied | **Critical** | §6.2 |
| G-02 | Submission approval has no role check of any kind | **High** | FR-SUB |
| G-03 | Most pages protected by nav visibility only; direct URL bypasses | **High** | §6.2 |
| G-04 | Trainer-commission controls reachable by receptionist/viewer via the member profile | **High** | FR-MEM |
| G-05 | Relay and Next.js routes duplicate ADMS logic with no shared code | Medium | §3.1 |
| G-06 | `canAccess()` fails open for unlisted routes | Medium | §6.2 |
| G-07 | Freezing a member does not pause `expiry_date` | Medium | FR-MEM |
| G-08 | `payment_type` CHECK omits `nutritionist` and `physiotherapy` | Medium | FR-FEE |
| G-09 | `database.ts` types cover 11 of 19 tables | Low | §5 |
| G-10 | No staging environment; one production Supabase project and one Vercel deployment | Medium | §3.2 |
| G-11 | No automated migration runner — migrations applied by hand | Medium | BR-DATA-05 |

---

## 11. Not built

Documented roadmap items with no implementation:

- SMS (Telenor CCSMS) and WhatsApp (WATI / Meta) — `/dashboard/sms` is a placeholder
- Online payment gateways (JazzCash / EasyPaisa)
- Automated fee reminders
- Expenses dashboard UI — the `expenses` table exists, no screen does
- Flutter mobile app (member profile, digital card, in-app payment, class booking, push)
- Public marketing website and online enquiry
- Multi-branch support
- AI features — churn prediction, chatbot, smart reminders, weekly insight reports
- Cafe POS — **specified separately in FD-LUF-POS-001**

---

## 12. Assumptions and constraints

| ID | Item |
|----|------|
| A-01 | Single branch. No multi-tenancy in the data model. |
| A-02 | English only. No localisation layer. |
| A-03 | Phone numbers are stored exactly as entered, with no normalisation. Deduplication by phone is therefore unreliable. |
| A-04 | Migrations are applied manually. A deployed code change that depends on an unapplied migration will fail in production. |
| A-05 | ZKTeco devices can only reach the one production relay VM, so device behaviour cannot be tested against a staging environment. |
| A-06 | Vercel bot protection makes datacentre-originating device traffic non-viable against the main app — the relay is architectural, not incidental. |

---

## Revision history

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1.0 | 8 Sept 2026 | Faisal Munir | Initial as-built functional document, verified against the live codebase |
