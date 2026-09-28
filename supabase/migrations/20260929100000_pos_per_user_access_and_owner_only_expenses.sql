-- Two access-model changes.
--
-- 1. POS access becomes PER USER, not per role.
--    Until now, holding a role was enough: every receptionist could reach
--    the terminal because POS_TERMINAL_ROLES listed 'receptionist'. The rule
--    is now that a role is a CEILING on what you may do, while an explicit
--    per-user grant decides whether you get in at all.
--
-- 2. Expenses becomes OWNER ONLY.
--
-- pos_department_scope (UUID[] -> pos_departments.id) already exists from
-- 20260909100000 and keeps its meaning: which departments this user may
-- work in. NULL continues to mean "unrestricted", which is only ever
-- correct for an owner.

ALTER TABLE public.system_users
  ADD COLUMN IF NOT EXISTS pos_access BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.system_users.pos_access IS
  'Explicit per-user POS grant. Role alone never grants POS access. Owner '
  'bypasses this flag entirely and always has every department.';

-- BACKFILL BY EXISTING ASSIGNMENT, NEVER BY ROLE.
--
-- ADD COLUMN gives every existing row false, which would log current POS
-- staff out the moment this deploys. The grant below prevents that WITHOUT
-- reintroducing "cashier role = automatic POS access", which is precisely
-- the rule this migration exists to remove.
--
-- The signal used is the one that already encoded a deliberate human
-- decision: pos_department_scope. Someone was given departments before
-- pos_access existed, so they were meant to use POS. Role is not consulted
-- at all — a receptionist with a department assignment is granted, and a
-- cashier without one is not.
--
-- "At least one VALID department" is checked against live pos_departments
-- rather than just a non-empty array. A scope holding only ids of deleted
-- departments is a stale assignment, not a working one, and granting on it
-- would produce a user who passes hasPosAccess() but can sell nothing.
UPDATE public.system_users u
   SET pos_access = true
 WHERE u.deleted_at IS NULL
   AND EXISTS (
     SELECT 1 FROM public.pos_departments d
      WHERE d.id = ANY(u.pos_department_scope)
        AND d.deleted_at IS NULL
   );

-- NOTE for anyone re-running this by hand: the statement above is a
-- one-time backfill, not a reconciliation rule. Re-running it would
-- re-enable a user the owner has since deliberately switched off while
-- leaving their departments assigned. Migrations run once, so this is
-- safe as written — just do not lift it into a scheduled job.

CREATE INDEX IF NOT EXISTS idx_system_users_pos_access
  ON public.system_users (pos_access) WHERE deleted_at IS NULL;

-- ── Expenses: owner only ─────────────────────────────────────────────────
-- Tightened from owner/manager/receptionist. The Expenses page exposes Net
-- Profit — fees collected against running costs — which is management
-- information, not counter information.
DROP POLICY IF EXISTS "front-desk read expenses"   ON public.expenses;
DROP POLICY IF EXISTS "owner manager view expenses" ON public.expenses;
DROP POLICY IF EXISTS "owner read expenses"        ON public.expenses;
CREATE POLICY "owner read expenses"
  ON public.expenses FOR SELECT
  TO authenticated
  USING (current_role_in(ARRAY['owner']));

-- Writes still have no policy at all and remain denied for every
-- authenticated client; /api/expenses/* is the only writer and now requires
-- the owner role there too.
