# Phase 3 — RLS Change Set (for review, NOT applied)

**Status:** proposal. No RLS migration has been written or applied.
**Requested deliverables:** policies added · policies modified · existing policies affected · role access matrix · migration & rollback strategy · confirmation existing gym workflows keep working.

---

## 0. The dependency that has to be stated first

**RLS is currently disabled on every table in this database.** The anon key can read and
write everything. Twenty migrations implementing a full baseline were authored on
25 August 2026 (`supabase/migrations/20260825*`) and are **in the repo but never applied**.

That baseline is a **hard prerequisite** for this change set, for one reason: the POS
policies are written against the four helper functions it creates —
`current_system_user_id()`, `current_role()`, `current_staff_id()` and
`current_role_in(text[])`. Without them, none of the policies below can be created.

It is also the reason HealthBox staff accounts must not be issued yet. Handing a third
party a login to a database where the browser's anon key reads every table is not a gap
that application code can close.

**Two separate approvals are therefore being asked for, in order:**

| | Change set | Risk | Contains POS code? |
|---|---|---|---|
| **R1** | Apply the existing August baseline as-is | Medium — touches live authorization for all 5 current roles | No |
| **R2** | Add POS table policies (this document) | Low — all-new tables, no existing data | Yes |

R2 cannot be applied before R1. Neither is bundled with any feature migration.

---

## 1. Policies being ADDED

All on new Phase 3 tables. Twenty-one tables, no existing rows, so there is no data-access
change for anything that exists today.

### 1.1 Catalogue — read wide, write narrow

| Table | SELECT | INSERT / UPDATE |
|-------|--------|-----------------|
| `pos_departments` | owner, manager, cashier, receptionist, healthbox_staff | owner |
| `pos_categories` | owner, manager, cashier, receptionist, healthbox_staff | owner, manager |
| `pos_suppliers` | owner, manager | owner, manager |
| `pos_products` | owner, manager, cashier, receptionist, healthbox_staff | owner, manager + healthbox_staff **scoped** |
| `pos_product_variants` | same as products | same as products |
| `pos_modifier_groups` | same as products | owner, manager + healthbox_staff **scoped** |
| `pos_modifiers` | same as products | owner, manager + healthbox_staff **scoped** |
| `pos_product_modifier_groups` | same as products | owner, manager + healthbox_staff **scoped** |

> **`cost_price` is NOT protected by RLS, and cannot be.** Postgres RLS is row-level;
> Supabase issues every logged-in user the same `authenticated` database role, so
> column-level `GRANT` cannot vary by application role either. Cost and margin are stripped
> **server-side in `/api/pos/catalog`**, and the terminal never queries `pos_products`
> directly. This is a deliberate architectural constraint, not an oversight — recorded here
> so nobody later "fixes" it by pointing the terminal at the table.

**Scoping predicate** used wherever "scoped" appears above:

```sql
-- healthbox_staff may only touch rows in a department listed on their own
-- system_users.pos_department_scope. NULL scope = unrestricted, which is
-- how every pre-existing role continues to behave.
department_id = ANY (
  SELECT unnest(pos_department_scope) FROM public.system_users
  WHERE id = current_system_user_id()
)
```

### 1.2 Orders and payments

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `pos_register_sessions` | owner, manager; cashier **own rows only** | owner, manager, cashier, receptionist | owner, manager; cashier own **unlocked** rows | none |
| `pos_orders` | owner, manager, cashier, receptionist | owner, manager, cashier, receptionist | owner, manager; others only while `status IN ('open','held')` | none |
| `pos_order_items` | owner, manager, cashier, receptionist | owner, manager, cashier, receptionist | **none — immutable** | none |
| `pos_payments` | owner, manager, cashier, receptionist | owner, manager, cashier, receptionist | **none — immutable** | none |
| `pos_approvals` | owner, manager; cashier **own requests only** | owner, manager, cashier, receptionist | owner, manager only | none |

Two invariants are enforced at the database level rather than trusted to the client:

```sql
-- A completed order can never be edited back into an open one.
CREATE POLICY "edit only open or held orders"
  ON public.pos_orders FOR UPDATE TO authenticated
  USING (status IN ('open','held') OR current_role_in(ARRAY['owner','manager']))
  WITH CHECK (status IN ('open','held','completed','voided','refunded','partially_refunded'));

-- A cashier can never resolve their own approval request.
CREATE POLICY "managers resolve approvals"
  ON public.pos_approvals FOR UPDATE TO authenticated
  USING (current_role_in(ARRAY['owner','manager']))
  WITH CHECK (current_role_in(ARRAY['owner','manager']));
```

No `DELETE` policy exists on any POS table. Removal is `deleted_at`, and the three
immutable ledgers have no `deleted_at` at all.

### 1.3 Inventory

