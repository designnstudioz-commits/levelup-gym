# Phase 3 — Migration Runbook

**Scope:** the 9 Phase 3 / Stage A migrations. **The RLS change set is NOT included and must not be applied yet.**
**Target:** the existing production Supabase project.
**Estimated time:** 15–20 minutes including verification.

---

## 0. What I verified, and what I could not

**Verified mechanically:**
- Dependency ordering — 21 tables, 2 sequences, **zero forward references** in filename order
- **Only one file touches an existing table** (file 1, `system_users`)
- No `CREATE INDEX CONCURRENTLY`, so every file can be wrapped in a transaction
- Every statement is idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT DO NOTHING`, or a `DROP … IF EXISTS` immediately before its `ADD`) — all 9 files are safe to re-run
- `tsc --noEmit` and `next build` both pass with the application code

**Not verified:** the SQL has never been executed. There is no Docker on this machine, so I
could not start a local Postgres, and there is no staging database — one production Supabase
project, one Vercel deployment. Everything below is static analysis plus the pre-flight
checks in §2, which exist precisely because I could not run the thing.

---

## 1. Execution order

Run in this order. It is plain filename order, which the dependency check confirms is valid.

| # | File | Creates | Touches existing data? |
|---|------|---------|------------------------|
| 1 | `20260909100000_pos_roles_and_settings.sql` | `pos_settings`, 2 sequences, 2 `system_users` columns, role CHECK | **YES — the only one** |
| 2 | `20260909100100_pos_catalog.sql` | `pos_departments`, `pos_categories`, `pos_suppliers`, `pos_products`, `pos_product_variants` | No |
| 3 | `20260909100200_pos_modifiers.sql` | `pos_modifier_groups`, `pos_modifiers`, `pos_product_modifier_groups` | No |
| 4 | `20260909100300_pos_sessions_and_orders.sql` | `pos_register_sessions`, `pos_orders`, `pos_order_items`, `pos_payments` | No |
| 5 | `20260909100400_pos_inventory.sql` | `pos_stock_receipts`, `pos_stock_receipt_items`, `pos_stock_counts`, `pos_stock_count_items`, `pos_stock_movements` | No |
| 6 | `20260909100500_pos_approvals.sql` | `pos_approvals` | No |
| 7 | `20260909100600_pos_healthbox.sql` | `pos_healthbox_expenses`, `pos_settlements` | No |
| 8 | `20260909100700_pos_seed.sql` | 4 department rows, 7 settings rows | No |
| 9 | `20260909100800_pos_number_functions.sql` | `pos_next_order_no()`, `pos_next_hold_ref()` | No |

**Files 2–9 create only new objects.** No `ALTER`, `DROP`, `UPDATE`, `DELETE` or `TRUNCATE`
against any existing table. They reference `members`, `daily_members`, `staff_members` and
`system_users` as foreign-key *targets* only, which is read-only and cannot modify a row.
Their worst realistic failure is "this file errors and creates nothing".

---

## 2. Pre-flight — run these BEFORE file 1

File 1 is the only one that can damage anything, and it does two things to `system_users`:
drops whatever CHECK constraint governs `role`, then adds a wider one. Both checks below
take seconds and remove the only real risk in this deployment.

### 2.1 See exactly which constraint will be dropped

The migration finds the constraint by pattern rather than by guessed name, because the
original name depends on how the table was first created. Confirm it will drop what you
expect and nothing else:

```sql
SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class     rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND rel.relname = 'system_users'
  AND con.contype = 'c'
  AND pg_get_constraintdef(con.oid) ILIKE '%role%';
