-- Expense module — extends the EXISTING expenses table.
--
-- Deliberately not a new gym_expenses table. `expenses` already exists from
-- the initial schema, already has the project's money convention
-- (NUMERIC(10,2)), already soft-deletes via deleted_at, already has RLS, and
-- is ALREADY READ by the Revenue report (dashboard/reports/page.tsx), which
-- computes netProfit = revenue - expenses from it. Adding a second table
-- would leave the report reading one and the new page writing the other —
-- the exact "two systems" problem this module is meant to avoid.
--
-- Columns are only ADDED, never dropped or renamed, per CLAUDE.md. The
-- requested fields map onto what already exists:
--   name      -> title            notes -> note
--   category  -> expense_head     created_by -> added_by
-- and the genuinely missing ones are added below.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS paid_to      TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_path TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW();

-- Void/audit trail. deleted_at already existed but recorded only WHEN, not
-- WHO, which is not good enough for a financial record.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_by   UUID REFERENCES system_users(id);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS void_reason  TEXT;

-- Amount must be positive. NOT VALID on purpose: it enforces on every INSERT
-- and UPDATE from now on, but does not retro-scan rows that already exist in
-- production, which this migration cannot inspect ahead of time and must not
-- fail on. Run VALIDATE CONSTRAINT later once those rows are known good.
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_amount_positive;
ALTER TABLE expenses ADD CONSTRAINT expenses_amount_positive CHECK (amount > 0) NOT VALID;

-- Category is enforced in the application (EXPENSE_CATEGORIES in
-- src/lib/expenses.ts) rather than by a DB CHECK. Same reasoning the project
-- already applies to packages.monthly_fee: production holds historical rows
-- whose expense_head values predate this module, and a strict constraint
-- would either fail the migration or silently invalidate them.

CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses (expense_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_expense_head ON expenses (expense_head)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_added_by     ON expenses (added_by)          WHERE deleted_at IS NULL;

-- Reuses the existing shared trigger function rather than defining another.
DROP TRIGGER IF EXISTS set_updated_at_expenses ON expenses;
CREATE TRIGGER set_updated_at_expenses BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────
-- SELECT widens from owner/manager to include receptionist, who now enters
-- expenses at the counter. Trainer and viewer stay excluded: the pre-existing
-- finance permission on this table never included them, and the brief says to
-- grant read only where existing finance permissions already do.
DROP POLICY IF EXISTS "owner manager view expenses" ON public.expenses;
DROP POLICY IF EXISTS "front-desk read expenses"   ON public.expenses;
CREATE POLICY "front-desk read expenses"
  ON public.expenses FOR SELECT
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager','receptionist']));

-- No INSERT/UPDATE/DELETE policy is defined, so those are denied by default
-- for every authenticated client. All writes go through /api/expenses/*,
-- which authenticates with requireStaff() and uses the service-role key —
-- the same shape as the pos_* tables. This is what lets "a receptionist may
-- edit only their own entry, and may never void one" be expressed exactly;
-- a row-level policy cannot distinguish editing a field from setting
-- deleted_at.

-- Private bucket for receipts, mirroring pos-healthbox-receipts exactly.
-- Never public: a receipt can show bank details or a supplier's invoice.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('expense-receipts', 'expense-receipts', false, 5242880,
        ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT (id) DO NOTHING;