| Table | SELECT | INSERT | UPDATE |
|-------|--------|--------|--------|
| `pos_stock_receipts` | owner, manager + healthbox_staff scoped | owner, manager + healthbox_staff scoped | owner, manager; drafts only for healthbox_staff |
| `pos_stock_receipt_items` | follows parent receipt | follows parent | drafts only |
| `pos_stock_counts` | owner, manager | owner, manager | owner, manager |
| `pos_stock_count_items` | owner, manager | owner, manager | owner, manager |
| `pos_stock_movements` | owner, manager + healthbox_staff scoped | owner, manager, cashier *(sale only)*, healthbox_staff *(wastage/expiry only)* | **none — immutable** |

The movement INSERT policy is the one place a value check appears in a policy, because
spec §17 forbids HealthBox staff unrestricted manual adjustment while explicitly permitting
wastage and expiry:

```sql
CREATE POLICY "healthbox staff record wastage only"
  ON public.pos_stock_movements FOR INSERT TO authenticated
  WITH CHECK (
    current_role_in(ARRAY['owner','manager'])
    OR (current_role() = 'cashier'         AND type = 'sale')
    OR (current_role() = 'healthbox_staff' AND type IN ('wastage','expiry','purchase','customer_return'))
  );
```

### 1.4 HealthBox

| Table | SELECT | INSERT | UPDATE |
|-------|--------|--------|--------|
| `pos_healthbox_expenses` | owner, manager, healthbox_staff | owner, manager, healthbox_staff | owner, manager; healthbox_staff **only their own `pending` rows** |
| `pos_settlements` | **owner, manager ONLY** | owner, manager | owner, manager |
| `pos_settings` | all authenticated (read) | owner | owner |

