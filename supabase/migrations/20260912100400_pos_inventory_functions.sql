-- Phase E — Inventory Management: atomic stock operations.
--
-- Follows the exact pattern already established by pos_complete_order /
-- pos_void_order / pos_refund_order (Phase 3B/C): SECURITY DEFINER plpgsql
-- functions that lock the affected product/variant row FOR UPDATE, write an
-- immutable pos_stock_movements row, and update the live stock_qty in the
-- same transaction — so a receipt, adjustment or count-apply either fully
-- succeeds or fully fails, and the movement ledger is never rewritten.
--
-- Additive only: one new nullable column on pos_suppliers, plus three new
-- functions. Nothing existing is altered.

ALTER TABLE pos_suppliers ADD COLUMN IF NOT EXISTS lead_time_days INTEGER;

-- ── Receive stock ────────────────────────────────────────────────────
-- payload: { caller_id, supplier_id?, department_id?, received_date?,
--            reference?, note?, items: [{product_id, variant_id?, qty, unit_cost?}] }
CREATE OR REPLACE FUNCTION public.pos_receive_stock(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id  uuid := (payload->>'caller_id')::uuid;
  v_items      jsonb := COALESCE(payload->'items', '[]'::jsonb);
  v_receipt_id uuid;
  v_total_qty  numeric := 0;
  v_total_cost numeric := 0;
  v_product    record;
  v_variant    record;
  rec          record;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Missing caller_id';
  END IF;
  IF jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'A stock receipt needs at least one line';
  END IF;

  SELECT
    COALESCE(SUM((i->>'qty')::numeric), 0),
    COALESCE(SUM((i->>'qty')::numeric * COALESCE((i->>'unit_cost')::numeric, 0)), 0)
  INTO v_total_qty, v_total_cost
  FROM jsonb_array_elements(v_items) i;

  INSERT INTO public.pos_stock_receipts
    (supplier_id, department_id, received_date, reference, total_qty, total_cost, note, status, posted_by, posted_at, created_by)
  VALUES (
    NULLIF(payload->>'supplier_id', '')::uuid,
    NULLIF(payload->>'department_id', '')::uuid,
    COALESCE((payload->>'received_date')::date, CURRENT_DATE),
    NULLIF(payload->>'reference', ''),
    v_total_qty, v_total_cost,
    NULLIF(payload->>'note', ''),
    'posted', v_caller_id, now(), v_caller_id
  ) RETURNING id INTO v_receipt_id;

  FOR rec IN
    SELECT
      (i->>'product_id')::uuid AS product_id,
      NULLIF(i->>'variant_id', '')::uuid AS variant_id,
      (i->>'qty')::numeric AS qty,
      COALESCE((i->>'unit_cost')::numeric, 0) AS unit_cost
    FROM jsonb_array_elements(v_items) i
  LOOP
    IF rec.product_id IS NULL THEN
      RAISE EXCEPTION 'Every receipt line needs a product';
    END IF;
    IF rec.qty IS NULL OR rec.qty <= 0 THEN
      RAISE EXCEPTION 'Every receipt line needs a quantity greater than zero';
    END IF;

    INSERT INTO public.pos_stock_receipt_items (receipt_id, product_id, variant_id, qty, unit_cost, total_cost)
    VALUES (v_receipt_id, rec.product_id, rec.variant_id, rec.qty, rec.unit_cost, rec.qty * rec.unit_cost);

    IF rec.variant_id IS NOT NULL THEN
      SELECT * INTO v_variant FROM public.pos_product_variants WHERE id = rec.variant_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Variant % not found', rec.variant_id;
      END IF;

      INSERT INTO public.pos_stock_movements
        (product_id, variant_id, type, qty_delta, qty_before, qty_after, receipt_id, unit_cost, created_by)
      VALUES
        (rec.product_id, rec.variant_id, 'purchase', rec.qty, v_variant.stock_qty, v_variant.stock_qty + rec.qty, v_receipt_id, rec.unit_cost, v_caller_id);

      UPDATE public.pos_product_variants SET stock_qty = stock_qty + rec.qty WHERE id = rec.variant_id;
    ELSE
      SELECT * INTO v_product FROM public.pos_products WHERE id = rec.product_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % not found', rec.product_id;
      END IF;

      INSERT INTO public.pos_stock_movements
        (product_id, variant_id, type, qty_delta, qty_before, qty_after, receipt_id, unit_cost, created_by)
      VALUES
        (rec.product_id, NULL, 'purchase', rec.qty, v_product.stock_qty, v_product.stock_qty + rec.qty, v_receipt_id, rec.unit_cost, v_caller_id);

      UPDATE public.pos_products SET stock_qty = stock_qty + rec.qty WHERE id = rec.product_id;
    END IF;
  END LOOP;

  INSERT INTO public.activity_logs (user_id, action, entity_type, entity_id, description, metadata)
  VALUES (
    v_caller_id, 'received_pos_stock', 'pos_stock_receipt', v_receipt_id,
    format('Received stock — %s units, Rs %s', v_total_qty, v_total_cost),
    jsonb_build_object('supplierId', payload->>'supplier_id', 'reference', payload->>'reference')
  );

  RETURN jsonb_build_object('receipt_id', v_receipt_id, 'total_qty', v_total_qty, 'total_cost', v_total_cost);
END;
$function$;

-- ── Adjust stock (damage / expiry / wastage / loss-theft / internal use /
--    manual adjustment — NOT count_correction, which only pos_apply_stock_count
--    writes, and NOT opening/purchase/sale/customer_return, which belong to
--    receiving and the checkout functions) ─────────────────────────────
-- payload: { caller_id, product_id, variant_id?, type, qty_delta, note? }
CREATE OR REPLACE FUNCTION public.pos_adjust_stock(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id  uuid := (payload->>'caller_id')::uuid;
  v_product_id uuid := (payload->>'product_id')::uuid;
  v_variant_id uuid := NULLIF(payload->>'variant_id', '')::uuid;
  v_type       text := payload->>'type';
  v_qty_delta  numeric := (payload->>'qty_delta')::numeric;
  v_note       text := NULLIF(payload->>'note', '');
  v_product    record;
  v_variant    record;
  v_qty_before numeric;
  v_qty_after  numeric;
  v_movement_id uuid;
BEGIN
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'Missing caller_id'; END IF;
  IF v_product_id IS NULL THEN RAISE EXCEPTION 'Missing product_id'; END IF;
  IF v_type IS NULL OR v_type NOT IN ('damage', 'expiry', 'wastage', 'loss_theft', 'internal_use', 'manual_adjustment') THEN
    RAISE EXCEPTION 'Invalid adjustment reason';
  END IF;
  IF v_qty_delta IS NULL OR v_qty_delta = 0 THEN
    RAISE EXCEPTION 'Adjustment quantity must not be zero';
  END IF;

  IF v_variant_id IS NOT NULL THEN
    SELECT * INTO v_variant FROM public.pos_product_variants WHERE id = v_variant_id AND product_id = v_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Variant not found'; END IF;
    v_qty_before := v_variant.stock_qty;
  ELSE
    SELECT * INTO v_product FROM public.pos_products WHERE id = v_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
    v_qty_before := v_product.stock_qty;
  END IF;

  v_qty_after := v_qty_before + v_qty_delta;
  IF v_qty_after < 0 THEN
    RAISE EXCEPTION 'Adjustment would take stock below zero (currently %)', v_qty_before;
  END IF;

  INSERT INTO public.pos_stock_movements
    (product_id, variant_id, type, qty_delta, qty_before, qty_after, reason_note, created_by)
  VALUES (v_product_id, v_variant_id, v_type, v_qty_delta, v_qty_before, v_qty_after, v_note, v_caller_id)
  RETURNING id INTO v_movement_id;

  IF v_variant_id IS NOT NULL THEN
    UPDATE public.pos_product_variants SET stock_qty = v_qty_after WHERE id = v_variant_id;
  ELSE
    UPDATE public.pos_products SET stock_qty = v_qty_after WHERE id = v_product_id;
  END IF;

  INSERT INTO public.activity_logs (user_id, action, entity_type, entity_id, description, metadata)
  VALUES (
    v_caller_id, 'adjusted_pos_stock', 'pos_stock_movement', v_movement_id,
    format('Stock adjustment (%s): %s%s units', v_type, CASE WHEN v_qty_delta > 0 THEN '+' ELSE '' END, v_qty_delta),
    jsonb_build_object('productId', v_product_id, 'variantId', v_variant_id, 'note', v_note)
  );

  RETURN jsonb_build_object('movement_id', v_movement_id, 'qty_before', v_qty_before, 'qty_after', v_qty_after);
END;
$function$;

-- ── Apply (post) a physical stock count ──────────────────────────────
-- Recomputes each line's delta against the CURRENT live stock_qty at apply
-- time (not the system_qty snapshotted when the count was created) so a
-- sale that happened mid-count is never silently double-corrected — the
-- count always resolves to exactly the counted_qty, atomically.
-- payload: { caller_id, count_id }
CREATE OR REPLACE FUNCTION public.pos_apply_stock_count(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id  uuid := (payload->>'caller_id')::uuid;
  v_count_id   uuid := (payload->>'count_id')::uuid;
  v_count      record;
  v_item       record;
  v_product    record;
  v_variant    record;
  v_qty_before numeric;
  v_qty_after  numeric;
  v_delta      numeric;
  v_corrections int := 0;
BEGIN
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'Missing caller_id'; END IF;
  IF v_count_id IS NULL THEN RAISE EXCEPTION 'Missing count_id'; END IF;

  SELECT * INTO v_count FROM public.pos_stock_counts WHERE id = v_count_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stock count not found'; END IF;
  IF v_count.status = 'applied' THEN RAISE EXCEPTION 'This count has already been applied'; END IF;
  IF v_count.status = 'cancelled' THEN RAISE EXCEPTION 'This count was cancelled'; END IF;

  FOR v_item IN
    SELECT * FROM public.pos_stock_count_items
    WHERE count_id = v_count_id AND deleted_at IS NULL AND counted_qty IS NOT NULL
  LOOP
    IF v_item.variant_id IS NOT NULL THEN
      SELECT * INTO v_variant FROM public.pos_product_variants WHERE id = v_item.variant_id FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;
      v_qty_before := v_variant.stock_qty;
    ELSE
      SELECT * INTO v_product FROM public.pos_products WHERE id = v_item.product_id FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;
      v_qty_before := v_product.stock_qty;
    END IF;

    v_delta := v_item.counted_qty - v_qty_before;

    IF v_delta <> 0 THEN
      v_qty_after := v_item.counted_qty;

      INSERT INTO public.pos_stock_movements
        (product_id, variant_id, type, qty_delta, qty_before, qty_after, stock_count_id, created_by)
      VALUES (v_item.product_id, v_item.variant_id, 'count_correction', v_delta, v_qty_before, v_qty_after, v_count_id, v_caller_id);

      IF v_item.variant_id IS NOT NULL THEN
        UPDATE public.pos_product_variants SET stock_qty = v_qty_after WHERE id = v_item.variant_id;
      ELSE
        UPDATE public.pos_products SET stock_qty = v_qty_after WHERE id = v_item.product_id;
      END IF;

      v_corrections := v_corrections + 1;
    END IF;

    UPDATE public.pos_stock_count_items
    SET variance = v_item.counted_qty - v_item.system_qty
    WHERE id = v_item.id;
  END LOOP;

  UPDATE public.pos_stock_counts
  SET status = 'applied', applied_by = v_caller_id, applied_at = now()
  WHERE id = v_count_id;

  INSERT INTO public.activity_logs (user_id, action, entity_type, entity_id, description, metadata)
  VALUES (
    v_caller_id, 'applied_pos_stock_count', 'pos_stock_count', v_count_id,
    format('Applied stock count — %s corrections', v_corrections),
    jsonb_build_object('corrections', v_corrections)
  );

  RETURN jsonb_build_object('count_id', v_count_id, 'corrections', v_corrections);
END;
$function$;
