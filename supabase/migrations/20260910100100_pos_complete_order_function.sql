-- Phase 3B closeout — atomic sale completion.
--
-- NO RLS IN THIS FILE (see 20260909100000 header — still its own reviewed
-- change set).
--
-- WHY THIS EXISTS.
--
-- The original completion route wrote the order header, items, payments,
-- order number and stock movements as separate sequential Supabase calls.
-- That is how the rest of this codebase already does multi-row writes (fee
-- collection's split payments work the same way) but POS checkout affects
-- money, inventory AND financial ownership in one customer-facing action,
-- and a failure between "payment recorded" and "stock decremented" is not
-- an acceptable risk to carry forward as the permanent architecture.
--
-- A PL/pgSQL function body is one implicit transaction: any RAISE EXCEPTION
-- anywhere in it rolls back every write the function made, automatically,
-- with no client-side transaction management needed (which PostgREST/
-- Supabase-js has no way to express across separate calls anyway). That is
-- the whole mechanism this migration relies on.
--
-- SECURITY — READ BEFORE CHANGING THE GRANTS BELOW.
--
-- This function does NOT re-derive pricing. It trusts unit_price, line_net,
-- modifiers_total etc. exactly as given in its payload — recomputing that
-- from the catalogue is deliberately kept in one place, the TypeScript
-- pricing/cart logic (src/lib/pos/pricing.ts, cart.ts), rather than
-- duplicated in SQL where the two could silently drift apart. Given that,
-- this function must NEVER be reachable by an ordinary authenticated
-- session: a cashier's own client calling it directly with a crafted
-- payload could check out an expensive item at an arbitrary price. It is
-- callable ONLY via the service-role key, from
-- /api/pos/orders/complete, which has ALREADY verified the caller's role
-- (requirePosUser) and computed every total server-side before ever
-- building this payload. No EXECUTE grant is given to `authenticated` —
-- contrast this deliberately with pos_next_order_no()/pos_next_hold_ref(),
-- which ARE safe for any signed-in staff member to call because they only
-- issue a sequence number.
--
-- WHAT IS ATOMIC HERE (all-or-nothing, in one transaction):
--   1. re-validate the order is still held/open (row-locked, closing a
--      race the old sequential version had)
--   2. re-validate live availability and stock — at variant level where a
--      line specifies one, at product level otherwise (see below)
--   3. verify payments sum to the order total
--   4. write/update the order header, including the financial-owner split
--   5. write order_items (modifier selections travel as JSONB on the row —
--      there is no separate per-order modifier table to write to)
--   6. write payments
--   7. issue the order_no and mark the order completed
--   8. write stock movements and decrement stock
--   9. write the activity log
--
-- VARIANT INVENTORY RULE (locked): inventory is tracked at the lowest
-- sellable SKU. A line with no variant tracks the PRODUCT's stock; a line
-- with a variant tracks THAT VARIANT's stock. product.track_inventory is
-- still the on/off switch for the product as a whole — when it's on, a
-- variant-specific line is routed to the variant's own stock_qty rather
-- than the product's.

CREATE OR REPLACE FUNCTION public.pos_complete_order(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id      uuid := (payload->>'caller_id')::uuid;
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

  -- ── Payment total, checked before any writes ────────────────────────
  SELECT COALESCE(SUM((p->>'amount')::numeric), 0) INTO v_payments_sum
  FROM jsonb_array_elements(v_payments) p;

  IF v_payments_sum <> v_total THEN
    RAISE EXCEPTION 'Payments total % does not match the order total %', v_payments_sum, v_total;
  END IF;

  -- ── Live availability + stock, row-locked ───────────────────────────
  -- Locking here (FOR UPDATE) is what closes the race the old sequential
  -- route had: two cashiers completing the same item at once will now
  -- serialise on this lock rather than both reading the same stock_qty.
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

  -- ── Order header ─────────────────────────────────────────────────────
  IF v_hold_order_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.pos_orders WHERE id = v_hold_order_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Held order not found';
    END IF;
    IF v_status <> 'held' THEN
      RAISE EXCEPTION 'This order is no longer held';
    END IF;

    UPDATE public.pos_orders SET
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
      customer_type, member_id, discount_type, discount_value, discount_amount,
      gross_amount, net_amount, levelup_net_amount, healthbox_net_amount, item_count,
      note, status, served_by
    ) VALUES (
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

  -- Defensive cleanup: a prior attempt on this same draft order that
  -- inserted items and then failed before reaching 'completed' (impossible
  -- once this function is the only write path, but harmless to keep as a
  -- guard against a hand-run retry). Only ever touches rows on an order
  -- that has not reached 'completed' — the ledger's immutability is about
  -- completed orders, not abandoned drafts.
  DELETE FROM public.pos_order_items WHERE order_id = v_order_id;

  -- ── Order items — cost resolved HERE, never trusted from the payload ─
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

  -- ── Payments ──────────────────────────────────────────────────────────
  INSERT INTO public.pos_payments (order_id, method, amount, tendered, change_given, reference)
  SELECT
    v_order_id,
    p->>'method',
    (p->>'amount')::numeric,
    NULLIF(p->>'tendered', '')::numeric,
    NULLIF(p->>'change_given', '')::numeric,
    p->>'reference'
  FROM jsonb_array_elements(v_payments) p;

  -- ── Issue the customer-facing number and finalise ────────────────────
  v_order_no := public.pos_next_order_no();

  UPDATE public.pos_orders
  SET order_no = v_order_no, status = 'completed', completed_at = now(), cart_snapshot = NULL
  WHERE id = v_order_id;

  -- ── Stock movements, per the locked variant-inventory rule ───────────
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

  -- ── Audit ─────────────────────────────────────────────────────────────
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

-- Security-critical: no PUBLIC, `authenticated` or `anon` grant. Only the
-- service-role key (used exclusively by /api/pos/orders/complete, after
-- requirePosUser has already verified the caller) may invoke this. See the
-- header comment for why this restriction must never be loosened.
--
-- REVOKE ALL FROM PUBLIC is not sufficient on its own: a stock Supabase
-- project runs `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON
-- FUNCTIONS TO anon, authenticated, service_role`, which grants EXECUTE
-- directly to those roles at function-creation time — a PUBLIC revoke does
-- not touch a grant made directly to a named role. This was verified live
-- against this project (authenticated could call the function despite the
-- PUBLIC revoke, until the explicit revokes below were added) — confirmed
-- with has_function_privilege() before and after. Any new POS function
-- that must stay service-role-only needs these same two explicit REVOKEs,
-- not just REVOKE ALL FROM PUBLIC.
REVOKE ALL ON FUNCTION public.pos_complete_order(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pos_complete_order(jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.pos_complete_order(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.pos_complete_order(jsonb) TO service_role;
