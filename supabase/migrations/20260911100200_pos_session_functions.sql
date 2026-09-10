-- Phase 3C — atomic shift close, and linking sales to the session that
-- took them.
--
-- NO RLS IN THIS FILE.

-- ── Close a register session ────────────────────────────────────────
--
-- expected_cash is computed HERE, by a direct aggregate over pos_payments
-- for orders in this session — not trusted from any running client-side
-- total. This is deliberate: pos_orders.payment_method_totals (updated
-- incrementally by pos_complete_order(), see below) exists purely so the
-- terminal can show a live "today so far" figure without re-querying —
-- it is a convenience cache, not the source of truth. The number that
-- actually determines a cashier's variance is always recomputed fresh at
-- close time.
--
-- Formula (matches the approved Cashier & Shift Report frame exactly):
--     opening_cash + cash sales - cash refunds = expected_cash
-- Refund payments are already stored as NEGATIVE amounts (see
-- pos_refund_order), so a single SUM(amount) over Cash payments in this
-- session already nets sales against refunds correctly with no separate
-- subtraction needed.
CREATE OR REPLACE FUNCTION public.pos_close_session(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_id  uuid := (payload->>'session_id')::uuid;
  v_counted     numeric := (payload->>'counted_cash')::numeric;
  v_session     record;
  v_cash_net    numeric;
  v_expected    numeric;
  v_variance    numeric;
  v_order_count int;
  v_method_totals jsonb;
BEGIN
  IF v_session_id IS NULL OR v_counted IS NULL THEN
    RAISE EXCEPTION 'session_id and counted_cash are required';
  END IF;

  SELECT * INTO v_session FROM public.pos_register_sessions WHERE id = v_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'Session is already %', v_session.status;
  END IF;

  SELECT COALESCE(SUM(p.amount), 0) INTO v_cash_net
  FROM public.pos_payments p
  JOIN public.pos_orders o ON o.id = p.order_id
  WHERE o.session_id = v_session_id AND p.method = 'Cash';

  v_expected := v_session.opening_cash + v_cash_net;
  v_variance := v_counted - v_expected;

  SELECT COUNT(*) INTO v_order_count
  FROM public.pos_orders WHERE session_id = v_session_id AND status IN ('completed', 'refunded');

  SELECT jsonb_object_agg(method, total) INTO v_method_totals
  FROM (
    SELECT p.method, SUM(p.amount) AS total
    FROM public.pos_payments p
    JOIN public.pos_orders o ON o.id = p.order_id
    WHERE o.session_id = v_session_id
    GROUP BY p.method
  ) t;

  UPDATE public.pos_register_sessions SET
    closed_at = now(),
    counted_cash = v_counted,
    expected_cash = v_expected,
    variance = v_variance,
    order_count = COALESCE(v_order_count, 0),
    payment_method_totals = COALESCE(v_method_totals, '{}'::jsonb),
    status = 'closed',
    updated_at = now()
  WHERE id = v_session_id;

  RETURN jsonb_build_object(
    'session_id', v_session_id, 'expected_cash', v_expected,
    'counted_cash', v_counted, 'variance', v_variance, 'order_count', COALESCE(v_order_count, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pos_close_session(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pos_close_session(jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.pos_close_session(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.pos_close_session(jsonb) TO service_role;

-- ── Manager review lock ──────────────────────────────────────────────
--
-- A single-row UPDATE is already atomic on its own; this doesn't need a
-- function for correctness, but is one for consistency with how every
-- other privileged POS write happens (service-role only, same lockdown),
-- and to keep "who may lock a session" enforced in exactly one place
-- rather than trusted to whichever route remembers to check it.
CREATE OR REPLACE FUNCTION public.pos_review_session(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_id uuid := (payload->>'session_id')::uuid;
  v_reviewer   uuid := (payload->>'reviewed_by')::uuid;
  v_session    record;
BEGIN
  IF v_session_id IS NULL OR v_reviewer IS NULL THEN
    RAISE EXCEPTION 'session_id and reviewed_by are required';
  END IF;

  SELECT * INTO v_session FROM public.pos_register_sessions WHERE id = v_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF v_session.status <> 'closed' THEN
    RAISE EXCEPTION 'Only a closed session can be reviewed (this one is %)', v_session.status;
  END IF;

  UPDATE public.pos_register_sessions SET
    reviewed_by = v_reviewer, reviewed_at = now(), is_locked = true, status = 'reviewed', updated_at = now()
  WHERE id = v_session_id;

  INSERT INTO public.activity_logs (user_id, action, entity_type, entity_id, description)
  VALUES (v_reviewer, 'reviewed_pos_session', 'pos_register_session', v_session_id,
    format('Reviewed and locked shift — variance Rs %s', v_session.variance));

  RETURN jsonb_build_object('session_id', v_session_id, 'status', 'reviewed');
END;
$$;

REVOKE ALL ON FUNCTION public.pos_review_session(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pos_review_session(jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.pos_review_session(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.pos_review_session(jsonb) TO service_role;

-- ── pos_complete_order(): link the sale to its session ───────────────
--
-- CREATE OR REPLACE, same signature — the one applied change is reading
-- payload->>'session_id' and setting it on the order header. Everything
-- else is byte-identical to the version this replaces (20260910100100).
-- Editing via CREATE OR REPLACE rather than a new function name because
-- this genuinely is the same function gaining one capability, not a new
-- one — the alternative (a v2 function) would leave two "the" completion
-- functions living side by side, one of them silently stale.
CREATE OR REPLACE FUNCTION public.pos_complete_order(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id      uuid := (payload->>'caller_id')::uuid;
  v_session_id     uuid := NULLIF(payload->>'session_id', '')::uuid;
  v_hold_order_id  uuid := NULLIF(payload->>'hold_order_id', '')::uuid;
  v_items          jsonb := COALESCE(payload->'items', '[]'::jsonb);
  v_payments       jsonb := COALESCE(payload->'payments', '[]'::jsonb);
  v_total          numeric := (payload->'totals'->>'total')::numeric;
  v_payments_sum   numeric;
  v_order_id       uuid;
  v_order_no       text;
  v_status         text;
  v_product        record;
  v_variant        record;
  rec              record;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Missing caller_id';
  END IF;
  IF jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Cannot complete an empty order';
  END IF;
  IF jsonb_array_length(v_payments) = 0 THEN
    RAISE EXCEPTION 'At least one payment is required';
  END IF;

  SELECT COALESCE(SUM((p->>'amount')::numeric), 0) INTO v_payments_sum
  FROM jsonb_array_elements(v_payments) p;

  IF v_payments_sum <> v_total THEN
    RAISE EXCEPTION 'Payments total % does not match the order total %', v_payments_sum, v_total;
  END IF;

  FOR rec IN
    SELECT
      (i->>'product_id')::uuid AS product_id,
      NULLIF(i->>'variant_id', '')::uuid AS variant_id,
      i->>'product_name' AS product_name,
      i->>'variant_name' AS variant_name,
      SUM((i->>'qty')::numeric) AS qty
    FROM jsonb_array_elements(v_items) i
    WHERE i->>'product_id' IS NOT NULL
    GROUP BY (i->>'product_id')::uuid, NULLIF(i->>'variant_id', '')::uuid,
             i->>'product_name', i->>'variant_name'
  LOOP
    SELECT * INTO v_product FROM public.pos_products WHERE id = rec.product_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '% is no longer in the catalogue', rec.product_name;
    END IF;
    IF NOT v_product.is_available THEN
      RAISE EXCEPTION '% is no longer available', v_product.name;
    END IF;

    IF v_product.track_inventory THEN
      IF rec.variant_id IS NOT NULL THEN
        SELECT * INTO v_variant FROM public.pos_product_variants WHERE id = rec.variant_id FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION '% (%) is no longer in the catalogue', rec.product_name, rec.variant_name;
        END IF;
        IF NOT v_variant.is_available THEN
          RAISE EXCEPTION '% (%) is no longer available', rec.product_name, rec.variant_name;
        END IF;
        IF v_variant.stock_qty < rec.qty THEN
          RAISE EXCEPTION 'Not enough stock for % (%) — % left', rec.product_name, rec.variant_name, v_variant.stock_qty;
        END IF;
      ELSE
        IF v_product.stock_qty < rec.qty THEN
          RAISE EXCEPTION 'Not enough stock for % — % left', rec.product_name, v_product.stock_qty;
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF v_hold_order_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.pos_orders WHERE id = v_hold_order_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Held order not found';
    END IF;
    IF v_status <> 'held' THEN
      RAISE EXCEPTION 'This order is no longer held';
    END IF;

    UPDATE public.pos_orders SET
      session_id = v_session_id,
      customer_type = payload->>'customer_type',
      member_id = NULLIF(payload->>'member_id', '')::uuid,
      discount_type = payload->>'discount_type',
      discount_value = COALESCE((payload->>'discount_value')::numeric, 0),
      discount_amount = COALESCE((payload->'totals'->>'discount_amount')::numeric, 0),
      gross_amount = COALESCE((payload->'totals'->>'gross')::numeric, 0),
      net_amount = v_total,
      levelup_net_amount = COALESCE((payload->'totals'->>'levelup_net')::numeric, 0),
      healthbox_net_amount = COALESCE((payload->'totals'->>'healthbox_net')::numeric, 0),
      item_count = ROUND(COALESCE((payload->'totals'->>'item_count')::numeric, 0))::int,
      note = payload->>'note',
      served_by = v_caller_id,
      updated_at = now()
    WHERE id = v_hold_order_id;

    v_order_id := v_hold_order_id;
  ELSE
    INSERT INTO public.pos_orders (
      session_id, customer_type, member_id, discount_type, discount_value, discount_amount,
      gross_amount, net_amount, levelup_net_amount, healthbox_net_amount, item_count,
      note, status, served_by
    ) VALUES (
      v_session_id,
      payload->>'customer_type',
      NULLIF(payload->>'member_id', '')::uuid,
      payload->>'discount_type',
      COALESCE((payload->>'discount_value')::numeric, 0),
      COALESCE((payload->'totals'->>'discount_amount')::numeric, 0),
      COALESCE((payload->'totals'->>'gross')::numeric, 0),
      v_total,
      COALESCE((payload->'totals'->>'levelup_net')::numeric, 0),
      COALESCE((payload->'totals'->>'healthbox_net')::numeric, 0),
      ROUND(COALESCE((payload->'totals'->>'item_count')::numeric, 0))::int,
      payload->>'note',
      'open',
      v_caller_id
    ) RETURNING id INTO v_order_id;
  END IF;

  DELETE FROM public.pos_order_items WHERE order_id = v_order_id;

  INSERT INTO public.pos_order_items (
    order_id, product_id, variant_id, department_id, department_name, financial_owner,
    product_name, variant_name, brand, sku, unit_price, cost_price, qty,
    modifiers, modifiers_total, item_note, line_gross, line_discount, line_net,
    member_price_applied, member_price_type, member_price_value
  )
  SELECT
    v_order_id,
    NULLIF(i->>'product_id', '')::uuid,
    NULLIF(i->>'variant_id', '')::uuid,
    NULLIF(i->>'department_id', '')::uuid,
    i->>'department_name',
    i->>'financial_owner',
    i->>'product_name',
    i->>'variant_name',
    i->>'brand',
    i->>'sku',
    (i->>'unit_price')::numeric,
    (SELECT cost_price FROM public.pos_products WHERE id = NULLIF(i->>'product_id', '')::uuid),
    (i->>'qty')::numeric,
    COALESCE(i->'modifiers', '[]'::jsonb),
    COALESCE((i->>'modifiers_total')::numeric, 0),
    i->>'item_note',
    COALESCE((i->>'line_gross')::numeric, 0),
    COALESCE((i->>'line_discount')::numeric, 0),
    COALESCE((i->>'line_net')::numeric, 0),
    COALESCE((i->>'member_price_applied')::boolean, false),
    i->>'member_price_type',
    NULLIF(i->>'member_price_value', '')::numeric
  FROM jsonb_array_elements(v_items) i;

  INSERT INTO public.pos_payments (order_id, method, amount, tendered, change_given, reference)
  SELECT
    v_order_id,
    p->>'method',
    (p->>'amount')::numeric,
    NULLIF(p->>'tendered', '')::numeric,
    NULLIF(p->>'change_given', '')::numeric,
    p->>'reference'
  FROM jsonb_array_elements(v_payments) p;

  v_order_no := public.pos_next_order_no();

  UPDATE public.pos_orders
  SET order_no = v_order_no, status = 'completed', completed_at = now(), cart_snapshot = NULL
  WHERE id = v_order_id;

  FOR rec IN
    SELECT
      (i->>'product_id')::uuid AS product_id,
      NULLIF(i->>'variant_id', '')::uuid AS variant_id,
      SUM((i->>'qty')::numeric) AS qty
    FROM jsonb_array_elements(v_items) i
    WHERE i->>'product_id' IS NOT NULL
    GROUP BY (i->>'product_id')::uuid, NULLIF(i->>'variant_id', '')::uuid
  LOOP
    SELECT * INTO v_product FROM public.pos_products WHERE id = rec.product_id;
    IF NOT v_product.track_inventory THEN
      CONTINUE;
    END IF;

    IF rec.variant_id IS NOT NULL THEN
      SELECT * INTO v_variant FROM public.pos_product_variants WHERE id = rec.variant_id;

      INSERT INTO public.pos_stock_movements
        (product_id, variant_id, type, qty_delta, qty_before, qty_after, order_id, unit_cost, created_by)
      VALUES
        (rec.product_id, rec.variant_id, 'sale', -rec.qty, v_variant.stock_qty, v_variant.stock_qty - rec.qty,
         v_order_id, v_product.cost_price, v_caller_id);

      UPDATE public.pos_product_variants SET stock_qty = stock_qty - rec.qty WHERE id = rec.variant_id;
    ELSE
      INSERT INTO public.pos_stock_movements
        (product_id, variant_id, type, qty_delta, qty_before, qty_after, order_id, unit_cost, created_by)
      VALUES
        (rec.product_id, NULL, 'sale', -rec.qty, v_product.stock_qty, v_product.stock_qty - rec.qty,
         v_order_id, v_product.cost_price, v_caller_id);

      UPDATE public.pos_products SET stock_qty = stock_qty - rec.qty WHERE id = rec.product_id;
    END IF;
  END LOOP;

  -- Running per-session cache, purely for the terminal's own "today so
  -- far" display — never read back by pos_close_session(), which always
  -- recomputes from pos_payments fresh (see that function's header).
  IF v_session_id IS NOT NULL THEN
    UPDATE public.pos_register_sessions SET
      order_count = order_count + 1,
      payment_method_totals = (
        SELECT jsonb_object_agg(method, total)
        FROM (
          SELECT method, SUM(amount) AS total FROM (
            -- what the session cache already had
            SELECT key AS method, value::numeric AS amount
            FROM jsonb_each_text(COALESCE((SELECT payment_method_totals FROM public.pos_register_sessions WHERE id = v_session_id), '{}'::jsonb))
            UNION ALL
            -- plus this sale's payments
            SELECT p->>'method', (p->>'amount')::numeric
            FROM jsonb_array_elements(v_payments) p
          ) combined(method, amount)
          GROUP BY method
        ) totals
      ),
      updated_at = now()
    WHERE id = v_session_id;
  END IF;

  INSERT INTO public.activity_logs (user_id, action, entity_type, entity_id, description, metadata)
  VALUES (
    v_caller_id, 'completed_pos_sale', 'pos_order', v_order_id,
    format('Completed sale #%s — Rs %s (%s items)',
      v_order_no, v_total, ROUND(COALESCE((payload->'totals'->>'item_count')::numeric, 0))),
    jsonb_build_object(
      'levelupNet', payload->'totals'->'levelup_net',
      'healthboxNet', payload->'totals'->'healthbox_net',
      'methods', (SELECT jsonb_agg(p->>'method') FROM jsonb_array_elements(v_payments) p)
    )
  );

  RETURN jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'total', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.pos_complete_order(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pos_complete_order(jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.pos_complete_order(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.pos_complete_order(jsonb) TO service_role;
