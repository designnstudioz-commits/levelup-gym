-- Phase G — Owner Reports + HealthBox Profit & Settlement.
--
-- Additive only. pos_settlements already existed (pre-planned, with exactly
-- the columns the locked profit-share rule needs); this migration adds:
--
--   1. 'ready' to pos_settlements' status enum — Draft -> Ready -> Finalised
--      -> Paid, matching the spec's suggested workflow (extending a CHECK
--      constraint's allowed values is the same additive-enum pattern used
--      in Phase F for needs_correction).
--   2. pos_orders.settlement_id — the linkage/locking column that makes
--      double-settlement prevention possible: once an order is claimed by
--      a finalised settlement, it can never be pulled into another one.
--      pos_healthbox_expenses.settlement_id already existed for the same
--      purpose on the expense side.
--   3. pos_finalize_healthbox_settlement(payload) — the atomic financial
--      posting operation (spec §20): locks the settlement and every order/
--      expense it will claim, verifies none of them are already claimed by
--      a DIFFERENT finalised settlement, computes the final snapshot using
--      the locked profit-share rule, persists it, links every included row,
--      and marks the settlement finalised — all in one transaction. Follows
--      the exact pattern already established by pos_complete_order /
--      pos_void_order / pos_refund_order.
--   4. pos_mark_settlement_paid(payload) — the last, simpler state
--      transition (finalised -> paid only).

ALTER TABLE pos_settlements DROP CONSTRAINT IF EXISTS pos_settlements_status_check;
ALTER TABLE pos_settlements ADD CONSTRAINT pos_settlements_status_check
  CHECK (status = ANY (ARRAY['draft'::text, 'ready'::text, 'finalised'::text, 'paid'::text]));

ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS settlement_id UUID REFERENCES pos_settlements(id);
CREATE INDEX IF NOT EXISTS idx_pos_orders_settlement_id ON pos_orders(settlement_id);

