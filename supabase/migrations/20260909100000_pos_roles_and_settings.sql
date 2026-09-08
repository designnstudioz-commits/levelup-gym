-- Phase 3 / Stage A — role foundations and POS configuration store.
--
-- NO RLS IN THIS FILE. Per the Phase 3 approval, row-level security is
-- handled as its own reviewed change set (see docs/phase3-rls-changeset.md)
-- and is deliberately NOT bundled into feature migrations. This file only
-- widens an existing CHECK constraint and adds nullable columns, so it
-- cannot weaken any current authorization.

-- ── 1. Two new system roles ──────────────────────────────────────────
--
-- House rule BR-DATA-04: never remove an enum/CHECK value, only add. The
-- constraint is dropped and recreated carrying the FULL previous list plus
-- the two new values.
--
-- The DO block rather than a plain DROP CONSTRAINT IF EXISTS: the original
-- constraint's generated name is not guaranteed to be
-- `system_users_role_check` (it depends on how the table was first created
-- in the Supabase editor). Dropping by a guessed name would silently
-- no-op via IF EXISTS, leaving the OLD constraint in place, and every
-- insert of a 'cashier' row would then fail with a confusing error at
-- runtime instead of here. This finds whichever CHECK constraint actually
-- governs `role` and removes it.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class     rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'system_users'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.system_users DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.system_users
  ADD CONSTRAINT system_users_role_check
  CHECK (role IN (
    'owner', 'manager', 'receptionist', 'trainer', 'viewer',
    'cashier',          -- operates /pos only
    'healthbox_staff'   -- third-party HealthBox staff, scoped to their department
  ));

-- ── 2. Department scoping ────────────────────────────────────────────
--
-- NULL means "not scoped" — every existing role keeps unrestricted access
-- and no current behaviour changes. A healthbox_staff account gets the
-- HealthBox department id here.
--
-- Deliberately UUID[] and NOT a foreign key: Postgres cannot enforce a FK
-- from an array element. Referential integrity is enforced in application
-- code and in the RLS policies that read this column. Modelling it as an
-- array (rather than hardcoding `role = 'healthbox_staff'` everywhere)
-- means a second third-party department later needs no schema change.
ALTER TABLE public.system_users
  ADD COLUMN IF NOT EXISTS pos_department_scope UUID[];

-- Manager override PIN for voids, refunds and over-limit discounts at the
-- terminal, so a manager does not have to log the cashier out mid-queue.
-- Stores a bcrypt/argon hash ONLY — never a plaintext PIN — and is
-- verified exclusively server-side in /api/pos/verify-pin.
ALTER TABLE public.system_users
  ADD COLUMN IF NOT EXISTS manager_pin_hash TEXT;

COMMENT ON COLUMN public.system_users.pos_department_scope IS
  'POS departments this user is limited to. NULL = unrestricted. Read by RLS policies.';
COMMENT ON COLUMN public.system_users.manager_pin_hash IS
  'Hashed manager override PIN for POS void/refund/discount approval. Never store plaintext.';

-- ── 3. POS settings ──────────────────────────────────────────────────
--
-- Key/value so operational policy (settlement cycle, discount ceiling,
-- void window) changes without a migration or a deploy — required by
-- spec §22: "The system should not require code changes just to switch
-- settlement frequency."
CREATE TABLE IF NOT EXISTS public.pos_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES public.system_users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. User-facing number sequences ──────────────────────────────────
--
-- Real Postgres sequences, not MAX+1 and emphatically not count(*)+1
-- (commit b891e03 fixed exactly that bug in device_commands). A sequence
-- is transaction-safe under concurrency and never reissues a number, which
-- matters because order_no is printed on the customer's receipt.
--
-- Gaps are acceptable and expected: a rolled-back transaction consumes a
-- number. An order number is an identifier, not an audit count.
CREATE SEQUENCE IF NOT EXISTS public.pos_order_no_seq START WITH 1001;
CREATE SEQUENCE IF NOT EXISTS public.pos_hold_no_seq  START WITH 1;
