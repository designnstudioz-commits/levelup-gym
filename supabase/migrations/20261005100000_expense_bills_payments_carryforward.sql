-- Expense module: back-dated bills, dated payments, and fund carry-forward.
--
-- WHAT CHANGES CONCEPTUALLY
-- Until now one `expenses` row meant both "a bill exists" and "it was paid",
-- with a single date doing both jobs. That cannot express a Rs 100,000 rent
-- bill dated 1 September of which Rs 60,000 is paid in September and
-- Rs 25,000 in October.
--
-- So: `expenses` keeps its identity as THE BILL (expense_date = bill date,
-- amount = bill total) and a new `expense_payments` table holds each dated
-- payment against it. Nothing is renamed or dropped, per CLAUDE.md rules 2
-- and 3 — `expenses.payment_method` simply becomes the bill's default method
-- rather than a statement that money moved.
--
-- THE RULE THAT PREVENTS DOUBLE-COUNTING
-- Money leaving the gym is `expense_payments`, never `expenses.amount`.
-- A bill on its own never reduces funds; only its payments do. Every reader
-- of "Expenses Paid" must sum expense_payments.amount by paid_on. The
-- backfill below gives every existing expense exactly one payment so the old
-- single-entry rows keep counting exactly once, on the same date as before.
--
-- Balances are never stored, only derived (see expense_month_summary). That
-- is deliberate: a back-dated bill, a correction or a void then recalculates
-- every later month automatically, with no reconciliation job to drift.

-- ── 1. The bill gains a due date and an "existed before we started" flag ──

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS due_date DATE;

-- Marks a bill imported during starting-balance setup, i.e. one already
-- outstanding before the first tracked month. It is display/audit only: an
-- opening bill deducts nothing by itself, exactly like any other bill,
-- because only payments move funds.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_opening_bill BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN expenses.expense_date IS
  'Bill date — when the cost was incurred. May be back-dated. NOT when it was paid: see expense_payments.paid_on.';
COMMENT ON COLUMN expenses.amount IS
  'Bill TOTAL. Outstanding = amount - sum of its non-voided expense_payments. Never sum this for "expenses paid".';
COMMENT ON COLUMN expenses.payment_method IS
  'Default method suggested when recording a payment. The authoritative method per payment is expense_payments.payment_method.';

-- ── 2. Dated payments against a bill ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS expense_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id     UUID NOT NULL REFERENCES expenses(id),
  amount         NUMERIC(10,2) NOT NULL,
  -- When money actually left. This, not created_at, drives every
  -- "Expenses Paid" figure, so a payment entered today for last month
  -- lands in last month.
  paid_on        DATE NOT NULL,
  payment_method TEXT,
  reference      TEXT,
  note           TEXT,
  receipt_path   TEXT,
  -- The real entry trail, preserved separately from paid_on so a back-dated
  -- payment still records who entered it and when.
  added_by       UUID REFERENCES system_users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  -- Soft delete only, with who and why — same contract as expenses.
  deleted_at     TIMESTAMPTZ,
  deleted_by     UUID REFERENCES system_users(id),
  void_reason    TEXT,
  -- Idempotency key supplied by the client. A retried or double-clicked
  -- submit carries the same token and returns the first payment instead of
  -- inserting a second one.
  client_token   TEXT
);

