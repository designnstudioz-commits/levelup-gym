-- Expense module, part 4: editing a bill becomes one atomic operation.
--
-- The route previously did three separate round trips: insert the amount
-- history, update the bill, and on failure delete the history row again. That
-- compensating delete is a correctness argument rather than a guarantee — if
-- the process dies between the update and the compensation, or two edits
-- interleave, the bill, its history and the audit trail can disagree. For a
-- financial record that is not good enough.
--
-- Everything now happens inside one function, which is one transaction:
--   lock the bill  ->  validate against payments  ->  write history
--   ->  update the bill  ->  append the audit entry
-- Any RAISE rolls the whole thing back, so a failed edit leaves no trace.
--
-- Ordering inside the transaction matters twice over:
--   * the row lock is taken FIRST, so a concurrent payment cannot slip in
--     between the validation and the update and leave the bill overpaid;
--   * the history row is written BEFORE the bill update, so the
--     amount-history backstop trigger sees the latest entry already matching
--     the new total and does not add a duplicate "correction" of its own.

CREATE OR REPLACE FUNCTION public.update_expense_bill(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id          uuid := (payload->>'expense_id')::uuid;
  v_actor       uuid := NULLIF(payload->>'actor_id', '')::uuid;
  v_reason      text := NULLIF(payload->>'reason', '');
  v_fields      jsonb := COALESCE(payload->'fields', '{}'::jsonb);
  v_kind        text := COALESCE(payload->>'amount_change_kind', 'correction');
  v_eff_in      date := NULLIF(payload->>'amount_effective_from', '')::date;
  v_changed     text := COALESCE(payload->>'changed', '');
  v_bill        record;
  v_live_paid   numeric;
  v_new_amount  numeric;
  v_new_date    date;
  v_eff_from    date;
  v_touches_amt boolean := false;
  v_history_id  uuid;
BEGIN
  IF v_id IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'expense_id and actor_id are required';
  END IF;

  -- Lock first. Everything below is decided against a bill nobody else can
  -- move, and the lock is held until this transaction ends.
  SELECT * INTO v_bill FROM expenses WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_bill.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This bill is voided and can no longer be edited';
  END IF;

  -- Payments are summed under the bill's lock, so a payment racing this edit
  -- either lands before the lock (and is counted here) or waits for it.
  SELECT COALESCE(SUM(amount), 0) INTO v_live_paid
    FROM expense_payments WHERE expense_id = v_id AND deleted_at IS NULL;

  v_new_date := CASE WHEN v_fields ? 'expense_date'
                     THEN (v_fields->>'expense_date')::date ELSE v_bill.expense_date END;

  IF v_fields ? 'amount' THEN
    v_new_amount := (v_fields->>'amount')::numeric;
    IF v_new_amount IS NULL OR v_new_amount <= 0 THEN
      RAISE EXCEPTION 'Amount must be greater than 0';
    END IF;
    v_touches_amt := v_new_amount IS DISTINCT FROM v_bill.amount;
  ELSE
    v_new_amount := v_bill.amount;
  END IF;

  IF v_touches_amt THEN
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'A reason is required when changing a bill''s amount';
    END IF;
    IF v_new_amount < v_live_paid - 0.005 THEN
      RAISE EXCEPTION
        'Rs % has already been paid against this bill, so the total cannot be lowered to Rs %.',
        trim(to_char(v_live_paid,  'FM999999990.00')),
        trim(to_char(v_new_amount, 'FM999999990.00'));
    END IF;

    -- A correction says the figure was always wrong, so it restates from the
    -- bill's own date. A revision applies only from the date given.
    IF v_kind = 'revision' THEN
      IF v_eff_in IS NULL THEN
        RAISE EXCEPTION 'A revision needs the date it takes effect from';
      END IF;
      v_eff_from := v_eff_in;
    ELSE
      v_eff_from := v_new_date;
    END IF;

    INSERT INTO expense_amount_history (expense_id, amount, effective_from, reason, changed_by)
    VALUES (v_id, v_new_amount, v_eff_from, v_reason, v_actor)
    RETURNING id INTO v_history_id;
  END IF;

  -- Only keys actually present are written, so "not supplied" and
  -- "explicitly cleared" stay distinguishable for the nullable columns.
  UPDATE expenses SET
    expense_date    = v_new_date,
    amount          = v_new_amount,
    due_date        = CASE WHEN v_fields ? 'due_date'
                           THEN NULLIF(v_fields->>'due_date', '')::date ELSE due_date END,
    title           = CASE WHEN v_fields ? 'title'
                           THEN v_fields->>'title' ELSE title END,
    expense_head    = CASE WHEN v_fields ? 'expense_head'
                           THEN v_fields->>'expense_head' ELSE expense_head END,
    payment_method  = CASE WHEN v_fields ? 'payment_method'
                           THEN v_fields->>'payment_method' ELSE payment_method END,
    paid_to         = CASE WHEN v_fields ? 'paid_to'
                           THEN NULLIF(v_fields->>'paid_to', '') ELSE paid_to END,
    note            = CASE WHEN v_fields ? 'note'
                           THEN NULLIF(v_fields->>'note', '') ELSE note END,
    receipt_path    = CASE WHEN v_fields ? 'receipt_path'
                           THEN NULLIF(v_fields->>'receipt_path', '') ELSE receipt_path END,
    is_opening_bill = CASE WHEN v_fields ? 'is_opening_bill'
                           THEN (v_fields->>'is_opening_bill')::boolean ELSE is_opening_bill END,
    -- Satisfies the legacy-write guard: this IS the current app.
    write_marker    = 'v2'
  WHERE id = v_id;

  -- Part of the same transaction, so a rolled-back edit leaves no audit entry
  -- claiming something happened.
  INSERT INTO activity_logs (user_id, action, entity_type, entity_id, description, metadata)
  VALUES (v_actor, 'updated_expense', 'expense', v_id,
    format('Edited bill "%s"%s%s', v_bill.title,
           CASE WHEN v_changed = '' THEN '' ELSE ' (' || v_changed || ')' END,
           CASE WHEN v_reason IS NULL THEN '' ELSE ' — ' || v_reason END),
    jsonb_build_object(
      'changed', v_changed,
      'reason', v_reason,
      'previous', jsonb_build_object('title', v_bill.title, 'amount', v_bill.amount,
                                     'expense_date', v_bill.expense_date),
      'amount_change_kind', CASE WHEN v_touches_amt THEN v_kind ELSE NULL END,
      'amount_effective_from', v_eff_from,
      'history_id', v_history_id));

  RETURN jsonb_build_object(
    'expense_id', v_id,
    'amount_changed', v_touches_amt,
    'history_id', v_history_id,
    'effective_from', v_eff_from);
END;
$function$;

REVOKE ALL ON FUNCTION public.update_expense_bill(jsonb) FROM PUBLIC, anon, authenticated;

-- ── Wording ──────────────────────────────────────────────────────────────
-- The old message told the owner to void the payments, which invites undoing
-- real payments just to clear a bill. Voiding a payment means "this was never
-- paid", so it must only ever be used for an entry made in error.
CREATE OR REPLACE FUNCTION public.expenses_guard_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_live_paid numeric;
BEGIN
  IF NEW.write_marker IS DISTINCT FROM 'v2' THEN
    RAISE EXCEPTION
      'This expense was edited by an outdated version of the app. Refresh the page and try again.'
      USING ERRCODE = 'raise_exception';
  END IF;

  NEW.write_marker := NULL;

  SELECT COALESCE(SUM(amount), 0) INTO v_live_paid
    FROM expense_payments
   WHERE expense_id = NEW.id AND deleted_at IS NULL;

  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND v_live_paid > 0 THEN
    RAISE EXCEPTION
      'This bill has recorded payments and cannot be voided. Only void payments entered by mistake.'
      USING ERRCODE = 'raise_exception';
  END IF;

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

REVOKE ALL ON FUNCTION public.expenses_guard_update() FROM PUBLIC, anon, authenticated;
