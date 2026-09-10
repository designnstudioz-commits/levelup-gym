-- Phase 3C — atomic void and refund.
--
-- NO RLS IN THIS FILE (still its own reviewed change set).
--
-- Same reasoning and the same lockdown as pos_complete_order() (migration
-- 20260910100100): a void or refund touches money, inventory and the
-- financial-owner split at once, so each is one Postgres function — one
-- implicit transaction — rather than sequential writes from Node. Both are
-- SECURITY DEFINER, callable ONLY by the service-role key, with EXECUTE
-- explicitly revoked from `authenticated` and `anon` (a bare
-- REVOKE ALL FROM PUBLIC is not sufficient on this project — see that
-- migration's header for why).
--
-- NEITHER FUNCTION CHECKS AUTHORISATION ITSELF. By the time either is
-- called, the Node route has already: verified the caller's role, and
-- either (a) verified a manager PIN and written an already-`approved`
-- pos_approvals row, or (b) confirmed an existing pos_approvals row was
-- resolved to `approved` by a manager from the dashboard. These functions
-- trust that an approval decision was already made correctly — they only
-- make the resulting money/inventory change atomic, and record which
-- approval authorised it.
--
-- SCOPE CUT, DELIBERATE: both are FULL-ORDER only. A partial /
-- line-level refund is not built here — flagged, not silently omitted.

-- ── Void ─────────────────────────────────────────────────────────────
--
-- Same-day-ish window (pos_settings.void_window_minutes, default 120),
-- checked here again even though the route checks it too — the same
-- defence-in-depth reasoning as pos_complete_order()'s stock re-check.
-- Reverses every stock movement the sale made and restores stock exactly,
-- rather than trusting the order's own qty figures a second time — this
-- makes void mathematically the sale's own undo, not a re-derivation of it.
CREATE OR REPLACE FUNCTION public.pos_void_order(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id    uuid := (payload->>'order_id')::uuid;
  v_approved_by uuid := (payload->>'approved_by')::uuid;
  v_approval_id uuid := NULLIF(payload->>'approval_id', '')::uuid;
  v_reason      text := payload->>'reason';
  v_order       record;
  v_window_min  int;
  rec           record;
BEGIN
  IF v_order_id IS NULL OR v_approved_by IS NULL OR v_reason IS NULL OR btrim(v_reason) = '' THEN
    RAISE EXCEPTION 'order_id, approved_by and reason are all required';
  END IF;

  SELECT * INTO v_order FROM public.pos_orders WHERE id = v_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_order.status <> 'completed' THEN
    RAISE EXCEPTION 'Only a completed order can be voided (this one is %)', v_order.status;
  END IF;

  -- void_window_minutes is stored as a bare JSON number, so its jsonb->text
  -- cast is already the plain digits (no quotes to strip, unlike a JSON
  -- string) — safe to cast straight to int.
  SELECT (value::text)::int INTO v_window_min
  FROM public.pos_settings WHERE key = 'void_window_minutes';
  v_window_min := COALESCE(v_window_min, 120);

  IF v_order.completed_at < now() - make_interval(mins => v_window_min) THEN
    RAISE EXCEPTION 'This order is outside the % minute void window — use Refund instead', v_window_min;
  END IF;

  -- Reverse every stock movement this order made — variant-level and
  -- product-level alike, mirroring exactly how pos_complete_order() wrote
  -- them, so a void is the completion's precise inverse.
  FOR rec IN
    SELECT product_id, variant_id, SUM(qty_delta) AS total_delta
    FROM public.pos_stock_movements
    WHERE order_id = v_order_id AND type = 'sale'
    GROUP BY product_id, variant_id
  LOOP
    IF rec.variant_id IS NOT NULL THEN
      INSERT INTO public.pos_stock_movements
        (product_id, variant_id, type, qty_delta, qty_before, qty_after, order_id, created_by, reason_note)
      SELECT product_id, rec.variant_id, 'customer_return', -rec.total_delta, stock_qty, stock_qty - rec.total_delta,
             v_order_id, v_approved_by, 'Void reversal'
      FROM public.pos_product_variants WHERE id = rec.variant_id;

      UPDATE public.pos_product_variants
      SET stock_qty = stock_qty - rec.total_delta
      WHERE id = rec.variant_id;
    ELSE
      INSERT INTO public.pos_stock_movements
        (product_id, variant_id, type, qty_delta, qty_before, qty_after, order_id, created_by, reason_note)
      SELECT id, NULL, 'customer_return', -rec.total_delta, stock_qty, stock_qty - rec.total_delta,
             v_order_id, v_approved_by, 'Void reversal'
      FROM public.pos_products WHERE id = rec.product_id;

      UPDATE public.pos_products
      SET stock_qty = stock_qty - rec.total_delta
      WHERE id = rec.product_id;
    END IF;
  END LOOP;

  UPDATE public.pos_orders SET
    status = 'voided', voided_by = v_approved_by, voided_at = now(), void_reason = v_reason, updated_at = now()
  WHERE id = v_order_id;

  IF v_approval_id IS NOT NULL THEN
    UPDATE public.pos_approvals SET status = 'approved', resolved_by = v_approved_by, resolved_at = now()
    WHERE id = v_approval_id;
  END IF;

  INSERT INTO public.activity_logs (user_id, action, entity_type, entity_id, description, metadata)
  VALUES (v_approved_by, 'voided_pos_order', 'pos_order', v_order_id,
    format('Voided order #%s — Rs %s (%s)', v_order.order_no, v_order.net_amount, v_reason),
    jsonb_build_object('reason', v_reason, 'approvalId', v_approval_id));

  RETURN jsonb_build_object('order_id', v_order_id, 'order_no', v_order.order_no, 'status', 'voided');
END;
$$;

-- ── Refund ───────────────────────────────────────────────────────────
--
-- Creates a NEW order carrying negative quantities and a negative net
-- amount, linked back via refund_of_order_id — the original completed
-- order is never edited, its own row is untouched apart from a status
-- flip to 'refunded'. Full-order only: every line of the original is
-- refunded in full, at the same per-line figures it sold at.
--
-- Payout is a SINGLE method chosen by whoever processes the refund (not
-- necessarily matching how the original sale was paid, which could have
-- been split across several methods) — a deliberate scope cut, flagged in
-- the Phase C report, not a silent gap.
CREATE OR REPLACE FUNCTION public.pos_refund_order(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id     uuid := (payload->>'order_id')::uuid;
  v_approved_by  uuid := (payload->>'approved_by')::uuid;
  v_approval_id  uuid := NULLIF(payload->>'approval_id', '')::uuid;
  v_reason       text := payload->>'reason';
  v_session_id   uuid := NULLIF(payload->>'session_id', '')::uuid;
  v_payout_method text := payload->>'payout_method';
  v_order        record;
  v_refund_id    uuid;
  v_refund_no    text;
  v_product      record;
  v_variant      record;
  rec            record;
BEGIN
  IF v_order_id IS NULL OR v_approved_by IS NULL OR v_reason IS NULL OR btrim(v_reason) = ''
     OR v_payout_method IS NULL THEN
    RAISE EXCEPTION 'order_id, approved_by, reason and payout_method are all required';
  END IF;

  SELECT * INTO v_order FROM public.pos_orders WHERE id = v_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_order.status <> 'completed' THEN
    RAISE EXCEPTION 'Only a completed order can be refunded (this one is %)', v_order.status;
  END IF;

  -- The refund's own order row: same customer, negative money, linked back.
  INSERT INTO public.pos_orders (
    order_no, session_id, status, customer_type, member_id,
    discount_type, discount_value, discount_amount,
    gross_amount, net_amount, levelup_net_amount, healthbox_net_amount, item_count,
    served_by, completed_at, refund_of_order_id, note
  ) VALUES (
    public.pos_next_order_no(), v_session_id, 'completed', v_order.customer_type, v_order.member_id,
    v_order.discount_type, v_order.discount_value, -v_order.discount_amount,
    -v_order.gross_amount, -v_order.net_amount, -v_order.levelup_net_amount, -v_order.healthbox_net_amount,
    v_order.item_count,
    v_approved_by, now(), v_order_id, format('Refund of #%s — %s', v_order.order_no, v_reason)
  ) RETURNING id, order_no INTO v_refund_id, v_refund_no;

  -- Negative line-for-line mirror of the original.
  INSERT INTO public.pos_order_items (
    order_id, product_id, variant_id, department_id, department_name, financial_owner,
    product_name, variant_name, brand, sku, unit_price, cost_price, qty,
    modifiers, modifiers_total, item_note, line_gross, line_discount, line_net,
    member_price_applied, member_price_type, member_price_value
  )
  SELECT
    v_refund_id, product_id, variant_id, department_id, department_name, financial_owner,
    product_name, variant_name, brand, sku, unit_price, cost_price, -qty,
    modifiers, modifiers_total, item_note, -line_gross, -line_discount, -line_net,
    member_price_applied, member_price_type, member_price_value
  FROM public.pos_order_items WHERE order_id = v_order_id;

  -- Money going back out — negative, so SUM(amount) across an order and
  -- its refund together, or across a whole session, nets correctly with
  -- no special-casing.
  INSERT INTO public.pos_payments (order_id, method, amount)
  VALUES (v_refund_id, v_payout_method, -v_order.net_amount);

  -- Restore stock exactly as void does, as 'customer_return' movements
  -- linked to the REFUND order (not the original), so the movement
  -- ledger's order_id always points at the transaction that caused it.
  FOR rec IN
    SELECT product_id, variant_id, SUM(qty_delta) AS total_delta
    FROM public.pos_stock_movements
    WHERE order_id = v_order_id AND type = 'sale'
    GROUP BY product_id, variant_id
  LOOP
    IF rec.variant_id IS NOT NULL THEN
      SELECT * INTO v_variant FROM public.pos_product_variants WHERE id = rec.variant_id FOR UPDATE;
      INSERT INTO public.pos_stock_movements
        (product_id, variant_id, type, qty_delta, qty_before, qty_after, order_id, created_by, reason_note)
      VALUES (rec.product_id, rec.variant_id, 'customer_return', -rec.total_delta,
              v_variant.stock_qty, v_variant.stock_qty - rec.total_delta, v_refund_id, v_approved_by, 'Refund return');
      UPDATE public.pos_product_variants SET stock_qty = stock_qty - rec.total_delta WHERE id = rec.variant_id;
    ELSE
      SELECT * INTO v_product FROM public.pos_products WHERE id = rec.product_id FOR UPDATE;
      INSERT INTO public.pos_stock_movements
        (product_id, variant_id, type, qty_delta, qty_before, qty_after, order_id, created_by, reason_note)
      VALUES (rec.product_id, NULL, 'customer_return', -rec.total_delta,
              v_product.stock_qty, v_product.stock_qty - rec.total_delta, v_refund_id, v_approved_by, 'Refund return');
      UPDATE public.pos_products SET stock_qty = stock_qty - rec.total_delta WHERE id = rec.product_id;
    END IF;
  END LOOP;

  UPDATE public.pos_orders SET status = 'refunded', updated_at = now() WHERE id = v_order_id;

  IF v_approval_id IS NOT NULL THEN
    UPDATE public.pos_approvals
    SET status = 'approved', resolved_by = v_approved_by, resolved_at = now(), resulting_order_id = v_refund_id
    WHERE id = v_approval_id;
  END IF;

  INSERT INTO public.activity_logs (user_id, action, entity_type, entity_id, description, metadata)
  VALUES (v_approved_by, 'refunded_pos_order', 'pos_order', v_order_id,
    format('Refunded order #%s as #%s — Rs %s back via %s (%s)',
      v_order.order_no, v_refund_no, v_order.net_amount, v_payout_method, v_reason),
    jsonb_build_object('reason', v_reason, 'approvalId', v_approval_id, 'refundOrderId', v_refund_id));

  RETURN jsonb_build_object(
    'order_id', v_order_id, 'order_no', v_order.order_no,
    'refund_order_id', v_refund_id, 'refund_order_no', v_refund_no, 'status', 'refunded'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pos_void_order(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pos_void_order(jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.pos_void_order(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.pos_void_order(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.pos_refund_order(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pos_refund_order(jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.pos_refund_order(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.pos_refund_order(jsonb) TO service_role;