```

**Expect exactly one row**, a CHECK listing the five current roles.
If you get **two or more rows**, stop and send me the output — the migration would drop all
of them and I would need to rewrite it to be more specific.

### 2.2 Confirm every existing role value survives the new constraint

This is the one that would actually bite. `ADD CONSTRAINT` validates existing rows, so a
single row holding an unexpected value makes file 1 fail:

```sql
SELECT COALESCE(role, '(null)') AS role, COUNT(*) AS accounts
FROM public.system_users
GROUP BY role
ORDER BY accounts DESC;
```

**Every non-null value must be one of:** `owner`, `manager`, `receptionist`, `trainer`,
`viewer`. NULLs are fine — a CHECK constraint passes on NULL.

Anything else (a typo, an old role, a differently-cased value) and file 1 fails. That is
recoverable, but only if you wrapped it in a transaction, which is §3.

### 2.3 Confirm no name collisions

```sql
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND tablename LIKE 'pos%'
ORDER BY tablename;
```

**Expect zero rows** on a first run. Rows here mean a previous partial run — harmless, since
every file is re-runnable, but worth knowing before you start.

---

## 3. The one thing that matters most: wrap each file in a transaction

The Supabase SQL editor does **not** wrap a multi-statement script in a transaction. Without
one, file 1 has a genuinely bad failure mode:

> the `DO` block drops the role constraint → `ADD CONSTRAINT` fails on an unexpected value →
> **`system_users` is left with no role constraint at all**, and nothing tells you.

So for each file, paste it into the SQL editor **between** these two lines:

```sql
BEGIN;

-- ...paste the entire migration file here...

