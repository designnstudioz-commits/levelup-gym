-- Expense module, part 3: protect the bill/payment/history invariants from
-- writers that predate them.
--
-- Part 2 made INSERTs from an old build safe. UPDATEs are still open, and a
-- stale browser tab running the previous deployment can do three things that
-- leave the books inconsistent:
--
--   1. CHANGE THE AMOUNT. The old editor has no notion of payments, so it can
--      lower a Rs 7,000 bill to Rs 5,000 while a Rs 7,000 payment is attached
--      — a bill paid more than it is worth. It also writes no
--      expense_amount_history row, so historical months keep reporting the
--      old figure while "outstanding now" uses the new one.
--
--   2. MOVE THE BILL DATE. Payments carry their own paid_on, so the money
--      stays in its original month while the bill moves to another. Under the
--      old single-row model those were the same date by definition.
--
--   3. VOID A BILL THAT HAS PAYMENTS. The old void route does not look at
--      expense_payments at all (verified: zero references). Voiding a paid
--      bill strips it from the books while the money it paid stays recorded.
--
-- Deliberately NOT fixed by syncing payments to the bill. Partial payment is
-- a legitimate state in the new model, so "make the payment match the bill"
-- would destroy real information. Instead: unsupported legacy writes are
-- REJECTED with an instruction to refresh, and the invariants are enforced
-- for every writer including the current app.

-- ── 1. Normalise before the guard exists ─────────────────────────────────
-- Rows inserted by an old build during the deploy gap carry
-- payments_managed = FALSE. Settle that here, while updates are still
-- unguarded, so a later replay of part 2 has nothing to do and cannot trip
-- the trigger created below.
UPDATE expenses SET payments_managed = TRUE WHERE payments_managed IS FALSE;

-- ── 2. The per-write marker ──────────────────────────────────────────────
-- The current app sets this on every UPDATE it makes. It is wiped back to
-- NULL by the trigger before the row is stored, so it is never persisted
-- state — purely a signal that says "this write came from a build that knows
-- about payments and amount history". An old build never sets it, which is
-- exactly what makes it detectable.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS write_marker TEXT;

COMMENT ON COLUMN expenses.write_marker IS
  'Per-write signal, never stored (reset to NULL by expenses_guard_update). The current app must set it to ''v2'' on every UPDATE; writes without it are rejected as coming from an outdated build.';

-- ── 3. The guard ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expenses_guard_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_live_paid numeric;
BEGIN
  -- (a) Reject writes from a build that does not understand payments.
  IF NEW.write_marker IS DISTINCT FROM 'v2' THEN
    RAISE EXCEPTION
      'This expense was edited by an outdated version of the app. Refresh the page and try again.'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- The marker is a signal, not state. Clear it so the next write has to
  -- present its own.
  NEW.write_marker := NULL;

  SELECT COALESCE(SUM(amount), 0) INTO v_live_paid
    FROM expense_payments
   WHERE expense_id = NEW.id AND deleted_at IS NULL;

  -- (b) A bill may not be voided while money is recorded against it. The
  -- payments would stay on the books with no bill to belong to. Void the
  -- payments first, each with its own reason.
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND v_live_paid > 0 THEN
    RAISE EXCEPTION
      'This bill has Rs % recorded against it. Void those payments before voiding the bill.',
      trim(to_char(v_live_paid, 'FM999999990.00'))
      USING ERRCODE = 'raise_exception';
  END IF;

  -- (c) The total may be corrected, but never below what has already been
  -- paid — that is an overpaid bill, which no reader can represent.
  IF NEW.amount IS DISTINCT FROM OLD.amount AND NEW.amount < v_live_paid - 0.005 THEN
    RAISE EXCEPTION
      'Rs % has already been paid against this bill, so the total cannot be lowered to Rs %.',
      trim(to_char(v_live_paid, 'FM999999990.00')),
      trim(to_char(NEW.amount,  'FM999999990.00'))
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS expenses_guard_update_trg ON expenses;
-- Named to sort after set_updated_at_expenses so updated_at is already
-- applied when this runs; neither depends on the other.
CREATE TRIGGER expenses_guard_update_trg BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION public.expenses_guard_update();

-- ── 4. Amount history can never be skipped ───────────────────────────────
-- The app inserts its history row BEFORE updating the bill, stating whether
-- the change is a correction or a revision. This is the backstop: if the
-- latest history entry does not already match the new total, one is written
-- as a correction (effective from the bill's own date), which is what an
-- amount change means when nobody said otherwise.
--
-- Compares against the LATEST entry rather than "any entry with this amount",
-- so changing 30,000 -> 45,000 -> 30,000 still records the final step.
CREATE OR REPLACE FUNCTION public.expenses_amount_history_backstop()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_latest numeric;
BEGIN
  IF NEW.amount IS NOT DISTINCT FROM OLD.amount THEN
    RETURN NEW;
  END IF;

  SELECT h.amount INTO v_latest
    FROM expense_amount_history h
   WHERE h.expense_id = NEW.id
   ORDER BY h.effective_from DESC, h.recorded_at DESC
   LIMIT 1;

  IF v_latest IS DISTINCT FROM NEW.amount THEN
    INSERT INTO expense_amount_history (expense_id, amount, effective_from, reason, changed_by)
    VALUES (NEW.id, NEW.amount, NEW.expense_date,
            'Recorded automatically: the total changed without an explicit history entry',
            NEW.added_by);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS expenses_amount_history_backstop_trg ON expenses;
CREATE TRIGGER expenses_amount_history_backstop_trg AFTER UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION public.expenses_amount_history_backstop();

REVOKE ALL ON FUNCTION public.expenses_guard_update()             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expenses_amount_history_backstop()  FROM PUBLIC, anon, authenticated;
