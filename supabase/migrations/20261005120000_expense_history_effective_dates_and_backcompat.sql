-- Expense module, part 2: effective-dated history, and safety during the
-- migrate-then-deploy window.
--
-- Three problems this fixes, all of which break historical honesty in a way
-- that deriving balances alone does NOT solve:
--
--   1. expense_month_summary read e.amount — TODAY's bill total. Correcting a
--      September bill in November silently rewrote September's outstanding
--      figure. A bill now carries an effective-dated amount history, and a
--      historical month uses the amount as it stood at that month's end.
--
--   2. It also read e.deleted_at IS NULL — TODAY's status. Voiding a bill in
--      November erased it from September, where it genuinely was outstanding.
--      A void now takes effect from the date it happened.
--
--   3. Between running the bills/payments migration and deploying the new
--      app, the OLD code is still live and inserts an expense with no payment
--      row. Under the new rules that is an unpaid bill, so money that really
--      left the gym would stop counting. A compatibility trigger closes that
--      window without needing a maintenance stop.

-- ── 1. Compatibility for writers that predate expense_payments ───────────
-- New code sets payments_managed = true and creates payments explicitly.
-- Anything that does not — the old build during the deploy window, a manual
-- SQL insert, an old script — gets a matching payment created for it, which
-- reproduces exactly what that row used to mean: a cost already paid, on its
-- own date.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payments_managed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN expenses.payments_managed IS
  'TRUE when the writer manages expense_payments itself (the current app). FALSE makes the legacy-compatibility trigger auto-create a full payment on insert. Do not set TRUE unless you also create the payment rows.';

CREATE OR REPLACE FUNCTION public.expenses_legacy_autopay()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Only for writers that do not manage payments themselves, and only for a
  -- live, positive bill.
  IF NEW.payments_managed IS TRUE OR NEW.deleted_at IS NOT NULL OR NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO expense_payments (expense_id, amount, paid_on, payment_method, added_by, note)
  VALUES (NEW.id, NEW.amount, NEW.expense_date, NEW.payment_method, NEW.added_by,
          'Auto-created for a writer that predates expense_payments');

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS expenses_legacy_autopay_trg ON expenses;
CREATE TRIGGER expenses_legacy_autopay_trg AFTER INSERT ON expenses
  FOR EACH ROW EXECUTE FUNCTION public.expenses_legacy_autopay();

-- Everything that exists right now was written by the old model and already
-- has its backfilled payment, so mark it managed to keep the trigger off it.
UPDATE expenses SET payments_managed = TRUE WHERE payments_managed IS FALSE;

-- ── 2. Effective-dated amount history ────────────────────────────────────
-- A bill's total can be corrected or revised. Which of those it is changes
-- what history should show, so the caller states it rather than the system
-- guessing:
--   * a CORRECTION is retroactive — the figure was always wrong, so
--     effective_from is the bill's own date and every past month is restated.
--   * a REVISION applies from a stated date — the amount genuinely changed
--     (a revised invoice), so months before that date keep the old figure.

CREATE TABLE IF NOT EXISTS expense_amount_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id     UUID NOT NULL REFERENCES expenses(id),
  amount         NUMERIC(10,2) NOT NULL,
  /** The bill total is this value for every date >= effective_from. */
  effective_from DATE NOT NULL,
  reason         TEXT,
  changed_by     UUID REFERENCES system_users(id),
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_amount_history_lookup
  ON expense_amount_history (expense_id, effective_from DESC, recorded_at DESC);

-- Seed: every existing bill's current total, effective from its bill date,
-- so there is always a row to read and no bill falls back to "unknown".
INSERT INTO expense_amount_history (expense_id, amount, effective_from, reason, changed_by, recorded_at)
SELECT e.id, e.amount, e.expense_date, 'Opening value at migration', e.added_by, COALESCE(e.created_at, NOW())
FROM expenses e
WHERE NOT EXISTS (SELECT 1 FROM expense_amount_history h WHERE h.expense_id = e.id);

/** The bill total as it stood on a given date. Falls back to the live
 *  expenses.amount only if a bill somehow has no history row. */
CREATE OR REPLACE FUNCTION public.expense_amount_as_of(p_expense_id uuid, p_as_of date)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT h.amount FROM expense_amount_history h
      WHERE h.expense_id = p_expense_id AND h.effective_from <= p_as_of
      ORDER BY h.effective_from DESC, h.recorded_at DESC
      LIMIT 1),
    (SELECT e.amount FROM expenses e WHERE e.id = p_expense_id)
  );
$function$;

-- ── 3. Summary, now effective-dated ──────────────────────────────────────
-- Replaces the version from 20261005100000. Two changes, both about not
-- letting today's state rewrite a closed month:
--   * the bill total comes from expense_amount_as_of(month_end)
--   * a void counts from the date it happened, not retroactively

