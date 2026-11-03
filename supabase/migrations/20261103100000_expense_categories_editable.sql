-- Editable expense categories.
--
-- The category list was a hardcoded TypeScript array (EXPENSE_CATEGORIES in
-- src/lib/expenses.ts). Adding one meant a developer, an edit and a deploy,
-- which is the wrong shape for something the owner changes as the business
-- changes. This moves the list into the database so he can manage it himself.
--
-- expenses.expense_head stays a plain TEXT column holding the category's
-- `value`. It is deliberately NOT a foreign key: production holds rows whose
-- expense_head predates this module, and more importantly a category that is
-- later archived must not orphan or rewrite the bills already filed under it.
-- The bills keep their text; the label falls back to that text when no row
-- matches.
--
-- Checked before writing this: all 10 distinct expense_head values in
-- production (Salaries 35, Other 12, Equipment 9, Maintenance 9, Cleaning 3,
-- Supplies 3, Marketing 2, Utilities 2, Internet 1, Rent 1) match the
-- hardcoded list exactly, so the seed below covers every existing bill.

CREATE TABLE IF NOT EXISTS public.expense_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What is written into expenses.expense_head. Immutable once bills exist:
  -- renaming is done through `label`, which no bill stores.
  value      TEXT NOT NULL,
  label      TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 100,
  -- The ten shipped with the module. Flagged so the UI can warn before
  -- archiving one, and so a reseed never duplicates them.
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES public.system_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Archive, never DELETE (CLAUDE.md rule 1). An archived category keeps
  -- labelling the bills already filed under it; it just stops being offered.
  deleted_at TIMESTAMPTZ
);

-- Case-insensitive uniqueness among LIVE rows only, so "Fuel" cannot be added
-- twice, but a category archived last year can be brought back under the same
-- name without colliding with its own tombstone.
CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_categories_value_live
  ON public.expense_categories (lower(value))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_expense_categories_live
  ON public.expense_categories (sort_order, label)
  WHERE deleted_at IS NULL;

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

-- Owner only, matching the rest of the Expenses module: the page, its API
-- routes and the "owner read expenses" policy are all owner-gated, and a
-- category list is management configuration, not counter information.
DROP POLICY IF EXISTS "owner manage expense categories" ON public.expense_categories;
CREATE POLICY "owner manage expense categories"
  ON public.expense_categories FOR ALL
  TO authenticated
  USING (public.current_role_in(ARRAY['owner']))
  WITH CHECK (public.current_role_in(ARRAY['owner']));

-- Seed the ten that were hardcoded, preserving the order they were listed in.
-- WHERE NOT EXISTS rather than ON CONFLICT: the unique index is partial, and
-- this reads the same whether or not the table was already populated.
INSERT INTO public.expense_categories (value, label, sort_order, is_default)
SELECT v, l, o, TRUE
FROM (VALUES
  ('Rent',        'Rent',                     10),
  ('Utilities',   'Electricity / Utilities',  20),
  ('Salaries',    'Salaries',                 30),
  ('Maintenance', 'Maintenance',              40),
  ('Cleaning',    'Cleaning',                 50),
  ('Marketing',   'Marketing',                60),
  ('Equipment',   'Equipment',                70),
  ('Supplies',    'Supplies',                 80),
  ('Internet',    'Internet',                 90),
  ('Other',       'Other',                   100)
) AS seed(v, l, o)
WHERE NOT EXISTS (
  SELECT 1 FROM public.expense_categories c
  WHERE lower(c.value) = lower(seed.v) AND c.deleted_at IS NULL
);

-- Verify after running:
-- SELECT value, label, sort_order, is_default FROM expense_categories
--   WHERE deleted_at IS NULL ORDER BY sort_order;
-- SELECT DISTINCT e.expense_head FROM expenses e
--   LEFT JOIN expense_categories c ON c.value = e.expense_head AND c.deleted_at IS NULL
--   WHERE e.expense_head IS NOT NULL AND c.id IS NULL;   -- expect 0 rows