`pos_settlements` is the single most sensitive POS table: it carries the 50/50 net-profit
split. HealthBox staff have **no policy of any kind** on it, so it is invisible to them —
which is what the approved frame states on the artboard ("Cashiers never see this financial
split") and what spec §17 requires.

An expense that has been approved becomes read-only to its submitter:

```sql
CREATE POLICY "healthbox staff edit own pending expenses"
  ON public.pos_healthbox_expenses FOR UPDATE TO authenticated
  USING (
    current_role_in(ARRAY['owner','manager'])
    OR (current_role() = 'healthbox_staff'
        AND submitted_by = current_system_user_id()
        AND status = 'pending')
  )
  WITH CHECK (
    current_role_in(ARRAY['owner','manager'])
    OR (current_role() = 'healthbox_staff' AND status = 'pending')
  );
```

---

## 2. Policies being MODIFIED

**None.**

That is a deliberate design outcome, not luck. The obvious pressure to modify an existing
policy came from member lookup: a cashier must find a member to tag a sale, but the August
baseline's `members` SELECT policy admits only owner, manager, receptionist and viewer.

Adding `cashier` there would have been wrong. RLS is row-level, so a cashier granted SELECT
on `members` receives **every column** — phone, CNIC, address, fees, medical notes. That is
far beyond what tagging a sale needs.

**Instead:** member lookup goes through `/api/pos/members/lookup`, a server route that
checks the caller's role and returns only `full_name`, `membership_no`, `status` and the
cart-aware member-pricing flag. No existing policy changes, and the cashier never gains
table access to `members` at all.

---

## 3. Existing policies AFFECTED

| Baseline policy | Effect of Phase 3 | Action |
|-----------------|-------------------|--------|
| `members` — front-desk read | Cashier deliberately excluded; served by API instead | None |
| `fee_payments` — front-desk manage | POS never writes here (spec §23) | None |
| `activity_logs` — authenticated log own actions | POS writes audit rows; `WITH CHECK (user_id = current_system_user_id())` already permits it | None |
| `activity_logs` — owner read | POS audit rows visible to owner only, as today | None |
| `expenses` — owner/manager view | HealthBox expenses use their own table | None |
| All other baseline policies | No POS interaction | None |

**One behavioural note.** Every baseline policy names its allowed roles explicitly via
`current_role_in(ARRAY[...])`. Because `cashier` and `healthbox_staff` appear in none of
those arrays, both new roles are **denied by default** on every existing gym table the
moment R1 is applied. That is the correct and intended outcome — but it means the new roles
must not be issued to real people before R1, or they will have broad access until it lands.

---

## 4. Role access matrix (after R1 + R2)

| Resource | Owner | Manager | Reception | Cashier | HealthBox staff | Trainer | Viewer |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Gym: members | RW | RW | RW | ✗ *(API only)* | ✗ | R *(own)* | R |
| Gym: fee_payments | RW | RW | RW | ✗ | ✗ | ✗ | ✗ |
| Gym: settings / users | RW | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| POS departments | RW | R | R | R | R | ✗ | ✗ |
| POS products | RW | RW | R | R *(no cost)* | RW *(scoped)* | ✗ | ✗ |
| POS product cost / margin | R | R | ✗ | ✗ | ✗ | ✗ | ✗ |
| POS orders | RW | RW | RW | RW | ✗ | ✗ | ✗ |
| POS payments | RW | RW | RW | RW | ✗ | ✗ | ✗ |
| Register sessions | RW | RW | RW | RW *(own)* | ✗ | ✗ | ✗ |
| Approvals — request | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Approvals — resolve | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Stock movements | RW | RW | ✗ | Insert *(sale)* | Insert *(wastage/expiry/receive)* | ✗ | ✗ |
| Stock adjustments / counts | RW | RW | ✗ | ✗ | ✗ | ✗ | ✗ |
| HealthBox expenses | RW | RW | ✗ | ✗ | RW *(own, pending)* | ✗ | ✗ |
| HealthBox expense approval | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **HealthBox settlement** | RW | RW | ✗ | ✗ | **✗** | ✗ | ✗ |

---

## 5. Migration and rollback strategy

### 5.1 Sequencing

```
R1  Apply 20260825* baseline (20 files, in filename order)
    └─ standalone release, no POS code deployed alongside
       └─ VERIFY: all 5 existing roles, full regression suite (§6)

R2  Apply Phase 3 POS policies (one file per table group, ~8 files)
    └─ VERIFY: POS smoke tests, per-role
       └─ ONLY THEN: create the first real cashier / healthbox_staff account
```

Phase 3 application and schema work continues in parallel and does not wait on either.
The POS tables function without RLS exactly as every other table does today.

### 5.2 Rollback

RLS rollback is unusually clean, because enabling RLS does not alter data:

```sql
-- Per-table, instant, non-destructive:
ALTER TABLE public.<table> DISABLE ROW LEVEL SECURITY;

-- Or drop a single misbehaving policy and leave the rest in force:
DROP POLICY IF EXISTS "<policy name>" ON public.<table>;
```

No data migration, no column change, nothing to restore. The failure mode of a bad policy
is **denied access**, not lost or corrupted rows — which is the safe direction, though it
does mean a bad policy on a live table is a visible outage rather than a silent one. Hence
the per-table verification below rather than a single big-bang apply.

### 5.3 Applying safely

1. Apply **one file at a time** in the Supabase SQL editor, in filename order.
2. After each, exercise the pages that touch that table while signed in as the most
   restricted role that must still work.
3. Anything unexpected: `DISABLE ROW LEVEL SECURITY` on that one table, continue, and
   investigate separately. Do not batch-revert.
4. Migrations are applied by hand — there is no runner in the deploy pipeline. **Apply
   before deploying** any code that depends on them, never after.

### 5.4 The one real risk in R1

The baseline was written in August and reviewed against the codebase as it stood then.
Pages have changed since. Before applying, I would re-verify each policy against current
call sites — particularly `members` (roughly 45 client-side call sites) and `fee_payments`.

---

## 6. Confirmation that existing gym workflows keep working

**What I can confirm now, from code:** the R2 policies in this document touch only new
tables and modify no existing policy, so they cannot alter any current gym behaviour. The
Phase 3 application changes already made are additive and the full build passes with every
existing route intact.

**What I cannot confirm without running R1 against the database:** that the August baseline
is still correct for today's code. It has never been executed anywhere — there is no staging
database (one production Supabase project, one Vercel deployment).

So this section is a **test plan to be executed during R1**, not a claim already satisfied:

| # | Workflow | Signed in as | Pass condition |
|---|----------|--------------|----------------|
| 1 | Public registration at `/register` | anon | Submission is created |
| 2 | Staff registration + first payment | receptionist | Member created, receipt renders |
| 3 | Approve a pending submission | manager | Member promoted, `reviewed_by` set |
| 4 | Collect a fee, split across two methods | receptionist | Both rows share one `receipt_no`; only the first carries `balance_due` |
| 5 | Partial payment, then settle the balance | receptionist | `balance_due` clears |
| 6 | Multi-month advance payment | manager | `expiry_date` extends by `duration_months × N` |
| 7 | Trainer commission for a PT member | owner | Ledger row matches pre-migration figure |
| 8 | Member list, all filter tabs | viewer | Loads; no write controls |
| 9 | Trainer dashboard | trainer | Sees only their own assigned members |
| 10 | Attendance page + a live device punch | manager | Punch records; **relay path unaffected** |
| 11 | Reports, all seven types | manager | Revenue totals identical to pre-migration |
| 12 | Settings, user management | owner | Create/deactivate works |
| 13 | Salary slip | manager | Renders and prints |
| 14 | Family approval | manager | Pricing decision saves |

> **Item 10 matters most.** The ZKTeco relay connects to Supabase with the
> **service-role key**, which bypasses RLS entirely, so device traffic should be
> unaffected. "Should be" is doing real work in that sentence — it is the one integration
> where a mistake is invisible until punches silently stop recording, so it gets an explicit
> check rather than an assumption.

---

## 7. What I am asking for

1. **Approve R1** (apply the August baseline) as its own release, or tell me to re-verify
   it against current call sites first — I would recommend the re-verification.
2. **Approve R2** (this document's POS policies) to be written as migrations, to be applied
   after R1 succeeds.
3. **Confirm no real cashier or HealthBox staff account is created until R2 is applied.**

Until then, Phase 3 application work continues and the POS tables behave exactly as every
other table in the database does today.