CREATE OR REPLACE FUNCTION public.expense_month_summary(p_month date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_month_start   date := date_trunc('month', p_month)::date;
  v_month_end     date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_next_month    date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_start_month   date;
  v_opening_funds numeric := 0;
  v_configured    boolean := false;
  v_window_start  date;
  v_prior_income  numeric := 0;
  v_prior_paid    numeric := 0;
  v_income        numeric := 0;
  v_paid          numeric := 0;
  v_opening       numeric;
  v_closing       numeric;
  v_outstanding_end numeric := 0;
  v_outstanding_now numeric := 0;
BEGIN
  SELECT start_month, opening_funds, true
    INTO v_start_month, v_opening_funds, v_configured
    FROM expense_settings WHERE id IS TRUE;

  IF v_start_month IS NULL THEN
    -- Not configured. Report from this month with zero opening funds and flag
    -- it, so the UI can say "not configured" rather than presenting 0 as a
    -- confirmed opening balance.
    v_start_month := v_month_start;
    v_opening_funds := 0;
    v_configured := false;
  END IF;

  v_window_start := v_start_month;

  IF v_month_start > v_window_start THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_prior_income FROM fee_payments
     WHERE deleted_at IS NULL AND payment_date >= v_window_start AND payment_date < v_month_start;

    SELECT v_prior_income + COALESCE(SUM(fee_paid), 0) INTO v_prior_income FROM daily_members
     WHERE deleted_at IS NULL AND visit_date >= v_window_start AND visit_date < v_month_start;

    -- A bill voided later was still a real payment back then, so the void is
    -- judged as at the end of the period being reported.
    SELECT COALESCE(SUM(p.amount), 0) INTO v_prior_paid
      FROM expense_payments p JOIN expenses e ON e.id = p.expense_id
     WHERE p.deleted_at IS NULL
       AND (e.deleted_at IS NULL OR e.deleted_at::date > v_month_end)
       AND p.paid_on >= v_window_start AND p.paid_on < v_month_start;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_income FROM fee_payments
   WHERE deleted_at IS NULL AND payment_date >= v_month_start AND payment_date < v_next_month;

  SELECT v_income + COALESCE(SUM(fee_paid), 0) INTO v_income FROM daily_members
   WHERE deleted_at IS NULL AND visit_date >= v_month_start AND visit_date < v_next_month;

  SELECT COALESCE(SUM(p.amount), 0) INTO v_paid
    FROM expense_payments p JOIN expenses e ON e.id = p.expense_id
   WHERE p.deleted_at IS NULL
     AND (e.deleted_at IS NULL OR e.deleted_at::date > v_month_end)
     AND p.paid_on >= v_month_start AND p.paid_on < v_next_month;

  v_opening := v_opening_funds + v_prior_income - v_prior_paid;
  v_closing := v_opening + v_income - v_paid;

  -- Outstanding AS AT month end: the bill total as it stood then, less only
  -- the payments made by then, counting only bills that existed and were not
  -- yet voided at that point.
  SELECT COALESCE(SUM(GREATEST(public.expense_amount_as_of(e.id, v_month_end) - COALESCE(paid.total, 0), 0)), 0)
    INTO v_outstanding_end
    FROM expenses e
    LEFT JOIN LATERAL (
      SELECT SUM(p.amount) AS total FROM expense_payments p
       WHERE p.expense_id = e.id AND p.deleted_at IS NULL AND p.paid_on <= v_month_end
    ) paid ON TRUE
   WHERE e.expense_date <= v_month_end
     AND (e.deleted_at IS NULL OR e.deleted_at::date > v_month_end);

  SELECT COALESCE(SUM(GREATEST(e.amount - COALESCE(paid.total, 0), 0)), 0) INTO v_outstanding_now
    FROM expenses e
    LEFT JOIN LATERAL (
      SELECT SUM(p.amount) AS total FROM expense_payments p
       WHERE p.expense_id = e.id AND p.deleted_at IS NULL
    ) paid ON TRUE
   WHERE e.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'month',              to_char(v_month_start, 'YYYY-MM'),
    'month_start',        v_month_start,
    'month_end',          v_month_end,
    'configured',         v_configured,
    'start_month',        v_start_month,
    'opening_funds',      v_opening_funds,
    'opening_balance',    v_opening,
    'income_collected',   v_income,
    'expenses_paid',      v_paid,
    'monthly_net',        v_income - v_paid,
    'closing_balance',    v_closing,
    'outstanding_at_month_end', v_outstanding_end,
    'outstanding_now',    v_outstanding_now
  );
END;
$function$;

-- ── 4. RLS and grants for the new table ──────────────────────────────────
ALTER TABLE expense_amount_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owner read expense amount history" ON public.expense_amount_history;
CREATE POLICY "owner read expense amount history"
  ON public.expense_amount_history FOR SELECT TO authenticated
  USING (current_role_in(ARRAY['owner']));

REVOKE ALL ON FUNCTION public.expense_amount_as_of(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expenses_legacy_autopay()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expense_month_summary(date)      FROM PUBLIC, anon, authenticated;