COMMIT;
```

If anything errors, run `ROLLBACK;` and the database is untouched. This works for all nine
files — none uses `CREATE INDEX CONCURRENTLY`, which is the usual reason a migration cannot
be transactional.

**Do not paste all nine files into one transaction.** One file per transaction, verified
before moving on, so a failure tells you exactly where you are.

---

## 4. Applying

For each file, in order:

1. Open the file in the repo, copy its full contents
2. Supabase Dashboard → **SQL Editor** → new query
3. Type `BEGIN;`, paste the file, type `COMMIT;`
4. Run
5. Run that file's verification query from §5
6. Only then move to the next file

### On timing

There is no migration runner in the deploy pipeline — migrations are applied by hand. **Apply
all nine before deploying the Phase 3 application code.** The reverse order breaks the live
site: the deployed `/pos` route queries `pos_departments`, and the dashboard layout selects
`pos_department_scope` from `system_users`.

The current production deployment is unaffected by applying these first — nothing live reads
any `pos_*` table, and the two new `system_users` columns are nullable and unread by existing
code.

---

## 5. Verification after each file

| After | Query | Expect |
|-------|-------|--------|
| 1 | `SELECT column_name FROM information_schema.columns WHERE table_name='system_users' AND column_name IN ('pos_department_scope','manager_pin_hash');` | 2 rows |
| 1 | `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='system_users_role_check';` | Lists all 7 roles |
| 1 | `SELECT last_value FROM pos_order_no_seq;` | `1001` |
| 2 | `SELECT COUNT(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('pos_departments','pos_categories','pos_suppliers','pos_products','pos_product_variants');` | `5` |
| 3 | same pattern for the 3 modifier tables | `3` |
| 4 | same pattern for the 4 order tables | `4` |
| 5 | same pattern for the 5 inventory tables | `5` |
| 6 | `pos_approvals` exists | `1` |
| 7 | `pos_healthbox_expenses`, `pos_settlements` exist | `2` |
| 8 | `SELECT name, financial_owner FROM pos_departments ORDER BY sort_order;` | Supplements / Level Up Cafe / Accessories = `levelup`; HealthBox = `healthbox` |
| 8 | `SELECT COUNT(*) FROM pos_settings;` | `7` |
| 9 | `SELECT pos_next_order_no();` | `LU-1001` |

> **Note on the last one:** calling `pos_next_order_no()` consumes 1001, so your first real
> order will be `LU-1002`. Harmless — order numbers are identifiers, not counts, and gaps are
> expected. Skip it if you would rather the first sale be `LU-1001`.

### Final check — the whole set

```sql
SELECT COUNT(*) AS pos_tables FROM pg_tables
WHERE schemaname = 'public' AND tablename LIKE 'pos\_%';
-- expect 21
```

---

## 6. Regression check on the live gym app

After all nine, before deploying anything, confirm the existing app is untouched. Files 2–9
cannot have affected it; this is really a check on file 1.

| # | Check | Pass condition |
|---|-------|----------------|
| 1 | Sign in as owner | Dashboard loads, revenue figures render |
| 2 | Sign in as receptionist | Front-desk dashboard loads |
| 3 | `/dashboard/settings` → Users tab | All accounts list with correct roles |
| 4 | Create a test system user, then deactivate it | Succeeds — this exercises the new role CHECK |
| 5 | Collect a fee with a split payment | Both rows share one `receipt_no` |
| 6 | `/dashboard/reports` → Revenue | Totals identical to before |
| 7 | `/dashboard/attendance` | Recent punches present; device shows online |

Item 4 is the one that matters. It is the only existing workflow that writes a `role` value,
and therefore the only one the changed constraint can break.

Item 7 confirms the ZKTeco path is unaffected. It should be — the relay connects with the
service-role key and never touches `system_users` — but it is the integration where a fault
is invisible until punches silently stop, so check it rather than assume.

---

## 7. Rollback

### Files 2–9

Fully reversible; nothing existing is touched.

```sql
BEGIN;
DROP TABLE IF EXISTS
  public.pos_settlements, public.pos_healthbox_expenses, public.pos_approvals,
  public.pos_stock_movements, public.pos_stock_count_items, public.pos_stock_counts,
  public.pos_stock_receipt_items, public.pos_stock_receipts,
  public.pos_payments, public.pos_order_items, public.pos_orders,
  public.pos_register_sessions,
  public.pos_product_modifier_groups, public.pos_modifiers, public.pos_modifier_groups,
  public.pos_product_variants, public.pos_products,
  public.pos_suppliers, public.pos_categories, public.pos_departments
CASCADE;
DROP FUNCTION IF EXISTS public.pos_next_order_no();
DROP FUNCTION IF EXISTS public.pos_next_hold_ref();
COMMIT;
```

### File 1

Restore the original role constraint:

```sql
BEGIN;
ALTER TABLE public.system_users DROP CONSTRAINT IF EXISTS system_users_role_check;
ALTER TABLE public.system_users
  ADD CONSTRAINT system_users_role_check
  CHECK (role IN ('owner','manager','receptionist','trainer','viewer'));
COMMIT;
```

**Only do this if no account has been given the `cashier` or `healthbox_staff` role** — the
`ADD CONSTRAINT` validates existing rows and will fail otherwise. Check first:

```sql
SELECT COUNT(*) FROM public.system_users WHERE role IN ('cashier','healthbox_staff');
```

The two new columns and `pos_settings` can be left in place — they are nullable, unread by
existing code, and dropping columns runs against the project's own never-drop rule. If you
truly want them gone: `DROP TABLE public.pos_settings;` and
`DROP SEQUENCE public.pos_order_no_seq, public.pos_hold_no_seq;`.

---

## 8. Summary of risk

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| An unexpected `role` value fails file 1 | Low | Pre-flight §2.2 catches it before you run anything |
| The `DO` block drops an unintended constraint | Very low | Pre-flight §2.1 shows exactly what it will drop |
| Partial failure leaves `system_users` unconstrained | **Only if you skip the transaction** | §3 — `BEGIN` / `COMMIT` per file |
| Files 2–9 damage gym data | None | Verified: they contain no `ALTER`/`DROP`/`UPDATE`/`DELETE`/`INSERT` against existing tables |
| Deploying code before migrating | Medium — it is a manual step | Apply all nine first (§4) |

**Bottom line.** Files 2–9 are additive and cannot affect existing data. File 1 is the only
one worth care, its risk is fully covered by two pre-flight queries and a `BEGIN`/`COMMIT`,
and every file is re-runnable if you need to start over.

Send me the output of §2.1 and §2.2 if anything looks off, and I will adjust before you run
anything.