-- ── Finalize a HealthBox settlement ──────────────────────────────────
-- payload: { caller_id, settlement_id }
--
-- The settlement row must already exist (created as 'draft' via the admin
-- API, with period_type/period_start/period_end set) — this function does
-- not create it, only locks in its final numbers and claims its rows.
CREATE OR REPLACE FUNCTION public.pos_finalize_healthbox_settlement(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id     uuid := (payload->>'caller_id')::uuid;
  v_settlement_id uuid := (payload->>'settlement_id')::uuid;
  v_settlement    record;
  v_gross         numeric := 0;
  v_discounts     numeric := 0;
  v_refunds       numeric := 0;
  v_net_sales     numeric := 0;
  v_cogs          numeric := 0;
  v_operating     numeric := 0;
  v_expenses      numeric := 0;
  v_profit        numeric := 0;
  v_levelup_share numeric := 0;
  v_healthbox_share numeric := 0;
  v_is_loss       boolean := false;
  v_loss_amount   numeric := 0;
  v_conflict_orders int;
  v_conflict_expenses int;
BEGIN
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'Missing caller_id'; END IF;
  IF v_settlement_id IS NULL THEN RAISE EXCEPTION 'Missing settlement_id'; END IF;

  SELECT * INTO v_settlement FROM public.pos_settlements WHERE id = v_settlement_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Settlement not found'; END IF;
  IF v_settlement.status NOT IN ('draft', 'ready') THEN
    RAISE EXCEPTION 'Only a draft or ready settlement can be finalised (this one is %)', v_settlement.status;
  END IF;

  -- Double-settlement guard #1: no HealthBox order in this period may
  -- already be claimed by a DIFFERENT finalised settlement. Lock every
  -- candidate order row now so a concurrent finalise on an overlapping
  -- period can't race past this check.
  SELECT count(*) INTO v_conflict_orders
  FROM public.pos_orders o
  WHERE o.status IN ('completed', 'refunded', 'partially_refunded')
    AND (o.completed_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN v_settlement.period_start AND v_settlement.period_end
    AND o.healthbox_net_amount <> 0
    AND o.settlement_id IS NOT NULL AND o.settlement_id <> v_settlement_id;
  IF v_conflict_orders > 0 THEN
    RAISE EXCEPTION 'This period overlaps % order(s) already claimed by another settlement', v_conflict_orders;
  END IF;

  -- Double-settlement guard #2: same check for approved expenses.
  SELECT count(*) INTO v_conflict_expenses
  FROM public.pos_healthbox_expenses e
  WHERE e.status = 'approved' AND e.deleted_at IS NULL
    AND e.expense_date BETWEEN v_settlement.period_start AND v_settlement.period_end
    AND e.settlement_id IS NOT NULL AND e.settlement_id <> v_settlement_id;
  IF v_conflict_expenses > 0 THEN
    RAISE EXCEPTION 'This period overlaps % approved expense(s) already claimed by another settlement', v_conflict_expenses;
  END IF;

  -- Lock in every order this settlement will claim, so nothing can slip
  -- in between this SELECT and the UPDATE below.
  PERFORM 1 FROM public.pos_orders o
  WHERE o.status IN ('completed', 'refunded', 'partially_refunded')
    AND (o.completed_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN v_settlement.period_start AND v_settlement.period_end
    AND o.healthbox_net_amount <> 0
  FOR UPDATE;

  -- ── Gross (HealthBox line items on ORIGINAL sale rows only —
  --    refund_of_order_id IS NULL — so a refund's negative mirror lines
  --    don't reduce the top-line gross figure; refunds get their own
  --    separate figure below instead). ──
  SELECT COALESCE(SUM(oi.line_gross), 0)
  INTO v_gross
  FROM public.pos_order_items oi
  WHERE oi.financial_owner = 'healthbox'
    AND oi.order_id IN (
      SELECT id FROM public.pos_orders
      WHERE refund_of_order_id IS NULL
        AND status IN ('completed', 'refunded', 'partially_refunded')
        AND (completed_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN v_settlement.period_start AND v_settlement.period_end
    );

  -- Net Sales nets refunds automatically: the original order keeps its
  -- original positive healthbox_net_amount even after status flips to
  -- 'refunded', and the refund's own mirror row (status='completed',
  -- refund_of_order_id set) carries the exact negative counterpart.
  SELECT COALESCE(SUM(o.healthbox_net_amount), 0) INTO v_net_sales
  FROM public.pos_orders o
  WHERE o.status IN ('completed', 'refunded', 'partially_refunded')
    AND (o.completed_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN v_settlement.period_start AND v_settlement.period_end;

  -- Refunds, isolated BEFORE deriving Discounts below — a refund mirror
  -- row's negative healthbox_net_amount also reduces v_net_sales, so
  -- computing Discounts as merely (Gross - Net) would silently swallow
  -- any refunded amount into the Discounts figure whenever both occur in
  -- the same period. Subtracting Refunds first keeps them genuinely
  -- separate line items, matching spec §2.
  SELECT COALESCE(-SUM(o.healthbox_net_amount), 0) INTO v_refunds
  FROM public.pos_orders o
  WHERE o.status IN ('completed', 'refunded', 'partially_refunded')
    AND o.refund_of_order_id IS NOT NULL
    AND (o.completed_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN v_settlement.period_start AND v_settlement.period_end;

  v_discounts := GREATEST(0, v_gross - v_net_sales - v_refunds);

  SELECT COALESCE(SUM(amount) FILTER (WHERE category = 'cogs'), 0),
         COALESCE(SUM(amount) FILTER (WHERE category = 'operating'), 0),
         COALESCE(SUM(amount), 0)
  INTO v_cogs, v_operating, v_expenses
  FROM public.pos_healthbox_expenses
  WHERE status = 'approved' AND deleted_at IS NULL
    AND expense_date BETWEEN v_settlement.period_start AND v_settlement.period_end;

  v_profit := v_net_sales - v_expenses;

  -- LOCKED RULE: positive profit splits 50/50; zero splits 0/0; a loss
  -- belongs entirely to HealthBox — Level Up's share is never negative.
  IF v_profit > 0 THEN
    v_levelup_share := round(v_profit * 0.5, 2);
    v_healthbox_share := v_profit - v_levelup_share;
    v_is_loss := false;
    v_loss_amount := 0;
  ELSIF v_profit = 0 THEN
    v_levelup_share := 0;
    v_healthbox_share := 0;
    v_is_loss := false;
    v_loss_amount := 0;
  ELSE
    v_levelup_share := 0;
    v_healthbox_share := v_profit; -- negative, HealthBox's own result
    v_is_loss := true;
    v_loss_amount := -v_profit;
  END IF;

  -- Claim every HealthBox order and approved expense in the period.
  UPDATE public.pos_orders
  SET settlement_id = v_settlement_id
  WHERE status IN ('completed', 'refunded', 'partially_refunded')
    AND (completed_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN v_settlement.period_start AND v_settlement.period_end
    AND healthbox_net_amount <> 0
    AND settlement_id IS NULL;

  UPDATE public.pos_healthbox_expenses
  SET settlement_id = v_settlement_id
  WHERE status = 'approved' AND deleted_at IS NULL
    AND expense_date BETWEEN v_settlement.period_start AND v_settlement.period_end
    AND settlement_id IS NULL;

  UPDATE public.pos_settlements SET
    gross_sales = v_gross,
    total_discounts = v_discounts,
    net_sales = v_net_sales,
    approved_cogs = v_cogs,
    approved_operating = v_operating,
    approved_expenses = v_expenses,
    net_profit = v_profit,
    levelup_share = v_levelup_share,
    healthbox_share = v_healthbox_share,
    is_loss = v_is_loss,
    loss_amount = v_loss_amount,
    status = 'finalised',
    finalised_by = v_caller_id,
    finalised_at = now(),
    updated_at = now()
  WHERE id = v_settlement_id;

  INSERT INTO public.activity_logs (user_id, action, entity_type, entity_id, description, metadata)
  VALUES (
    v_caller_id, 'finalised_healthbox_settlement', 'pos_settlement', v_settlement_id,
    format('Finalised HealthBox settlement %s to %s — Net %s %s, HealthBox share Rs %s',
      v_settlement.period_start, v_settlement.period_end, v_net_sales,
      CASE WHEN v_is_loss THEN '(loss)' ELSE '' END, v_healthbox_share),
    jsonb_build_object('netProfit', v_profit, 'levelupShare', v_levelup_share, 'healthboxShare', v_healthbox_share, 'isLoss', v_is_loss)
  );

  RETURN jsonb_build_object(
    'settlement_id', v_settlement_id, 'status', 'finalised',
    'net_profit', v_profit, 'levelup_share', v_levelup_share, 'healthbox_share', v_healthbox_share, 'is_loss', v_is_loss
  );
END;
$function$;

-- ── Mark a finalised settlement as Paid ──────────────────────────────
-- payload: { caller_id, settlement_id, payment_method?, payment_reference? }
CREATE OR REPLACE FUNCTION public.pos_mark_settlement_paid(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id     uuid := (payload->>'caller_id')::uuid;
  v_settlement_id uuid := (payload->>'settlement_id')::uuid;
  v_settlement    record;
BEGIN
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'Missing caller_id'; END IF;
  IF v_settlement_id IS NULL THEN RAISE EXCEPTION 'Missing settlement_id'; END IF;

  SELECT * INTO v_settlement FROM public.pos_settlements WHERE id = v_settlement_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Settlement not found'; END IF;
  IF v_settlement.status <> 'finalised' THEN
    RAISE EXCEPTION 'Only a finalised settlement can be marked paid (this one is %)', v_settlement.status;
  END IF;

  UPDATE public.pos_settlements SET
    status = 'paid',
    paid_at = now(),
    payment_method = COALESCE(NULLIF(payload->>'payment_method', ''), payment_method),
    note = CASE WHEN payload->>'payment_reference' IS NOT NULL AND payload->>'payment_reference' <> ''
                THEN COALESCE(note || E'\n', '') || 'Payment reference: ' || (payload->>'payment_reference')
                ELSE note END,
    updated_at = now()
  WHERE id = v_settlement_id;

  INSERT INTO public.activity_logs (user_id, action, entity_type, entity_id, description, metadata)
  VALUES (
    v_caller_id, 'marked_healthbox_settlement_paid', 'pos_settlement', v_settlement_id,
    format('Marked HealthBox settlement %s to %s as paid', v_settlement.period_start, v_settlement.period_end),
    jsonb_build_object('paymentMethod', payload->>'payment_method', 'paymentReference', payload->>'payment_reference')
  );

  RETURN jsonb_build_object('settlement_id', v_settlement_id, 'status', 'paid');
END;
$function$;
