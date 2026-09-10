-- Phase 3C — fixes a real gap found during verification, before it ever
-- reached a real shift close.
--
-- pos_void_order() reversed stock but never reversed the PAYMENT. A void
-- flips the order's status and restores stock, but the original payment
-- row (say, +Rs 1000 Cash) was left standing. pos_close_session()'s
-- expected_cash is a straight SUM over every Cash payment for orders in
-- the session, with no status filter — deliberately, because that same
-- simplicity is what makes refund self-correcting: a refund's negative
-- payment row nets against the original sale's positive one with no
-- special-casing required. Void broke that symmetry — the money stayed
-- counted even though the sale it belonged to was erased.
--
-- Fix: void now inserts reversing NEGATIVE payment rows, one per original
-- payment method, mirroring exactly how it already reverses stock movements
-- line-for-line. This is the same principle used everywhere else in this
-- schema (payments are a ledger; a correction is a new row, never an edit)
-- rather than teaching pos_close_session a special case for one status.
--
-- CREATE OR REPLACE, same signature, same lockdown grants as before —
-- only the body gains the payment-reversal block.
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

  SELECT (value::text)::int INTO v_window_min
  FROM public.pos_settings WHERE key = 'void_window_minutes';
  v_window_min := COALESCE(v_window_min, 120);

  IF v_order.completed_at < now() - make_interval(mins => v_window_min) THEN
    RAISE EXCEPTION 'This order is outside the % minute void window — use Refund instead', v_window_min;
  END IF;

  -- Reverse stock, exactly as before.
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

  -- NEW: reverse every original payment, one negative row per method, so
  -- a voided sale contributes exactly zero to any cash (or any method's)
  -- total from this point on — the same self-correcting principle refund
  -- already relies on.
  INSERT INTO public.pos_payments (order_id, method, amount, reference)
  SELECT order_id, method, -amount, 'Void reversal'
  FROM public.pos_payments
  WHERE order_id = v_order_id;

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

REVOKE ALL ON FUNCTION public.pos_void_order(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pos_void_order(jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.pos_void_order(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.pos_void_order(jsonb) TO service_role;