ALTER TABLE expense_payments DROP CONSTRAINT IF EXISTS expense_payments_amount_positive;
ALTER TABLE expense_payments ADD CONSTRAINT expense_payments_amount_positive CHECK (amount > 0) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_expense_payments_client_token
  ON expense_payments (client_token) WHERE client_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expense_payments_expense ON expense_payments (expense_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expense_payments_paid_on ON expense_payments (paid_on DESC) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at_expense_payments ON expense_payments;
CREATE TRIGGER set_updated_at_expense_payments BEFORE UPDATE ON expense_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 3. Starting balances (singleton) ─────────────────────────────────────
-- Nothing is assumed. Until the owner configures this, the module reports
-- opening funds of zero and says so on screen rather than inventing a number.

CREATE TABLE IF NOT EXISTS expense_settings (
  id             BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  -- First day of the first month the gym wants tracked.
  start_month    DATE NOT NULL,
  -- Cash/bank on hand at the START of start_month. May be negative.
  opening_funds  NUMERIC(10,2) NOT NULL DEFAULT 0,
  configured_by  UUID REFERENCES system_users(id),
  configured_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_expense_settings ON expense_settings;
CREATE TRIGGER set_updated_at_expense_settings BEFORE UPDATE ON expense_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 4. Backfill: every existing expense becomes a fully-paid bill ────────
-- The old model had no notion of an unpaid bill, so every row that exists
-- today was money that had already moved. One payment each, on the same
-- date and method it already carried, so historical totals are unchanged.
--
-- Guarded by NOT EXISTS, so re-running this migration cannot create a second
-- payment and double-count. Voided expenses are skipped: a voided bill has
-- no payment to represent.

INSERT INTO expense_payments (expense_id, amount, paid_on, payment_method, added_by, created_at, note)
SELECT e.id, e.amount, e.expense_date, e.payment_method, e.added_by, e.created_at,
       'Migrated from the original single-entry expense record'
FROM expenses e
WHERE e.deleted_at IS NULL
  AND e.amount > 0
  AND NOT EXISTS (SELECT 1 FROM expense_payments p WHERE p.expense_id = e.id);

-- ── 5. Recording a payment, atomically ───────────────────────────────────
-- In Postgres rather than the API because the overpayment check and the
-- insert must not race: two concurrent Rs 60,000 payments against a
-- Rs 100,000 bill must not both pass a "there is Rs 100,000 outstanding"
-- check. SELECT ... FOR UPDATE on the bill serialises them.

CREATE OR REPLACE FUNCTION public.record_expense_payment(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_expense_id uuid := (payload->>'expense_id')::uuid;
  v_amount     numeric := (payload->>'amount')::numeric;
  v_paid_on    date := (payload->>'paid_on')::date;
  v_method     text := NULLIF(payload->>'payment_method', '');
  v_reference  text := NULLIF(payload->>'reference', '');
  v_note       text := NULLIF(payload->>'note', '');
  v_receipt    text := NULLIF(payload->>'receipt_path', '');
  v_added_by   uuid := NULLIF(payload->>'added_by', '')::uuid;
  v_token      text := NULLIF(payload->>'client_token', '');
  v_bill       record;
  v_paid       numeric;
  v_outstanding numeric;
  v_id         uuid;
BEGIN
  IF v_expense_id IS NULL OR v_amount IS NULL OR v_paid_on IS NULL OR v_added_by IS NULL THEN
    RAISE EXCEPTION 'expense_id, amount, paid_on and added_by are all required';
  END IF;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than 0';
  END IF;

  -- Same token means the same intended payment: return the original rather
  -- than inserting a duplicate.
  IF v_token IS NOT NULL THEN
    SELECT id INTO v_id FROM expense_payments WHERE client_token = v_token;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('payment_id', v_id, 'duplicate', true);
    END IF;
  END IF;

  SELECT * INTO v_bill FROM expenses WHERE id = v_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;
  IF v_bill.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This bill is voided and cannot take payments';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM expense_payments WHERE expense_id = v_expense_id AND deleted_at IS NULL;

  v_outstanding := v_bill.amount - v_paid;
  IF v_amount > v_outstanding THEN
    RAISE EXCEPTION 'Payment of Rs % exceeds the Rs % still outstanding on this bill',
      trim(to_char(v_amount, 'FM999999990.00')), trim(to_char(v_outstanding, 'FM999999990.00'));
  END IF;

  INSERT INTO expense_payments
    (expense_id, amount, paid_on, payment_method, reference, note, receipt_path, added_by, client_token)
  VALUES
    (v_expense_id, v_amount, v_paid_on, v_method, v_reference, v_note, v_receipt, v_added_by, v_token)
  RETURNING id INTO v_id;

  INSERT INTO activity_logs (user_id, action, entity_type, entity_id, description, metadata)
  VALUES (v_added_by, 'recorded_expense_payment', 'expense', v_expense_id,
    format('Paid Rs %s against "%s" (dated %s)',
           trim(to_char(v_amount, 'FM999999990.00')), v_bill.title, v_paid_on),
    jsonb_build_object('paymentId', v_id, 'amount', v_amount, 'paidOn', v_paid_on,
                       'method', v_method, 'billTotal', v_bill.amount));

  RETURN jsonb_build_object(
    'payment_id', v_id,
    'duplicate', false,
    'outstanding', v_bill.amount - (v_paid + v_amount)
  );
END;
$function$;

-- ── 6. Voiding a payment ─────────────────────────────────────────────────
-- Soft delete with who and why. The money goes back into that month's funds
-- automatically, because every balance is derived from live payments.

CREATE OR REPLACE FUNCTION public.void_expense_payment(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payment_id uuid := (payload->>'payment_id')::uuid;
  v_voided_by  uuid := NULLIF(payload->>'voided_by', '')::uuid;
  v_reason     text := NULLIF(payload->>'reason', '');
  v_pay        record;
  v_title      text;
BEGIN
  IF v_payment_id IS NULL OR v_voided_by IS NULL THEN
    RAISE EXCEPTION 'payment_id and voided_by are required';
  END IF;

  SELECT * INTO v_pay FROM expense_payments WHERE id = v_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;
  IF v_pay.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('payment_id', v_payment_id, 'already_voided', true);
  END IF;

  UPDATE expense_payments
     SET deleted_at = NOW(), deleted_by = v_voided_by, void_reason = v_reason
   WHERE id = v_payment_id;

  SELECT title INTO v_title FROM expenses WHERE id = v_pay.expense_id;

  INSERT INTO activity_logs (user_id, action, entity_type, entity_id, description, metadata)
  VALUES (v_voided_by, 'voided_expense_payment', 'expense', v_pay.expense_id,
    format('Voided a Rs %s payment against "%s" (dated %s)%s',
           trim(to_char(v_pay.amount, 'FM999999990.00')), COALESCE(v_title, '—'), v_pay.paid_on,
           CASE WHEN v_reason IS NULL THEN '' ELSE ' — ' || v_reason END),
    jsonb_build_object('paymentId', v_payment_id, 'amount', v_pay.amount,
                       'paidOn', v_pay.paid_on, 'reason', v_reason));

  RETURN jsonb_build_object('payment_id', v_payment_id, 'already_voided', false);
END;
$function$;

-- ── 7. The monthly summary lives in the NEXT migration ──────────────────
-- expense_month_summary is defined once, in
-- 20261005120000_expense_history_effective_dates_and_backcompat.sql, because
-- it depends on expense_amount_history which is created there.
--
-- It was briefly defined here as well. Two migrations defining the same
-- function is a trap: re-running this one AFTER the later one silently
-- reverts effective-dated history back to "use today's amount and today's
-- deleted flag", which quietly rewrites closed months. Caught in staging on
-- 2026-10-05 by exactly that sequence. One definition, in one file.
--
-- These two migrations are a pair and must be applied in filename order.

-- ── 8. RLS ───────────────────────────────────────────────────────────────
-- Owner-only read, matching the existing "owner read expenses" policy.
-- No INSERT/UPDATE/DELETE policy, so writes are denied to every authenticated
-- client and must go through /api/expenses/*, which authenticates with
-- requireStaff() and uses the service-role key — the same shape the expenses
-- table already uses.

ALTER TABLE expense_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owner read expense payments" ON public.expense_payments;
CREATE POLICY "owner read expense payments"
  ON public.expense_payments FOR SELECT TO authenticated
  USING (current_role_in(ARRAY['owner']));

ALTER TABLE expense_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owner read expense settings" ON public.expense_settings;
CREATE POLICY "owner read expense settings"
  ON public.expense_settings FOR SELECT TO authenticated
  USING (current_role_in(ARRAY['owner']));

-- The RPCs are SECURITY DEFINER, so they must not be callable by an ordinary
-- client — the API routes invoke them with the service-role key after
-- authenticating the caller.
REVOKE ALL ON FUNCTION public.record_expense_payment(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.void_expense_payment(jsonb)   FROM PUBLIC, anon, authenticated;
-- expense_month_summary is created AND revoked in the next migration.
