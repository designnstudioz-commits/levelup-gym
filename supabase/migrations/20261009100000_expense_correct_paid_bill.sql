-- Expense module, part 5: correcting a bill that is already fully paid, and
-- the amount-history row that new bills were never getting.
--
-- TWO PROBLEMS, BOTH FOUND IN LIVE USE ON 2026-10-09.
--
-- 1. Correcting a mistyped total was effectively impossible. A bill may never
--    be worth less than what has been paid against it — a sound rule, and the
--    reason partial payments can exist at all. But every bill in this gym is
--    fully paid (20 from the migration, the rest created with "Record a
--    payment now" ticked, which is the default). So the rule blocked the
--    single most common correction: fixing a typo. The owner had to void the
--    payment, edit the bill, then re-record the payment — three steps, and
--    easy to abandon halfway, leaving a bill with no payment at all.
--
--    Fixed by letting the caller say "the payment was wrong too". The bill
--    and its payment are then corrected together, in one transaction.
--
--    Deliberately NOT done by editing the payment row in place. The old
--    payment is voided with a reason and a corrected one is inserted, which
--    is exactly what the manual three-step dance produced — the mistaken
--    figure stays visible in the payment history rather than being
--    overwritten. Same audit trail, one step.
--
--    Deliberately NOT applied when the bill has more than one live payment,
--    or when the single payment does not equal the old total. In those cases
--    there is no single obvious way to redistribute the difference, and
--    guessing would silently move money between dated payments. Those still
--    have to be handled by hand, and the function says so.
--
-- 2. Bills created through POST /api/expenses had no expense_amount_history
--    row. The part-2 migration seeded one for every bill that existed then,
--    and the backstop trigger covers UPDATEs, but nothing covered INSERT. So
--    four bills created since had no recorded opening value, and
--    expense_amount_as_of() fell back to today's amount for them — meaning a
--    later revision would have restated earlier months with the new figure,
--    the precise failure effective dating exists to prevent. Backfilled
--    below; the API now writes one at creation.

-- ── 1. Backfill the missing opening values ───────────────────────────────
INSERT INTO expense_amount_history (expense_id, amount, effective_from, reason, changed_by, recorded_at)
SELECT e.id, e.amount, e.expense_date,
       'Opening value (backfilled 2026-10-09 — bill predates history-on-create)',
       e.added_by, COALESCE(e.created_at, NOW())
FROM expenses e
WHERE NOT EXISTS (SELECT 1 FROM expense_amount_history h WHERE h.expense_id = e.id);

-- ── 2. Correct a fully-paid bill in one transaction ──────────────────────
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
  -- "the payment was wrong too" — correct it alongside the bill.
  v_fix_payment boolean := COALESCE((payload->>'correct_payment')::boolean, false);
  v_bill        record;
  v_live_paid   numeric;
  v_pay_count   int;
  v_old_pay     record;
  v_new_amount  numeric;
  v_new_date    date;
  v_eff_from    date;
  v_touches_amt boolean := false;
  v_history_id  uuid;
  v_new_pay_id  uuid;
BEGIN
  IF v_id IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'expense_id and actor_id are required';
  END IF;

  SELECT * INTO v_bill FROM expenses WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_bill.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This bill is voided and can no longer be edited';
  END IF;

  SELECT COALESCE(SUM(amount), 0), COUNT(*) INTO v_live_paid, v_pay_count
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

    -- Correct the payment alongside the bill, when asked and when there is
    -- exactly one payment that settled the bill in full. Done BEFORE the
    -- overpayment check below, so that check then sees the corrected figure.
    IF v_fix_payment AND v_live_paid > 0 THEN
      IF v_pay_count <> 1 THEN
        RAISE EXCEPTION
          'This bill has % payments. Correct them individually from the payment history, then change the total.',
          v_pay_count;
      END IF;

      SELECT * INTO v_old_pay FROM expense_payments
       WHERE expense_id = v_id AND deleted_at IS NULL LIMIT 1;

      IF v_old_pay.amount IS DISTINCT FROM v_bill.amount THEN
        RAISE EXCEPTION
          'The Rs % recorded does not settle this Rs % bill in full, so it is a part payment. Correct it from the payment history instead.',
          trim(to_char(v_old_pay.amount, 'FM999999990.00')),
          trim(to_char(v_bill.amount, 'FM999999990.00'));
      END IF;

      -- Void the mistaken figure rather than overwriting it, so the payment
      -- history still shows what was originally entered and why it changed.
      UPDATE expense_payments
         SET deleted_at = NOW(), deleted_by = v_actor,
             void_reason = COALESCE(v_reason, 'Corrected with the bill total')
       WHERE id = v_old_pay.id;

      INSERT INTO expense_payments
        (expense_id, amount, paid_on, payment_method, reference, note, receipt_path, added_by)
      VALUES
        (v_id, v_new_amount, v_old_pay.paid_on, v_old_pay.payment_method,
         v_old_pay.reference, 'Corrected with the bill total', v_old_pay.receipt_path, v_actor)
      RETURNING id INTO v_new_pay_id;

      v_live_paid := v_new_amount;

      INSERT INTO activity_logs (user_id, action, entity_type, entity_id, description, metadata)
      VALUES (v_actor, 'corrected_expense_payment', 'expense', v_id,
        format('Corrected the payment on "%s" from Rs %s to Rs %s (dated %s) — %s',
               v_bill.title,
               trim(to_char(v_old_pay.amount, 'FM999999990.00')),
               trim(to_char(v_new_amount,     'FM999999990.00')),
               v_old_pay.paid_on, COALESCE(v_reason, 'no reason given')),
        jsonb_build_object('voidedPaymentId', v_old_pay.id, 'newPaymentId', v_new_pay_id,
                           'from', v_old_pay.amount, 'to', v_new_amount, 'paidOn', v_old_pay.paid_on));
    END IF;

    IF v_new_amount < v_live_paid - 0.005 THEN
      RAISE EXCEPTION
        'Rs % has already been paid against this bill, so the total cannot be lowered to Rs %.',
        trim(to_char(v_live_paid,  'FM999999990.00')),
        trim(to_char(v_new_amount, 'FM999999990.00'));
    END IF;

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
    write_marker    = 'v2'
  WHERE id = v_id;

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
      'history_id', v_history_id,
      'payment_corrected', v_new_pay_id IS NOT NULL));

  RETURN jsonb_build_object(
    'expense_id', v_id,
    'amount_changed', v_touches_amt,
    'history_id', v_history_id,
    'effective_from', v_eff_from,
    'payment_corrected', v_new_pay_id IS NOT NULL,
    'new_payment_id', v_new_pay_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.update_expense_bill(jsonb) FROM PUBLIC, anon, authenticated;

-- ── 3. Never let a bill exist without an opening value again ─────────────
-- Seeded on INSERT by a trigger rather than in the API route, for the same
-- reason the legacy-autopay trigger exists: it then covers every writer —
-- the current app, an older build during a deploy window, and any manual
-- SQL — instead of only the one code path that remembered to do it.
-- Mirrors expenses_amount_history_backstop, which already covers UPDATE.
CREATE OR REPLACE FUNCTION public.expenses_seed_amount_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO expense_amount_history (expense_id, amount, effective_from, reason, changed_by)
  VALUES (NEW.id, NEW.amount, NEW.expense_date, 'Opening value', NEW.added_by);

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS expenses_seed_amount_history_trg ON expenses;
CREATE TRIGGER expenses_seed_amount_history_trg AFTER INSERT ON expenses
  FOR EACH ROW EXECUTE FUNCTION public.expenses_seed_amount_history();

REVOKE ALL ON FUNCTION public.expenses_seed_amount_history() FROM PUBLIC, anon, authenticated;
